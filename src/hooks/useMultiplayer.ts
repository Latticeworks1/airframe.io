/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback } from "react";
import { Vector3, Quaternion, Euler } from "three";
import { GameEngine } from "../game/gameEngine";
import { WorldRenderer } from "../game/worldRenderer";
import { AmmoBelt, MatchMode } from "../types";
import { DEFAULT_AIRCRAFT } from "../game/aircraftData";
import { getMultiplayerSessionId } from "./useProgression";
import { FlightPhysicsEngine } from "../game/flightModel";

export interface ChatMessage {
  sender: string;
  text: string;
  ts: number;
}

export function useMultiplayer() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const disconnectMultiplayer = useCallback(() => {
    if (socketRef.current) {
      if (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }
  }, []);

  const connectMultiplayer = useCallback(
    (
      engine: GameEngine,
      renderer3D: WorldRenderer,
      mapId: string,
      mode: MatchMode,
      nickname: string,
      skin: string,
      onLocalPlayerHit: (tgtId: string, isGround: boolean) => void,
      onMatchRejected: (reason: string) => void
    ) => {
      disconnectMultiplayer();

      const multiplayerSessionId = getMultiplayerSessionId();
      const myPilotId = `pilot_${multiplayerSessionId.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
      const myCallsign = nickname || "Maverick_99";

      engine.isMultiplayer = true;
      const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
      const wsUrl = `${protocol}${window.location.host}/multiplayer`;

      let socket: WebSocket | null = null;
      try {
        socket = new WebSocket(wsUrl);
        socketRef.current = socket;
      } catch (wsErr) {
        console.warn("Unable to establish WebSocket connection", wsErr);
        return;
      }

      const _netQ = new Quaternion();
      const _netQSnap = new Quaternion();
      const _netEuler = new Euler();

      socket.onerror = (err) => {
        console.warn(
          "Multiplayer matchmaking offline or connectivity error. Operating in offline/local capability.",
          err
        );
      };

      socket.onopen = () => {
        const localPlayer = engine.pilots.find(p => p.id === "player");
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "join",
              queueKey: `${mapId}_${mode}`,
              sessionId: multiplayerSessionId,
              pilotId: myPilotId,
              name: `${myCallsign} (You)`,
              specs: localPlayer?.specs || DEFAULT_AIRCRAFT[0],
              skin: skin || "default",
              ammo: localPlayer?.ammo || {}
            })
          );
        }
      };

      socket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          if (msg.type === "welcome") {
            engine.isHost = msg.hostId === myPilotId;
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer && (msg.assignedTeam === 1 || msg.assignedTeam === 2)) {
              localPlayer.team = msg.assignedTeam;
            }

            // Sync initial other remote players into engine
            engine.pilots = engine.pilots.filter(p => p.id === "player" || p.isBot);

            msg.players.forEach((player: any) => {
              if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
                engine.pilots.push({
                  id: player.id,
                  name: player.name,
                  isBot: false,
                  team: player.team,
                  aircraftId: player.aircraftId,
                  specs: player.specs,
                  x: player.x,
                  y: player.y,
                  z: player.z,
                  vx: player.vx,
                  vy: player.vy,
                  vz: player.vz,
                  pitch: player.pitch,
                  yaw: player.yaw,
                  roll: player.roll,
                  throttle: player.throttle,
                  engineTemperature: 75,
                  damage: player.damage,
                  ammo: player.ammo || {},
                  ammoBelt: AmmoBelt.Universal,
                  modifications: [],
                  score: player.score || 0,
                  kills: player.kills || 0,
                  deaths: player.deaths || 0,
                  xpEarned: 0
                });
              }
            });

            // Sync initial ground targets
            if (msg.groundTargets?.length > 0) {
              msg.groundTargets.forEach((syncTarget: any) => {
                const localTarget = engine.groundTargets.find(t => t.id === syncTarget.id);
                if (localTarget) {
                  localTarget.hp = syncTarget.hp;
                  localTarget.isDead = syncTarget.isDead;
                }
              });
            }

            // Sync initial sky zone ownership
            if (msg.skyZones?.length > 0) {
              msg.skyZones.forEach((syncZone: any) => {
                const localZone = engine.skyZones.find(z => z.id === syncZone.id);
                if (localZone) {
                  localZone.owningTeam = syncZone.owningTeam;
                  localZone.captureProgress = syncZone.captureProgress;
                }
              });
            }

            // Sync team scores
            if (msg.scores) {
              engine.team1Score = msg.scores.team1 ?? 0;
              engine.team2Score = msg.scores.team2 ?? 0;
            }
          } else if (msg.type === "join_rejected") {
            console.warn("Multiplayer join rejected:", msg.reason);
            onMatchRejected(msg.reason);
          } else if (msg.type === "player_joined") {
            const player = msg.player;
            if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
              if (engine.isHost) engine.removeBot(player.team);
              engine.pilots.push({
                id: player.id,
                name: player.name,
                isBot: false,
                team: player.team,
                aircraftId: player.aircraftId,
                specs: player.specs,
                x: player.x,
                y: player.y,
                z: player.z,
                vx: player.vx,
                vy: player.vy,
                vz: player.vz,
                pitch: player.pitch,
                yaw: player.yaw,
                roll: player.roll,
                throttle: player.throttle,
                engineTemperature: 75,
                damage: player.damage,
                ammo: player.ammo || {},
                ammoBelt: AmmoBelt.Universal,
                modifications: [],
                score: player.score || 0,
                kills: player.kills || 0,
                deaths: player.deaths || 0,
                xpEarned: 0
              });
            }
          } else if (msg.type === "player_updated") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) {
              remote.x = msg.state.x;
              remote.y = msg.state.y;
              remote.z = msg.state.z;
              remote.vx = msg.state.vx;
              remote.vy = msg.state.vy;
              remote.vz = msg.state.vz;
              remote.pitch = msg.state.pitch;
              remote.yaw = msg.state.yaw;
              remote.roll = msg.state.roll;
              remote.throttle = msg.state.throttle;
              remote.damage = msg.state.damage;
              remote.ammo = msg.state.ammo as typeof remote.ammo;
              remote.score = msg.state.score;
              remote.kills = msg.state.kills;
              remote.deaths = msg.state.deaths;

              const sq = new Quaternion().setFromEuler(
                new Euler(msg.state.pitch, msg.state.yaw, msg.state.roll, "YXZ")
              );
              remote.netSnap = {
                x: msg.state.x,
                y: msg.state.y,
                z: msg.state.z,
                vx: msg.state.vx,
                vy: msg.state.vy,
                vz: msg.state.vz,
                qx: sq.x,
                qy: sq.y,
                qz: sq.z,
                qw: sq.w,
                at: performance.now()
              };
            }
          } else if (msg.type === "player_left") {
            engine.pilots = engine.pilots.filter(p => p.id !== msg.id);
            if (engine.isHost && msg.team) engine.addBot(msg.team as 1 | 2);
          } else if (msg.type === "player_fired") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) {
              engine.spawnProjectile(remote, msg.weaponType);
            }
          } else if (msg.type === "voxel_impact") {
            const lv = new Vector3(msg.lx, msg.ly, msg.lz);
            renderer3D.deformAircraft(msg.targetId, lv, msg.blast);
          } else if (msg.type === "kill_confirmed") {
            const netToLocal = (id: string) => (id === myPilotId ? "player" : id);
            const killer = engine.pilots.find(p => p.id === netToLocal(msg.killerId));
            const victim = engine.pilots.find(p => p.id === netToLocal(msg.victimId));
            if (killer && victim) {
              engine.forceRegisterKill(killer.id, victim.id, msg.weapon);
            }
          } else if (msg.type === "ground_updated") {
            const localTarget = engine.groundTargets.find(t => t.id === msg.targetId);
            if (localTarget) {
              localTarget.hp = msg.hp;
              localTarget.isDead = msg.isDead;
            }
          } else if (msg.type === "scores_updated") {
            engine.team1Score = msg.team1Score;
            engine.team2Score = msg.team2Score;
          } else if (msg.type === "host_changed") {
            engine.isHost = msg.hostId === myPilotId;
          } else if (msg.type === "damage_inflicted") {
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer) {
              const spot = new Vector3(msg.hitSpotLocal.x, msg.hitSpotLocal.y, msg.hitSpotLocal.z);
              FlightPhysicsEngine.applyDamage(localPlayer, msg.damage, msg.bulletType, spot);
            }
          } else if (msg.type === "bots_updated") {
            if (!engine.isHost) {
              const botSnapAt = performance.now();
              msg.bots.forEach((syncBot: any) => {
                const localBot = engine.pilots.find(p => p.id === syncBot.id);
                if (localBot) {
                  localBot.vx = syncBot.vx;
                  localBot.vy = syncBot.vy;
                  localBot.vz = syncBot.vz;
                  localBot.throttle = syncBot.throttle;
                  localBot.damage = syncBot.damage;
                  const bq = new Quaternion().setFromEuler(
                    new Euler(syncBot.pitch, syncBot.yaw, syncBot.roll, "YXZ")
                  );
                  localBot.netSnap = {
                    x: syncBot.x,
                    y: syncBot.y,
                    z: syncBot.z,
                    vx: syncBot.vx,
                    vy: syncBot.vy,
                    vz: syncBot.vz,
                    qx: bq.x,
                    qy: bq.y,
                    qz: bq.z,
                    qw: bq.w,
                    at: botSnapAt
                  };
                }
              });
            }
          } else if (msg.type === "chat_broadcast") {
            setChatMessages(prev => [
              ...prev.slice(-49),
              {
                sender: msg.senderName,
                text: msg.text,
                ts: Date.now()
              }
            ]);
          }
        } catch (err) {
          console.error("Multiplayer message parse/apply error:", err);
        }
      };

      // Wire engine callbacks
      engine.onProjectileSpawn = (weaponType) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "fire",
              weaponType
            })
          );
        }
      };

      engine.onGroundTargetDamage = (targetId, hp, isDead) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "ground_damage",
              targetId,
              hp,
              isDead
            })
          );
        }
      };

      engine.onLocalPlayerKill = (killerId, victimId, weapon) => {
        if (killerId !== "player") return;
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "kill",
              killerId: myPilotId,
              victimId,
              weapon
            })
          );
        }
      };

      engine.onPlayerDamage = (shooterId, targetId, damage, bulletType, hitSpotLocal) => {
        if (shooterId !== "player") return;
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "damage_inflicted",
              targetId,
              damage,
              bulletType,
              hitSpotLocal: { x: hitSpotLocal.x, y: hitSpotLocal.y, z: hitSpotLocal.z }
            })
          );
        }
      };

      engine.onVoxelHit = (targetId, localOffsetMeters, blastMeters) => {
        renderer3D.deformAircraft(targetId, localOffsetMeters, blastMeters);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "voxel_impact",
              targetId,
              lx: localOffsetMeters.x,
              ly: localOffsetMeters.y,
              lz: localOffsetMeters.z,
              blast: blastMeters
            })
          );
        }
      };
    },
    [disconnectMultiplayer]
  );

  const sendChat = useCallback((text: string, nickname: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "chat",
          senderName: nickname || "PILOT",
          text
        })
      );
    } else {
      setChatMessages(prev => [
        ...prev.slice(-49),
        {
          sender: nickname || "PILOT",
          text,
          ts: Date.now()
        }
      ]);
    }
  }, []);

  return {
    chatMessages,
    setChatMessages,
    connectMultiplayer,
    disconnectMultiplayer,
    sendChat,
    socketRef
  };
}
