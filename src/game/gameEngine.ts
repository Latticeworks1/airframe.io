/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3, Quaternion, Euler } from "three";
import {
  Pilot,
  Projectile,
  GroundTarget,
  SkyZone,
  InputFrame,
  AircraftSpecs,
  MatchMode,
  GameMap,
  WeaponType,
  AmmoBelt,
  KillEvent
} from "../types";
import { DEFAULT_AIRCRAFT, WEAPON_SPECS_MAP } from "./aircraftData";
import { FlightPhysicsEngine } from "./flightModel";
import { generateId } from "./math";
import { AircraftController } from "./aircraftController";
import { ProjectileSystem } from "./projectileSystem";
import { BotAISystem } from "./botAISystem";
import { GroundDefenseSystem } from "./groundDefenseSystem";
import { ObjectiveSystem } from "./objectiveSystem";
import { getTerrainHeight, getDeterministicIslands } from "./terrainModel";
import { MAP_DEFINITIONS } from "./content/maps/mapDefinitions";

const BOT_NAMES = [
  "RedBaron_00",
  "VipersNest",
  "SkyMaverick",
  "GhostPilot",
  "Spitfire99",
  "ZeroG",
  "Slayer_Ace",
  "MustangSally",
  "TornadoSlam",
  "Flanker_Fritz",
  "ZephyrDancer",
  "CloudSweeper"
];

type EnginePilot = Pilot & {
  weaponCooldowns?: Partial<Record<WeaponType, number>>;
  invulnerableTimer?: number;
};

function getSpawnYaw(team: 1 | 2): number {
  return team === 1 ? Math.PI / 2 : -Math.PI / 2;
}

function createEmptyInputFrame(): InputFrame {
  return {
    held: {
      w: false,
      s: false,
      a: false,
      d: false,
      q: false,
      e: false,
      b: false,
      f: false,
      g: false,
      shift: false,
      control: false,
      space: false,
      r: false,
      arrowUp: false,
      arrowDown: false,
      arrowLeft: false,
      arrowRight: false
    },
    edges: {
      flapsPressed: false,
      gearPressed: false,
      cameraPressed: false,
      resetPressed: false
    },
    mousePos: { x: 0, y: 0 },
    mouseDelta: { x: 0, y: 0 },
    rightMouse: false
  };
}

export class GameEngine {
  public pilots: Pilot[] = [];
  public projectiles: Projectile[] = [];
  public groundTargets: GroundTarget[] = [];
  public skyZones: SkyZone[] = [];
  public killFeed: KillEvent[] = [];

  public playerPilotId!: string;
  public selectedMapId: GameMap;
  public matchMode: MatchMode;

  public team1Score = 0;
  public team2Score = 0;
  public matchTimer = 360;
  public matchEnded = false;

  public xpEarnedThisMatch = 0;
  public targetsDestroyedThisMatch = 0;

  public isMultiplayer = false;
  public isHost = false;
  public onProjectileSpawn?: (type: WeaponType) => void;
  public onGroundTargetDamage?: (targetId: string, hp: number, isDead: boolean) => void;
  public onLocalPlayerKill?: (killerId: string, victimId: string, weapon: string) => void;
  public onLocalPlayerHit?: (targetId: string, isGround: boolean) => void;

  private onKillCallback: (event: KillEvent) => void;
  private onGameOverCallback: (victory: boolean, xp: number) => void;

  private controllers = new Map<string, AircraftController>();

  private getOrCreateController(pilotId: string): AircraftController {
    let ctrl = this.controllers.get(pilotId);
    if (!ctrl) {
      ctrl = new AircraftController();
      this.controllers.set(pilotId, ctrl);
    }
    return ctrl;
  }

  constructor(
    playerPlaneId: string,
    playerBelt: AmmoBelt,
    playerMods: string[],
    mapId: GameMap,
    mode: MatchMode,
    onKill: (event: KillEvent) => void,
    onGameOver: (victory: boolean, xp: number) => void,
    playerNickname?: string,
    startOnGround: boolean = false
  ) {
    this.selectedMapId = mapId;
    this.matchMode = mode;
    this.onKillCallback = onKill;
    this.onGameOverCallback = onGameOver;

    this.initMatch(playerPlaneId, playerBelt, playerMods, playerNickname, startOnGround);
  }

