import { Pilot } from "../../types";
import { DEFAULT_AIRCRAFT } from "../aircraftData";
import { generateId } from "../math";
import { NetworkPlayer } from "./MatchState";


export const BOT_NAMES = [
  "Striker", "Interceptor", "Spectre", "Phoenix", "Phantom",
  "Grizzly", "Falcon", "Viper", "Cobra", "Reaper",
  "Warlord", "Tornado", "Spitfire", "Mustang", "Zero"
];

export class BotSystem {
  public spawnBot(
    team: number, 
    aircraftId: string, 
    pilots: Map<string, Pilot>, 
    statePlayers: any,
    addPhysicsBody: (id: string, pilot: Pilot) => void,
    getSpawnYaw: (t: number) => number
  ) {
    const id = "bot_" + generateId();
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    
    // Bots spawn high up, randomly distributed
    const startX = (Math.random() - 0.5) * 2000;
    const startZ = team === 1 ? -3000 + Math.random() * 500 : 3000 - Math.random() * 500;
    const startY = 600 + Math.random() * 400;

    const pilot = new Pilot({
      id,
      aircraftId,
      x: startX,
      y: startY,
      z: startZ,
      qx: 0,
      qy: Math.sin(getSpawnYaw(team) / 2),
      qz: 0,
      qw: Math.cos(getSpawnYaw(team) / 2),
      vx: 0,
      vy: 0,
      vz: 100, // Forward speed
      damage: {
        engine: 1, leftWing: 1, rightWing: 1, tail: 1,
        cockpit: 1, fuelTank: 1, fuselage: 1, hasFire: false, hasOilLeak: false
      },
      specs: DEFAULT_AIRCRAFT.find(a => a.id === aircraftId) || DEFAULT_AIRCRAFT[0]
    });
    pilot.team = team as 1 | 2;
    pilot.isBot = true;
    pilot.name = name;
    
    // ctrl.throttleDelta is no longer used here
    pilot.throttle = 1.0;

    pilots.set(id, pilot);

    const netPlayer = new NetworkPlayer();
    netPlayer.id = id;
    netPlayer.name = name;
    netPlayer.team = team;
    netPlayer.aircraftId = aircraftId;
    netPlayer.skin = "bot-camo";
    netPlayer.isBot = true;
    statePlayers.set(id, netPlayer);

    addPhysicsBody(id, pilot);
  }

  public fillWithBots(
    targetCount: number, 
    pilots: Map<string, Pilot>,
    statePlayers: any,
    addPhysicsBody: (id: string, pilot: Pilot) => void,
    getSpawnYaw: (t: number) => number
  ) {
    let team1 = 0;
    let team2 = 0;
    for (const p of pilots.values()) {
      if (p.team === 1) team1++;
      if (p.team === 2) team2++;
    }

    while (team1 + team2 < targetCount) {
      const team = team1 <= team2 ? 1 : 2;
      const aircraft = DEFAULT_AIRCRAFT[Math.floor(Math.random() * DEFAULT_AIRCRAFT.length)];
      this.spawnBot(team, aircraft.id, pilots, statePlayers, addPhysicsBody, getSpawnYaw);
      if (team === 1) team1++;
      else team2++;
    }
  }

  public evictBotsIfFull(maxClients: number, currentHumans: number, pilots: Map<string, Pilot>, cleanupPlayer: (id: string) => void) {
    let totalPlayers = pilots.size;
    
    // If joining would exceed max, evict a bot
    while (totalPlayers >= maxClients) {
      const bots = Array.from(pilots.values()).filter(p => p.isBot);
      if (bots.length === 0) break; // no bots to evict
      
      const toEvict = bots[0];
      cleanupPlayer(toEvict.id);
      totalPlayers--;
    }
  }
}
