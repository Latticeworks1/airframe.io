import { Room, Client } from "@colyseus/core";
import { MatchState, ClientInputTuple } from "./multiplayer/MatchState";
import { RoomSetup } from "./multiplayer/RoomSetup";
import { InputSystem } from "./multiplayer/InputSystem";
import { SimulationSystem } from "./multiplayer/SimulationSystem";
import { WeaponSystem } from "./multiplayer/WeaponSystem";
import { ProjectileSystem } from "./multiplayer/ProjectileSystem";
import { DamageSystem } from "./multiplayer/DamageSystem";
import { SnapshotSystem } from "./multiplayer/SnapshotSystem";
import { PhysicsSystem } from "./multiplayer/PhysicsSystem";
import { Pilot, GroundTarget, SkyZone } from "../types";
import { neutralCommand } from "./multiplayer/RoomUtils";

export class MultiplayerRoom extends Room<{ state: MatchState }> {
  maxClients = 16;
  autoDispose = true;

  private setup = new RoomSetup();
  private inputSys = new InputSystem();
  private simSys = new SimulationSystem();
  private weaponSys = new WeaponSystem();
  private projSys = new ProjectileSystem();
  private dmgSys = new DamageSystem();
  private snapSys = new SnapshotSystem();
  private physSys = new PhysicsSystem();

  private pilots = new Map<string, Pilot>();
  private projectiles: any[] = [];
  private groundTargets: GroundTarget[] = [];
  private skyZones: SkyZone[] = [];
  private playerVoxelGrids = new Map<string, any>();
  private playerHistory = new Map<string, any[]>();
  
  private serverTick = 0;
  private accumulator = 0;
  private mapId: string = "island-chain";
  private matchTimer = 900;

  async onCreate(options: any) {
    this.setState(new MatchState());
    this.mapId = options.mapId || "island-chain";
    
    await this.physSys.init();

    this.onMessage("input", (client, packet: ClientInputTuple) => {
      this.inputSys.enqueueInput(client.sessionId, packet);
    });

    this.onMessage("chat", (client, text: string) => {
      const pState = this.state.players.get(client.sessionId);
      if (pState && typeof text === "string") {
        this.broadcast("chat", [this.serverTick, pState.id, pState.name, text.slice(0, 140)]);
      }
    });

    this.setup.botSys.fillWithBots(
      8, this.pilots, this.state.players,
      (id, p) => this.physSys.addPhysicsBody(id, p),
      (t) => (t === 1 ? Math.PI / 2 : -Math.PI / 2)
    );

    this.setSimulationInterval((dtMs) => this.updateSimulation(dtMs), 1000 / 60);
  }

  async onAuth(client: Client, options: any) {
    return this.setup.onAuth(client, options);
  }

  onJoin(client: Client, options: any) {
    this.setup.onJoin(client, options, this.mapId, this.pilots, this.state.players, this.serverTick, (t, m) => this.broadcast(t, m), this.physSys, this.playerVoxelGrids);
  }

  onLeave(client: Client) {
    this.setup.onLeave(client, this.pilots, this.state.players, (t, m) => this.broadcast(t, m), this.physSys, this.playerVoxelGrids);
  }

  onDispose() {
    this.physSys.dispose();
  }

  private updateSimulation(deltaMs: number) {
    this.accumulator = this.simSys.updateSimulation(this.accumulator, deltaMs, this.state.matchEnded, () => this.tick());
  }

