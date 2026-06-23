import React from "react";
import { Vector3, Quaternion, Euler } from "three";
import { Room } from "@colyseus/sdk";
import { ChatMessage, MultiplayerMatchContext } from "./types";
import { DEFAULT_AIRCRAFT } from "../../game/aircraftData";
import { Pilot, AmmoBelt, WeaponType } from "../../types";
import { FlightPhysicsEngine } from "../../game/flightModel";

export function setupRoomListeners(
  room: Room,
  engine: MultiplayerMatchContext,
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onLocalPlayerHit: (tgtId: string, isGround: boolean) => void
) {
  // Sync Colyseus room state
  room.onStateChange((state) => {
    engine.team1Score = state.team1Score;
    engine.team2Score = state.team2Score;
    engine.matchTimer = state.matchTimer;
    engine.matchEnded = state.matchEnded;
  });

  // Sync player entries in Colyseus schema
  room.state.players.onAdd((player: any, key: string) => {
    if (key === room.sessionId) return; // ignore local player

    const existing = engine.pilots.find((p) => p.id === key);
    if (!existing) {
      const specs = DEFAULT_AIRCRAFT.find((a) => a.id === player.aircraftId) || DEFAULT_AIRCRAFT[0];
      const newPilot = new Pilot({
        id: key,
        name: player.name,
        isBot: player.isBot,
        team: player.team as 1 | 2,
        aircraftId: player.aircraftId,
        specs,
        x: 0, y: 350, z: 0,
        vx: 0, vy: 0, vz: 0,
        pitch: 0, yaw: 0, roll: 0,
        throttle: 0.8,
        engineTemperature: 75,
        damage: {
          engine: 1.0, leftWing: 1.0, rightWing: 1.0, tail: 1.0,
          cockpit: 1.0, fuelTank: 1.0, fuselage: 1.0,
          hasFire: false, hasOilLeak: false
        },
        ammo: {} as Record<WeaponType, number>,
        ammoBelt: AmmoBelt.Universal,
        modifications: [],
        score: player.score,
        kills: player.kills,
        deaths: player.deaths,
        xpEarned: 0
      });
      engine.pilots.push(newPilot);
    }
  });

  room.state.players.onRemove((player: any, key: string) => {
    engine.pilots = engine.pilots.filter((p) => p.id !== key);
  });

  // Listen for messages
  room.onMessage("chat", ([_tick, _senderId, senderName, text]) => {
    setChatMessages((prev) => [
      ...prev.slice(-49),
      { sender: senderName, text, ts: Date.now() }
    ]);
  });

  room.onMessage("snapshot", ([tick, lastSeqs, entities]) => {
    const mySeq = lastSeqs[room.sessionId];

    entities.forEach((entity: any) => {
      const [id, kind] = entity;
      if (kind === "aircraft") {
        const [
          _id, _kind, x, y, z, vx, vy, vz, pitch, yaw, roll, throttle,
          dmgEngine, dmgLeftWing, dmgRightWing, dmgTail, dmgCockpit, dmgFuelTank, dmgFuselage,
          hasFire, hasOilLeak, ammoPrimary, ammoRocket
        ] = entity;

        const isMe = id === room.sessionId;
        const pilot = engine.pilots.find((p) => p.id === (isMe ? "player" : id));

        if (pilot) {
          if (isMe) {
            (pilot as any).serverPosition = new Vector3(x, y, z);
            (pilot as any).serverVelocity = new Vector3(vx, vy, vz);
            (pilot as any).serverRotation = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, "YXZ"));
            (pilot as any).serverLastProcessedSeq = mySeq;
            (pilot as any).serverTick = tick;
          } else {
            pilot.vx = vx; pilot.vy = vy; pilot.vz = vz;
            pilot.throttle = throttle;
            pilot.damage = {
              engine: dmgEngine, leftWing: dmgLeftWing, rightWing: dmgRightWing, tail: dmgTail,
              cockpit: dmgCockpit, fuelTank: dmgFuelTank, fuselage: dmgFuselage,
              hasFire: hasFire === 1, hasOilLeak: hasOilLeak === 1
            };
            const primaryW = pilot.specs.weapons.find((w) => w !== WeaponType.ROCKET && w !== WeaponType.BOMB) || WeaponType.MG_7_7;
            pilot.ammo = {
              [primaryW]: ammoPrimary,
              [WeaponType.ROCKET]: ammoRocket
            } as Record<WeaponType, number>;

            const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, "YXZ"));
            pilot.netSnap = {
              x, y, z, vx, vy, vz,
              qx: q.x, qy: q.y, qz: q.z, qw: q.w,
              at: performance.now()
            };
          }
        }
      }
    });
  });

  room.onMessage("player_fired", ({ id, weaponType }) => {
    if (id !== room.sessionId) {
      const pilot = engine.pilots.find((p) => p.id === id);
      if (pilot) engine.spawnProjectile(pilot, weaponType);
    }
  });

  room.onMessage("projectile_impact", ({ type, px, py, pz }) => {
    engine.onProjectileImpact?.(type, new Vector3(px, py, pz), "server");
  });

  room.onMessage("voxel_impact", ({ targetId, lx, ly, lz, blast }) => {
    engine.onVoxelHit?.(targetId, new Vector3(lx, ly, lz), blast);
  });

  room.onMessage("ground_updated", ({ targetId, hp, isDead }) => {
    const target = engine.groundTargets.find((t) => t.id === targetId);
    if (target) { target.hp = hp; target.isDead = isDead; }
  });

  room.onMessage("damage_inflicted", ({ damage, bulletType, hitSpotLocal }) => {
    const localPlayer = engine.pilots.find((p) => p.id === "player");
    if (localPlayer) {
      const spot = new Vector3(hitSpotLocal.x, hitSpotLocal.y, hitSpotLocal.z);
      FlightPhysicsEngine.applyDamage(localPlayer, damage, bulletType, spot);
      onLocalPlayerHit("player", false);
    }
  });

  room.onMessage("pilot_respawned", ({ id, x, y, z, yaw }) => {
    const pilot = engine.pilots.find((p) => p.id === (id === room.sessionId ? "player" : id));
    if (pilot) {
      pilot.x = x; pilot.y = y; pilot.z = z; pilot.yaw = yaw;
      pilot.pitch = 0; pilot.roll = 0; pilot.vx = 0; pilot.vy = 0; pilot.vz = 0;
      pilot.damage = {
        engine: 1.0, leftWing: 1.0, rightWing: 1.0, tail: 1.0,
        cockpit: 1.0, fuelTank: 1.0, fuselage: 1.0,
        hasFire: false, hasOilLeak: false
      };
      engine.onPilotRespawn?.(id === room.sessionId ? "player" : id);
    }
  });

  room.onMessage("kill_confirmed", ({ killerId, victimId, weapon }) => {
    const kMap = killerId === room.sessionId ? "player" : killerId;
    const vMap = victimId === room.sessionId ? "player" : victimId;
    engine.forceRegisterKill(kMap, vMap, weapon);
  });

  room.onMessage("match_end", ({ team1Won }) => {
    const localPlayer = engine.pilots.find((p) => p.id === "player");
    const myTeam = localPlayer?.team ?? 1;
    const won = (myTeam === 1 && team1Won) || (myTeam === 2 && !team1Won);
    engine.forceEndGame(won);
  });
}