  private initMatch(
    playerPlaneId: string,
    playerBelt: AmmoBelt,
    playerMods: string[],
    playerNickname?: string,
    startOnGround: boolean = false
  ) {
    const pSpecs =
      DEFAULT_AIRCRAFT.find(a => a.id === playerPlaneId) || DEFAULT_AIRCRAFT[0];

    // Calculate starting position coordinates depending on spawn ground preference
    const { x: airX, y: airY, z: airZ, vx: airVx, vy: airVy, vz: airVz } = this.getAirSpawnPosition(1);
    let initialX = airX;
    let initialY = airY;
    let initialZ = airZ;
    let initialVx = airVx;
    let initialVy = airVy;
    let initialVz = airVz;
    let initialYaw = getSpawnYaw(1);
    let initialThrottle = 0.8;
    let initialGearDeployed = false;
    let initialFlaps: "up" | "combat" | "landing" = "up";

    if (startOnGround) {
      const mapDef = MAP_DEFINITIONS[this.selectedMapId];
      if (mapDef && mapDef.layout.hasCarriers) {
        // Spawn on Team 1 carrier deck: (-4000, 25.2, -3000), rotated Math.PI / 4
        // To give full taxi/kickoff distance on the 400m deck, offset back by ~120m
        const yaw = Math.PI / 4;
        initialX = -4000 - Math.sin(yaw) * 120;
        initialZ = -3000 - Math.cos(yaw) * 120;
        initialY = 25.2; // Sits neatly on flight deck level (25m)
        initialVx = 0;
        initialVy = 0;
        initialVz = 0;
        initialYaw = yaw;
        initialThrottle = 0.0; // Engine idling, ready for launch throttle-up
        initialGearDeployed = true; // Landing gear down
        initialFlaps = "combat"; // Takeoff/combat flaps for extra low-speed lift assist
      } else {
        // Find if map has an airfield block (e.g. Alpine Valleys)
        const islands = getDeterministicIslands(this.selectedMapId);
        const airfield = islands.find((isl: any) => isl.isAirfield);
        if (airfield) {
          // Spawn at runway center back-offset (runway length is 900m)
          const yaw = airfield.rotationY;
          initialX = airfield.x - Math.sin(yaw) * 300;
          initialZ = airfield.z - Math.cos(yaw) * 300;
          initialY = airfield.scaleY + 10.2; // Top of airfield runway block + slight clearance for gear
          initialVx = 0;
          initialVy = 0;
          initialVz = 0;
          initialYaw = yaw;
          initialThrottle = 0.0;
          initialGearDeployed = true;
          initialFlaps = "combat";
        } else {
          // Fallback to ground level spawn
          initialX = -1500;
          initialZ = 50;
          const terr = getTerrainHeight(initialX, initialZ, this.selectedMapId);
          initialY = terr.height + 1.5;
          initialVx = 0;
          initialVy = 0;
          initialVz = 0;
          initialYaw = getSpawnYaw(1);
          initialThrottle = 0.0;
          initialGearDeployed = true;
          initialFlaps = "combat";
        }
      }
    }

    const playerPilot: EnginePilot = {
      id: "player",
      name: playerNickname ? `${playerNickname} (You)` : "You (Pilot-01)",
      isBot: false,
      team: 1,
      aircraftId: pSpecs.id,
      specs: pSpecs,
      x: initialX,
      y: initialY,
      z: initialZ,
      vx: initialVx,
      vy: initialVy,
      vz: initialVz,
      pitch: 0,
      roll: 0,
      yaw: initialYaw,
      throttle: initialThrottle,
      engineTemperature: 75,
      damage: this.createEmptyDamage(),
      ammo: this.initAmmo(pSpecs),
      ammoBelt: playerBelt,
      modifications: playerMods,
      score: 0,
      kills: 0,
      deaths: 0,
      xpEarned: 0,
      smoothedPitch: 0,
      smoothedRoll: 0,
      smoothedYaw: 0,
      pitchIntent: 0,
      rollIntent: 0,
      yawIntent: 0,
      elevatorDeflection: 0,
      aileronDeflection: 0,
      rudderDeflection: 0,
      flaps: initialFlaps,
      gearDeployed: initialGearDeployed,
      airbrakeDeployed: false,
      weaponCooldowns: {},
      invulnerableTimer: 1.5
    };

    this.pilots.push(playerPilot);
    this.playerPilotId = "player";

    let adversaryCount = 5;
    let teammateCount = 4;

    if (this.matchMode === MatchMode.DuelArena) {
      adversaryCount = 1;
      teammateCount = 0;
      this.matchTimer = 180;
    }

    for (let i = 0; i < teammateCount; i++) {
      const bSpecs = DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)];
      this.spawnBot(1, bSpecs);
    }

    for (let i = 0; i < adversaryCount; i++) {
      const bSpecs = DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)];
      this.spawnBot(2, bSpecs);
    }

    this.buildObjectives();
  }

  private createEmptyDamage() {
    return {
      engine: 1.0,
      leftWing: 1.0,
      rightWing: 1.0,
      tail: 1.0,
      cockpit: 1.0,
      fuelTank: 1.0,
      fuselage: 1.0,
      hasFire: false,
      hasOilLeak: false
    };
  }

  private initAmmo(specs: AircraftSpecs): Record<WeaponType, number> {
    const caps: Record<WeaponType, number> = {} as any;

    specs.weapons.forEach(w => {
      caps[w] = WEAPON_SPECS_MAP[w].ammoCapacity;
    });

    return caps;
  }

  private getAirSpawnPosition(team: 1 | 2): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
    const mapDef = MAP_DEFINITIONS[this.selectedMapId];
    const sp = mapDef?.spawn ?? { distMin: 3500, distMax: 4200, aglMin: 350, aglMax: 650, initialSpeedMs: 140, spreadZ: 600 };
    const dist = sp.distMin + Math.random() * (sp.distMax - sp.distMin);
    const sign = team === 1 ? -1 : 1;
    const x = sign * dist;
    const z = (Math.random() - 0.5) * 2 * sp.spreadZ;
    const terrain = getTerrainHeight(x, z, this.selectedMapId);
    const agl = sp.aglMin + Math.random() * (sp.aglMax - sp.aglMin);
    const y = terrain.height + agl;

    // Derive velocity from the spawn yaw quaternion so world-space direction
    // is always consistent with aircraft orientation — no manual sign assumptions.
    const yaw = getSpawnYaw(team);
    const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0, "YXZ"));
    const vel = new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(sp.initialSpeedMs);

    return { x, y, z, vx: vel.x, vy: vel.y, vz: vel.z };
  }

  private spawnBot(team: 1 | 2, specs: AircraftSpecs, nameOverride?: string) {
    const bId = generateId();
    const { x, y, z, vx, vy, vz } = this.getAirSpawnPosition(team);

    const pilot: EnginePilot = {
      id: bId,
      name: nameOverride || BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
      isBot: true,
      team,
      aircraftId: specs.id,
      specs,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      pitch: 0,
      roll: 0,
      yaw: getSpawnYaw(team),
      throttle: 0.75,
      engineTemperature: 72,
      damage: this.createEmptyDamage(),
      ammo: this.initAmmo(specs),
      ammoBelt: AmmoBelt.Universal,
      modifications: [],
      score: 0,
      kills: 0,
      deaths: 0,
      xpEarned: 0,
      smoothedPitch: 0,
      smoothedRoll: 0,
      smoothedYaw: 0,
      pitchIntent: 0,
      rollIntent: 0,
      yawIntent: 0,
      elevatorDeflection: 0,
      aileronDeflection: 0,
      rudderDeflection: 0,
      flaps: "up",
      gearDeployed: false,
      airbrakeDeployed: false,
      weaponCooldowns: {},
      invulnerableTimer: 1.5,
      aiState: {
        behavior: "patrol",
        targetId: null,
        timer: Math.random() * 3,
        destinationX: 0,
        destinationY: 450,
        destinationZ: 0,
        skills: {
          accuracy: 0.5 + Math.random() * 0.4,
          aggression: 0.4 + Math.random() * 0.5,
          avoidance: 0.3 + Math.random() * 0.6
        }
      }
    };

    this.pilots.push(pilot);
  }

  private buildObjectives() {
    this.groundTargets = [];
    this.skyZones = [];

    if (
      this.matchMode === MatchMode.AirSupremacy ||
      this.matchMode === MatchMode.EndlessFront
    ) {
      this.skyZones.push(
        {
          id: "zone-a",
          name: "Alpha Zone",
          x: -1200,
          y: 500,
          z: -500,
          radius: 450,
          owningTeam: 0,
          captureProgress: 0
        },
        {
          id: "zone-b",
          name: "Bravo Zone",
          x: 0,
          y: 700,
          z: 0,
          radius: 600,
          owningTeam: 0,
          captureProgress: 0
        },
        {
          id: "zone-c",
          name: "Charlie Zone",
          x: 1200,
          y: 500,
          z: 500,
          radius: 450,
          owningTeam: 0,
          captureProgress: 0
        }
      );
    }

    const islandLocations = [
      { x: -2000, z: -1000 },
      { x: -500, z: -2500 },
      { x: 1800, z: -800 },
      { x: 300, z: 1600 },
      { x: -1100, z: 2400 },
      { x: 2200, z: 2000 }
    ];

    islandLocations.forEach((loc, index) => {
      const assignedTeam = index % 2 === 0 ? 1 : 2;

      this.groundTargets.push({
        id: `aa-${index}`,
        name: `FlaK AA Battery ${assignedTeam === 1 ? "A" : "B"}`,
        team: assignedTeam as 1 | 2,
        type: "anti-air",
        x: loc.x,
        y: 45,
        z: loc.z,
        hp: 120,
        maxHp: 120,
        isDead: false,
        fireCooldown: Math.random() * 2
      });

      this.groundTargets.push({
        id: `tgt-${index}`,
        name: assignedTeam === 1 ? "Red Radar Station" : "Blue Radar Station",
        team: assignedTeam as 1 | 2,
        type: "radar",
        x: loc.x + 80,
        y: 40,
        z: loc.z + 80,
        hp: 180,
        maxHp: 180,
        isDead: false
      });
    });

    if (this.matchMode === MatchMode.GroundStrike) {
      for (const team of [1, 2] as const) {
        for (let i = 0; i < 4; i++) {
          this.groundTargets.push({
            id: `convoy-t${team}-${i}`,
            name: `${team === 1 ? "Teammate" : "Adversary"} Convoy T${team} - #${i + 1}`,
            team,
            type: "convoy",
            x: team === 1 ? -3000 + i * 150 : 3000 - i * 150,
            y: 12,
            z: team === 1 ? -1500 + i * 40 : 1500 - i * 40,
            hp: 80,
            maxHp: 80,
            isDead: false
          });
        }
      }
    }
  }

  public update(dt: number, inputFrame: InputFrame, playerMouseTarget: Vector3 | null) {
    if (this.matchEnded) return;

    dt = Math.min(dt, 0.05);

    this.matchTimer = Math.max(0, this.matchTimer - dt);

    if (this.matchTimer <= 0) {
      this.endGame();
      return;
    }

    this.tickPilotCooldowns(dt);

    const player = this.pilots.find(p => p.id === "player") as EnginePilot | undefined;

    if (player) {
      if (player.damage.fuselage <= 0) {
        this.updateDeadPilot(player, dt);
      } else {
        const controller = this.getOrCreateController(player.id);
        const command = controller.update(player, inputFrame, playerMouseTarget, dt);
        FlightPhysicsEngine.update(player, command, dt, this.selectedMapId);
        this.enforceMapBoundary(player, dt);
        this.handleWeaponFiring(player, command.primaryFire, command.secondaryFire, dt);
      }
    }

    this.pilots.forEach(p => {
      if (!p.isBot) return;

      const bot = p as EnginePilot;

      if (bot.damage.fuselage <= 0) {
        this.updateDeadPilot(bot, dt);
      } else {
        if (this.isMultiplayer && !this.isHost) {
          // In multiplayer, remote non-host clients let the host synchronize bot positions
          bot.x += bot.vx * dt;
          bot.y += bot.vy * dt;
          bot.z += bot.vz * dt;
          return;
        }

        this.runAIConsensus(bot, dt);

        const botInput = createEmptyInputFrame();
        const botTarget = bot.aiState
          ? new Vector3(
              bot.aiState.destinationX,
              bot.aiState.destinationY,
              bot.aiState.destinationZ
            )
          : null;

        const controller = this.getOrCreateController(bot.id);
        const command = controller.update(bot, botInput, botTarget, dt);
        FlightPhysicsEngine.update(bot, command, dt, this.selectedMapId);
        this.enforceMapBoundary(bot, dt);
      }
    });

    this.updateProjectiles(dt);
    this.updateGroundDefense(dt);
    this.updateCaptureZones(dt);

    if (this.team1Score >= 1000 || this.team2Score >= 1000) {
      this.endGame();
    }
  }

  private tickPilotCooldowns(dt: number) {
    this.pilots.forEach(p => {
      const ep = p as EnginePilot;

      ep.invulnerableTimer = Math.max(0, (ep.invulnerableTimer ?? 0) - dt);

      if (!ep.weaponCooldowns) ep.weaponCooldowns = {};

      Object.keys(ep.weaponCooldowns).forEach(k => {
        const w = k as WeaponType;
        ep.weaponCooldowns![w] = Math.max(0, (ep.weaponCooldowns![w] ?? 0) - dt);
      });
    });
  }

  private updateDeadPilot(pilot: Pilot, dt: number) {
    pilot.vy -= 90 * dt;
    pilot.pitch += dt * 4;
    pilot.x += pilot.vx * dt;
    pilot.y += pilot.vy * dt;
    pilot.z += pilot.vz * dt;

    if (pilot.y < 20) {
      this.respawnPilot(pilot);
    }
  }

  private handleWeaponFiring(
    pilot: Pilot,
    triggerPrimary: boolean,
    triggerSecondary: boolean,
    dt: number
  ) {
    const ep = pilot as EnginePilot;

    if (!ep.weaponCooldowns) ep.weaponCooldowns = {};

    pilot.specs.weapons.forEach(wType => {
      const spec = WEAPON_SPECS_MAP[wType];
      const ammo = pilot.ammo[wType] ?? 0;

      if (ammo <= 0) return;

      const cooldown = ep.weaponCooldowns![wType] ?? 0;
      if (cooldown > 0) return;

      const isSecondary = wType === WeaponType.ROCKET || wType === WeaponType.BOMB;

      if (isSecondary) {
        if (!triggerSecondary) return;

        this.spawnProjectile(pilot, wType);
        pilot.ammo[wType]--;
        ep.weaponCooldowns![wType] = 1 / Math.max(0.01, spec.fireRate);
        return;
      }

      if (!triggerPrimary) return;

      const shotChance = spec.fireRate * dt * 0.9;

      if (Math.random() < shotChance) {
        this.spawnProjectile(pilot, wType);
        pilot.ammo[wType]--;
        ep.weaponCooldowns![wType] = 0.015;
      }
    });
  }

  public spawnProjectile(pilot: Pilot, type: WeaponType) {
    ProjectileSystem.spawnProjectile(pilot, type, this.projectiles, this.onProjectileSpawn);
  }

  private updateProjectiles(dt: number) {
    ProjectileSystem.updateProjectiles(
      dt,
      this.projectiles,
      this.pilots,
      this.groundTargets,
      {
        registerKill: (k, v, w) => this.registerKill(k, v, w),
        registerGroundTargetKill: (k, t) => this.registerGroundTargetKill(k, t),
        onProjectileSpawn: this.onProjectileSpawn,
        onGroundTargetDamage: this.onGroundTargetDamage,
        onHitEnemy: (k, t, isGround) => {
          if (k === "player" && this.onLocalPlayerHit) {
            this.onLocalPlayerHit(t, isGround);
          }
        }
      }
    );
  }

  public forceRegisterKill(killerId: string, victimId: string, weapon: string) {
    this.registerKill(killerId, victimId, weapon);
  }

  private registerKill(killerId: string, victimId: string, weapon: string) {
    const killer = this.pilots.find(p => p.id === killerId);
    const victim = this.pilots.find(p => p.id === victimId);

    if (!victim) return;
    if (victim.damage.fuselage <= 0) return; // Guard duplicate registers in multiplayer

    if (killerId === "player" && this.onLocalPlayerKill) {
      this.onLocalPlayerKill(killerId, victimId, weapon);
    }

    if (victim.damage.fuselage > 0) {
      victim.damage.fuselage = 0;
    }

    victim.deaths++;

    let killMsg = `${victim.name} crashed`;

    if (killer) {
      killer.kills++;
      killer.score += 300;
      killMsg = `${killer.name} downed ${victim.name} with ${weapon}`;

      if (killerId === "player") {
        this.xpEarnedThisMatch += 150 + (weapon === WeaponType.ROCKET ? 100 : 0);
        this.team1Score += 100;
      } else if (killer.team === 1) {
        this.team1Score += 100;
      } else {
        this.team2Score += 100;
      }
    }

    const event: KillEvent = {
      id: generateId(),
      killerName: killer ? killer.name : "System",
      killerTeam: killer ? killer.team : 1,
      victimName: victim.name,
      victimTeam: victim.team,
      method: weapon,
      timestamp: Date.now()
    };

    this.killFeed.unshift(event);
    if (this.killFeed.length > 6) this.killFeed.pop();

    this.onKillCallback(event);
  }

  private registerGroundTargetKill(killerId: string, target: GroundTarget) {
    const killer = this.pilots.find(p => p.id === killerId);

    if (killer) {
      killer.score += 200;

      if (killerId === "player") {
        this.xpEarnedThisMatch += 120;
        this.targetsDestroyedThisMatch++;
        this.team1Score += 80;
      } else if (killer.team === 1) {
        this.team1Score += 80;
      } else {
        this.team2Score += 80;
      }
    }

    const event: KillEvent = {
      id: generateId(),
      killerName: killer ? killer.name : "System",
      killerTeam: killer ? killer.team : 1,
      victimName: target.name,
      victimTeam: target.team,
      method: "Heavy Ordnance",
      timestamp: Date.now()
    };

    this.killFeed.unshift(event);
    if (this.killFeed.length > 6) this.killFeed.pop();

    this.onKillCallback(event);
  }

  private enforceMapBoundary(pilot: Pilot, dt: number) {
    const mapRadius = MAP_DEFINITIONS[this.selectedMapId]?.world?.radius ?? 6000;
    const dist = Math.sqrt(pilot.x * pilot.x + pilot.z * pilot.z);
    if (dist > mapRadius) {
      const scale = Math.max(80, Math.sqrt(pilot.vx ** 2 + pilot.vy ** 2 + pilot.vz ** 2)) * 2 * dt;
      pilot.vx += (-pilot.x / dist) * scale;
      pilot.vz += (-pilot.z / dist) * scale;
    }
  }

  private respawnPilot(pilot: Pilot) {
    const ep = pilot as EnginePilot;

    pilot.damage = this.createEmptyDamage();
    pilot.ammo = this.initAmmo(pilot.specs);

    ep.weaponCooldowns = {};
    ep.invulnerableTimer = 2.0;

    const { x: rx, y: ry, z: rz, vx: rvx, vy: rvy, vz: rvz } = this.getAirSpawnPosition(pilot.team as 1 | 2);
    pilot.x = rx;
    pilot.y = ry;
    pilot.z = rz;
    pilot.vx = rvx;
    pilot.vy = rvy;
    pilot.vz = rvz;
    pilot.pitch = 0;
    pilot.roll = 0;
    pilot.yaw = getSpawnYaw(pilot.team);
    pilot.throttle = 0.8;
    pilot.engineTemperature = 75;
    pilot.smoothedPitch = 0;
    pilot.smoothedRoll = 0;
    pilot.smoothedYaw = 0;
    pilot.pitchIntent = 0;
    pilot.rollIntent = 0;
    pilot.yawIntent = 0;
    pilot.elevatorDeflection = 0;
    pilot.aileronDeflection = 0;
    pilot.rudderDeflection = 0;
    pilot.flaps = "up";
    pilot.gearDeployed = false;
    pilot.airbrakeDeployed = false;
  }

  private runAIConsensus(bot: Pilot, dt: number) {
    BotAISystem.runAIConsensus(
      bot,
      dt,
      this.pilots,
      this.groundTargets,
      this.skyZones,
      (p, prim, sec, d) => this.handleWeaponFiring(p, prim, sec, d)
    );
  }

  private updateGroundDefense(dt: number) {
    GroundDefenseSystem.updateGroundDefense(
      dt,
      this.groundTargets,
      this.pilots,
      this.projectiles,
      this.isMultiplayer,
      this.isHost
    );
  }

  private updateCaptureZones(dt: number) {
    ObjectiveSystem.updateCaptureZones(
      dt,
      this.skyZones,
      this.pilots,
      (team, amt) => {
        if (team === 1) this.team1Score += amt;
        else if (team === 2) this.team2Score += amt;
      },
      this.isMultiplayer,
      this.isHost
    );

    this.team1Score = Math.floor(this.team1Score);
    this.team2Score = Math.floor(this.team2Score);
  }

  private endGame() {
    this.matchEnded = true;
    const playerWon = this.team1Score >= this.team2Score;

    if (playerWon) {
      this.xpEarnedThisMatch += 400;
    }

    this.onGameOverCallback(playerWon, this.xpEarnedThisMatch);
  }
}