import express from "express";
import path from "path";
import http from "http";
import { writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import type { WireDamageModel, WirePilotState, WireBotState } from "./src/networkTypes";

interface PlayerState {
  id: string;
  name: string;
  team: 1 | 2;
  aircraftId: string;
  specs: unknown;
  skin: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  throttle: number;
  damage: WireDamageModel;
  ammo: Record<string, number>;
  score: number;
  kills: number;
  deaths: number;
}

interface Room {
  id: string;
  queueKey: string;
  capacity: number;
  hostId: string | null;
  players: Map<string, PlayerState>;
  sockets: Map<string, WebSocket>;
  groundTargets: Map<string, any>;
  skyZones: Map<string, any>;
  scores: { team1: number; team2: number };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Core HTTP server wrapper
  const server = http.createServer(app);

  // WebSocket Server
  const wss = new WebSocketServer({ noServer: true });

  // In-memory rooms for matches
  const rooms = new Map<string, Room>();
  const activeSessions = new Map<string, WebSocket>();
  const MAX_PLAYERS_PER_ROOM = 12;
  let roomSequence = 0;

  // Dedicated telemetry WebSocket — streams frames straight to telemetry.jsonl in real time.
  const telemWss = new WebSocketServer({ noServer: true });
  telemWss.on("connection", (ws) => {
    let frameCount = 0;
    writeFileSync(telemPath, ""); // new session on every connection
    console.log("[telemetry] session started");

    ws.on("message", (raw: Buffer) => {
      try {
        const frames: unknown[] = JSON.parse(raw.toString());
        if (!Array.isArray(frames) || frames.length === 0) return;
        const lines = frames.map(f => JSON.stringify(f)).join("\n") + "\n";
        appendFileSync(telemPath, lines);
        frameCount += frames.length;
      } catch { /* drop malformed */ }
    });

    ws.on("close", () => console.log(`[telemetry] session ended — ${frameCount} frames`));
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/multiplayer") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else if (url.pathname === "/telemetry-ws") {
      telemWss.handleUpgrade(request, socket, head, (ws) => {
        telemWss.emit("connection", ws);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    let currentRoomId: string | null = null;
    let currentPilotId: string | null = null;
    let currentSessionId: string | null = null;

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message);

        if (data.type === "join") {
          if (currentRoomId || currentPilotId) {
            ws.send(JSON.stringify({
              type: "join_rejected",
              reason: "already_joined"
            }));
            return;
          }

          const { pilotId, name, specs, skin } = data;
          const queueKey = String(data.queueKey || data.roomId || "quickplay");
          const sessionId = String(data.sessionId || pilotId);
          const existingSession = activeSessions.get(sessionId);

          if (
            existingSession &&
            existingSession !== ws &&
            existingSession.readyState === WebSocket.OPEN
          ) {
            ws.send(JSON.stringify({
              type: "join_rejected",
              reason: "duplicate_session"
            }));
            return;
          }

          let room = Array.from(rooms.values())
            .filter(candidate =>
              candidate.queueKey === queueKey &&
              candidate.players.size < candidate.capacity
            )
            .sort((a, b) => b.players.size - a.players.size)[0];

          if (!room) {
            const roomId = `${queueKey}#${++roomSequence}`;
            room = {
              id: roomId,
              queueKey,
              capacity: MAX_PLAYERS_PER_ROOM,
              hostId: pilotId,
              players: new Map(),
              sockets: new Map(),
              groundTargets: new Map(),
              skyZones: new Map(),
              scores: { team1: 0, team2: 0 }
            };
            rooms.set(roomId, room);
          }

          const team1Count = Array.from(room.players.values())
            .filter(player => player.team === 1).length;
          const team2Count = room.players.size - team1Count;
          const assignedTeam: 1 | 2 =
            team1Count === team2Count
              ? (room.players.size % 2 === 0 ? 1 : 2)
              : team1Count < team2Count ? 1 : 2;

          currentRoomId = room.id;
          currentPilotId = pilotId;
          currentSessionId = sessionId;
          activeSessions.set(sessionId, ws);
          
          // If no host exists, assign this pilot
          if (!room.hostId) {
            room.hostId = pilotId;
          }

          const defaultPlayerState: PlayerState = {
            id: pilotId,
            name,
            team: assignedTeam,
            aircraftId: specs.id,
            specs,
            skin: skin || "default",
            x: 0, y: 350, z: 0,
            vx: 0, vy: 0, vz: 0,
            pitch: 0, yaw: 0, roll: 0,
            throttle: 0.8,
            damage: {
              engine: 1, leftWing: 1, rightWing: 1, tail: 1,
              cockpit: 1, fuelTank: 1, fuselage: 1,
              hasFire: false, hasOilLeak: false
            },
            ammo: data.ammo || {},
            score: 0,
            kills: 0,
            deaths: 0
          };

          room.players.set(pilotId, defaultPlayerState);
          room.sockets.set(pilotId, ws);

          // Get other players' state list
          const existingPlayers: PlayerState[] = [];
          room.players.forEach((p, id) => {
            if (id !== pilotId) {
              existingPlayers.push(p);
            }
          });

          // Send welcome to this client
          ws.send(JSON.stringify({
            type: "welcome",
            assignedId: pilotId,
            assignedTeam,
            roomId: room.id,
            queueKey: room.queueKey,
            capacity: room.capacity,
            hostId: room.hostId,
            players: existingPlayers,
            scores: room.scores,
            groundTargets: Array.from(room.groundTargets.values()),
            skyZones: Array.from(room.skyZones.values())
          }));

          // Notify all other players in this room
          room.sockets.forEach((s, id) => {
            if (id !== pilotId && s.readyState === WebSocket.OPEN) {
              s.send(JSON.stringify({
                type: "player_joined",
                player: defaultPlayerState
              }));
            }
          });
        }

        else if (data.type === "update") {
          if (!currentRoomId || !currentPilotId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const player = room.players.get(currentPilotId);
          if (player) {
            const s = data.pilotState as WirePilotState;
            player.x = s.x; player.y = s.y; player.z = s.z;
            player.vx = s.vx; player.vy = s.vy; player.vz = s.vz;
            player.pitch = s.pitch; player.yaw = s.yaw; player.roll = s.roll;
            player.throttle = s.throttle;
            player.damage = s.damage;
            player.ammo = s.ammo;
            player.score = s.score;
            player.kills = s.kills;
            player.deaths = s.deaths;

            // Broadcast state update to everyone else in the room
            const payload = JSON.stringify({
              type: "player_updated",
              id: currentPilotId,
              state: data.pilotState
            });

            room.sockets.forEach((s, id) => {
              if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
                s.send(payload);
              }
            });
          }
        }

        else if (data.type === "fire") {
          if (!currentRoomId || !currentPilotId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          // Broadcast fire action to everyone else
          const payload = JSON.stringify({
            type: "player_fired",
            id: currentPilotId,
            weaponType: data.weaponType
          });

          room.sockets.forEach((s, id) => {
            if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

        else if (data.type === "kill") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          // Relay kill trigger so everyone logs and registers deaths / team scores properly
          const payload = JSON.stringify({
            type: "kill_confirmed",
            killerId: data.killerId,
            victimId: data.victimId,
            weapon: data.weapon
          });

          room.sockets.forEach((s) => {
            if (s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

        else if (data.type === "ground_damage") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const { targetId, hp, isDead, killerId } = data;
          room.groundTargets.set(targetId, { id: targetId, hp, isDead, killerId });

          // Broadcast damage increment
          const payload = JSON.stringify({
            type: "ground_updated",
            targetId,
            hp,
            isDead,
            killerId
          });

          room.sockets.forEach((s, id) => {
            if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }
        else if (data.type === "damage_inflicted") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const targetSocket = room.sockets.get(data.targetId);
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({
              type: "damage_inflicted",
              damage: data.damage,
              bulletType: data.bulletType,
              hitSpotLocal: data.hitSpotLocal
            }));
          }
        }

        else if (data.type === "skyzone_update") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const { zoneId, owningTeam, captureProgress } = data;
          room.skyZones.set(zoneId, { id: zoneId, owningTeam, captureProgress });

          // Broadcast capture updates
          const payload = JSON.stringify({
            type: "skyzone_updated",
            zoneId,
            owningTeam,
            captureProgress
          });

          room.sockets.forEach((s, id) => {
            if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

        else if (data.type === "score_sync") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          room.scores = { team1: data.team1Score, team2: data.team2Score };

          const payload = JSON.stringify({
            type: "scores_updated",
            team1Score: data.team1Score,
            team2Score: data.team2Score
          });

          room.sockets.forEach((s, id) => {
            if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

        else if (data.type === "bots_sync") {
          if (!currentRoomId || !currentPilotId) return;
          const room = rooms.get(currentRoomId);
          if (!room || room.hostId !== currentPilotId) return; // Only host can update/sync bots

          // Broadcast bot states to all other players in the room
          const payload = JSON.stringify({
            type: "bots_updated",
            bots: data.bots
          });

          room.sockets.forEach((s, id) => {
            if (id !== currentPilotId && s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

        else if (data.type === "chat") {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const payload = JSON.stringify({
            type: "chat_broadcast",
            senderName: data.senderName,
            text: data.text
          });

          room.sockets.forEach((s) => {
            if (s.readyState === WebSocket.OPEN) {
              s.send(payload);
            }
          });
        }

      } catch (err) {
        console.error("Failed processing WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      if (
        currentSessionId &&
        activeSessions.get(currentSessionId) === ws
      ) {
        activeSessions.delete(currentSessionId);
      }

      if (currentRoomId && currentPilotId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          room.players.delete(currentPilotId);
          room.sockets.delete(currentPilotId);

          // If leaving player was host, migrate host designation
          if (room.hostId === currentPilotId) {
            const nextHost = Array.from(room.players.keys())[0] || null;
            room.hostId = nextHost;

            // Notify everyone of host change
            const hostPayload = JSON.stringify({
              type: "host_changed",
              hostId: nextHost
            });
            room.sockets.forEach((s) => {
              if (s.readyState === WebSocket.OPEN) {
                s.send(hostPayload);
              }
            });
          }

          // Broadcast departure
          const leavePayload = JSON.stringify({
            type: "player_left",
            id: currentPilotId
          });

          room.sockets.forEach((s) => {
            if (s.readyState === WebSocket.OPEN) {
              s.send(leavePayload);
            }
          });

          // Empty Room Cleanup
          if (room.players.size === 0) {
            rooms.delete(currentRoomId);
          }
        }
      }
    });
  });

  // API Route for quick status check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRooms: rooms.size });
  });

  const telemPath = path.join(tmpdir(), "airframe-telemetry.jsonl");

  // Client-Side Asset Bundling & Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Airframe Server] Online on http://localhost:${PORT}`);
  });
}

startServer();
