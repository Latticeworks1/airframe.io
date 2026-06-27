import { Pilot, GroundTarget, SkyZone } from "../../types";

export class SnapshotSystem {
  public broadcastSnapshot(
    serverTick: number,
    pilots: Map<string, Pilot>,
    projectiles: any[],
    groundTargets: GroundTarget[],
    skyZones: SkyZone[],
    team1Score: number,
    team2Score: number,
    matchTimer: number,
    broadcastFn: (type: string, payload: any) => void
  ) {
    const entitiesArray: any[] = [];
    
    for (const [id, pilot] of pilots.entries()) {
      entitiesArray.push([
        id,
        "aircraft",
        Math.round(pilot.x * 10) / 10,
        Math.round(pilot.y * 10) / 10,
        Math.round(pilot.z * 10) / 10,
        Math.round(pilot.vx * 100) / 100,
        Math.round(pilot.vy * 100) / 100,
        Math.round(pilot.vz * 100) / 100,
        Math.round(pilot.qx * 1000) / 1000,
        Math.round(pilot.qy * 1000) / 1000,
        Math.round(pilot.qz * 1000) / 1000,
        Math.round(pilot.qw * 1000) / 1000,
        Math.round(pilot.throttle * 100) / 100,
        pilot.damage.engine,
        pilot.damage.leftWing,
        pilot.damage.rightWing,
        pilot.damage.tail,
        pilot.damage.cockpit,
        pilot.damage.fuelTank,
        pilot.damage.fuselage,
        pilot.damage.hasFire ? 1 : 0,
        pilot.damage.hasOilLeak ? 1 : 0,
        pilot.ammo[pilot.specs.weapons.find(w => w !== "Rockets" && w !== "Small Bombs") || "7.7mm MG"] || 0,
        pilot.ammo["Rockets"] || 0
      ]);
    }

    for (const p of projectiles) {
      entitiesArray.push([
        p.id,
        "projectile",
        Math.round(p.x * 10) / 10,
        Math.round(p.y * 10) / 10,
        Math.round(p.z * 10) / 10,
        p.ownerId,
        p.type
      ]);
    }

    for (const t of groundTargets) {
      if (t.isDead) continue;
      entitiesArray.push([
        t.id,
        "groundTarget",
        Math.round(t.x * 10) / 10,
        Math.round(t.y * 10) / 10,
        Math.round(t.z * 10) / 10,
        t.team,
        t.type,
        Math.round(t.hp * 100) / 100
      ]);
    }

    const payload = [
      serverTick,
      entitiesArray,
      team1Score,
      team2Score,
      Math.round(matchTimer),
      skyZones.map(z => [z.id, z.owningTeam, z.captureProgress])
    ];

    broadcastFn("snapshot", payload);
  }
}
