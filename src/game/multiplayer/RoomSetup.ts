import { Client } from "@colyseus/core";

import { RoomAuth } from "./RoomAuth";
import { RoomLifecycle } from "./RoomLifecycle";
import { BotSystem } from "./BotSystem";
import { PhysicsSystem } from "./PhysicsSystem";
import { Pilot } from "../../types";

export class RoomSetup {
  private authSys = new RoomAuth();
  private lifecycle = new RoomLifecycle();
  public botSys = new BotSystem();

  public async onAuth(client: Client, options: any) {
    return this.authSys.onAuth(client, options);
  }

  public onJoin(
    client: Client,
    options: any,
    mapId: string,
    pilots: Map<string, Pilot>,
    statePlayers: any,
    serverTick: number,
    broadcast: (t: string, m: any) => void,
    physSys: PhysicsSystem,
    playerVoxelGrids: Map<string, any>
  ) {
    this.lifecycle.onJoin(
      client, options, client.auth,
      this.balanceTeams(pilots), mapId, pilots, statePlayers,
      serverTick, broadcast,
      physSys.world, physSys.rigidBodies, physSys.colliders, playerVoxelGrids,
      (t) => this.evictBot(t, pilots, physSys, playerVoxelGrids)
    );
  }

  public onLeave(
    client: Client,
    pilots: Map<string, Pilot>,
    statePlayers: any,
    broadcast: (t: string, m: any) => void,
    physSys: PhysicsSystem,
    playerVoxelGrids: Map<string, any>
  ) {
    const player = pilots.get(client.sessionId);
    if (player) {
      const team = player.team;
      this.cleanupPlayer(client.sessionId, pilots, physSys, playerVoxelGrids);
      statePlayers.delete(client.sessionId);
      this.botSys.spawnBot(team, "falcon-mk2", pilots, statePlayers, (id, p) => physSys.addPhysicsBody(id, p), (t) => (t === 1 ? Math.PI/2 : -Math.PI/2));
      broadcast("player_left", { id: client.sessionId, team });
    }
  }

  public respawnPilot(
    pilotId: string,
    pilots: Map<string, Pilot>,
    mapId: string,
    playerVoxelGrids: Map<string, any>,
    broadcast: (t: string, m: any) => void
  ) {
    this.lifecycle.respawnPilot(pilotId, pilots, mapId, playerVoxelGrids, broadcast);
  }

  private balanceTeams(pilots: Map<string, Pilot>): 1 | 2 {
    let t1 = 0, t2 = 0;
    for (const p of pilots.values()) { if (p.team === 1) t1++; else if (p.team === 2) t2++; }
    return t1 <= t2 ? 1 : 2;
  }

  private evictBot(team: number, pilots: Map<string, Pilot>, physSys: PhysicsSystem, playerVoxelGrids: Map<string, any>) {
    const bots = Array.from(pilots.values()).filter(p => p.isBot && p.team === team);
    if (bots.length > 0) this.cleanupPlayer(bots[0].id, pilots, physSys, playerVoxelGrids);
  }

  public cleanupPlayer(id: string, pilots: Map<string, Pilot>, physSys: PhysicsSystem, playerVoxelGrids: Map<string, any>) {
    pilots.delete(id);
    physSys.removePhysicsBody(id);
    playerVoxelGrids.delete(id);
  }
}
