// Run with: node --import tsx/esm src/hooks/multiplayer/listeners.test.ts
import assert from "node:assert/strict";
import { setupRoomListeners } from "./listeners.js";
import { Pilot, AmmoBelt, WeaponType } from "../../types.js";
import { Vector3, Quaternion } from "three";

// Mock the react state dispatch function
const mockSetChatMessages = () => {};

// Mock the local player hit callback
let localPlayerHitRegister: { tgtId: string; isGround: boolean } | null = null;
const mockOnLocalPlayerHit = (tgtId: string, isGround: boolean) => {
  localPlayerHitRegister = { tgtId, isGround };
};

// Mock Colyseus Callbacks API
class MockCallbacks {
  public addCallbacks = new Map<string, (item: any, key: string) => void>();
  public removeCallbacks = new Map<string, (item: any, key: string) => void>();

  public onAdd(collectionName: string, cb: (item: any, key: string) => void) {
    this.addCallbacks.set(collectionName, cb);
  }

  public onRemove(collectionName: string, cb: (item: any, key: string) => void) {
    this.removeCallbacks.set(collectionName, cb);
  }
}

// Mock Colyseus Room
class MockRoom {
  public sessionId = "local-player-session-123";
  public state = {
    team1Score: 0,
    team2Score: 0,
    matchTimer: 300,
    matchEnded: false,
    players: new Map()
  };

  public stateChangeCallbacks: Array<(state: any) => void> = [];
  public messageHandlers = new Map<string, (message: any) => void>();
  public callbacks = new MockCallbacks();

  public onStateChange(cb: (state: any) => void) {
    this.stateChangeCallbacks.push(cb);
  }

  public onMessage(type: string, cb: (message: any) => void) {
    this.messageHandlers.set(type, cb);
    return { clear: () => {} };
  }
}

// Mock the Colyseus/SDK Callbacks static getter
import { Callbacks } from "@colyseus/sdk";
const originalGet = Callbacks.get;
Callbacks.get = (room: any) => {
  return room.callbacks;
};

// Mock Match Engine / MultiplayerMatchContext
class MockEngine {
  public pilots: Pilot[] = [];
  public projectiles: any[] = [];
  public groundTargets: any[] = [];
  public team1Score = 0;
  public team2Score = 0;
  public matchTimer = 0;
  public matchEnded = false;
  public forceRegisterKillCalled: { killerId: string; victimId: string; weapon: any } | null = null;
  public forceEndGameCalled: boolean | null = null;
  public spawnProjectileCalled: { pilotId: string; weaponType: any } | null = null;
  public projectileImpactCalled: { type: any; pos: Vector3; origin: string } | null = null;
  public voxelHitCalled: { targetId: string; pos: Vector3; blast: any } | null = null;
  public pilotRespawnCalled: string | null = null;

  public spawnProjectile(pilot: Pilot, weaponType: any) {
    this.spawnProjectileCalled = { pilotId: pilot.id, weaponType };
  }

  public onProjectileImpact(type: any, pos: Vector3, origin: string) {
    this.projectileImpactCalled = { type, pos, origin };
  }

  public onVoxelHit(targetId: string, pos: Vector3, blast: any) {
    this.voxelHitCalled = { targetId, pos, blast };
  }

  public onPilotRespawn(id: string) {
    this.pilotRespawnCalled = id;
  }

  public forceRegisterKill(killerId: string, victimId: string, weapon: any) {
    this.forceRegisterKillCalled = { killerId, victimId, weapon };
  }

  public forceEndGame(won: boolean) {
    this.forceEndGameCalled = won;
  }
}

