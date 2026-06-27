import { WeaponType, Pilot } from "../../types";
import { getTerrainHeight } from "../terrainModel";
import { Vector3 } from "three";
import { getPlaneHitRadius } from "../math";

export class ProjectileSystem {
  public updateProjectiles(
    projectiles: any[],
    dt: number,
    mapId: string,
    pilots: Map<string, Pilot>,
    triggerSplashDamage: (pos: Vector3, ownerId: string, team: number, type: WeaponType) => void,
    applyDamage: (pilot: Pilot, amount: number, hitZone: string, weapon: string, ownerId: string) => void
  ) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.isRocket || p.type === WeaponType.BOMB) {
          triggerSplashDamage(new Vector3(p.x, p.y, p.z), p.ownerId, p.ownerTeam, p.type as WeaponType);
        }
        projectiles.splice(i, 1);
        continue;
      }

      const p0x = p.x; const p0y = p.y; const p0z = p.z;
      
      if (p.isRocket || p.type === WeaponType.BOMB) {
        p.vy -= 9.8 * dt; // gravity
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Terrain collision
      const terr = getTerrainHeight(p.x, p.z, mapId);
      if (p.y <= terr.height) {
        if (p.isRocket || p.type === WeaponType.BOMB) {
          triggerSplashDamage(new Vector3(p.x, terr.height, p.z), p.ownerId, p.ownerTeam, p.type as WeaponType);
        }
        projectiles.splice(i, 1);
        continue;
      }

      // Fast Raycast against planes
      let hit = false;
      const moveVec = new Vector3(p.x - p0x, p.y - p0y, p.z - p0z);
      const moveDist = moveVec.length();
      const moveDir = moveVec.clone().normalize();

      for (const targetPilot of pilots.values()) {
        if (targetPilot.team === p.ownerTeam) continue;
        if ((targetPilot.entity.components.get("destructible") as any).isDead) continue;
        if (targetPilot.invulnerableTimer && targetPilot.invulnerableTimer > 0) continue;

        const targetPos = new Vector3(targetPilot.x, targetPilot.y, targetPilot.z);
        const p0Vec = new Vector3(p0x, p0y, p0z);
        const toTarget = targetPos.clone().sub(p0Vec);
        
        const dot = toTarget.dot(moveDir);
        if (dot < 0 || dot > moveDist) continue; 

        const closestPoint = p0Vec.clone().add(moveDir.clone().multiplyScalar(dot));
        const distToCenter = closestPoint.distanceTo(targetPos);
        const hitRadius = getPlaneHitRadius(targetPilot.specs);

        if (distToCenter <= hitRadius) {
          if (p.isRocket || p.type === WeaponType.BOMB) {
            triggerSplashDamage(closestPoint, p.ownerId, p.ownerTeam, p.type as WeaponType);
          } else {
            const localHit = closestPoint.clone().sub(targetPos);
            const relativeOffset = localHit.clone().divideScalar(hitRadius);
            
            // Belt multiplier
            let dmgMult = 1.0;
            if (p.belt === "Armor-Piercing") dmgMult = 1.25;
            if (p.belt === "High-Explosive") dmgMult = 1.4;

            applyDamage(targetPilot, dmgMult, this.determineHitZone(relativeOffset), p.type, p.ownerId);
          }
          projectiles.splice(i, 1);
          hit = true;
          break;
        }
      }

      if (hit) continue;
    }
  }

  private determineHitZone(spot: Vector3) {
    if (spot.z > 0.4) return "engine";
    if (spot.z < -0.5) return "tail";
    if (Math.abs(spot.x) > 0.28) return spot.x < 0 ? "leftWing" : "rightWing";
    if (spot.y > 0.4) return "cockpit";
    if (spot.y < -0.3) return "fuelTank";
    return "fuselage";
  }
}
