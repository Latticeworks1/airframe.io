import { Client } from "@colyseus/core";
import { Pilot } from "../../types";
import { DEFAULT_AIRCRAFT } from "../aircraftData";
import { getVoxelDef } from "../content/aircraft/voxelRegistry";
import { buildVoxelGrid } from "../voxelMesh";
import { NetworkPlayer } from "./MatchState";
import { getAirSpawnPosition, getSpawnYaw, createEmptyDamage, initAmmo } from "./RoomUtils";
import { Quaternion, Euler } from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getPlaneHitRadius } from "../math";
import { AmmoBelt } from "../../types";

export class RoomLifecycle {
  public onJoin(
    client: Client, 
    options: any,
    authData: any,
    assignedTeam: number,
    mapId: string,
    pilots: Map<string, Pilot>,
    statePlayers: any,
    serverTick: number,
    broadcast: (type: string, msg: any) => void,
    rapierWorld: RAPIER.World,
    rigidBodies: Map<string, RAPIER.RigidBody>,
    colliders: Map<string, RAPIER.Collider>,
    playerVoxelGrids: Map<string, any>,
    evictBot: (team: number) => void
  ) {
    const planeId = options.aircraftId || authData.selectedPlaneId || "falcon-mk2";
    const skin = options.skin || authData.customizations?.skin || "default";

    evictBot(assignedTeam);

    const specs = DEFAULT_AIRCRAFT.find(a => a.id === planeId) || DEFAULT_AIRCRAFT[0];
    const spawnPos = getAirSpawnPosition(assignedTeam as 1 | 2, mapId);

    const q = new Quaternion().setFromEuler(new Euler(0, getSpawnYaw(assignedTeam), 0, "YXZ"));

    const player = new Pilot({
      id: client.sessionId,
      name: authData.nickname || "Maverick",
      isBot: false,
      team: assignedTeam as 1 | 2,
      aircraftId: planeId,
      specs,
      x: spawnPos.x, y: spawnPos.y, z: spawnPos.z,
      vx: spawnPos.vx, vy: spawnPos.vy, vz: spawnPos.vz,
      qx: q.x, qy: q.y, qz: q.z, qw: q.w,
      throttle: 0.8,
      engineTemperature: 75,
      damage: createEmptyDamage(),
      ammo: initAmmo(specs),
      ammoBelt: authData.selectedBelt || AmmoBelt.Universal,
      modifications: authData.equippedMods?.[planeId] || [],
      score: 0, kills: 0, deaths: 0,
      weaponCooldowns: {},
      invulnerableTimer: 2.0
    });

    pilots.set(client.sessionId, player);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setUserData({ playerId: client.sessionId });
    const body = rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(getPlaneHitRadius(specs) + 3.2);
    const collider = rapierWorld.createCollider(colliderDesc, body);
    
    rigidBodies.set(client.sessionId, body);
    colliders.set(client.sessionId, collider);

    const voxDef = getVoxelDef(planeId);
    if (voxDef) playerVoxelGrids.set(client.sessionId, buildVoxelGrid(voxDef));

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
    statePlayers.set(client.sessionId, netPlayer);

    client.send("welcome", { assignedId: client.sessionId, assignedTeam, tick: serverTick });
    broadcast("player_joined", { id: client.sessionId, name: player.name, team: assignedTeam });
  }

  public respawnPilot(
    pilotId: string, 
    pilots: Map<string, Pilot>, 
    mapId: string, 
    playerVoxelGrids: Map<string, any>,
    broadcast: (type: string, msg: any) => void
  ) {
    const pilot = pilots.get(pilotId);
    if (!pilot) return;

    const spawnPos = getAirSpawnPosition(pilot.team as 1 | 2, mapId);
    pilot.x = spawnPos.x; pilot.y = spawnPos.y; pilot.z = spawnPos.z;
    pilot.vx = spawnPos.vx; pilot.vy = spawnPos.vy; pilot.vz = spawnPos.vz;
    
    const q = new Quaternion().setFromEuler(new Euler(0, getSpawnYaw(pilot.team), 0, "YXZ"));
    pilot.qx = q.x; pilot.qy = q.y; pilot.qz = q.z; pilot.qw = q.w;
    pilot.throttle = 0.8;
    
    const destrComp = pilot.entity.components.get("destructible") as any;
    destrComp.hp = 100;
    destrComp.isDead = false;
    destrComp.damageModel = createEmptyDamage();
    
    const wepComp = pilot.entity.components.get("weaponized") as any;
    wepComp.ammo = initAmmo(pilot.specs);
    wepComp.cooldowns = {};
    pilot.invulnerableTimer = 2.0;

    const voxDef = getVoxelDef(pilot.aircraftId);
    if (voxDef) playerVoxelGrids.set(pilotId, buildVoxelGrid(voxDef));

    broadcast("pilot_respawned", { id: pilotId, x: spawnPos.x, y: spawnPos.y, z: spawnPos.z, yaw: getSpawnYaw(pilot.team) });
  }
}
