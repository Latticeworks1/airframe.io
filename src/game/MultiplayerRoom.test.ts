// Run with: node --import tsx/esm src/game/MultiplayerRoom.test.ts
// tsx is already a devDependency; Node 22+ required.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { MultiplayerRoom } from "./MultiplayerRoom.js";
import { AmmoBelt } from "../types.js";
import { DEFAULT_AIRCRAFT } from "./aircraftData.js";





type ClientInputTuple = [
  number, // seq
  number, // pitch
  number, // roll
  number, // yaw
  number, // throttleDelta
  number, // boost
  number, // airbrake
  number, // primaryFire
  number, // secondaryFire
  number, // flaps
  number  // gearDeployed
];

async function testMultiplayerRoom() {
  console.log("[*] Running MultiplayerRoom unit tests...");

  // Initialize Rapier WASM before running tests to prevent async race conditions
  await RAPIER.init();

  const room = new MultiplayerRoom();
  room.roomId = "test-room-123";

  // Mock Colyseus Room environment methods and properties
  const broadcastMessages: Array<{ type: string; message: any }> = [];
  room.broadcast = (type: any, message: any) => {
    broadcastMessages.push({ type: String(type), message });
  };

  const messageHandlers = new Map<string, (client: any, message: any) => void>();
  room.onMessage = (type: any, callback: any) => {
    messageHandlers.set(String(type), callback);
    return {} as any;
  };

  const clientMessages: Array<{ sessionId: string; type: string; message: any }> = [];
  const createMockClient = (sessionId: string, nickname = "Maverick") => {
    return {
      sessionId,
      auth: {
        nickname,
        selectedPlaneId: "falcon-mk2",
        customizations: { skin: "default" },
        selectedBelt: AmmoBelt.Universal,
        equippedMods: { "falcon-mk2": [] }
      },
      send: (type: string, message: any) => {
        clientMessages.push({ sessionId, type, message });
      }
    } as any;
  };

  // Prevent background simulation thread from starting
  room.setSimulationInterval = (_cb: any, _delay: any) => {
    return { close: () => {} } as any;
  };

  // 0.5 Test onAuth authentication
  console.log("[*] Testing Room authentication (onAuth)...");
  const saveDir = fs.existsSync("/data") ? "/data/saves" : path.join(process.cwd(), "saves");
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  const tempToken = "test_token_auth_unit";
  const tempSavePath = path.join(saveDir, `${tempToken}.json`);
  fs.writeFileSync(tempSavePath, JSON.stringify({
    nickname: "Iceman",
    selectedPlaneId: "falcon-mk2",
    customizations: { skin: "default" },
    selectedBelt: AmmoBelt.Universal,
    equippedMods: { "falcon-mk2": [] }
  }));

  try {
    const mockAuthClient = {} as any;
    const authResult = await room.onAuth(mockAuthClient, { token: tempToken, nickname: "Iceman" });
    assert.strictEqual(authResult.nickname, "Iceman", "onAuth should successfully validate correct credentials");

    const authResult2 = await room.onAuth(mockAuthClient, { token: tempToken, nickname: "Maverick" });
    assert.strictEqual(authResult2.nickname, "Maverick", "onAuth should accept different nickname in options");

    const guestResult = await room.onAuth(mockAuthClient, { token: "nonexistent_token", nickname: "Iceman" });
    assert.strictEqual(guestResult.isGuest, true, "onAuth should return guest session for nonexistent token");
  } finally {
    if (fs.existsSync(tempSavePath)) {
      fs.unlinkSync(tempSavePath);
    }
  }

  // 1. Test onCreate
  console.log("[*] Testing Room creation...");
  await room.onCreate({ mapId: "island-chain", mode: 1 });

  assert.ok(room.state, "MatchState should be initialized");
  assert.strictEqual(room.state.matchEnded, false, "Match should not be ended");
  assert.strictEqual(room.state.team1Score, 0, "Team 1 score should be 0");
  assert.strictEqual(room.state.team2Score, 0, "Team 2 score should be 0");
  
  // By default, fillWithBots spawns 8 bots (4 per team)
  const botCount = Array.from((room as any).pilots.values()).filter((p: any) => p.isBot).length;
  assert.strictEqual(botCount, 8, "Should initially spawn exactly 8 bots (4 per team)");

  // 2. Test team balancing & bot eviction
  console.log("[*] Testing team balancing & bot eviction...");
  (room as any).pilots.clear();
  assert.strictEqual((room as any).setup.balanceTeams((room as any).pilots), 1, "balanceTeams should return 1 when empty");
  
  // Add 1 player to team 1
  (room as any).pilots.set("p1", { isBot: false, team: 1 });
  assert.strictEqual((room as any).setup.balanceTeams((room as any).pilots), 2, "balanceTeams should return 2 when team 1 has 1 player");

  // Add 1 player to team 2
  (room as any).pilots.set("p2", { isBot: false, team: 2 });
  assert.strictEqual((room as any).setup.balanceTeams((room as any).pilots), 1, "balanceTeams should return 1 when teams are equal");

  // Spawn a bot to team 1, and evict it
  (room as any).setup.botSys.spawnBot(1, DEFAULT_AIRCRAFT[0].id, (room as any).pilots, (room as any).state.players, (id: string, p: any) => (room as any).physSys.addPhysicsBody(id, p), (t: number) => (t === 1 ? Math.PI / 2 : -Math.PI / 2));
  const bot1 = Array.from((room as any).pilots.values()).find((p: any) => p.isBot && p.team === 1);
  assert.ok(bot1, "Bot should be spawned on Team 1");
  const botId = (bot1 as any).id;
  assert.ok((room as any).pilots.has(botId), "Bot should be in pilots map");
  assert.ok((room as any).physSys.rigidBodies.has(botId), "Bot should have a rigid body");

  // Evict the bot
  (room as any).setup.evictBot(1, (room as any).pilots, (room as any).physSys, (room as any).playerVoxelGrids);
  assert.ok(!(room as any).pilots.has(botId), "Bot should be evicted from pilots map");
  assert.ok(!(room as any).physSys.rigidBodies.has(botId), "Bot's rigid body should be cleaned up");

  // Restore bots for next steps
  (room as any).pilots.clear();
  (room as any).setup.botSys.fillWithBots(
    8, (room as any).pilots, (room as any).state.players,
    (id: string, p: any) => (room as any).physSys.addPhysicsBody(id, p),
    (t: number) => (t === 1 ? Math.PI / 2 : -Math.PI / 2)
  );

  // 3. Test Player joining
  console.log("[*] Testing Player joining...");
  const client1 = createMockClient("player_session_1", "Iceman");
  
  // Mock balanceTeams to assign to Team 1
  (room as any).setup.balanceTeams = () => 1;
  
  room.onJoin(client1, { aircraftId: "falcon-mk2", skin: "default" });

  assert.ok((room as any).pilots.has(client1.sessionId), "Player pilot should be registered");
  assert.ok(room.state.players.has(client1.sessionId), "Player should be added to Colyseus state schema");
  
  const playerPilot = (room as any).pilots.get(client1.sessionId);
  assert.strictEqual(playerPilot.name, "Iceman", "Pilot name should match auth client data");
  assert.strictEqual(playerPilot.team, 1, "Player should be assigned to Team 1");
  assert.strictEqual(playerPilot.isBot, false, "Player should not be marked as bot");

  // Verify welcome message was sent to client
  const welcomeMessage = clientMessages.find(m => m.sessionId === client1.sessionId && m.type === "welcome");
  assert.ok(welcomeMessage, "Welcome packet should be sent to joining client");
  assert.strictEqual(welcomeMessage.message.assignedTeam, 1, "Welcome packet team should be 1");

  // 4. Test Chat message handler
  console.log("[*] Testing Chat message handler...");
  const chatHandler = messageHandlers.get("chat");
  assert.ok(chatHandler, "Chat handler should be registered");
  chatHandler(client1, "Fox Two! Fox Two!");
  const lastChatBroadcast = broadcastMessages.find(m => m.type === "chat");
  assert.ok(lastChatBroadcast, "Chat message should be broadcast");
  assert.strictEqual(lastChatBroadcast.message[1], "player_session_1", "Broadcasted sender ID should match");
  assert.strictEqual(lastChatBroadcast.message[2], "Iceman", "Broadcasted sender name should match");
  assert.strictEqual(lastChatBroadcast.message[3], "Fox Two! Fox Two!", "Broadcasted text should match");

  // 5. Test Input Handling & Queuing edge cases
  console.log("[*] Testing input queue sorting and limits...");
  (room as any).inputSys.inputQueues.set(client1.sessionId, []);

  // Enqueue 65 inputs to test the queue size ceiling of 60
  for (let i = 0; i < 65; i++) {
    const tuple: ClientInputTuple = [i, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0];
    (room as any).inputSys.enqueueInput(client1.sessionId, tuple);
  }
  const q = (room as any).inputSys.inputQueues.get(client1.sessionId);
  assert.strictEqual(q.length, 60, "Input queue size should be capped at 60");
  assert.strictEqual(q[0].seq, 5, "Oldest inputs (0-4) should have been shifted out");
  assert.strictEqual(q[59].seq, 64, "Newest input (64) should be at the tail");

  // Test out-of-order sorting
  (room as any).inputSys.inputQueues.set(client1.sessionId, []);
  const t5: ClientInputTuple = [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const t8: ClientInputTuple = [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const t10: ClientInputTuple = [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  (room as any).inputSys.enqueueInput(client1.sessionId, t10);
  (room as any).inputSys.enqueueInput(client1.sessionId, t5);
  (room as any).inputSys.enqueueInput(client1.sessionId, t8);
  const sortedQ = (room as any).inputSys.inputQueues.get(client1.sessionId);
  assert.strictEqual(sortedQ[0].seq, 5);
  assert.strictEqual(sortedQ[1].seq, 8);
  assert.strictEqual(sortedQ[2].seq, 10);

  // Test queue under-run handles and preserves command state but disables fire
  (room as any).inputSys.inputQueues.set(client1.sessionId, []);
  (room as any).projectiles = [];
  (room as any).inputSys.lastInputs.set(client1.sessionId, {
    pitch: 0.5, roll: 0.2, yaw: 0.1, throttleDelta: 0,
    boost: true, airbrake: false, primaryFire: true, secondaryFire: true,
    flaps: "combat", gearDeployed: false
  });
  const originalRandUnder = Math.random;
  Math.random = () => 0; // force fire if triggered
  try {
    (room as any).tick(); // runs simulation tick, empty queue triggers under-run
  } finally {
    Math.random = originalRandUnder;
  }
  assert.strictEqual((room as any).projectiles.length, 0, "Queue under-run should disable weapon firing and spawn 0 projectiles");

  console.log("[*] All tests passed successfully!");
}

testMultiplayerRoom().catch(e => {
  console.error("FAIL MultiplayerRoom test:", e);
  process.exit(1);
});
