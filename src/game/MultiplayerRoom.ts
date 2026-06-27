import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Euler } from "three";
import { Pilot, FlightCommand, WeaponType, AmmoBelt, GroundTarget, SkyZone, AircraftSpecs } from "../types";
import { destructible, control } from "../types/components";
import { getVoxelDef } from "./content/aircraft/voxelRegistry";
import { buildVoxelGrid, findVoxelImpact, deformAtImpact, VoxelGridState } from "./voxelMesh";
import { getTerrainHeight } from "./terrainModel";
import { FlightPhysicsEngine } from "./flightModel";
import { EngineCallbacks, getProjectileReleaseState } from "./projectileSystem";
import { DEFAULT_AIRCRAFT, WEAPON_SPECS_MAP } from "./aircraftData";
import { generateId, getPlaneHitRadius } from "./math";
import { MAP_REGISTRY } from "./content/maps/registry";
import { BotAISystem } from "./botAISystem";
import { loadHeightmap } from "./terrainModel";
import { ObjectiveSystem } from "./objectiveSystem";
import fs from "fs";
import path from "path";

// ---- Colyseus State Schema ----

export class NetworkPlayer extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("uint8") team: number = 1;
  @type("string") aircraftId: string = "";
  @type("string") skin: string = "default";
  @type("uint32") score: number = 0;
  @type("uint16") kills: number = 0;
  @type("uint16") deaths: number = 0;
  @type("boolean") isBot: boolean = false;
  @type("uint32") lastProcessedSeq: number = 0;
}

export class MatchState extends Schema {
  @type({ map: NetworkPlayer }) players = new MapSchema<NetworkPlayer>();
  @type("uint32") team1Score: number = 0;
  @type("uint32") team2Score: number = 0;
  @type("number") matchTimer: number = 360;
  @type("boolean") matchEnded: boolean = false;
}

// Compact client input packet tuple:
// [seq, pitch, roll, yaw, throttleDelta, boost, airbrake, primaryFire, secondaryFire, flaps, gearDeployed]
export type ClientInputTuple = [
  number, // seq
  number, // pitch
  number, // roll
  number, // yaw
  number, // throttleDelta
  number, // boost (0 or 1)
  number, // airbrake (0 or 1)
  number, // primaryFire (0 or 1)
  number, // secondaryFire (0 or 1)
  number, // flaps (0 = up, 1 = combat, 2 = landing)
  number  // gearDeployed (0 or 1)
];

interface ClientInputState {
  seq: number;
  command: FlightCommand;
}

interface HistoricalTransform {
  tick: number;
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
  vx: number; vy: number; vz: number;
}

// Names list for bot spawning
const BOT_NAMES = [
  "Striker", "Interceptor", "Spectre", "Phoenix", "Phantom",
  "Grizzly", "Falcon", "Viper", "Cobra", "Reaper",
  "Warlord", "Tornado", "Spitfire", "Mustang", "Zero"
];

const FIXED_DT = 1 / 60;

let rapierInitialized = false;
async function ensureRapier() {
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }
}

function getSpawnYaw(team: number): number {
  return team === 1 ? Math.PI / 2 : -Math.PI / 2;
}

export class MultiplayerRoom extends Room<{ state: MatchState }> {
  maxClients = 16;
  private rapierWorld!: RAPIER.World;
  private mapId!: string;
  private matchMode!: number;
  
  // Authoritative simulation state
  private pilots = new Map<string, Pilot>();
  private projectiles: any[] = [];
  private groundTargets: GroundTarget[] = [];
  private skyZones: SkyZone[] = [];
  private playerVoxelGrids = new Map<string, VoxelGridState>();
  
  // Rapier physics proxies
  private rigidBodies = new Map<string, RAPIER.RigidBody>();
  private colliders = new Map<string, RAPIER.Collider>();
  
  // Timing / Tick variables
  private serverTick = 0;
  private accumulator = 0;
  
  // Input queues (sessionId -> ClientInputState[])
  private inputQueues = new Map<string, ClientInputState[]>();
  private lastInputs = new Map<string, FlightCommand>();
  
  // Position history for lag compensation (playerId -> HistoricalTransform[])
  private playerHistory = new Map<string, HistoricalTransform[]>();

  // Fractional score accumulators for capture zone ticking
  private team1FractionalScore = 0;
  private team2FractionalScore = 0;

  async onCreate(options: any) {
    this.autoDispose = false;
    this.setState(new MatchState());
    
    this.mapId = options.mapId || "island-chain";
    this.matchMode = options.mode || 1; // AirSupremacy
    
    // Load heightmap data headlessly
    const mapDef = MAP_REGISTRY[this.mapId];
    if (mapDef && mapDef.terrain.kind === "heightmap") {
      try {
        await loadHeightmap(mapDef.terrain.path, mapDef.world.radius, mapDef.terrain.elevationScale);
        console.log(`[MultiplayerRoom] Headless heightmap cached for ${this.mapId}`);
      } catch (e) {
        console.error(`[MultiplayerRoom] Heightmap cache failed for ${this.mapId}:`, e);
      }
    }
    
    await ensureRapier();
    this.rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    
    this.buildObjectives();
    this.fillWithBots();

    this.onMessage("input", (client, packet: ClientInputTuple) => {
      this.enqueueInput(client.sessionId, packet);
    });

    this.onMessage("chat", (client, text: string) => {
      const pState = this.state.players.get(client.sessionId);
      if (pState && typeof text === "string") {
        this.broadcast("chat", [
          this.serverTick,
          pState.id,
          pState.name,
          text.slice(0, 140)
        ]);
      }
    });

    this.setSimulationInterval((dtMs) => this.updateSimulation(dtMs), 1000 / 60);
  }

