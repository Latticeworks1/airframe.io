// Run with: node --import tsx/esm src/game/MultiplayerRoom.test.ts
// tsx is already a devDependency; Node 22+ required.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { MultiplayerRoom } from "./MultiplayerRoom.js";
import { AmmoBelt, Pilot, WeaponType } from "../types.js";
import { DEFAULT_AIRCRAFT } from "./aircraftData.js";
import { Vector3 } from "three";
import { destructible } from "../types/components.js";
import { getTerrainHeight } from "./terrainModel.js";
import { GroundTarget } from "../types.js";

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
  assert.strictEqual((room as any).balanceTeams(), 1, "balanceTeams should return 1 when empty");
  
  // Add 1 player to team 1
  (room as any).pilots.set("p1", { isBot: false, team: 1 });
  assert.strictEqual((room as any).balanceTeams(), 2, "balanceTeams should return 2 when team 1 has 1 player");

  // Add 1 player to team 2
  (room as any).pilots.set("p2", { isBot: false, team: 2 });
  assert.strictEqual((room as any).balanceTeams(), 1, "balanceTeams should return 1 when teams are equal");

  // Spawn a bot to team 1, and evict it
  (room as any).spawnBot(1, DEFAULT_AIRCRAFT[0]);
  const bot1 = Array.from((room as any).pilots.values()).find((p: any) => p.isBot && p.team === 1);
  assert.ok(bot1, "Bot should be spawned on Team 1");
  const botId = (bot1 as any).id;
  assert.ok((room as any).pilots.has(botId), "Bot should be in pilots map");
  assert.ok((room as any).rigidBodies.has(botId), "Bot should have a rigid body");

  // Evict the bot
  (room as any).evictBot(1);
  assert.ok(!(room as any).pilots.has(botId), "Bot should be evicted from pilots map");
  assert.ok(!(room as any).rigidBodies.has(botId), "Bot's rigid body should be cleaned up");

  // Restore bots for next steps
  (room as any).pilots.clear();
  (room as any).fillWithBots();

  // 3. Test Player joining
  console.log("[*] Testing Player joining...");
  const client1 = createMockClient("player_session_1", "Iceman");
  
  // Mock balanceTeams to assign to Team 1
  (room as any).balanceTeams = () => 1;
  
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
  (room as any).inputQueues.set(client1.sessionId, []);

  // Enqueue 65 inputs to test the queue size ceiling of 60
  for (let i = 0; i < 65; i++) {
    const tuple: ClientInputTuple = [i, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0];
    (room as any).enqueueInput(client1.sessionId, tuple);
  }
  const q = (room as any).inputQueues.get(client1.sessionId);
  assert.strictEqual(q.length, 60, "Input queue size should be capped at 60");
  assert.strictEqual(q[0].seq, 5, "Oldest inputs (0-4) should have been shifted out");
  assert.strictEqual(q[59].seq, 64, "Newest input (64) should be at the tail");

  // Test out-of-order sorting
  (room as any).inputQueues.set(client1.sessionId, []);
  (room as any).enqueueInput(client1.sessionId, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  (room as any).enqueueInput(client1.sessionId, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  (room as any).enqueueInput(client1.sessionId, [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const sortedQ = (room as any).inputQueues.get(client1.sessionId);
  assert.strictEqual(sortedQ[0].seq, 5);
  assert.strictEqual(sortedQ[1].seq, 8);
  assert.strictEqual(sortedQ[2].seq, 10);

  // Test queue under-run handles and preserves command state but disables fire
  (room as any).inputQueues.set(client1.sessionId, []);
  (room as any).projectiles = [];
  (room as any).lastInputs.set(client1.sessionId, {
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

  // 6. Test Map Boundary Enforcement & Out-of-Bounds Damage
  console.log("[*] Testing map boundary enforcement...");
  (room as any).pilots.clear();
  const borderPilot = new Pilot({
    id: "border_player",
    name: "BorderFlyer",
    isBot: false,
    team: 1,
    aircraftId: "falcon-mk2",
    specs: DEFAULT_AIRCRAFT[0],
    x: 33000, // outside default 32000 map radius for island-chain
    y: 500,
    z: 0,
    vx: 100, vy: 0, vz: 0,
    pitch: 0, roll: 0, yaw: 0,
    throttle: 0.8,
    damage: (room as any).createEmptyDamage(),
    ammo: {},
    kills: 0, deaths: 0, score: 0
  } as any);
  (room as any).pilots.set("border_player", borderPilot);
  
  const initialYaw = borderPilot.yaw;
  (room as any).serverTick = 30; // so mod 30 is true and applies damage
  (room as any).enforceMapBoundary(borderPilot, 1.0);
  
  assert.ok(borderPilot.yaw !== initialYaw, "Boundary enforcement should rotate pilot back towards center");
  assert.ok(borderPilot.damage.fuselage < 1.0, "Boundary enforcement should inflict damage to fuselage");

  // Reduce fuselage near 0, tick, and assert boundary kill
  borderPilot.damage.fuselage = 0.04;
  (room as any).serverTick = 60; // mod 30 = 0
  (room as any).enforceMapBoundary(borderPilot, 1.0);
  assert.strictEqual(borderPilot.damage.fuselage, 0, "Fuselage should drop to 0");
  const boundaryKillBroadcast = broadcastMessages.find(m => m.type === "kill_confirmed" && m.message.victimId === "border_player");
  assert.ok(boundaryKillBroadcast, "Should broadcast kill confirmation for boundary death");
  assert.strictEqual(boundaryKillBroadcast.message.killerId, "boundary");

  // 7. Test Dead Pilot updates (gravity falling & terrain landing)
  console.log("[*] Testing dead pilot gravity & terrain landing...");
  const deadPilot = new Pilot({
    id: "dead_player",
    name: "Crashed",
    isBot: false,
    team: 1,
    aircraftId: "falcon-mk2",
    specs: DEFAULT_AIRCRAFT[0],
    x: 0,
    y: 5000,
    z: 0,
    vx: 50, vy: 0, vz: 50,
    pitch: 0, roll: 0, yaw: 0,
    throttle: 0,
    damage: (room as any).createEmptyDamage(),
    ammo: {},
    kills: 0, deaths: 0, score: 0
  } as any);
  destructible(deadPilot.entity).damageModel!.fuselage = 0; // marked dead
  (room as any).pilots.set("dead_player", deadPilot);

  (room as any).updateDeadPilot(deadPilot, 1.0);
  assert.strictEqual(deadPilot.vy, -9.8, "Dead pilot should accelerate downwards due to gravity");
  assert.ok(deadPilot.y < 5000, "Dead pilot position Y should decrease");

  // Force dead pilot to hit the ground
  deadPilot.y = -50;
  (room as any).updateDeadPilot(deadPilot, 1.0);
  const terrainHeight = getTerrainHeight(deadPilot.x, deadPilot.z, (room as any).mapId).height;
  assert.strictEqual(deadPilot.y, terrainHeight, "Dead pilot should be locked to terrain height");
  assert.strictEqual(deadPilot.vx, 0, "Dead pilot velocity X should be zeroed");
  assert.strictEqual(deadPilot.vy, 0, "Dead pilot velocity Y should be zeroed");
  assert.strictEqual(deadPilot.vz, 0, "Dead pilot velocity Z should be zeroed");

  // 8. Test Cooldowns ticking and Invulnerability Timer
  console.log("[*] Testing cooldowns ticking & invulnerability...");
  const cdPilot = new Pilot({
    id: "cd_player",
    name: "CooldownTest",
    isBot: false,
    team: 1,
    aircraftId: "falcon-mk2",
    specs: { ...DEFAULT_AIRCRAFT[0], weapons: [WeaponType.MG_7_7, WeaponType.ROCKET] },
    x: 0, y: 500, z: 0,
    vx: 0, vy: 0, vz: 100,
    damage: (room as any).createEmptyDamage(),
    ammo: {},
    kills: 0, deaths: 0, score: 0
  } as any);
  cdPilot.invulnerableTimer = 2.0;
  
  const wepComp = {
    cooldowns: { [WeaponType.MG_7_7]: 0.5 },
    ammo: { [WeaponType.MG_7_7]: 100, [WeaponType.ROCKET]: 5 }
  };
  cdPilot.entity.components.set("weaponized", wepComp as any);

  (room as any).tickCooldowns(cdPilot, 0.1);
  assert.strictEqual(cdPilot.invulnerableTimer, 1.9, "Invulnerable timer should decrement");
  assert.strictEqual(wepComp.cooldowns[WeaponType.MG_7_7], 0.4, "Weapon cooldown should decrement");

  console.log("[*] Testing primary & secondary weapon firing...");
  // Test primary firing with cooldown > 0 (should not fire)
  wepComp.cooldowns[WeaponType.MG_7_7] = 0.1;
  const initialProjCount = (room as any).projectiles.length;
  (room as any).handleWeaponFiring(cdPilot, true, false, 0.016);
  assert.strictEqual((room as any).projectiles.length, initialProjCount, "Should not fire weapon while on cooldown");

  // Test primary firing when cooldown is 0
  wepComp.cooldowns[WeaponType.MG_7_7] = 0;
  const origRandom = Math.random;
  Math.random = () => 0; // force fire chance to succeed
  try {
    (room as any).handleWeaponFiring(cdPilot, true, false, 0.016);
  } finally {
    Math.random = origRandom;
  }
  assert.ok((room as any).projectiles.length > initialProjCount, "Should fire primary weapon when cooldown is 0");
  assert.ok(wepComp.cooldowns[WeaponType.MG_7_7] > 0, "Should set muzzle cooldown after firing");

  // Test secondary firing (rocket)
  const initialProjCountSec = (room as any).projectiles.length;
  wepComp.cooldowns[WeaponType.ROCKET] = 0;
  (room as any).handleWeaponFiring(cdPilot, false, true, 0.016);
  assert.strictEqual((room as any).projectiles.length, initialProjCountSec + 1, "Should spawn secondary projectile");
  assert.strictEqual(wepComp.ammo[WeaponType.ROCKET], 4, "Should decrement rocket ammo");

  // 9. Test Policy B Lag Compensation & Fast-Forward Sweep
  console.log("[*] Testing Policy B lag compensation & fast-forward...");
  (room as any).pilots.clear();
  (room as any).pilots.set("player_session_1", playerPilot);
  (room as any).inputQueues.set("player_session_1", []);
  (room as any).playerHistory.set("player_session_1", []);
  
  // Set up lag queue with length of 5 (simulating 5 ticks of latency)
  const qBuffer = (room as any).inputQueues.get("player_session_1");
  for (let i = 0; i < 5; i++) {
    qBuffer.push({ seq: i, command: (room as any).neutralCommand() });
  }

  // Record historical coordinates at tick serverTick - 5
  (room as any).serverTick = 100;
  const history = (room as any).playerHistory.get("player_session_1") || [];
  history.push({
    tick: 95, // 100 - 5
    x: 100, y: 600, z: 200,
    pitch: 0, yaw: 0, roll: 0,
    vx: 0, vy: 0, vz: 100
  });
  (room as any).playerHistory.set("player_session_1", history);

  // Position current pilot at different coordinate
  playerPilot.x = 500;
  playerPilot.y = 600;
  playerPilot.z = 500;
  playerPilot.vx = 0;
  playerPilot.vy = 0;
  playerPilot.vz = 100;
  
  (room as any).projectiles = [];
  (room as any).spawnServerProjectile(playerPilot, WeaponType.MG_7_7, 100);
  
  const newProj = (room as any).projectiles[(room as any).projectiles.length - 1];
  assert.ok(newProj, "Projectile should be spawned");
  assert.ok(newProj.z < 400, "Projectile starting Z should be closer to historical 200 than current 500");
  assert.strictEqual(newProj.ownerId, "player_session_1");

  // 10. Test Projectiles & Raycast Collision (AP / Incendiary damage)
  console.log("[*] Testing projectile raycast collision & ammo belt modifiers...");
  const victimSocket = createMockClient("victim_test", "Iceman");
  room.onJoin(victimSocket, { aircraftId: "falcon-mk2", skin: "default" });
  
  const victimP = (room as any).pilots.get("victim_test");
  victimP.x = 0;
  victimP.y = 500;
  victimP.z = 100;
  victimP.vx = 0; victimP.vy = 0; victimP.vz = 0;
  destructible(victimP.entity).damageModel!.fuselage = 1.0;
  
  // Update Rapier body translation
  const vBody = (room as any).rigidBodies.get("victim_test");
  vBody.setTranslation({ x: 0, y: 500, z: 100 }, true);
  (room as any).rapierWorld.step();



  // 10.1 Test AP belt (deals 1.3x damage)
  destructible(victimP.entity).damageModel!.tail = 1.0;
  (room as any).projectiles = [];
  (room as any).projectiles.push({
    id: "proj_ap",
    ownerId: "player_session_1",
    ownerTeam: 1,
    type: WeaponType.MG_7_7,
    belt: "Armor-Piercing",
    x: 0, y: 500, z: 80,
    vx: 0, vy: 0, vz: 1200,
    life: 1.0
  });

  // 10.1 Test AP belt (deals 1.3x damage)
  destructible(victimP.entity).damageModel!.rightWing = 1.0;
  (room as any).projectiles = [];
  (room as any).projectiles.push({
    id: "proj_ap",
    ownerId: "player_session_1",
    ownerTeam: 1,
    type: WeaponType.MG_7_7,
    belt: "Armor-Piercing",
    x: 0, y: 500, z: 80,
    vx: 0, vy: 0, vz: 1200,
    life: 1.0
  });

  (room as any).updateProjectiles(0.02);
  assert.strictEqual((room as any).projectiles.length, 0, "Projectile should be removed after hit");
  assert.ok(destructible(victimP.entity).damageModel!.rightWing < 1.0, "Victim should have taken wing damage");
  const damageAppliedAP = 1.0 - destructible(victimP.entity).damageModel!.rightWing;
  
  // 10.2 Test Incendiary belt (deals 0.85x damage)
  destructible(victimP.entity).damageModel!.rightWing = 1.0;
  (room as any).projectiles.push({
    id: "proj_inc",
    ownerId: "player_session_1",
    ownerTeam: 1,
    type: WeaponType.MG_7_7,
    belt: "Incendiary",
    x: 0, y: 500, z: 80,
    vx: 0, vy: 0, vz: 1200,
    life: 1.0
  });

  (room as any).updateProjectiles(0.02);
  const damageAppliedInc = 1.0 - destructible(victimP.entity).damageModel!.rightWing;
  assert.ok(damageAppliedAP > damageAppliedInc, "Armor-piercing belt should deal more damage than Incendiary belt");

  // 10.3 Test PvP Scoring (Lethal damage)
  console.log("[*] Testing PvP scoring and lethal damage...");
  const initialKills = playerPilot.kills;
  const initialScore = playerPilot.score;
  const initialDeaths = victimP.deaths;
  const initialTeamScore = room.state.team1Score;
  
  const pvpbroadcasts: any[] = [];
  const originalBroadcast = room.broadcast;
  room.broadcast = (type: any, msg: any) => pvpbroadcasts.push({ type, msg });
  
  // Directly register a kill to test scoring logic (collision mapping is tested above)
  (room as any).registerKill("player_session_1", "victim_test", "CANNON_30");
  
  assert.strictEqual(playerPilot.kills, initialKills + 1, "Killer should gain 1 kill");
  assert.strictEqual(playerPilot.score, initialScore + 300, "Killer should gain 300 score points");
  assert.strictEqual(victimP.deaths, initialDeaths + 1, "Victim should gain 1 death");
  assert.strictEqual(room.state.team1Score, initialTeamScore + 100, "Killer's team should gain 100 team points");
  
  const killConfirmedBroadcast = pvpbroadcasts.find(m => m.type === "kill_confirmed");
  assert.ok(killConfirmedBroadcast, "kill_confirmed event must be broadcasted");
  assert.strictEqual(killConfirmedBroadcast.msg.killerId, "player_session_1", "Broadcast should have correct killer");
  assert.strictEqual(killConfirmedBroadcast.msg.victimId, "victim_test", "Broadcast should have correct victim");

  // Verify Victim Respawn
  // registerKill uses setTimeout for 4s before respawning. We manually invoke it for the test.
  (room as any).respawnPilot("victim_test");
  assert.strictEqual(destructible(victimP.entity).damageModel!.fuselage, 1.0, "Victim fuselage should be reset to 1.0 on respawn");
  assert.strictEqual(destructible(victimP.entity).isDead, false, "Victim should not be dead after respawn");
  assert.strictEqual(victimP.invulnerableTimer, 2.0, "Victim should have 2.0s invulnerable timer on respawn");
  const respawnBroadcast = pvpbroadcasts.find(m => m.type === "pilot_respawned");
  assert.ok(respawnBroadcast, "pilot_respawned event must be broadcasted");

  room.broadcast = originalBroadcast;

  // 10.4 Test Disconnect cleanup (onLeave)
  console.log("[*] Testing Disconnect cleanup (onLeave)...");
  room.onLeave(victimSocket, 4000);
  
  assert.strictEqual((room as any).pilots.has(victimSocket.sessionId), false, "Pilot should be removed from pilots map");
  assert.strictEqual((room as any).rigidBodies.has(victimSocket.sessionId), false, "RigidBody should be cleaned up");
  assert.strictEqual(room.state.players.has(victimSocket.sessionId), false, "Player should be removed from state schema");
  
  const leaveBroadcast = broadcastMessages.find(m => m.type === "player_left" && m.message.id === "victim_test");
  assert.ok(leaveBroadcast, "player_left broadcast should be sent");


  // 11. Test ground target damage & splash scaling
  console.log("[*] Testing ground target damage & splash scaling...");
  (room as any).groundTargets = [];
  const gtRadar = new GroundTarget({
    id: "test_radar",
    name: "Test Radar",
    team: 2,
    type: "radar",
    x: 100, y: 5000, z: 100,
    hp: 200, maxHp: 200, isDead: false
  });
  (room as any).groundTargets.push(gtRadar);

  // Spawn AP projectile hitting the ground target (AP belt does 1.8x base damage on ground targets)
  (room as any).projectiles = [];
  (room as any).projectiles.push({
    id: "proj_gt",
    ownerId: "player_session_1",
    ownerTeam: 1,
    type: WeaponType.MG_7_7,
    belt: "Armor-Piercing",
    x: 100, y: 5000, z: 98,
    vx: 0, vy: 0, vz: 100,
    life: 1.0
  });
  
  (room as any).updateProjectiles(0.04);
  assert.ok(gtRadar.hp < 200, "Ground target should take damage");
  
  // Test splash damage
  gtRadar.hp = 200;
  gtRadar.isDead = false;
  
  // Trigger splash damage from bomb at (100, 0, 150) -> distance is 50.
  // Bomb splash radius is 180, base is 350.
  // falloff = 1 - 50 / 180 = 0.722. expected damage = 350 * 0.722 = 252.7 -> dead.
  (room as any).triggerSplashDamage(new Vector3(100, 5000, 150), "player_session_1", 1, WeaponType.BOMB);
  assert.strictEqual(gtRadar.hp, 0, "Ground target should be destroyed by splash");
  assert.strictEqual(gtRadar.isDead, true, "Ground target should be marked dead");

  // 12. Test game end conditions
  console.log("[*] Testing game end conditions...");
  room.state.matchEnded = false;
  room.state.matchTimer = 0.01;
  
  (room as any).tick();
  assert.strictEqual(room.state.matchEnded, true, "Game should end when timer reaches 0");

  room.state.matchEnded = false;
  room.state.matchTimer = 300;
  room.state.team1Score = 1005;
  (room as any).tick();
  assert.strictEqual(room.state.matchEnded, true, "Game should end when a team score >= 1000");

  // 13. Test snapshot structure
  console.log("[*] Testing snapshot structure...");
  (room as any).serverTick = 2; // will become 3 in tick
  
  const snaps: any[] = [];
  room.broadcast = (type: any, message: any) => {
    if (type === "snapshot") {
      snaps.push(message);
    }
  };

  room.state.matchEnded = false;
  (room as any).tick();
  assert.strictEqual(snaps.length, 1, "Should broadcast snapshot on mod 3 ticks");
  
  const snap = snaps[0];
  assert.strictEqual(snap[0], 3, "Snapshot tick should match serverTick");
  assert.ok(snap[1], "Snapshot should include lastProcessedSeqs mapping");
  assert.ok(Array.isArray(snap[2]), "Snapshot should include entities array");

  // 14. Test onDispose
  console.log("[*] Testing Room disposal...");
  room.onDispose();

  // 15. Test Lobby Capacity (Spawning new lobbies when full)
  console.log("[*] Testing Lobby Capacity (Spillover)...");
  // Colyseus natively handles spawning new rooms via joinOrCreate when rooms reach maxClients.
  // We assert that the room properly configures this threshold.
  const capacityRoom = new MultiplayerRoom();
  assert.strictEqual(capacityRoom.maxClients, 16, "MultiplayerRoom must have maxClients=16 to ensure Colyseus spawns new lobbies when full");

  console.log("[SUCCESS] All MultiplayerRoom unit tests passed.");
  process.exit(0);
}

testMultiplayerRoom().catch((e) => {
  console.error("FAIL MultiplayerRoom test:", e);
  process.exit(1);
});
