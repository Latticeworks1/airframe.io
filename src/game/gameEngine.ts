/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Vector3, Quaternion, Euler } from "three";
import {
  Pilot,
  Projectile,
  GroundTarget,
  SkyZone,
  InputFrame,
  AircraftSpecs,
  MatchMode,
  WeaponType,
  AmmoBelt,
  KillEvent,
  CampaignMissionDefinition,
  CampaignMissionState
} from "../types";
import { DEFAULT_AIRCRAFT, WEAPON_SPECS_MAP } from "./aircraftData";
import { FlightPhysicsEngine } from "./flightModel";
import { generateId } from "./math";
import { AircraftController } from "./aircraftController";
import { ProjectileSystem } from "./projectileSystem";
import { BotAISystem } from "./botAISystem";
import { GroundDefenseSystem } from "./groundDefenseSystem";
import { ObjectiveSystem } from "./objectiveSystem";
import { getTerrainHeight, getTerrainLayout } from "./terrainModel";
import { MAP_REGISTRY } from "./content/maps/registry";
import { resolveCarriers } from "./content/structures/registry";
import { getCampaignMission } from "./content/campaign/campaignMissions";

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
  public selectedMapId: string;
  public matchMode: MatchMode;

  public team1Score = 0;
  public team2Score = 0;
  public matchTimer = 360;
  public matchEnded = false;


  public xpEarnedThisMatch = 0;
  public targetsDestroyedThisMatch = 0;
  public campaignMission: CampaignMissionDefinition | null = null;
  public campaignState: CampaignMissionState | null = null;
  public secondaryWeaponPreference: WeaponType | null = null;

  public isMultiplayer = false;
  public isHost = false;
  private _dtSmooth: number | undefined = undefined;
  public onProjectileSpawn?: (type: WeaponType) => void;
  public onProjectileImpact?: (
    type: WeaponType,
    position: Vector3,
    ownerId: string
  ) => void;
  public onGroundTargetDamage?: (targetId: string, hp: number, isDead: boolean) => void;
  public onLocalPlayerKill?: (killerId: string, victimId: string, weapon: string) => void;
  public onLocalPlayerHit?: (targetId: string, isGround: boolean) => void;
  public onPlayerDamage?: (
    shooterId: string,
    targetId: string,
    damage: number,
    bulletType: string,
    hitSpotLocal: Vector3
  ) => void;
  public onVoxelHit?: (
    targetId: string,
    localOffsetMeters: Vector3,
    blastMeters: number
  ) => void;
  public onPilotRespawn?: (pilotId: string) => void;
  public getVoxelImpact?: (
    targetId: string,
    segStartLocal: Vector3,
    segEndLocal: Vector3
  ) => THREE.Vector3 | null | undefined;

  private onKillCallback: (event: KillEvent) => void;
  private onGameOverCallback: (victory: boolean, xp: number) => void;
  public onMatchEnd?: (playerWon: boolean) => void;

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
    mapId: string,
    mode: MatchMode,
    onKill: (event: KillEvent) => void,
    onGameOver: (victory: boolean, xp: number) => void,
    playerNickname?: string,
    startOnGround: boolean = false,
    campaignMissionId?: string | null
  ) {
    this.selectedMapId = mapId;
    this.matchMode = mode;
    this.onKillCallback = onKill;
    this.onGameOverCallback = onGameOver;
    this.campaignMission = getCampaignMission(campaignMissionId);
    if (this.campaignMission) {
      this.matchTimer = this.campaignMission.timeLimitSeconds;
      this.campaignState = {
        missionId: this.campaignMission.id,
        name: this.campaignMission.operation,
        objectiveLabel: this.campaignMission.objectiveLabel,
        progress: 0,
        targetCount: this.campaignMission.targetCount,
        completed: false
      };
    }

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
      const mapDef = MAP_REGISTRY[this.selectedMapId];
      const teamCarrier = mapDef ? resolveCarriers(mapDef.layout.carriers)[0] : undefined;
      if (teamCarrier) {
        const yaw = teamCarrier.rotationY;
        initialX = teamCarrier.x - Math.sin(yaw) * 120;
        initialZ = teamCarrier.z - Math.cos(yaw) * 120;
        initialY = teamCarrier.deckHeight;
        initialVx = 0;
        initialVy = 0;
        initialVz = 0;
        initialYaw = yaw;
        initialThrottle = 0.0; // Engine idling, ready for launch throttle-up
        initialGearDeployed = true; // Landing gear down
        initialFlaps = "combat"; // Takeoff/combat flaps for extra low-speed lift assist
      } else {
        const layout = mapDef ? getTerrainLayout(mapDef) : null;
        const airfieldFeature = layout?.features.find(f => f.type === "airfield");
        const airfieldBlock = airfieldFeature
          ? layout!.blocks.find(b => b.id === airfieldFeature.parentBlockId)
          : null;
        if (airfieldBlock) {
          const yaw = airfieldBlock.rotationY;
          initialX = airfieldBlock.position[0] - Math.sin(yaw) * 300;
          initialZ = airfieldBlock.position[2] - Math.cos(yaw) * 300;
          initialY = airfieldBlock.scale[1] + 10.2;
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

    const playerPilot: EnginePilot = new Pilot({
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
      elevatorDeflection: 0,
      aileronDeflection: 0,
      rudderDeflection: 0,
      flaps: initialFlaps,
      gearDeployed: initialGearDeployed,
      airbrakeDeployed: false,
      weaponCooldowns: {},
      invulnerableTimer: 1.5
    }) as EnginePilot;

    this.pilots.push(playerPilot);
    this.playerPilotId = "player";

    if (this.matchMode === MatchMode.DuelArena) {
      this.spawnBot(2, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);
      this.matchTimer = 180;
    } else {
      // Fill the room with bots — real players displace them as they join.
      // ROOM_SIZE must match MAX_PLAYERS_PER_ROOM in server.ts.
      const ROOM_SIZE = 32;
      const half = ROOM_SIZE / 2;
      for (let i = 0; i < half - 1; i++) {
        this.spawnBot(1, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);
      }
      for (let i = 0; i < half; i++) {
        this.spawnBot(2, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);
      }
    }

    this.buildObjectives();
  }

  // Called by the host client when a real player joins — evict one bot from that team.
  public removeBot(team: 1 | 2): boolean {
    const idx = this.pilots.findIndex(p => p.isBot && p.team === team);
    if (idx === -1) return false;
    this.pilots.splice(idx, 1);
    return true;
  }

  // Called by the host client when a real player leaves — fill the empty slot.
  public addBot(team: 1 | 2) {
    const specs = DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)];
    this.spawnBot(team, specs);
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
    const mapDef = MAP_REGISTRY[this.selectedMapId];
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

    const pilot: EnginePilot = new Pilot({
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
    }) as EnginePilot;

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

      this.groundTargets.push(new GroundTarget({
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
      }));

      this.groundTargets.push(new GroundTarget({
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
      }));
    });

    if (this.matchMode === MatchMode.GroundStrike) {
      for (const team of [1, 2] as const) {
        for (let i = 0; i < 4; i++) {
          this.groundTargets.push(new GroundTarget({
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
          }));
        }
      }
    }
  }

  public update(dt: number, inputFrame: InputFrame, playerMouseTarget: Vector3 | null) {
    if (this.matchEnded) return;

    this.matchTimer = Math.max(0, this.matchTimer - dt);

    if (this.matchTimer <= 0) {
      this.endGame();
      return;
    }

    // Adaptive physics rate: track a simple rolling average of dt and scale the
    // sub-step ceiling up when the GPU is clearly overloaded (sustained >20ms
    // frames). This keeps the physics loop from consuming most of the frame
    // budget and allows the renderer to catch up. Minimum is 50Hz (0.02s).
    this._dtSmooth = this._dtSmooth === undefined
      ? dt
      : this._dtSmooth * 0.95 + dt * 0.05;
    const maxSubStep = Math.min(0.02, Math.max(0.01, this._dtSmooth * 0.5));
    let timeLeft = Math.min(0.1, dt); // clamp total dt to guard against death spiral

    while (timeLeft > 0) {
      const step = Math.min(maxSubStep, timeLeft);

      this.tickPilotCooldowns(step);

      const player = this.pilots.find(p => p.id === "player") as EnginePilot | undefined;

      if (player) {
        if (player.damage.fuselage <= 0) {
          this.updateDeadPilot(player, step);
        } else {
          const controller = this.getOrCreateController(player.id);
          const command = controller.update(player, inputFrame, playerMouseTarget, step);
          player.lastCommand = command;
          FlightPhysicsEngine.update(player, command, step, this.selectedMapId);
          this.enforceMapBoundary(player, step);
          this.handleWeaponFiring(player, command.primaryFire, command.secondaryFire, step);
        }
      }

      this.pilots.forEach(p => {
        if (p.id === "player") return;

        const pilot = p as EnginePilot;

        if (pilot.damage.fuselage <= 0) {
          this.updateDeadPilot(pilot, step);
        } else {
          if (pilot.isBot) {
            if (this.isMultiplayer && !this.isHost) {
              // In multiplayer, remote non-host clients let the host synchronize bot positions
              pilot.x += pilot.vx * step;
              pilot.y += pilot.vy * step;
              pilot.z += pilot.vz * step;
              return;
            }

            this.runAIConsensus(pilot, step);

            const botInput = createEmptyInputFrame();
            const botTarget = pilot.aiState
              ? new Vector3(
                  pilot.aiState.destinationX,
                  pilot.aiState.destinationY,
                  pilot.aiState.destinationZ
                )
              : null;

            const controller = this.getOrCreateController(pilot.id);
            const command = controller.update(pilot, botInput, botTarget, step);
            pilot.lastCommand = command;
            FlightPhysicsEngine.update(pilot, command, step, this.selectedMapId);
            this.enforceMapBoundary(pilot, step);
          } else {
            // Remote player linear extrapolation
            pilot.x += pilot.vx * step;
            pilot.y += pilot.vy * step;
            pilot.z += pilot.vz * step;
          }
        }
      });

      this.updateProjectiles(step);
      this.updateGroundDefense(step);
      this.updateCaptureZones(step);

      timeLeft -= step;
    }

    this.updateCampaignMission();

    if (!this.campaignMission && (this.team1Score >= 1000 || this.team2Score >= 1000)) {
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

    const usableSecondary = pilot.specs.weapons.find(wType => {
      if (wType !== WeaponType.ROCKET && wType !== WeaponType.BOMB) return false;
      if ((pilot.ammo[wType] ?? 0) <= 0) return false;
      return this.secondaryWeaponPreference
        ? wType === this.secondaryWeaponPreference
        : true;
    }) ?? pilot.specs.weapons.find(
      wType =>
        (wType === WeaponType.ROCKET || wType === WeaponType.BOMB) &&
        (pilot.ammo[wType] ?? 0) > 0
    );

    pilot.specs.weapons.forEach(wType => {
      const spec = WEAPON_SPECS_MAP[wType];
      const ammo = pilot.ammo[wType] ?? 0;

      if (ammo <= 0) return;

      const cooldown = ep.weaponCooldowns![wType] ?? 0;
      if (cooldown > 0) return;

      const isSecondary = wType === WeaponType.ROCKET || wType === WeaponType.BOMB;

      if (isSecondary) {
        if (!triggerSecondary) return;
        if (wType !== usableSecondary) return;

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
      this.selectedMapId,
      {
        registerKill: (k, v, w) => this.registerKill(k, v, w),
        registerGroundTargetKill: (k, t) => this.registerGroundTargetKill(k, t),
        onProjectileSpawn: this.onProjectileSpawn,
        onProjectileImpact: this.onProjectileImpact,
        onGroundTargetDamage: this.onGroundTargetDamage,
        onPlayerDamage: (k, t, d, b, s) => {
          if (this.onPlayerDamage) {
            this.onPlayerDamage(k, t, d, b, s);
          }
        },
        onHitEnemy: (k, t, isGround) => {
          if (k === "player" && this.onLocalPlayerHit) {
            this.onLocalPlayerHit(t, isGround);
          }
        },
        onVoxelHit: (targetId, localOffsetMeters, blastMeters) => {
          if (this.onVoxelHit) this.onVoxelHit(targetId, localOffsetMeters, blastMeters);
        },
        getVoxelImpact: (targetId, segStartLocal, segEndLocal) => {
          return this.getVoxelImpact?.(targetId, segStartLocal, segEndLocal);
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

    if (killer) {
      killer.kills++;
      killer.score += 300;

      // Non-host clients receive authoritative team scores via score_sync; skip local accumulation
      // to avoid double-counting when kill_confirmed arrives out of order relative to scores_updated.
      if (!this.isMultiplayer || this.isHost) {
        if (killerId === "player") {
          this.xpEarnedThisMatch += 150 + (weapon === WeaponType.ROCKET ? 100 : 0);
          this.team1Score += 100;
        } else if (killer.team === 1) {
          this.team1Score += 100;
        } else {
          this.team2Score += 100;
        }
      } else if (killerId === "player") {
        this.xpEarnedThisMatch += 150 + (weapon === WeaponType.ROCKET ? 100 : 0);
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
    const mapRadius = MAP_REGISTRY[this.selectedMapId]?.world?.radius ?? 6000;
    const dist = Math.sqrt(pilot.x * pilot.x + pilot.z * pilot.z);
    if (dist > mapRadius) {
      const horizontalSpeed = Math.hypot(pilot.vx, pilot.vz);
      if (horizontalSpeed > 1e-6) {
        const targetVx = (-pilot.x / dist) * horizontalSpeed;
        const targetVz = (-pilot.z / dist) * horizontalSpeed;
        const steer = Math.min(1, dt * 2);
        pilot.vx += (targetVx - pilot.vx) * steer;
        pilot.vz += (targetVz - pilot.vz) * steer;

        // Lerp can slightly shrink a vector but must never add kinetic energy.
        const steeredSpeed = Math.hypot(pilot.vx, pilot.vz);
        if (steeredSpeed > horizontalSpeed) {
          const correction = horizontalSpeed / steeredSpeed;
          pilot.vx *= correction;
          pilot.vz *= correction;
        }

        if (pilot.isBot) {
          // Snap bot orientation inward to prevent boundary locking
          pilot.yaw = Math.atan2(-pilot.x, -pilot.z);
          pilot.pitch = 0;
          pilot.roll = 0;
        }
      }
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
    pilot.avx = 0;
    pilot.avy = 0;
    pilot.avz = 0;
    pilot.isStalling = false;
    pilot.stallSeverity = 0;
    pilot.physicsDebug = undefined;
    pilot.throttle = 0.8;
    pilot.engineTemperature = 75;
    pilot.smoothedPitch = 0;
    pilot.smoothedRoll = 0;
    pilot.smoothedYaw = 0;
    pilot.elevatorDeflection = 0;
    pilot.aileronDeflection = 0;
    pilot.rudderDeflection = 0;
    pilot.lastCommand = undefined;
    pilot.flaps = "up";
    pilot.gearDeployed = false;
    pilot.airbrakeDeployed = false;

    // A controller carries blend and toggle state between frames. A new life must
    // start with a new controller so no manual override or trim-like state leaks
    // through the respawn boundary.
    this.controllers.delete(pilot.id);

    if (this.onPilotRespawn) this.onPilotRespawn(pilot.id);
  }

  private runAIConsensus(bot: Pilot, dt: number) {
    const mapRadius = MAP_REGISTRY[this.selectedMapId]?.world?.radius ?? 6000;
    BotAISystem.runAIConsensus(
      bot,
      dt,
      this.pilots,
      this.groundTargets,
      this.skyZones,
      (p, prim, sec, d) => this.handleWeaponFiring(p, prim, sec, d),
      mapRadius
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

  private updateCampaignMission() {
    if (!this.campaignMission || !this.campaignState || this.matchEnded) return;

    const player = this.pilots.find(p => p.id === this.playerPilotId);
    const progress =
      this.campaignMission.objectiveType === "destroy-ground"
        ? this.targetsDestroyedThisMatch
        : player?.kills ?? 0;

    this.campaignState.progress = Math.min(
      progress,
      this.campaignMission.targetCount
    );

    if (this.campaignState.progress >= this.campaignMission.targetCount) {
      this.campaignState.completed = true;
      this.xpEarnedThisMatch += this.campaignMission.xpReward;
      this.endGame(true);
    }
  }

  public forceEndGame(playerWon: boolean) {
    if (this.matchEnded) return;
    this.matchEnded = true;
    if (playerWon) this.xpEarnedThisMatch += 400;
    this.onGameOverCallback(playerWon, this.xpEarnedThisMatch);
  }

  private endGame(victoryOverride?: boolean) {
    const playerWon = victoryOverride ?? (
      this.campaignMission
        ? this.campaignState?.completed === true
        : this.team1Score >= this.team2Score
    );
    this.onMatchEnd?.(playerWon);
    this.forceEndGame(playerWon);
  }
}