  async onAuth(client: Client, options: any) {
    const token = options.token;
    const nickname = options.nickname;
    if (!token || typeof token !== "string" || token.length > 128) {
      throw new Error("Invalid session token");
    }

    const saveDir = fs.existsSync("/data") ? "/data/saves" : path.join(process.cwd(), "saves");
    const filePath = path.join(saveDir, `${token}.json`);

    // On ephemeral deployments (HuggingFace Spaces) the save directory is reset
    // on every container restart. Allow joining with the options data as a guest
    // rather than hard-rejecting returning players whose session file no longer exists.
    if (!fs.existsSync(filePath)) {
      console.warn(`[Auth] No save for token ${token.slice(0, 8)}… — guest session`);
      return {
        nickname: nickname || "Pilot",
        selectedPlaneId: options.aircraftId || "falcon-mk2",
        isGuest: true
      };
    }

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const save = JSON.parse(raw);
      // Accept nickname from options so a player who changed it without re-registering
      // is not blocked; the canonical name lives in the save for history only.
      return { ...save, nickname: nickname || save.nickname };
    } catch (err) {
      console.error(`onAuth validation failed for ${token}:`, err);
      return {
        nickname: nickname || "Pilot",
        selectedPlaneId: options.aircraftId || "falcon-mk2",
        isGuest: true
      };
    }
  }

  onUncaughtException(error: Error, methodName: string) {
    console.error(`[Room ${this.roomId}] Uncaught exception in ${methodName}:`, error);
  }

  onJoin(client: Client, options: any) {
    const authData = client.auth;
    const assignedTeam = this.balanceTeams();
    const planeId = options.aircraftId || authData.selectedPlaneId || "falcon-mk2";
    const skin = options.skin || authData.customizations?.skin || "default";

    // Evict a bot from the same team
    this.evictBot(assignedTeam);

    // Initialize the Pilot object
    const specs = DEFAULT_AIRCRAFT.find(a => a.id === planeId) || DEFAULT_AIRCRAFT[0];
    const spawnPos = this.getAirSpawnPosition(assignedTeam);

    const player = new Pilot({
      id: client.sessionId,
      name: authData.nickname || "Maverick",
      isBot: false,
      team: assignedTeam,
      aircraftId: planeId,
      specs,
      x: spawnPos.x,
      y: spawnPos.y,
      z: spawnPos.z,
      vx: spawnPos.vx,
      vy: spawnPos.vy,
      vz: spawnPos.vz,
      pitch: 0,
      roll: 0,
      yaw: getSpawnYaw(assignedTeam),
      throttle: 0.8,
      engineTemperature: 75,
      damage: this.createEmptyDamage(),
      ammo: this.initAmmo(specs),
      ammoBelt: authData.selectedBelt || AmmoBelt.Universal,
      modifications: authData.equippedMods?.[planeId] || [],
      score: 0,
      kills: 0,
      deaths: 0,
      weaponCooldowns: {},
      invulnerableTimer: 2.0
    });

    this.pilots.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);

    // Create Rapier body
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setUserData({ playerId: client.sessionId });
    const body = this.rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(getPlaneHitRadius(specs) + 3.2); // include buffer
    const collider = this.rapierWorld.createCollider(colliderDesc, body);
    
    this.rigidBodies.set(client.sessionId, body);
    this.colliders.set(client.sessionId, collider);

    // Initialize headless voxel grid state if it exists
    const voxDef = getVoxelDef(planeId);
    if (voxDef) {
      this.playerVoxelGrids.set(client.sessionId, buildVoxelGrid(voxDef));
    }

    // Add to Colyseus MapSchema
    const netPlayer = new NetworkPlayer();
    netPlayer.id = client.sessionId;
    netPlayer.name = player.name;
    netPlayer.team = assignedTeam;
    netPlayer.aircraftId = planeId;
    netPlayer.skin = skin;
    netPlayer.score = 0;
    netPlayer.kills = 0;
    netPlayer.deaths = 0;
    netPlayer.isBot = false;
    this.state.players.set(client.sessionId, netPlayer);

    // Send welcome / join confirmation
    client.send("welcome", {
      assignedId: client.sessionId,
      assignedTeam,
      tick: this.serverTick
    });

    // Notify others
    this.broadcast("player_joined", {
      id: client.sessionId,
      name: player.name,
      team: assignedTeam
    });

    console.log(`[Room ${this.roomId}] Player ${player.name} joined team ${assignedTeam}`);
  }

  onLeave(client: Client, code?: number) {
    const player = this.pilots.get(client.sessionId);
    console.log(`[Room ${this.roomId}] onLeave called for ${client.sessionId} code=${code} known=${!!player}`);
    if (player) {
      const team = player.team;
      this.cleanupPlayer(client.sessionId);
      this.state.players.delete(client.sessionId);

      // Respawn a bot to fill the empty slot
      this.spawnBot(team, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);

      this.broadcast("player_left", { id: client.sessionId, team });
      console.log(`[Room ${this.roomId}] Player ${player.name} left. Spawned replacement bot.`);
    }
  }

  onDispose() {
    this.rapierWorld.free();
    console.log(`[Room ${this.roomId}] Disposed`);
  }

  // ---- Simulation loop ----

  private updateSimulation(deltaMs: number) {
    if (this.state.matchEnded) return;

    this.accumulator += deltaMs / 1000;
    // Guard against spiral of death
    if (this.accumulator > 0.1) {
      this.accumulator = 0.1;
    }

    while (this.accumulator >= FIXED_DT) {
      this.tick();
      this.accumulator -= FIXED_DT;
    }
  }

  private tick() {
    this.serverTick++;
    
    // Decrement match timer
    this.state.matchTimer = Math.max(0, this.state.matchTimer - FIXED_DT);
    if (this.state.matchTimer <= 0) {
      this.endGame();
      return;
    }

    // 1. Process player inputs & update rigid body translations
    for (const [sessionId, queue] of this.inputQueues.entries()) {
      const player = this.pilots.get(sessionId);
      if (!player) continue;

      let cmd: FlightCommand;
      const nextInput = queue.shift();
      if (nextInput) {
        cmd = nextInput.command;
        this.lastInputs.set(sessionId, cmd);
        
        // update last processed sequence
        const schemaPlayer = this.state.players.get(sessionId);
        if (schemaPlayer) {
          schemaPlayer.lastProcessedSeq = nextInput.seq;
        }
      } else {
        // Queue under-run: copy previous command but disable weapon firing
        const last = this.lastInputs.get(sessionId);
        cmd = last ? { ...last, primaryFire: false, secondaryFire: false } : this.neutralCommand();
      }

      if (destructible(player.entity).damageModel!.fuselage <= 0) {
        this.updateDeadPilot(player, FIXED_DT);
      } else {
        // Tick cooldowns
        this.tickCooldowns(player, FIXED_DT);
        
        // Run Aerodynamics physics step
        FlightPhysicsEngine.update(player, cmd, FIXED_DT, this.mapId);
        this.enforceMapBoundary(player, FIXED_DT);
        
        // Fire weapons
        this.handleWeaponFiring(player, cmd.primaryFire, cmd.secondaryFire, FIXED_DT, nextInput?.seq);
      }

      // Sync to Rapier
      const body = this.rigidBodies.get(sessionId);
      if (body) {
        body.setNextKinematicTranslation({ x: player.x, y: player.y, z: player.z });
      }

      // Record transformation history for lag compensation
      this.recordHistory(sessionId, player);
    }

    // 2. Process Bots AI & update rigid body translations
    for (const [botId, pilot] of this.pilots.entries()) {
      if (!pilot.isBot) continue;

      if (destructible(pilot.entity).damageModel!.fuselage <= 0) {
        this.updateDeadPilot(pilot, FIXED_DT);
      } else {
        this.tickCooldowns(pilot, FIXED_DT);
        
        // Run AI behavior consensus to determine steering target & fire triggers
        BotAISystem.runAIConsensus(
          pilot,
          FIXED_DT,
          Array.from(this.pilots.values()),
          this.groundTargets,
          this.skyZones,
          (p, prim, sec, d) => this.handleWeaponFiring(p, prim, sec, d),
          MAP_REGISTRY[this.mapId]?.world.radius ?? 6000
        );

        // Pilot is updated inside runAIConsensus/FlightPhysicsEngine
        const botCtrl = control(pilot.entity);
        const cmd = botCtrl.lastCommand || this.neutralCommand();
        FlightPhysicsEngine.update(pilot, cmd, FIXED_DT, this.mapId);
        this.enforceMapBoundary(pilot, FIXED_DT);
      }

      // Sync to Rapier
      const body = this.rigidBodies.get(botId);
      if (body) {
        body.setNextKinematicTranslation({ x: pilot.x, y: pilot.y, z: pilot.z });
      }

      // Record bot transformation history
      this.recordHistory(botId, pilot);
    }

    // Step the Rapier world to align kinematic translations
    this.rapierWorld.step();

    // 3. Update Authoritative projectiles
    this.updateProjectiles(FIXED_DT);

    // 4. Update Objectives capture zones & scores
    ObjectiveSystem.updateCaptureZones(
      FIXED_DT,
      this.skyZones,
      Array.from(this.pilots.values()),
      (team, amt) => {
        if (team === 1) {
          this.team1FractionalScore += amt;
          const integerPart = Math.floor(this.team1FractionalScore);
          if (integerPart > 0) {
            this.state.team1Score += integerPart;
            this.team1FractionalScore -= integerPart;
          }
        } else if (team === 2) {
          this.team2FractionalScore += amt;
          const integerPart = Math.floor(this.team2FractionalScore);
          if (integerPart > 0) {
            this.state.team2Score += integerPart;
            this.team2FractionalScore -= integerPart;
          }
        }
      },
      true,
      true
    );

    // 5. Broadcast World Snapshot to all clients at 20Hz (every 3 ticks)
    if (this.serverTick % 3 === 0) {
      this.broadcastSnapshot();
    }

    // End match check
    if (this.state.team1Score >= 1000 || this.state.team2Score >= 1000) {
      this.endGame();
    }
  }

  // ---- Weapons Firing & lag compensation (Policy B) ----

  private handleWeaponFiring(
    pilot: Pilot,
    triggerPrimary: boolean,
    triggerSecondary: boolean,
    dt: number,
    clientSeq?: number
  ) {
    if (!pilot.entity.components.has("weaponized")) return;
    const wep = pilot.entity.components.get("weaponized") as any;
    if (!wep.cooldowns) wep.cooldowns = {};

    pilot.specs.weapons.forEach(wType => {
      const spec = WEAPON_SPECS_MAP[wType];
      const ammo = wep.ammo[wType] ?? 0;
      if (ammo <= 0) return;

      const cooldown = wep.cooldowns[wType] ?? 0;
      if (cooldown > 0) return;

      const isSecondary = wType === WeaponType.ROCKET || wType === WeaponType.BOMB;

      if (isSecondary) {
        if (!triggerSecondary) return;
        this.spawnServerProjectile(pilot, wType, clientSeq);
        wep.ammo[wType]--;
        wep.cooldowns[wType] = 1 / Math.max(0.01, spec.fireRate);
        return;
      }

      if (!triggerPrimary) return;

      // Gun round firing probability
      const shotChance = spec.fireRate * dt * 0.9;
      if (Math.random() < shotChance) {
        this.spawnServerProjectile(pilot, wType, clientSeq);
        wep.ammo[wType]--;
        wep.cooldowns[wType] = 0.015;
      }
    });
  }

  private spawnServerProjectile(pilot: Pilot, type: WeaponType, clientSeq?: number) {
    const isGun = type !== WeaponType.ROCKET && type !== WeaponType.BOMB;
    
    // Broadcast trigger event so client can spawn smooth predicted tracer instantly
    this.broadcast("player_fired", { id: pilot.id, weaponType: type });

    if (isGun && clientSeq !== undefined) {
      // POLICY B: Historical muzzle, current-world projectile insertion
      const oneWayLatencyTicks = Math.min(30, Math.max(0, this.inputQueues.get(pilot.id)?.length || 0)); // estimate latency
      const historicalTick = this.serverTick - oneWayLatencyTicks;
      const history = this.playerHistory.get(pilot.id) || [];
      const histTransform = history.find(h => h.tick === historicalTick) || history[history.length - 1];

      let release;
      if (histTransform) {
        const tempPilot = new Pilot({
          id: pilot.id,
          aircraftId: pilot.aircraftId,
          specs: pilot.specs,
          x: histTransform.x, y: histTransform.y, z: histTransform.z,
          vx: histTransform.vx, vy: histTransform.vy, vz: histTransform.vz,
          pitch: histTransform.pitch, yaw: histTransform.yaw, roll: histTransform.roll,
          ammo: pilot.ammo
        });
        release = getProjectileReleaseState(tempPilot, type);
      } else {
        release = getProjectileReleaseState(pilot, type);
      }

      let px = release.position.x;
      let py = release.position.y;
      let pz = release.position.z;
      const vx = release.velocity.x;
      const vy = release.velocity.y;
      const vz = release.velocity.z;

      // Fast-forward sweep against STATIC terrain only
      const elapsedSec = oneWayLatencyTicks * FIXED_DT;
      const steps = oneWayLatencyTicks;
      let hitTerrain = false;

      for (let s = 0; s < steps; s++) {
        px += vx * FIXED_DT;
        py += vy * FIXED_DT;
        pz += vz * FIXED_DT;

        const terr = getTerrainHeight(px, pz, this.mapId);
        if (py <= terr.height) {
          hitTerrain = true;
          this.triggerSplashDamage(new Vector3(px, py, pz), pilot.id, pilot.team, type);
          break;
        }
      }

      if (!hitTerrain) {
        // Insert into current world
        this.projectiles.push({
          id: generateId(),
          ownerId: pilot.id,
          ownerTeam: pilot.team,
          type,
          belt: wepBelt(pilot),
          x: px, y: py, z: pz,
          vx, vy, vz,
          life: 1.8 - elapsedSec,
          isRocket: false
        });
      }
    } else {
      // Bombs / Rockets: spawn at current muzzle, no lag fast-forward
      const release = getProjectileReleaseState(pilot, type);
      this.projectiles.push({
        id: generateId(),
        ownerId: pilot.id,
        ownerTeam: pilot.team,
        type,
        belt: wepBelt(pilot),
        x: release.position.x,
        y: release.position.y,
        z: release.position.z,
        vx: release.velocity.x,
        vy: release.velocity.y,
        vz: release.velocity.z,
        life: type === WeaponType.ROCKET ? 4.5 : 7.0,
        isRocket: type === WeaponType.ROCKET || type === WeaponType.BOMB
      });
    }
  }

  private updateProjectiles(dt: number) {
    const callbacks: EngineCallbacks = {
      registerKill: (killerId, victimId, weapon) => this.registerKill(killerId, victimId, weapon),
      registerGroundTargetKill: (killerId, target) => this.registerGroundTargetKill(killerId, target),
      onProjectileImpact: (type, pos, _ownerId) => {
        this.broadcast("projectile_impact", { type, px: pos.x, py: pos.y, pz: pos.z });
      },
      onGroundTargetDamage: (targetId, hp, isDead) => {
        this.broadcast("ground_updated", { targetId, hp, isDead });
      },
      onPlayerDamage: (shooterId, targetId, damage, bulletType, hitSpotLocal) => {
        const targetSocket = this.clients.find(c => c.sessionId === targetId);
        if (targetSocket) {
          targetSocket.send("damage_inflicted", {
            damage,
            bulletType,
            hitSpotLocal: { x: hitSpotLocal.x, y: hitSpotLocal.y, z: hitSpotLocal.z }
          });
        }
      },
      onVoxelHit: (targetId, localOffsetMeters, blastMeters) => {
        const grid = this.playerVoxelGrids.get(targetId);
        if (grid) {
          deformAtImpact(grid, localOffsetMeters, blastMeters);
        }
        this.broadcast("voxel_impact", {
          targetId,
          lx: localOffsetMeters.x,
          ly: localOffsetMeters.y,
          lz: localOffsetMeters.z,
          blast: blastMeters
        });
      },
      getVoxelImpact: (targetId, segStartLocal, segEndLocal) => {
        const grid = this.playerVoxelGrids.get(targetId);
        if (grid) {
          return findVoxelImpact(grid, segStartLocal, segEndLocal);
        }
        return undefined;
      }
    };

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      const lastX = p.x;
      const lastY = p.y;
      const lastZ = p.z;

      if (p.type === WeaponType.BOMB) {
        p.vy -= 9.8 * dt;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      let hitDetected = false;

      // Check terrain collision
      const terrHeight = getTerrainHeight(p.x, p.z, this.mapId).height;
      if (p.y <= Math.max(12, terrHeight)) {
        hitDetected = true;
        if (p.isRocket) {
          this.triggerSplashDamage(new Vector3(p.x, p.y, p.z), p.ownerId, p.ownerTeam, p.type);
        }
      }

      // Check player colliders in Rapier
      if (!hitDetected) {
        const start = new Vector3(lastX, lastY, lastZ);
        const end = new Vector3(p.x, p.y, p.z);
        const displacement = end.clone().sub(start);
        const distance = displacement.length();
        
        if (distance > 0.001) {
          const direction = displacement.clone().normalize();
          const ray = new RAPIER.Ray(start, direction);
          const ownerCollider = this.colliders.get(p.ownerId);

          const hit = this.rapierWorld.castRayAndGetNormal(
            ray,
            distance,
            true,
            undefined,
            undefined,
            ownerCollider,
            undefined,
            undefined
          );

          if (hit) {
            hitDetected = true;
            const parent = hit.collider.parent();
            const struckPlayerId = parent ? (parent.userData as any)?.playerId : null;
            const targetPilot = struckPlayerId ? this.pilots.get(struckPlayerId) : null;

            if (targetPilot && destructible(targetPilot.entity).damageModel!.fuselage > 0) {
              const spec = WEAPON_SPECS_MAP[p.type];
              let dmg = spec.damage;

              if (p.belt === "Armor-Piercing") dmg *= 1.3;
              if (p.belt === "Incendiary") dmg *= 0.85;

              // Compute local hit point
              const rotInv = new Quaternion()
                .setFromEuler(new Euler(targetPilot.pitch, targetPilot.yaw, targetPilot.roll, "YXZ"))
                .invert();
              const hitWorld = start.clone().addScaledVector(direction, hit.timeOfImpact);
              const localHit = hitWorld.clone().sub(new Vector3(targetPilot.x, targetPilot.y, targetPilot.z)).applyQuaternion(rotInv);
              const hitRadius = getPlaneHitRadius(targetPilot.specs);
              const relativeOffset = localHit.clone().divideScalar(hitRadius);

              FlightPhysicsEngine.applyDamage(targetPilot, dmg, String(p.type), relativeOffset);

              // Apply damage callbacks
              callbacks.onPlayerDamage!(p.ownerId, targetPilot.id, dmg, String(p.type), relativeOffset);
              
              const blastM = p.type === WeaponType.BOMB ? 2.5 : p.type === WeaponType.ROCKET ? 0.75 : 0;
              callbacks.onVoxelHit!(targetPilot.id, localHit, blastM);

              if (destructible(targetPilot.entity).damageModel!.fuselage <= 0) {
                callbacks.registerKill(p.ownerId, targetPilot.id, String(p.type));
              }
            }
          }
        }
      }

      // Check ground targets
      if (!hitDetected) {
        for (const gt of this.groundTargets) {
          if (gt.isDead || gt.team === p.ownerTeam) continue;
          
          const start = new Vector3(lastX, lastY, lastZ);
          const end = new Vector3(p.x, p.y, p.z);
          const gtPos = new Vector3(gt.x, gt.y, gt.z);
          const closest = new Vector3();
          
          const ab = end.clone().sub(start);
          const ac = gtPos.clone().sub(start);
          const abLen2 = ab.lengthSq();
          const t = abLen2 <= 0.000001 ? 0 : Math.max(0, Math.min(1, ac.dot(ab) / abLen2));
          closest.copy(start).addScaledVector(ab, t);

          const dist = closest.distanceTo(gtPos);
          if (dist < 24) {
            hitDetected = true;
            let dmg = WEAPON_SPECS_MAP[p.type].damage;
            if (p.belt === "Armor-Piercing") dmg *= 1.8;
            if (p.type === WeaponType.BOMB) dmg *= 2.5;

            gt.hp = Math.max(0, gt.hp - dmg);
            if (gt.hp <= 0) gt.isDead = true;

            callbacks.onGroundTargetDamage!(gt.id, gt.hp, gt.isDead);
            
            if (gt.isDead) {
              callbacks.registerGroundTargetKill(p.ownerId, gt);
            }
            break;
          }
        }
      }

      if (hitDetected || p.life <= 0) {
        if (hitDetected && callbacks.onProjectileImpact) {
          callbacks.onProjectileImpact(p.type, new Vector3(p.x, p.y, p.z), p.ownerId);
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  private triggerSplashDamage(epicenter: Vector3, ownerId: string, team: number, type: WeaponType) {
    const splashRad = type === WeaponType.BOMB ? 180 : 70;
    const baseSplash = type === WeaponType.BOMB ? 350 : 150;

    // Ground targets
    this.groundTargets.forEach(gt => {
      if (gt.isDead || gt.team === team) return;
      const d = epicenter.distanceTo(new Vector3(gt.x, gt.y, gt.z));
      if (d < splashRad) {
        const falloff = 1 - d / splashRad;
        gt.hp = Math.max(0, gt.hp - baseSplash * falloff);
        if (gt.hp <= 0) gt.isDead = true;

        this.broadcast("ground_updated", { targetId: gt.id, hp: gt.hp, isDead: gt.isDead });
        
        if (gt.isDead) {
          this.registerGroundTargetKill(ownerId, gt);
        }
      }
    });

    // Players
    this.pilots.forEach(pilot => {
      if (pilot.team === team || destructible(pilot.entity).damageModel!.fuselage <= 0) return;
      const d = epicenter.distanceTo(new Vector3(pilot.x, pilot.y, pilot.z));
      if (d < splashRad) {
        const falloff = 1 - d / splashRad;
        const relativeOffset = new Vector3(0, -0.5, 0);

        FlightPhysicsEngine.applyDamage(pilot, baseSplash * falloff, String(type), relativeOffset);

        // Apply local hit deformation
        const rotInv = new Quaternion()
          .setFromEuler(new Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ"))
          .invert();
        const localDir = new Vector3(pilot.x - epicenter.x, pilot.y - epicenter.y, pilot.z - epicenter.z)
          .applyQuaternion(rotInv);
        const localLen = localDir.length();
        if (localLen > 7) localDir.multiplyScalar(7 / localLen);
        const blastAtImpact = 0.3 + falloff * 2.2;

        const grid = this.playerVoxelGrids.get(pilot.id);
        if (grid) {
          deformAtImpact(grid, localDir, blastAtImpact);
        }

        this.broadcast("voxel_impact", {
          targetId: pilot.id,
          lx: localDir.x, ly: localDir.y, lz: localDir.z,
          blast: blastAtImpact
        });

        const targetSocket = this.clients.find(c => c.sessionId === pilot.id);
        if (targetSocket) {
          targetSocket.send("damage_inflicted", {
            damage: baseSplash * falloff,
            bulletType: String(type),
            hitSpotLocal: { x: relativeOffset.x, y: relativeOffset.y, z: relativeOffset.z }
          });
        }

        if (destructible(pilot.entity).damageModel!.fuselage <= 0) {
          this.registerKill(ownerId, pilot.id, String(type));
        }
      }
    });
  }

  // ---- Match Rules, Scores and Evictions ----

  private balanceTeams(): 1 | 2 {
    let t1 = 0, t2 = 0;
    for (const p of this.pilots.values()) {
      if (!p.isBot) {
        if (p.team === 1) t1++; else t2++;
      }
    }
    return t1 <= t2 ? 1 : 2;
  }

  private evictBot(team: 1 | 2) {
    const bots = Array.from(this.pilots.entries()).filter(([_, p]) => p.isBot && p.team === team);
    if (bots.length > 0) {
      const [botId] = bots[0];
      this.cleanupPlayer(botId);
      this.state.players.delete(botId);
    }
  }

  private fillWithBots() {
    const botsPerTeam = 4;
    for (let i = 0; i < botsPerTeam; i++) {
      this.spawnBot(1, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);
    }
    for (let i = 0; i < botsPerTeam; i++) {
      this.spawnBot(2, DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)]);
    }
  }

  private spawnBot(team: 1 | 2, specs: AircraftSpecs) {
    const botId = `bot_${generateId().slice(0, 8)}`;
    const spawnPos = this.getAirSpawnPosition(team);

    const bot = new Pilot({
      id: botId,
      name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
      isBot: true,
      team,
      aircraftId: specs.id,
      specs,
      x: spawnPos.x, y: spawnPos.y, z: spawnPos.z,
      vx: spawnPos.vx, vy: spawnPos.vy, vz: spawnPos.vz,
      pitch: 0, roll: 0, yaw: getSpawnYaw(team),
      throttle: 0.75,
      engineTemperature: 72,
      damage: this.createEmptyDamage(),
      ammo: this.initAmmo(specs),
      ammoBelt: AmmoBelt.Universal,
      modifications: [],
      score: 0, kills: 0, deaths: 0,
      weaponCooldowns: {},
      invulnerableTimer: 2.0,
      aiState: {
        behavior: "patrol",
        targetId: null,
        timer: Math.random() * 3,
        destinationX: 0, destinationY: 450, destinationZ: 0,
        skills: {
          accuracy: 0.5 + Math.random() * 0.4,
          aggression: 0.4 + Math.random() * 0.5,
          avoidance: 0.3 + Math.random() * 0.6
        }
      }
    });

    this.pilots.set(botId, bot);

    // Create Rapier proxy
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setUserData({ playerId: botId });
    const body = this.rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(getPlaneHitRadius(specs) + 3.2);
    const collider = this.rapierWorld.createCollider(colliderDesc, body);
    
    this.rigidBodies.set(botId, body);
    this.colliders.set(botId, collider);

    const voxDef = getVoxelDef(specs.id);
    if (voxDef) {
      this.playerVoxelGrids.set(botId, buildVoxelGrid(voxDef));
    }

    // Add to Colyseus schema
    const netBot = new NetworkPlayer();
    netBot.id = botId;
    netBot.name = bot.name;
    netBot.team = team;
    netBot.aircraftId = specs.id;
    netBot.skin = "default";
    netBot.score = 0;
    netBot.kills = 0;
    netBot.deaths = 0;
    netBot.isBot = true;
    this.state.players.set(botId, netBot);
  }

  private registerKill(killerId: string, victimId: string, weapon: string) {
    const killer = this.pilots.get(killerId);
    const victim = this.pilots.get(victimId);
    if (!victim) return;

    victim.deaths++;
    const vState = this.state.players.get(victimId);
    if (vState) vState.deaths++;

    let killerName = "System";
    if (killer) {
      killer.kills++;
      killer.score += 300;
      
      const kState = this.state.players.get(killerId);
      if (kState) {
        kState.kills++;
        kState.score += 300;
      }
      
      killerName = killer.name;
      
      // Award score to team
      if (killer.team === 1) this.state.team1Score += 100;
      else if (killer.team === 2) this.state.team2Score += 100;
    }

    this.broadcast("kill_confirmed", {
      killerId,
      victimId,
      killerName,
      victimName: victim.name,
      weapon
    });

    // Schedule respawn for the victim in 4 seconds
    setTimeout(() => this.respawnPilot(victimId), 4000);
  }

  private registerGroundTargetKill(killerId: string, _target: GroundTarget) {
    const killer = this.pilots.get(killerId);
    if (killer) {
      killer.score += 150;
      const kState = this.state.players.get(killerId);
      if (kState) kState.score += 150;

      if (killer.team === 1) this.state.team1Score += 80;
      else if (killer.team === 2) this.state.team2Score += 80;
    }
  }

  private respawnPilot(pilotId: string) {
    const pilot = this.pilots.get(pilotId);
    if (!pilot) return;

    const spawnPos = this.getAirSpawnPosition(pilot.team);
    pilot.x = spawnPos.x;
    pilot.y = spawnPos.y;
    pilot.z = spawnPos.z;
    pilot.vx = spawnPos.vx;
    pilot.vy = spawnPos.vy;
    pilot.vz = spawnPos.vz;
    pilot.pitch = 0;
    pilot.roll = 0;
    pilot.yaw = getSpawnYaw(pilot.team);
    pilot.throttle = 0.8;
    
    // Reset damage and ammo
    const destrComp = destructible(pilot.entity);
    destrComp.hp = 100;
    destrComp.isDead = false;
    destrComp.damageModel = this.createEmptyDamage();
    
    const wepComp = pilot.entity.components.get("weaponized") as any;
    wepComp.ammo = this.initAmmo(pilot.specs);
    wepComp.cooldowns = {};

    pilot.invulnerableTimer = 2.0;

    // Reset voxel grid
    const voxDef = getVoxelDef(pilot.aircraftId);
    if (voxDef) {
      this.playerVoxelGrids.set(pilotId, buildVoxelGrid(voxDef));
    }

    this.broadcast("pilot_respawned", {
      id: pilotId,
      x: spawnPos.x, y: spawnPos.y, z: spawnPos.z,
      yaw: pilot.yaw
    });
    console.log(`[Room ${this.roomId}] Respawned pilot ${pilot.name}`);
  }

  private endGame() {
    if (this.state.matchEnded) return;
    this.state.matchEnded = true;

    const team1Won = this.state.team1Score >= this.state.team2Score;
    this.broadcast("match_end", {
      team1Score: this.state.team1Score,
      team2Score: this.state.team2Score,
      team1Won
    });

    // Disconnect all clients and release the room after results are visible.
    setTimeout(() => this.disconnect(), 15000);
  }

  // ---- Private Helpers ----

  private buildObjectives() {
    const mapDef = MAP_REGISTRY[this.mapId];
    const sp = mapDef?.spawn ?? { distMin: 3500 };
    // All objective positions were authored for a spawn distance of 3500m.
    // Scale them proportionally so objectives sit at the same relative position
    // between the two team spawns regardless of actual map size.
    const k = (sp.distMin ?? 3500) / 3500;

    this.skyZones.push(
      { id: "zone-a", name: "Alpha Zone", x: -1200 * k, y: 500, z: -500 * k, radius: 450 * k, owningTeam: 0, captureProgress: 0 },
      { id: "zone-b", name: "Bravo Zone", x: 0, y: 700, z: 0, radius: 600 * k, owningTeam: 0, captureProgress: 0 },
      { id: "zone-c", name: "Charlie Zone", x: 1200 * k, y: 500, z: 500 * k, radius: 450 * k, owningTeam: 0, captureProgress: 0 }
    );

    const islandLocations = [
      { x: -2000 * k, z: -1000 * k },
      { x:  -500 * k, z: -2500 * k },
      { x:  1800 * k, z:  -800 * k },
      { x:   300 * k, z:  1600 * k },
      { x: -1100 * k, z:  2400 * k },
      { x:  2200 * k, z:  2000 * k }
    ];

    islandLocations.forEach((loc, index) => {
      const assignedTeam = index % 2 === 0 ? 1 : 2;
      const aaY = getTerrainHeight(loc.x, loc.z, this.mapId).height;
      const radarX = loc.x + 80;
      const radarZ = loc.z + 80;
      const radarY = getTerrainHeight(radarX, radarZ, this.mapId).height;

      this.groundTargets.push(
        new GroundTarget({
          id: `aa-${index}`,
          name: `FlaK AA Battery ${assignedTeam === 1 ? "A" : "B"}`,
          team: assignedTeam as 1 | 2,
          type: "anti-air",
          x: loc.x, y: aaY, z: loc.z,
          hp: 120, maxHp: 120, isDead: false,
          fireCooldown: Math.random() * 2
        }),
        new GroundTarget({
          id: `tgt-${index}`,
          name: assignedTeam === 1 ? "Red Radar Station" : "Blue Radar Station",
          team: assignedTeam as 1 | 2,
          type: "radar",
          x: radarX, y: radarY, z: radarZ,
          hp: 250, maxHp: 250, isDead: false
        })
      );
    });
  }

  private getAirSpawnPosition(team: 1 | 2): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
    const mapDef = MAP_REGISTRY[this.mapId];
    const sp = mapDef?.spawn ?? { distMin: 3500, distMax: 4200, aglMin: 350, aglMax: 650, initialSpeedMs: 140, spreadZ: 600 };
    const dist = sp.distMin + Math.random() * (sp.distMax - sp.distMin);
    const sign = team === 1 ? -1 : 1;
    const x = sign * dist;
    const z = (Math.random() - 0.5) * 2 * sp.spreadZ;
    const terrain = getTerrainHeight(x, z, this.mapId);
    const agl = sp.aglMin + Math.random() * (sp.aglMax - sp.aglMin);
    const y = terrain.height + agl;

    const yaw = getSpawnYaw(team);
    const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0, "YXZ"));
    const vel = new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(sp.initialSpeedMs);
    return { x, y, z, vx: vel.x, vy: vel.y, vz: vel.z };
  }

  private createEmptyDamage() {
    return {
      engine: 1.0, leftWing: 1.0, rightWing: 1.0, tail: 1.0,
      cockpit: 1.0, fuelTank: 1.0, fuselage: 1.0,
      hasFire: false, hasOilLeak: false
    };
  }

  private initAmmo(specs: AircraftSpecs): Record<WeaponType, number> {
    const caps: Record<WeaponType, number> = {} as any;
    specs.weapons.forEach(w => {
      caps[w] = WEAPON_SPECS_MAP[w].ammoCapacity;
    });
    return caps;
  }

  private neutralCommand(): FlightCommand {
    return {
      pitch: 0, roll: 0, yaw: 0,
      throttleDelta: 0, boost: false, airbrake: false,
      primaryFire: false, secondaryFire: false,
      flaps: "up", gearDeployed: false
    };
  }

  private enqueueInput(sessionId: string, tuple: ClientInputTuple) {
    const queue = this.inputQueues.get(sessionId);
    if (!queue) return;

    // Convert tuple back to FlightCommand
    const [
      seq, pitch, roll, yaw, throttleDelta,
      boost, airbrake, primaryFire, secondaryFire, flapsCode, gearDeployed
    ] = tuple;

    const flaps = flapsCode === 2 ? "landing" : flapsCode === 1 ? "combat" : "up";

    const command: FlightCommand = {
      pitch, roll, yaw, throttleDelta,
      boost: boost === 1,
      airbrake: airbrake === 1,
      primaryFire: primaryFire === 1,
      secondaryFire: secondaryFire === 1,
      flaps,
      gearDeployed: gearDeployed === 1
    };

    queue.push({ seq, command });
    
    // Sort queue by sequence number just in case packets arrived out of order
    queue.sort((a, b) => a.seq - b.seq);

    // Limit queue size to avoid memory leakage
    if (queue.length > 60) {
      queue.shift();
    }
  }

  private tickCooldowns(pilot: Pilot, dt: number) {
    const wep = pilot.entity.components.get("weaponized") as any;
    if (wep && wep.cooldowns) {
      for (const w of Object.keys(wep.cooldowns)) {
        if (wep.cooldowns[w] > 0) {
          wep.cooldowns[w] = Math.max(0, wep.cooldowns[w] - dt);
        }
      }
    }
    if (pilot.invulnerableTimer && pilot.invulnerableTimer > 0) {
      pilot.invulnerableTimer = Math.max(0, pilot.invulnerableTimer - dt);
    }
  }

  private recordHistory(playerId: string, player: Pilot) {
    let history = this.playerHistory.get(playerId);
    if (!history) {
      history = [];
      this.playerHistory.set(playerId, history);
    }
    history.push({
      tick: this.serverTick,
      x: player.x, y: player.y, z: player.z,
      pitch: player.pitch, yaw: player.yaw, roll: player.roll,
      vx: player.vx, vy: player.vy, vz: player.vz
    });
    // keep up to 120 ticks (~2 seconds of history)
    if (history.length > 120) {
      history.shift();
    }
  }

  private enforceMapBoundary(pilot: Pilot, dt: number) {
    const mapRadius = MAP_REGISTRY[this.mapId]?.world.radius ?? 6000;
    const dist = Math.sqrt(pilot.x * pilot.x + pilot.z * pilot.z);
    
    if (dist > mapRadius) {
      // Force plane rotation back towards center
      const toCenterX = -pilot.x;
      const toCenterZ = -pilot.z;
      const targetYaw = Math.atan2(toCenterX, toCenterZ);
      
      // Interpolate yaw towards target
      let diff = targetYaw - pilot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      pilot.yaw += diff * dt * 0.8;
      
      // Inflict boundary out-of-bounds fuselage damage gradually
      if (this.serverTick % 30 === 0) {
        const destrComp = destructible(pilot.entity);
        if (destrComp && destrComp.damageModel) {
          destrComp.damageModel.fuselage = Math.max(0, destrComp.damageModel.fuselage - 0.05);
          if (destrComp.damageModel.fuselage <= 0) {
            this.registerKill("boundary", pilot.id, "boundary");
          }
        }
      }
    }
  }

  private updateDeadPilot(pilot: Pilot, dt: number) {
    pilot.vy -= 9.8 * dt; // gravity fall
    pilot.x += pilot.vx * dt;
    pilot.y += pilot.vy * dt;
    pilot.z += pilot.vz * dt;

    const terrain = getTerrainHeight(pilot.x, pilot.z, this.mapId);
    if (pilot.y <= terrain.height) {
      pilot.y = terrain.height;
      pilot.vx = 0;
      pilot.vy = 0;
      pilot.vz = 0;
    }
  }

  private cleanupPlayer(sessionId: string) {
    this.pilots.delete(sessionId);
    this.inputQueues.delete(sessionId);
    this.lastInputs.delete(sessionId);
    this.playerHistory.delete(sessionId);
    this.playerVoxelGrids.delete(sessionId);

    const body = this.rigidBodies.get(sessionId);
    if (body) {
      this.rapierWorld.removeRigidBody(body);
      this.rigidBodies.delete(sessionId);
    }
    const col = this.colliders.get(sessionId);
    if (col) {
      this.colliders.delete(sessionId);
    }
  }

  private broadcastSnapshot() {
    const entitiesArray: any[] = [];
    
    for (const [id, pilot] of this.pilots.entries()) {
      entitiesArray.push([
        id,
        "aircraft",
        Math.round(pilot.x * 10) / 10,
        Math.round(pilot.y * 10) / 10,
        Math.round(pilot.z * 10) / 10,
        Math.round(pilot.vx * 100) / 100,
        Math.round(pilot.vy * 100) / 100,
        Math.round(pilot.vz * 100) / 100,
        Math.round(pilot.pitch * 1000) / 1000,
        Math.round(pilot.yaw * 1000) / 1000,
        Math.round(pilot.roll * 1000) / 1000,
        Math.round(pilot.throttle * 100) / 100,
        pilot.damage.engine,
        pilot.damage.leftWing,
        pilot.damage.rightWing,
        pilot.damage.tail,
        pilot.damage.cockpit,
        pilot.damage.fuelTank,
        pilot.damage.fuselage,
        pilot.damage.hasFire ? 1 : 0,
        pilot.damage.hasOilLeak ? 1 : 0,
        pilot.ammo[pilot.specs.weapons.find(w => w !== WeaponType.ROCKET && w !== WeaponType.BOMB) || WeaponType.MG_7_7] ?? 0,
        pilot.ammo[WeaponType.ROCKET] ?? 0
      ]);
    }

    for (const p of this.projectiles) {
      entitiesArray.push([
        p.id,
        "projectile",
        Math.round(p.x * 10) / 10,
        Math.round(p.y * 10) / 10,
        Math.round(p.z * 10) / 10,
        Math.round(p.vx * 10) / 10,
        Math.round(p.vy * 10) / 10,
        Math.round(p.vz * 10) / 10,
        0, 0, 0,
        0,
        p.ownerId,
        p.type
      ]);
    }

    // Acknowledge input sequence numbers
    const lastSeqs: Record<string, number> = {};
    for (const [sid, pState] of this.state.players.entries()) {
      if (!pState.isBot) {
        lastSeqs[sid] = pState.lastProcessedSeq;
      }
    }

    this.broadcast("snapshot", [
      this.serverTick,
      lastSeqs,
      entitiesArray
    ]);
  }
}

function wepBelt(pilot: Pilot): string {
  const wepComp = pilot.entity.components.get("weaponized") as any;
  return wepComp ? String(wepComp.ammoBelt) : "Universal";
}
