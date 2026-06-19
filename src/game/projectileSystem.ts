/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Vector3 } from "three";
import { Pilot, Projectile, GroundTarget, WeaponType, AmmoBelt } from "../types";
import { WEAPON_SPECS_MAP } from "./aircraftData";
import { FlightPhysicsEngine } from "./flightModel";
import { generateId, closestPointOnSegment, getPlaneHitRadius, LOCAL_FORWARD } from "./math";

function beltName(belt: AmmoBelt | string): string {
  return String(belt);
}

export interface EngineCallbacks {
  registerKill: (killerId: string, victimId: string, weapon: string) => void;
  registerGroundTargetKill: (killerId: string, target: GroundTarget) => void;
  onProjectileSpawn?: (type: WeaponType) => void;
  onGroundTargetDamage?: (targetId: string, hp: number, isDead: boolean) => void;
  onHitEnemy?: (killerId: string, targetId: string, isGround: boolean) => void;
}

export class ProjectileSystem {
  public static spawnProjectile(
    pilot: Pilot,
    type: WeaponType,
    projectiles: Projectile[],
    onProjectileSpawn?: (type: WeaponType) => void
  ) {
    const origin = new Vector3(pilot.x, pilot.y, pilot.z);

    const rot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
    );

    const dir = LOCAL_FORWARD.clone().applyQuaternion(rot).normalize();

    const spec = WEAPON_SPECS_MAP[type];
    const bulletSpeed = spec.muzzleVelocity;