async function testListeners() {
  console.log("[*] Running client-side listeners unit tests...");

  const room = new MockRoom() as any;
  const engine = new MockEngine() as any;

  // Initialize listeners
  setupRoomListeners(room, engine, mockSetChatMessages, mockOnLocalPlayerHit);

  // 1. Verify onStateChange syncing
  room.state.team1Score = 15;
  room.state.team2Score = 10;
  room.state.matchTimer = 180;
  room.state.matchEnded = true;
  room.stateChangeCallbacks.forEach(cb => cb(room.state));

  assert.strictEqual(engine.team1Score, 15, "Team 1 score should sync");
  assert.strictEqual(engine.team2Score, 10, "Team 2 score should sync");
  assert.strictEqual(engine.matchTimer, 180, "Match timer should sync");
  assert.strictEqual(engine.matchEnded, true, "Match ended state should sync");

  // 2. Verify onAdd callback updates the engine pilots array
  const addPlayerCb = room.callbacks.addCallbacks.get("players");
  assert.ok(addPlayerCb, "players.onAdd callback should be registered");

  const mockRemotePlayerSchema = {
    name: "Skywalker",
    isBot: false,
    team: 2,
    aircraftId: "grizzly-a1",
    score: 100,
    kills: 5,
    deaths: 2
  };
  addPlayerCb(mockRemotePlayerSchema, "remote-player-456");

  assert.strictEqual(engine.pilots.length, 1, "Remote pilot should be added to engine.pilots");
  const remotePilot = engine.pilots[0];
  assert.strictEqual(remotePilot.id, "remote-player-456", "Pilot ID should match");
  assert.strictEqual(remotePilot.name, "Skywalker", "Pilot name should match");
  assert.strictEqual(remotePilot.team, 2, "Pilot team should match");

  // 3. Verify onRemove callback filters out the player
  const removePlayerCb = room.callbacks.removeCallbacks.get("players");
  assert.ok(removePlayerCb, "players.onRemove callback should be registered");
  removePlayerCb({}, "remote-player-456");
  assert.strictEqual(engine.pilots.length, 0, "Remote pilot should be removed from engine.pilots");

  // Re-add for snapshot testing
  addPlayerCb(mockRemotePlayerSchema, "remote-player-456");

  // Setup local player in engine (App.tsx usually initializes this)
  const localPilot = new Pilot({
    id: "player",
    name: "Maverick",
    isBot: false,
    team: 1,
    aircraftId: "falcon-mk2",
    specs: remotePilot.specs,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    pitch: 0, yaw: 0, roll: 0,
    throttle: 0.5,
    engineTemperature: 75,
    damage: { engine: 1, leftWing: 1, rightWing: 1, tail: 1, cockpit: 1, fuelTank: 1, fuselage: 1, hasFire: false, hasOilLeak: false },
    ammo: {} as any,
    ammoBelt: AmmoBelt.Universal,
    modifications: [],
    score: 0, kills: 0, deaths: 0, xpEarned: 0
  });
  engine.pilots.push(localPilot);

  // 4. Verify snapshot packet processing
  const snapshotCb = room.messageHandlers.get("snapshot");
  assert.ok(snapshotCb, "snapshot message handler should be registered");

  const lastSeqs = {
    [room.sessionId]: 42
  };
  const entities = [
    // Local player update entity
    [
      room.sessionId,
      "aircraft",
      100.5, 200.5, 300.5, // position
      10.2, 20.2, 30.2,    // velocity
      0.1, 0.2, 0.3,       // pitch, yaw, roll
      0.8,                 // throttle
      1, 1, 1, 1, 1, 1, 1, // damage statuses
      0, 0,                // fire, oil leak
      300, 4               // ammo primary, ammo rocket
    ],
    // Remote player update entity
    [
      "remote-player-456",
      "aircraft",
      500.5, 600.5, 700.5, // position
      5.2, 6.2, 7.2,       // velocity
      -0.1, -0.2, -0.3,    // pitch, yaw, roll
      0.6,                 // throttle
      0.8, 1, 1, 1, 1, 1, 1, // damage statuses
      0, 0,                // fire, oil leak
      150, 0               // ammo primary, ammo rocket
    ]
  ];

  snapshotCb([1000, lastSeqs, entities]); // snapshot message: [tick, lastSeqs, entities]

  // Local player should have server position updates staged
  assert.ok((localPilot as any).serverPosition, "Local player serverPosition should be defined");
  assert.strictEqual((localPilot as any).serverPosition.x, 100.5, "Local player serverPosition X matches snapshot");
  assert.strictEqual((localPilot as any).serverLastProcessedSeq, 42, "Local player serverLastProcessedSeq matches snapshot");
  assert.strictEqual((localPilot as any).serverTick, 1000, "Local player serverTick matches snapshot");

  // Remote player should have immediate position interpolation variables staged in netSnap
  const remotePilotRef = engine.pilots.find(p => p.id === "remote-player-456")!;
  assert.ok(remotePilotRef.netSnap, "Remote player netSnap should be defined");
  assert.strictEqual(remotePilotRef.netSnap.x, 500.5, "Remote player netSnap X matches snapshot");
  assert.strictEqual(remotePilotRef.vx, 5.2, "Remote player velocity X matches snapshot");

  // 5. Verify other messaging updates
  const playerFiredCb = room.messageHandlers.get("player_fired");
  assert.ok(playerFiredCb, "player_fired message handler should be registered");
  playerFiredCb({ id: "remote-player-456", weaponType: WeaponType.MG_7_7 });
  assert.deepEqual(engine.spawnProjectileCalled, { pilotId: "remote-player-456", weaponType: WeaponType.MG_7_7 }, "spawnProjectile called for firing player");

  const projectileImpactCb = room.messageHandlers.get("projectile_impact");
  assert.ok(projectileImpactCb, "projectile_impact message handler should be registered");
  projectileImpactCb({ type: WeaponType.MG_7_7, px: 1, py: 2, pz: 3 });
  assert.deepEqual(engine.projectileImpactCalled, { type: WeaponType.MG_7_7, pos: new Vector3(1, 2, 3), origin: "server" }, "projectileImpact callback executed");

  const voxelImpactCb = room.messageHandlers.get("voxel_impact");
  assert.ok(voxelImpactCb, "voxel_impact message handler should be registered");
  voxelImpactCb({ targetId: "ground-unit-1", lx: 10, ly: 20, lz: 30, blast: true });
  assert.deepEqual(engine.voxelHitCalled, { targetId: "ground-unit-1", pos: new Vector3(10, 20, 30), blast: true }, "voxel impact callback executed");

  const groundUpdatedCb = room.messageHandlers.get("ground_updated");
  assert.ok(groundUpdatedCb, "ground_updated message handler should be registered");
  const mockTarget = { id: "ground-unit-1", hp: 100, isDead: false };
  engine.groundTargets.push(mockTarget);
  groundUpdatedCb({ targetId: "ground-unit-1", hp: 45, isDead: false });
  assert.strictEqual(mockTarget.hp, 45, "Ground target health updated");
  assert.strictEqual(mockTarget.isDead, false, "Ground target isDead flag updated");

  const damageInflictedCb = room.messageHandlers.get("damage_inflicted");
  assert.ok(damageInflictedCb, "damage_inflicted message handler should be registered");
  localPlayerHitRegister = null;
  damageInflictedCb({ damage: 0.1, bulletType: WeaponType.MG_7_7, hitSpotLocal: { x: 0, y: 1, z: 2 } });
  assert.ok(localPlayerHitRegister, "Local player hit callback registered");
  assert.strictEqual(localPlayerHitRegister.tgtId, "player", "Hit target is player");

  const pilotRespawnedCb = room.messageHandlers.get("pilot_respawned");
  assert.ok(pilotRespawnedCb, "pilot_respawned message handler should be registered");
  pilotRespawnedCb({ id: "remote-player-456", x: 10, y: 20, z: 30, yaw: 1.5 });
  assert.strictEqual(engine.pilotRespawnCalled, "remote-player-456", "Engine onPilotRespawn called");
  assert.strictEqual(remotePilotRef.x, 10, "Respawned pilot coordinate X updated");

  const killConfirmedCb = room.messageHandlers.get("kill_confirmed");
  assert.ok(killConfirmedCb, "kill_confirmed message handler should be registered");
  killConfirmedCb({ killerId: room.sessionId, victimId: "remote-player-456", weapon: WeaponType.MG_7_7 });
  assert.deepEqual(engine.forceRegisterKillCalled, { killerId: "player", victimId: "remote-player-456", weapon: WeaponType.MG_7_7 }, "Kill confirmation registered");

  const matchEndCb = room.messageHandlers.get("match_end");
  assert.ok(matchEndCb, "match_end message handler should be registered");
  matchEndCb({ team1Won: true });
  assert.strictEqual(engine.forceEndGameCalled, true, "Game end callback registered");

  // Restore Callbacks static getter
  Callbacks.get = originalGet;

  console.log("[SUCCESS] All client-side listeners tests passed.");
}

testListeners().catch(err => {
  console.error("[FAILURE] Test failed:", err);
  process.exit(1);
});
