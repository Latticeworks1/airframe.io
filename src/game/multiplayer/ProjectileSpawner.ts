import { Pilot, WeaponType, AmmoBelt } from "../../types";
import { getProjectileReleaseState } from "../projectileSystem";
import { generateId } from "../math";
import { Vector3 } from "three";
import { getTerrainHeight } from "../terrainModel";

const FIXED_DT = 1 / 60;

function getWepBelt(p: Pilot, type: WeaponType): AmmoBelt {
  const wep = p.entity.components.get("weaponized") as any;
  if (!wep || !wep.belts) return AmmoBelt.Universal;
  return wep.belts[type] || AmmoBelt.Universal;
}

export function spawnOrdnance(pilot: Pilot, type: WeaponType, projectiles: any[]) {
  const release = getProjectileReleaseState(pilot, type);
  projectiles.push({
    id: generateId(),
    ownerId: pilot.id,
    ownerTeam: pilot.team,
    type,
    belt: getWepBelt(pilot, type),
    x: release.position.x, y: release.position.y, z: release.position.z,
    vx: release.velocity.x, vy: release.velocity.y, vz: release.velocity.z,
    life: 5.0,
    isRocket: type === WeaponType.ROCKET
  });
}

export function spawnGunProjectile(
  pilot: Pilot, 
  type: WeaponType, 
  clientSeq: number | undefined,
  inputQueueLength: number,
  playerHistory: any[],
  triggerSplashDamage: (pos: Vector3, ownerId: string, team: number, type: WeaponType) => void,
  projectiles: any[],
  mapId: string
) {
  if (clientSeq === undefined) {
    const release = getProjectileReleaseState(pilot, type);
    projectiles.push({
      id: generateId(),
      ownerId: pilot.id,
      ownerTeam: pilot.team,
      type,
      belt: getWepBelt(pilot, type),
      x: release.position.x, y: release.position.y, z: release.position.z,
      vx: release.velocity.x, vy: release.velocity.y, vz: release.velocity.z,
      life: 1.8,
      isRocket: false
    });
    return;
  }

  const oneWayLatencyTicks = Math.min(30, Math.max(0, inputQueueLength)); 
  const historicalTick = (pilot as any).serverTick - oneWayLatencyTicks;
  const history = playerHistory || [];
  const histTransform = history.find(h => h.tick === historicalTick) || history[history.length - 1];

  let release;
  if (histTransform) {
    const tempPilot = new Pilot({
      id: pilot.id,
      aircraftId: pilot.aircraftId,
      specs: pilot.specs,
      x: histTransform.x, y: histTransform.y, z: histTransform.z,
      vx: histTransform.vx, vy: histTransform.vy, vz: histTransform.vz,
      qx: histTransform.qx ?? histTransform.rotX, 
      qy: histTransform.qy ?? histTransform.rotY,
      qz: histTransform.qz ?? histTransform.rotZ,
      qw: histTransform.qw ?? histTransform.rotW,
      ammo: pilot.ammo
    });
    release = getProjectileReleaseState(tempPilot, type);
  } else {
    release = getProjectileReleaseState(pilot, type);
  }

  let px = release.position.x, py = release.position.y, pz = release.position.z;
  const vx = release.velocity.x, vy = release.velocity.y, vz = release.velocity.z;

  const elapsedSec = oneWayLatencyTicks * FIXED_DT;
  for (let s = 0; s < oneWayLatencyTicks; s++) {
    px += vx * FIXED_DT; py += vy * FIXED_DT; pz += vz * FIXED_DT;
    if (py <= getTerrainHeight(px, pz, mapId).height) {
      triggerSplashDamage(new Vector3(px, py, pz), pilot.id, pilot.team as 1 | 2, type);
      return;
    }
  }

  projectiles.push({
    id: generateId(), ownerId: pilot.id, ownerTeam: pilot.team, type,
    belt: getWepBelt(pilot, type),
    x: px, y: py, z: pz, vx, vy, vz,
    life: 1.8 - elapsedSec, isRocket: false
  });
}
