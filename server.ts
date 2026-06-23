import express from "express";
import http from "http";
import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer as createViteServer } from "vite";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MultiplayerRoom } from "./src/game/MultiplayerRoom";

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = parseInt(process.env.PORT ?? "7860", 10);
  const server = http.createServer(app);

  // Initialize Colyseus game server
  const gameServer = new Server({
    transport: new WebSocketTransport({ server })
  });
  gameServer.define("air_combat", MultiplayerRoom);

  // Bind matchmaking and HTTP routes to the server without breaking Express body-parser
  (gameServer as any).bindRoutes();

  // Authoritative progression save directory
  const saveDir = existsSync("/data") ? "/data/saves" : path.join(process.cwd(), "saves");
  if (!existsSync(saveDir)) {
    try { mkdirSync(saveDir, { recursive: true }); } catch (e) { console.error(e); }
  }

  // Save/Load Progression APIs
  app.get("/api/progression", (req, res) => {
    const sid = req.query.sid as string | undefined;
    if (!sid || sid.length > 128) return res.status(400).json({ error: "Invalid session ID" });
    const filePath = path.join(saveDir, `${sid}.json`);
    if (existsSync(filePath)) {
      try { res.json(JSON.parse(readFileSync(filePath, "utf-8"))); } catch { res.status(500).json({ error: "Failed to read save" }); }
    } else {
      res.json({ status: "not_found" });
    }
  });

  app.post("/api/progression", (req, res) => {
    const { sessionId, progression } = req.body;
    if (!sessionId || sessionId.length > 128 || !progression) return res.status(400).json({ error: "Invalid request payload" });
    try {
      writeFileSync(path.join(saveDir, `${sessionId}.json`), JSON.stringify(progression, null, 2), "utf-8");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to save progression" });
    }
  });

  // Lobby presence: token -> last-seen timestamp. Entries expire after 15s.
  const lobbyPresence = new Map<string, number>();

  app.get("/api/presence", (req, res) => res.json({ ok: true }));
  app.get("/api/ice-servers", (req, res) => res.json([{ urls: "stun:stun.l.google.com:19302" }]));

  app.get("/api/health", async (req, res) => {
    const token = (req.query.t as string) || req.ip || "anon";
    const now = Date.now();
    lobbyPresence.set(token, now);
    const cutoff = now - 15000;
    for (const [k, v] of lobbyPresence) if (v < cutoff) lobbyPresence.delete(k);

    try {
      const rooms = await matchMaker.query({ name: "air_combat" });
      let roomPlayers = 0;
      rooms.forEach((r) => roomPlayers += r.clients);
      const totalPlayers = roomPlayers + lobbyPresence.size;
      res.json({ status: "ok", totalPlayers, byQueue: {} });
    } catch {
      res.json({ status: "ok", totalPlayers: lobbyPresence.size, byQueue: {} });
    }
  });

  app.get("/api/preview", (req, res) => {
    res.json({ players: [] });
  });

  // Serve client assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Airframe Server Auth] Online on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
