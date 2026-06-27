import { AircraftSpecs, FlightCommand, WeaponType } from "../../types";
import { WEAPON_SPECS_MAP } from "../aircraftData";
import { getTerrainHeight } from "../terrainModel";
import { MAP_REGISTRY } from "../content/maps/registry";
import { Vector3, Quaternion, Euler } from "three";

export function getSpawnYaw(team: number): number {
  return team === 1 ? Math.PI / 2 : -Math.PI / 2;
}

export function createEmptyDamage() {
  return {
    engine: 1.0, leftWing: 1.0, rightWing: 1.0, tail: 1.0,
    cockpit: 1.0, fuelTank: 1.0, fuselage: 1.0,
    hasFire: false, hasOilLeak: false
  };
}

export function initAmmo(specs: AircraftSpecs): Record<WeaponType, number> {
  const caps: Record<WeaponType, number> = {} as any;
  specs.weapons.forEach(w => {
    caps[w] = WEAPON_SPECS_MAP[w].ammoCapacity;
  });
  return caps;
}

export function getAirSpawnPosition(team: 1 | 2, mapId: string): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const mapDef = MAP_REGISTRY[mapId];
  const sp = mapDef?.spawn ?? { distMin: 3500, distMax: 4200, aglMin: 350, aglMax: 650, initialSpeedMs: 140, spreadZ: 600 };
  const dist = sp.distMin + Math.random() * (sp.distMax - sp.distMin);
  const sign = team === 1 ? -1 : 1;
  const x = sign * dist;
  const z = (Math.random() - 0.5) * 2 * sp.spreadZ;
  const terrain = getTerrainHeight(x, z, mapId);
  const agl = sp.aglMin + Math.random() * (sp.aglMax - sp.aglMin);
  const y = terrain.height + agl;

  const yaw = getSpawnYaw(team);
  const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0, "YXZ"));
  const vel = new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(sp.initialSpeedMs);
  return { x, y, z, vx: vel.x, vy: vel.y, vz: vel.z };
}

export function neutralCommand(): FlightCommand {
  return {
    pitch: 0, roll: 0, yaw: 0,
    throttleDelta: 0, boost: false, airbrake: false,
    primaryFire: false, secondaryFire: false,
    flaps: "up", gearDeployed: false
  };
}
