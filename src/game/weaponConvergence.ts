import { Vector3 } from "three";
import type { CockpitDef } from "./cockpitMesh";

export interface GunConvergenceSolution {
  targetLocal: Vector3;
  directionLocal: Vector3;
}

export function getSightRayLocal(cockpit: CockpitDef): Vector3 {
  return new Vector3(...cockpit.sightAnchor)
    .sub(new Vector3(...cockpit.eye))
    .normalize();
}

export function solveGunConvergenceLocal(
  muzzleLocal: Vector3,
  cockpit: CockpitDef,
  convergenceM: number
): GunConvergenceSolution {
  const targetLocal = new Vector3(...cockpit.eye)
    .addScaledVector(getSightRayLocal(cockpit), convergenceM);
  const directionLocal = targetLocal.clone().sub(muzzleLocal).normalize();
  return { targetLocal, directionLocal };
}
