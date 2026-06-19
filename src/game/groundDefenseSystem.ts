/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3 } from "three";
import { Pilot, GroundTarget, Projectile, WeaponType, AmmoBelt } from "../types";
import { generateId } from "./math";

export class GroundDefenseSystem {
  public static updateGroundDefense(
    dt: number,
    groundTargets: GroundTarget[],
    pilots: Pilot[],
    projectiles: Projectile[],
    isMultiplayer: boolean,
    isHost: boolean
  ) {
    if (isMultiplayer && !isHost) {
      return;
    }

    groundTargets.forEach(t => {
      if (t.isDead || t.type !== "anti-air") return;

      if (t.fireCooldown !== undefined) {
        t.fireCooldown = Math.max(0, t.fireCooldown - dt);

        if (t.fireCooldown <= 0) {
          const opposingTeam = t.team === 1 ? 2 : 1;
          const targetsInSky = pilots.filter(
            p => p.team === opposingTeam && p.damage.fuselage > 0
          );

          let lockedPlane: Pilot | null = null;
          let minDist = 1300;

          targetsInSky.forEach(p => {
            const d = new Vector3(t.x, t.y, t.z).distanceTo(
              new Vector3(p.x, p.y, p.z)
            );

            if (d < minDist) {
              minDist = d;
              lockedPlane = p;
            }
          });

          if (lockedPlane) {
            this.spawnAABullet(t, lockedPlane, projectiles);
            t.fireCooldown = 1.0 + Math.random() * 1.5;
          }
        }
      }
    });

    groundTargets.forEach(t => {
      if (t.isDead || t.type !== "convoy") return;

      const spd = t.team === 1 ? 4.5 : -4.5;
      t.x += spd * dt;
    });
  }

  private static spawnAABullet(aa: GroundTarget, target: Pilot, projectiles: Projectile[]) {
    const startPos = new Vector3(aa.x, aa.y + 6, aa.z);
    const tarPos = new Vector3(
      target.x,
      target.y + (Math.random() - 0.5) * 50,
      target.z
    );

    const dir = tarPos.clone().sub(startPos).normalize();
    const bulletSpeed = 550;

    const projectile: Projectile = {
      id: generateId(),
      ownerId: aa.id,
      ownerTeam: aa.team,
      type: WeaponType.MG_7_7,
      belt: AmmoBelt.Tracer,
      x: startPos.x,
      y: startPos.y,
      z: startPos.z,
      vx: dir.x * bulletSpeed,
      vy: dir.y * bulletSpeed,
      vz: dir.z * bulletSpeed,
      life: 2.5,
      isRocket: false
    };

    projectiles.push(projectile);
  }
}
