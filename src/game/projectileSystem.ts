/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Vector3 } from "three";
import { Pilot, Projectile, GroundTarget, WeaponType, AmmoBelt } from "../types";
import { WEAPON_SPECS_MAP } from "./aircraftData";
import { AIRCRAFT_DEFINITIONS } from "./content/aircraft/registry";
import { MODIFICATIONS } from "./content/modifications/modificationData";
import { FlightPhysicsEngine } from "./flightModel";
import { generateId, closestPointOnSegment, getPlaneHitRadius, LOCAL_FORWARD } from "./math";
import { getTerrainHeight } from "./terrainModel";

function beltName(belt: AmmoBelt | string): string {
  return String(belt);
}

export function getProjectileReleaseState(
  pilot: Pilot,
  type: WeaponType
): { position: Vector3; velocity: Vector3 } {
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
  );
  const direction = LOCAL_FORWARD.clone().applyQuaternion(rotation).normalize();
  const spec = WEAPON_SPECS_MAP[type];
  const aircraftDef = AIRCRAFT_DEFINITIONS.find(
    definition => definition.specs.id === pilot.aircraftId
  );
  const currentAmmo = pilot.ammo[type] ?? spec.ammoCapacity;
  const releasedCount = Math.max(0, spec.ammoCapacity - currentAmmo);
  const hardpointList =
    type === WeaponType.BOMB
      ? aircraftDef?.hardpoints.bombPositions
      : type === WeaponType.ROCKET
        ? aircraftDef?.hardpoints.rocketPositions
        : aircraftDef?.hardpoints.positions;
  const hardpoint = hardpointList?.length
    ? hardpointList[releasedCount % hardpointList.length]
    : null;

  const position = new Vector3(pilot.x, pilot.y, pilot.z);
  if (hardpoint) {
    position.add(
      new Vector3(hardpoint.x, hardpoint.y, hardpoint.z)
        .applyQuaternion(rotation)
    );
  } else {
    position.addScaledVector(direction, 12);
  }

  const velocity = new Vector3(pilot.vx, pilot.vy, pilot.vz);
  if (type === WeaponType.BOMB) {
    velocity.add(
      new Vector3(0, -1, 0)
        .applyQuaternion(rotation)
        .multiplyScalar(3.5)
    );
  } else {
    velocity.addScaledVector(direction, spec.muzzleVelocity);
  }

  return { position, velocity };
}

export interface EngineCallbacks {
  registerKill: (killerId: string, victimId: string, weapon: string) => void;
  registerGroundTargetKill: (killerId: string, target: GroundTarget) => void;
  onProjectileSpawn?: (type: WeaponType) => void;
  onProjectileImpact?: (
    type: WeaponType,
    position: Vector3,
    ownerId: string
  ) => void;
  onGroundTargetDamage?: (targetId: string, hp: number, isDead: boolean) => void;
  onHitEnemy?: (killerId: string, targetId: string, isGround: boolean) => void;
  onPlayerDamage?: (
    shooterId: string,
    targetId: string,
    damage: number,
    bulletType: string,
    hitSpotLocal: Vector3
  ) => void;
  // Fires with the actual local-space impact offset in metres (not normalised)
  // so the voxel deformation system can destroy voxels in the right place.
  onVoxelHit?: (
    targetId: string,
    localOffsetMeters: Vector3,
    blastMeters: number
  ) => void;
  // Returns the centre of the first voxel struck by the segment in local aircraft
  // space, null if the aircraft uses voxels but the segment misses all of them,
  // or undefined if the aircraft has no voxel definition (use closest-point fallback).
  getVoxelImpact?: (
    targetId: string,
    segStartLocal: Vector3,
    segEndLocal: Vector3
  ) => THREE.Vector3 | null | undefined;
}

export class ProjectileSystem {
  public static spawnProjectile(
    pilot: Pilot,
    type: WeaponType,
    projectiles: Projectile[],
    onProjectileSpawn?: (type: WeaponType) => void
  ) {
    const rot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
    );

    const dir = LOCAL_FORWARD.clone().applyQuaternion(rot).normalize();

    const spec = WEAPON_SPECS_MAP[type];