    const dispersionAmount = spec.dispersion;
    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * dispersionAmount,
      (Math.random() - 0.5) * dispersionAmount,
      (Math.random() - 0.5) * dispersionAmount
    ).applyQuaternion(rot);

    dir.add(spread).normalize();

    const startPos = origin.clone().addScaledVector(dir, 12);

    const projectile: Projectile = {
      id: generateId(),
      ownerId: pilot.id,
      ownerTeam: pilot.team,
      type,
      belt: pilot.ammoBelt,
      x: startPos.x,
      y: startPos.y,
      z: startPos.z,
      vx: pilot.vx + dir.x * bulletSpeed,
      vy: pilot.vy + dir.y * bulletSpeed,
      vz: pilot.vz + dir.z * bulletSpeed,
      life: type === WeaponType.ROCKET ? 4.5 : type === WeaponType.BOMB ? 7.0 : 1.8,
      isRocket: type === WeaponType.ROCKET || type === WeaponType.BOMB
    };

    if (pilot.id === "player" && onProjectileSpawn) {
      onProjectileSpawn(type);
    }

    projectiles.push(projectile);
  }

  public static updateProjectiles(
    dt: number,
    projectiles: Projectile[],
    pilots: Pilot[],
    groundTargets: GroundTarget[],
    callbacks: EngineCallbacks
  ) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;

      const lastPos = new Vector3(p.x, p.y, p.z);

      if (p.type === WeaponType.BOMB) {
        p.vy -= 9.8 * dt;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const currentPos = new Vector3(p.x, p.y, p.z);
      let hasHit = false;

      // Pilot check
      for (const target of pilots) {
        const epTarget = target as any;

        if (target.id === p.ownerId) continue;
        if (target.team === p.ownerTeam) continue;
        if (target.damage.fuselage <= 0) continue;
        if ((epTarget.invulnerableTimer ?? 0) > 0) continue;

        const targetPos = new Vector3(target.x, target.y, target.z);
        const closest = closestPointOnSegment(lastPos, currentPos, targetPos);
        const distToPlaneCenter = closest.distanceTo(targetPos);
        const hitRadius = getPlaneHitRadius(target.specs);

        if (distToPlaneCenter < hitRadius) {
          const localImpactWorld = closest.clone().sub(targetPos);

          const rotInv = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(target.pitch, target.yaw, target.roll, "YXZ"))
            .invert();

          const relativeOffsetLocal = localImpactWorld
            .applyQuaternion(rotInv)
            .divideScalar(hitRadius);

          let finalDmg = WEAPON_SPECS_MAP[p.type].damage;
          const belt = beltName(p.belt);

          if (belt === "Armor-Piercing") finalDmg *= 1.3;
          if (belt === "Incendiary") finalDmg *= 0.85;

          FlightPhysicsEngine.applyDamage(target, finalDmg, String(p.type), relativeOffsetLocal);
          hasHit = true;

          if (callbacks.onHitEnemy) {
            callbacks.onHitEnemy(p.ownerId, target.id, false);
          }

          if (target.damage.fuselage <= 0) {
            callbacks.registerKill(p.ownerId, target.id, String(p.type));
          }

          break;
        }
      }

      // Ground target check
      if (!hasHit) {
        for (const target of groundTargets) {
          if (target.isDead || target.team === p.ownerTeam) continue;

          const targetPos = new Vector3(target.x, target.y, target.z);
          const closest = closestPointOnSegment(lastPos, currentPos, targetPos);
          const distToTgt = closest.distanceTo(targetPos);

          if (distToTgt < 24) {
            let dmg = WEAPON_SPECS_MAP[p.type].damage;
            const belt = beltName(p.belt);

            if (belt === "Armor-Piercing") dmg *= 1.8;
            if (p.type === WeaponType.BOMB) dmg *= 2.5;

            target.hp = Math.max(0, target.hp - dmg);
            if (target.hp <= 0) {
              target.isDead = true;
            }
            if (callbacks.onGroundTargetDamage) {
              callbacks.onGroundTargetDamage(target.id, target.hp, target.isDead);
            }
            if (callbacks.onHitEnemy) {
              callbacks.onHitEnemy(p.ownerId, target.id, true);
            }
            hasHit = true;

            if (target.isDead) {
              callbacks.registerGroundTargetKill(p.ownerId, target);
            }

            break;
          }
        }
      }

      if (!hasHit && p.y <= 12) {
        hasHit = true;

        if (p.isRocket) {
          this.triggerSplashDamage(currentPos, p.ownerId, p.ownerTeam, p.type, groundTargets, pilots, callbacks);
        }
      }

      if (hasHit || p.life <= 0) {
        projectiles.splice(i, 1);
      }
    }
  }

  public static triggerSplashDamage(
    epicenter: Vector3,
    ownerId: string,
    team: number,
    type: WeaponType,
    groundTargets: GroundTarget[],
    pilots: Pilot[],
    callbacks: EngineCallbacks
  ) {
    const splashRad = type === WeaponType.BOMB ? 180 : 70;
    const baseSplash = type === WeaponType.BOMB ? 350 : 150;

    groundTargets.forEach(t => {
      if (t.isDead || t.team === team) return;

      const d = epicenter.distanceTo(new Vector3(t.x, t.y, t.z));

      if (d < splashRad) {
        const falloff = 1 - d / splashRad;
        t.hp = Math.max(0, t.hp - baseSplash * falloff);

        if (t.hp <= 0) {
          t.isDead = true;
        }

        if (callbacks.onGroundTargetDamage) {
          callbacks.onGroundTargetDamage(t.id, t.hp, t.isDead);
        }

        if (callbacks.onHitEnemy) {
          callbacks.onHitEnemy(ownerId, t.id, true);
        }

        if (t.isDead) {
          callbacks.registerGroundTargetKill(ownerId, t);
        }
      }
    });

    pilots.forEach(p => {
      if (p.team === team) return;
      if (p.damage.fuselage <= 0) return;

      const ep = p as any;
      if ((ep.invulnerableTimer ?? 0) > 0) return;

      const d = epicenter.distanceTo(new Vector3(p.x, p.y, p.z));

      if (d < splashRad) {
        const falloff = 1 - d / splashRad;
        const relativeOffset = new Vector3(0, -0.5, 0);

        FlightPhysicsEngine.applyDamage(p, baseSplash * falloff, String(type), relativeOffset);

        if (callbacks.onHitEnemy) {
          callbacks.onHitEnemy(ownerId, p.id, false);
        }

        if (p.damage.fuselage <= 0) {
          callbacks.registerKill(ownerId, p.id, String(type));
        }
      }
    });
  }
}
