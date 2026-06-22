/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback } from "react";
import { Vector3, Quaternion, Euler } from "three";
import { GameEngine } from "../game/gameEngine";
import { WorldRenderer } from "../game/worldRenderer";
import { AmmoBelt, MatchMode, Pilot } from "../types";
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
  const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChansRef = useRef<Map<string, RTCDataChannel>>(new Map());
  // Buffers ICE candidates that arrive before setRemoteDescription completes
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const myPilotIdRef = useRef<string>("");
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);

  const closePeer = useCallback((peerId: string) => {
    const dc = dataChansRef.current.get(peerId);
    if (dc) { try { dc.close(); } catch { /* ignore */ } dataChansRef.current.delete(peerId); }
    const pc = peerConnsRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch { /* ignore */ } peerConnsRef.current.delete(peerId); }
    pendingIceRef.current.delete(peerId);
  }, []);

  const disconnectMultiplayer = useCallback(() => {
    peerConnsRef.current.forEach((_, id) => closePeer(id));
    if (socketRef.current) {
      if (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }
  }, [closePeer]);

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
      myPilotIdRef.current = myPilotId;
      const myCallsign = nickname || "Maverick_99";

      engine.isMultiplayer = true;

      // Fetch TURN/STUN credentials from server (proxied from Metered)
      fetch("/api/ice-servers")
        .then(r => r.json())
        .then((servers: RTCIceServer[]) => { iceServersRef.current = servers; })
        .catch(() => { /* keep default STUN */ });

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

      // --- WebRTC helpers ---

      const setupDataChannel = (dc: RTCDataChannel, peerId: string) => {
        dc.onopen = () => {
          console.log(`[rtc] DataChannel open with ${peerId}`);
          dataChansRef.current.set(peerId, dc);
        };
        dc.onclose = () => { dataChansRef.current.delete(peerId); };
        dc.onerror = () => { dataChansRef.current.delete(peerId); };
        dc.onmessage = (evt) => {
          try { applyGameMsg(JSON.parse(evt.data)); } catch { /* ignore */ }
        };
      };

      const createPeerConn = (peerId: string, isOfferer: boolean): RTCPeerConnection => {
        const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
        peerConnsRef.current.set(peerId, pc);

        pc.onicecandidate = (e) => {
          if (e.candidate && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "rtc_ice", targetId: peerId, candidate: e.candidate }));
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            closePeer(peerId);
          }
        };

        if (isOfferer) {
          const dc = pc.createDataChannel("game", { ordered: false, maxRetransmits: 0 });
          setupDataChannel(dc, peerId);
          pc.createOffer()
            .then(offer => pc.setLocalDescription(offer).then(() => offer))
            .then(offer => {
              if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "rtc_offer", targetId: peerId, offer }));
              }
            })
            .catch(err => console.warn("[rtc] offer failed:", err));
        } else {
          pc.ondatachannel = (e) => setupDataChannel(e.channel, peerId);
        }

        return pc;
      };

      const drainIceCandidates = async (pc: RTCPeerConnection, peerId: string) => {
        const pending = pendingIceRef.current.get(peerId) || [];
        for (const c of pending) {
          await pc.addIceCandidate(c).catch(() => {});
        }
        pendingIceRef.current.delete(peerId);
      };

      // --- Shared game message handler (called from both WebSocket and DataChannel) ---

      const applyGameMsg = (msg: any) => {
        if (msg.type === "player_updated") {
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
              x: msg.state.x, y: msg.state.y, z: msg.state.z,
              vx: msg.state.vx, vy: msg.state.vy, vz: msg.state.vz,
              qx: sq.x, qy: sq.y, qz: sq.z, qw: sq.w,
              at: performance.now()
            };
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
                  x: syncBot.x, y: syncBot.y, z: syncBot.z,
                  vx: syncBot.vx, vy: syncBot.vy, vz: syncBot.vz,
                  qx: bq.x, qy: bq.y, qz: bq.z, qw: bq.w,
                  at: botSnapAt
                };
              }
            });
          }
        } else if (msg.type === "scores_updated") {
          engine.team1Score = msg.team1Score;
          engine.team2Score = msg.team2Score;
        } else if (msg.type === "chat_broadcast") {
          setChatMessages(prev => [
            ...prev.slice(-49),
            { sender: msg.senderName, text: msg.text, ts: Date.now() }
          ]);
        }
        // All other game message types are handled in socket.onmessage only
        // (fire, kill, damage, ground, voxel) since those are infrequent and
        // already handled by the WebSocket relay path
      };

      // --- WebSocket message handler ---

      socket.onerror = (err) => {
        console.warn("Multiplayer WebSocket error:", err);
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

          if (msg.type === "ping") {
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "pong" }));
            }
          }

          else if (msg.type === "welcome") {
            engine.isHost = msg.hostId === myPilotId;
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer && (msg.assignedTeam === 1 || msg.assignedTeam === 2)) {
              localPlayer.team = msg.assignedTeam;
            }

            engine.pilots = engine.pilots.filter(p => p.id === "player" || p.isBot);

            msg.players.forEach((player: any) => {
              if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
                engine.pilots.push(new Pilot({
                  id: player.id,
                  name: player.name,
                  isBot: false,
                  team: player.team,
                  aircraftId: player.aircraftId,
                  specs: player.specs,
                  x: player.x, y: player.y, z: player.z,
                  vx: player.vx, vy: player.vy, vz: player.vz,
                  pitch: player.pitch, yaw: player.yaw, roll: player.roll,
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
                }));
              }
              // Initiate WebRTC with each existing peer
              if (player.id !== myPilotId) {
                createPeerConn(player.id, true /* offerer */);
              }
            });

            if (msg.groundTargets?.length > 0) {
              msg.groundTargets.forEach((syncTarget: any) => {
                const localTarget = engine.groundTargets.find(t => t.id === syncTarget.id);
                if (localTarget) { localTarget.hp = syncTarget.hp; localTarget.isDead = syncTarget.isDead; }
              });
            }

            if (msg.skyZones?.length > 0) {
              msg.skyZones.forEach((syncZone: any) => {
                const localZone = engine.skyZones.find(z => z.id === syncZone.id);
                if (localZone) { localZone.owningTeam = syncZone.owningTeam; localZone.captureProgress = syncZone.captureProgress; }
              });
            }

            if (msg.scores) {
              engine.team1Score = msg.scores.team1 ?? 0;
              engine.team2Score = msg.scores.team2 ?? 0;
            }
          }

          else if (msg.type === "join_rejected") {
            console.warn("Multiplayer join rejected:", msg.reason);
            onMatchRejected(msg.reason);
          }

          else if (msg.type === "player_joined") {
            const player = msg.player;
            if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
              if (engine.isHost) engine.removeBot(player.team);
              engine.pilots.push(new Pilot({
                id: player.id,
                name: player.name,
                isBot: false,
                team: player.team,
                aircraftId: player.aircraftId,
                specs: player.specs,
                x: player.x, y: player.y, z: player.z,
                vx: player.vx, vy: player.vy, vz: player.vz,
                pitch: player.pitch, yaw: player.yaw, roll: player.roll,
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
              }));
              // Initiate WebRTC with the new peer
              createPeerConn(player.id, true /* offerer */);
            }
          }

          else if (msg.type === "rtc_offer") {
            const pc = createPeerConn(msg.fromId, false /* answerer */);
            pc.setRemoteDescription(msg.offer)
              .then(() => drainIceCandidates(pc, msg.fromId))
              .then(() => pc.createAnswer())
              .then(answer => pc.setLocalDescription(answer).then(() => answer))
              .then(answer => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: "rtc_answer", targetId: msg.fromId, answer }));
                }
              })
              .catch(err => console.warn("[rtc] answer failed:", err));
          }

          else if (msg.type === "rtc_answer") {
            const pc = peerConnsRef.current.get(msg.fromId);
            if (pc) {
              pc.setRemoteDescription(msg.answer)
                .then(() => drainIceCandidates(pc, msg.fromId))
                .catch(err => console.warn("[rtc] setRemoteDescription answer failed:", err));
            }
          }

          else if (msg.type === "rtc_ice") {
            const pc = peerConnsRef.current.get(msg.fromId);
            if (pc && pc.remoteDescription) {
              pc.addIceCandidate(msg.candidate).catch(() => {});
            } else {
              const pending = pendingIceRef.current.get(msg.fromId) || [];
              pending.push(msg.candidate);
              pendingIceRef.current.set(msg.fromId, pending);
            }
          }

          else if (msg.type === "player_updated") {
            applyGameMsg(msg);
          }

          else if (msg.type === "player_left") {
            engine.pilots = engine.pilots.filter(p => p.id !== msg.id);
            if (engine.isHost && msg.team) engine.addBot(msg.team as 1 | 2);
            closePeer(msg.id);
          }

          else if (msg.type === "player_fired") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) engine.spawnProjectile(remote, msg.weaponType);
          }

          else if (msg.type === "voxel_impact") {
            const lv = new Vector3(msg.lx, msg.ly, msg.lz);
            renderer3D.deformAircraft(msg.targetId, lv, msg.blast);
          }

          else if (msg.type === "kill_confirmed") {
            const netToLocal = (id: string) => (id === myPilotId ? "player" : id);
            const killer = engine.pilots.find(p => p.id === netToLocal(msg.killerId));
            const victim = engine.pilots.find(p => p.id === netToLocal(msg.victimId));
            if (killer && victim) engine.forceRegisterKill(killer.id, victim.id, msg.weapon);
          }

          else if (msg.type === "ground_updated") {
            const localTarget = engine.groundTargets.find(t => t.id === msg.targetId);
            if (localTarget) { localTarget.hp = msg.hp; localTarget.isDead = msg.isDead; }
          }

          else if (msg.type === "scores_updated") {
            applyGameMsg(msg);
          }

          else if (msg.type === "host_changed") {
            engine.isHost = msg.hostId === myPilotId;
          }

          else if (msg.type === "damage_inflicted") {
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer) {
              const spot = new Vector3(msg.hitSpotLocal.x, msg.hitSpotLocal.y, msg.hitSpotLocal.z);
              FlightPhysicsEngine.applyDamage(localPlayer, msg.damage, msg.bulletType, spot);
            }
          }

          else if (msg.type === "bots_updated") {
            applyGameMsg(msg);
          }

          else if (msg.type === "chat_broadcast") {
            applyGameMsg(msg);
          }

          else if (msg.type === "skyzone_updated") {
            const localZone = engine.skyZones.find(z => z.id === msg.zoneId);
            if (localZone) { localZone.owningTeam = msg.owningTeam; localZone.captureProgress = msg.captureProgress; }
          }

        } catch (err) {
          console.error("Multiplayer message parse/apply error:", err);
        }
      };

      // Wire engine callbacks

      engine.onProjectileSpawn = (weaponType) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "fire", weaponType }));
        }
      };

      engine.onGroundTargetDamage = (targetId, hp, isDead) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "ground_damage", targetId, hp, isDead }));
        }
      };

      engine.onLocalPlayerKill = (killerId, victimId, weapon) => {
        if (killerId !== "player") return;
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "kill", killerId: myPilotId, victimId, weapon }));
        }
      };

      engine.onPlayerDamage = (shooterId, targetId, damage, bulletType, hitSpotLocal) => {
        if (shooterId !== "player") return;
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: "damage_inflicted",
            targetId,
            damage,
            bulletType,
            hitSpotLocal: { x: hitSpotLocal.x, y: hitSpotLocal.y, z: hitSpotLocal.z }
          }));
        }
      };

      engine.onVoxelHit = (targetId, localOffsetMeters, blastMeters) => {
        renderer3D.deformAircraft(targetId, localOffsetMeters, blastMeters);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: "voxel_impact",
            targetId,
            lx: localOffsetMeters.x,
            ly: localOffsetMeters.y,
            lz: localOffsetMeters.z,
            blast: blastMeters
          }));
        }
      };
    },
    [disconnectMultiplayer, closePeer]
  );

  const sendChat = useCallback((text: string, nickname: string) => {
    const senderName = nickname || "PILOT";
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "chat", senderName, text }));
    } else {
      // Offline fallback: deliver locally and broadcast to any open DataChannels
      setChatMessages(prev => [...prev.slice(-49), { sender: senderName, text, ts: Date.now() }]);
      const payload = JSON.stringify({ type: "chat_broadcast", senderName, text });
      dataChansRef.current.forEach(dc => {
        if (dc.readyState === "open") dc.send(payload);
      });
    }
  }, []);

  return {
    chatMessages,
    setChatMessages,
    connectMultiplayer,
    disconnectMultiplayer,
    sendChat,
    socketRef,
    dataChansRef,
    myPilotIdRef,
  };
}