  private tick() {
    this.serverTick++;
    this.matchTimer -= (1 / 60);
    if (this.matchTimer <= 0) this.endGame();

    this.simSys.tickPlayers(
      this.pilots, this.state.players,
      (id, n) => this.inputSys.getNextInput(id, n),
      neutralCommand,
      (p, dt) => { /* tick cooldowns */ for(const k in p.weaponCooldowns){ p.weaponCooldowns[k] = Math.max(0, p.weaponCooldowns[k]-dt); } },
      (p, dt) => { p.vy -= 9.8 * dt; },
      (_p, _dt) => { /* enforce bound */ },
      (p, pf, sf, dt, seq) => this.weaponSys.handleWeaponFiring(p, pf, sf, dt, seq, this.inputSys.getQueueLength(p.id), this.playerHistory.get(p.id) || [], (pos, oid, team, type) => this.dmgSys.triggerSplashDamage(pos, oid, team, type, this.pilots, (k,v,w)=>this.registerKill(k,v,w)), this.projectiles, this.mapId, (t, p)=>this.broadcast(t, p)),
      (id, p) => { const b = this.physSys.rigidBodies.get(id); if (b) b.setNextKinematicTranslation({x: p.x, y: p.y, z: p.z}); },
      (id, p) => { 
        if(!this.playerHistory.has(id)) this.playerHistory.set(id, []);
        const hist = this.playerHistory.get(id)!;
        hist.push({ tick: this.serverTick, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
        if(hist.length > 30) hist.shift();
      },
      this.mapId
    );

    this.simSys.tickBots(
      this.pilots, this.groundTargets, this.skyZones,
      (p, dt) => { for(const k in p.weaponCooldowns){ p.weaponCooldowns[k] = Math.max(0, p.weaponCooldowns[k]-dt); } },
      (p, dt) => { p.vy -= 9.8 * dt; },
      (_p, _dt) => { /* enforce bound */ },
      (p, pf, sf, dt, seq) => this.weaponSys.handleWeaponFiring(p, pf, sf, dt, seq, 0, [], (pos, oid, team, type) => this.dmgSys.triggerSplashDamage(pos, oid, team, type, this.pilots, (k,v,w)=>this.registerKill(k,v,w)), this.projectiles, this.mapId, (t, p)=>this.broadcast(t, p)),
      (id, p) => { const b = this.physSys.rigidBodies.get(id); if (b) b.setNextKinematicTranslation({x: p.x, y: p.y, z: p.z}); },
      (id, p) => { 
        if(!this.playerHistory.has(id)) this.playerHistory.set(id, []);
        const hist = this.playerHistory.get(id)!;
        hist.push({ tick: this.serverTick, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
        if(hist.length > 30) hist.shift();
      },
      this.mapId,
      neutralCommand
    );

    this.projSys.updateProjectiles(
      this.projectiles, 1/60, this.mapId, this.pilots,
      (pos, oid, team, type) => this.dmgSys.triggerSplashDamage(pos, oid, team, type, this.pilots, (k,v,w)=>this.registerKill(k,v,w)),
      (p, a, hz, w, oid) => this.dmgSys.applyDamage(p, a, hz, w, oid, (k,v,w)=>this.registerKill(k,v,w))
    );

    if (this.serverTick % 2 === 0) {
      this.snapSys.broadcastSnapshot(this.serverTick, this.pilots, this.projectiles, this.groundTargets, this.skyZones, this.state.team1Score, this.state.team2Score, this.matchTimer, (t, m) => this.broadcast(t, m));
    }
  }

  private registerKill(killerId: string, victimId: string, weapon: string) {
    this.dmgSys.registerKill(killerId, victimId, weapon, this.pilots, this.state.players, (t,p)=> (t===1 ? this.state.team1Score+=p : this.state.team2Score+=p), (t,m)=>this.broadcast(t,m), (id) => setTimeout(() => this.setup.respawnPilot(id, this.pilots, this.mapId, this.playerVoxelGrids, (t,m)=>this.broadcast(t,m)), 3000));
  }

  private endGame() {
    this.state.matchEnded = true;
    this.broadcast("match_end", { team1Score: this.state.team1Score, team2Score: this.state.team2Score, team1Won: this.state.team1Score >= this.state.team2Score });
    setTimeout(() => this.disconnect(), 15000);
  }
}