    let dispersionAmount = spec.dispersion;
    pilot.modifications?.forEach(modId => {
      const mod = MODIFICATIONS.find(m => m.id === modId);
      if (mod?.effects.dispersion !== undefined) {
        dispersionAmount *= (1 + mod.effects.dispersion);
      }
    });

    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * dispersionAmount,
      (Math.random() - 0.5) * dispersionAmount,
      (Math.random() - 0.5) * dispersionAmount
    ).applyQuaternion(rot);

    dir.add(spread).normalize();

    const release = getProjectileReleaseState(pilot, type);
    if (type !== WeaponType.BOMB) {
      release.velocity.set(pilot.vx, pilot.vy, pilot.vz)
        .addScaledVector(dir, spec.muzzleVelocity);
    }

    const projectile: Projectile = {
      id: generateId(),
      ownerId: pilot.id,
      ownerTeam: pilot.team,
      type,
      belt: pilot.ammoBelt,
      x: release.position.x,
      y: release.position.y,
      z: release.position.z,
      vx: release.velocity.x,
      vy: release.velocity.y,
      vz: release.velocity.z,
      life: type === WeaponType.ROCKET ? 4.5 : type === WeaponType.BOMB ? 7.0 : 1.8,
      isRocket: type === WeaponType.ROCKET || type === WeaponType.BOMB
    };

    if (pilot.id === "player" && onProjectileSpawn) {
      onProjectileSpawn(type);
    }

    projectiles.push(projectile);
  }
  
  private static lastPosTmp = new Vector3();
  private static currentPosTmp = new Vector3();
  private static targetPosTmp = new Vector3();
  private static closestTmp = new Vector3();
  private static localImpactWorldTmp = new Vector3();
  private static rotInvTmp = new THREE.Quaternion();
  private static eulerTmp = new THREE.Euler();
  private static relativeOffsetLocalTmp = new Vector3();
  private static localOffsetMetersTmp = new Vector3();
  private static localSegStartTmp = new Vector3();
  private static localSegEndTmp = new Vector3();

  public static updateProjectiles(
    dt: number,
    projectiles: Projectile[],
    pilots: Pilot[],
    groundTargets: GroundTarget[],
    mapId: string,
    callbacks: EngineCallbacks
  ) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;

      ProjectileSystem.lastPosTmp.set(p.x, p.y, p.z);

      if (p.type === WeaponType.BOMB) {
        p.vy -= 9.8 * dt;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      ProjectileSystem.currentPosTmp.set(p.x, p.y, p.z);
      let hasHit = false;

      // Pilot check
      for (const target of pilots) {
        const epTarget = target as any;

        if (target.id === p.ownerId) continue;
        if (target.team === p.ownerTeam) continue;
        if (target.damage.fuselage <= 0) continue;
        if ((epTarget.invulnerableTimer ?? 0) > 0) continue;

        ProjectileSystem.targetPosTmp.set(target.x, target.y, target.z);
        closestPointOnSegment(
          ProjectileSystem.lastPosTmp,
          ProjectileSystem.currentPosTmp,
          ProjectileSystem.targetPosTmp,
          ProjectileSystem.closestTmp
        );
        const distToPlaneCenter = ProjectileSystem.closestTmp.distanceTo(ProjectileSystem.targetPosTmp);
        const hitRadius = getPlaneHitRadius(target.specs);

        if (distToPlaneCenter < hitRadius) {
          ProjectileSystem.rotInvTmp
            .setFromEuler(ProjectileSystem.eulerTmp.set(target.pitch, target.yaw, target.roll, "YXZ"))
            .invert();

          // Transform projectile segment endpoints into local aircraft space
          ProjectileSystem.localSegStartTmp
            .copy(ProjectileSystem.lastPosTmp)
            .sub(ProjectileSystem.targetPosTmp)
            .applyQuaternion(ProjectileSystem.rotInvTmp);
          ProjectileSystem.localSegEndTmp
            .copy(ProjectileSystem.currentPosTmp)
            .sub(ProjectileSystem.targetPosTmp)
            .applyQuaternion(ProjectileSystem.rotInvTmp);

          // Precise voxel traversal when the target aircraft has a voxel def.
          // getVoxelImpact returns:
          //   Vector3  → voxel aircraft, cell struck — use as impact centre
          //   null     → voxel aircraft, segment misses all cells — skip hit
          //   undefined→ no voxel def — fall back to closest-point method
          const voxResult = callbacks.getVoxelImpact?.(
            target.id,
            ProjectileSystem.localSegStartTmp,
            ProjectileSystem.localSegEndTmp
          );
          if (voxResult === null) break; // voxel aircraft, true miss

          if (voxResult !== undefined) {
            ProjectileSystem.localOffsetMetersTmp.copy(voxResult);
          } else {
            // Closest-point fallback for aircraft without voxel definitions
            ProjectileSystem.localImpactWorldTmp
              .copy(ProjectileSystem.closestTmp)
              .sub(ProjectileSystem.targetPosTmp);
            ProjectileSystem.localOffsetMetersTmp
              .copy(ProjectileSystem.localImpactWorldTmp)
              .applyQuaternion(ProjectileSystem.rotInvTmp);
          }

          ProjectileSystem.relativeOffsetLocalTmp
            .copy(ProjectileSystem.localOffsetMetersTmp)
            .divideScalar(hitRadius);

          let finalDmg = WEAPON_SPECS_MAP[p.type].damage;
          const owner = pilots.find(pl => pl.id === p.ownerId);
          owner?.modifications?.forEach(modId => {
            const mod = MODIFICATIONS.find(m => m.id === modId);
            if (mod?.effects.damage !== undefined) {
              finalDmg *= (1 + mod.effects.damage);
            }
          });

          const belt = beltName(p.belt);
          if (belt === "Armor-Piercing") finalDmg *= 1.3;
          if (belt === "Incendiary") finalDmg *= 0.85;

          FlightPhysicsEngine.applyDamage(target, finalDmg, String(p.type), ProjectileSystem.relativeOffsetLocalTmp);
          hasHit = true;

          if (callbacks.onPlayerDamage) {
            callbacks.onPlayerDamage(
              p.ownerId,
              target.id,
              finalDmg,
              String(p.type),
              ProjectileSystem.relativeOffsetLocalTmp
            );
          }

          // Voxel deformation — only fired when a specific cell was struck.
          // Blast radii are explicit per weapon type, not derived from damage values.
          if (voxResult !== undefined && callbacks.onVoxelHit) {
            const blastM =
              p.type === WeaponType.BOMB   ? 2.50 :
              p.type === WeaponType.ROCKET ? 0.75 : 0;
            callbacks.onVoxelHit(target.id, ProjectileSystem.localOffsetMetersTmp, blastM);
          }

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

          ProjectileSystem.targetPosTmp.set(target.x, target.y, target.z);
          closestPointOnSegment(
            ProjectileSystem.lastPosTmp,
            ProjectileSystem.currentPosTmp,
            ProjectileSystem.targetPosTmp,
            ProjectileSystem.closestTmp
          );
          const distToTgt = ProjectileSystem.closestTmp.distanceTo(ProjectileSystem.targetPosTmp);

          if (distToTgt < 24) {
            let dmg = WEAPON_SPECS_MAP[p.type].damage;
            const owner = pilots.find(pl => pl.id === p.ownerId);
            owner?.modifications?.forEach(modId => {
              const mod = MODIFICATIONS.find(m => m.id === modId);
              if (mod?.effects.damage !== undefined) {
                dmg *= (1 + mod.effects.damage);
              }
            });

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

      const terrainHeight = getTerrainHeight(p.x, p.z, mapId).height;
      if (!hasHit && p.y <= Math.max(12, terrainHeight)) {
        hasHit = true;

        if (p.isRocket) {
          this.triggerSplashDamage(
            ProjectileSystem.currentPosTmp,
            p.ownerId,
            p.ownerTeam,
            p.type,
            groundTargets,
            pilots,
            callbacks
          );
        }
      }

      if (hasHit || p.life <= 0) {
        if (hasHit && callbacks.onProjectileImpact) {
          callbacks.onProjectileImpact(p.type, ProjectileSystem.currentPosTmp, p.ownerId);
        }
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

        if (callbacks.onVoxelHit) {
          // Blast arrives from the epicenter direction. Transform that vector
          // to local aircraft space and clamp to wing-tip distance so the
          // impact lands on a surface voxel rather than empty space.
          const rotInv = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, "YXZ"))
            .invert();
          const localDir = new Vector3(
            p.x - epicenter.x, p.y - epicenter.y, p.z - epicenter.z
          ).applyQuaternion(rotInv);
          const localLen = localDir.length();
          if (localLen > 7) localDir.multiplyScalar(7 / localLen);
          // Blast radius at the pilot scales with proximity: 0.3 m at splashRad edge, 2.5 m at centre
          const blastAtImpact = 0.3 + falloff * 2.2;
          callbacks.onVoxelHit(p.id, localDir, blastAtImpact);
        }

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
