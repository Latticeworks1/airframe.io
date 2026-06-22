import assert from "node:assert/strict";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { AmmoBelt, Pilot, Projectile, WeaponType } from "../types";
import { falconMk2 } from "./content/aircraft/falcon-mk2";
import { getCockpitDef } from "./content/aircraft/cockpitRegistry";
import {
  getProjectileReleaseState,
  ProjectileSystem,
} from "./projectileSystem";
import { solveGunConvergenceLocal } from "./weaponConvergence";

const cockpit = getCockpitDef(falconMk2.specs.id);
assert.ok(cockpit, "Falcon cockpit definition must exist");

const convergenceM = falconMk2.hardpoints.gunConvergenceM;
assert.ok(convergenceM, "Falcon gun convergence must be configured");

const pilot = new Pilot({
  id: "convergence-test",
  name: "Test Pilot",
  isBot: false,
  team: 1,
  aircraftId: falconMk2.specs.id,
  specs: falconMk2.specs,
  x: 123,
  y: 456,
  z: -789,
  vx: 37,
  vy: -4,
  vz: 112,
  pitch: 0.17,
  yaw: -0.43,
  roll: 0.29,
  throttle: 1,
  engineTemperature: 80,
  damage: {
    engine: 1,
    leftWing: 1,
    rightWing: 1,
    tail: 1,
    cockpit: 1,
    fuelTank: 1,
    fuselage: 1,
    hasFire: false,
    hasOilLeak: false,
  },
  ammo: {
    [WeaponType.MG_7_7]: 1200,
    [WeaponType.HMG_12_7]: 600,
    [WeaponType.CANNON_20]: 0,
    [WeaponType.CANNON_30]: 0,
    [WeaponType.ROCKET]: 0,
    [WeaponType.BOMB]: 0,
  },
  ammoBelt: AmmoBelt.Universal,
  modifications: [],
  score: 0,
  kills: 0,
  deaths: 0,
  xpEarned: 0,
});

const rotation = new Quaternion().setFromEuler(
  new Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
);
const aircraftPosition = new Vector3(pilot.x, pilot.y, pilot.z);
const aircraftVelocity = new Vector3(pilot.vx, pilot.vy, pilot.vz);
let sharedTargetWorld: Vector3 | undefined;

falconMk2.hardpoints.positions.forEach((hardpoint, index) => {
  const muzzleLocal = new Vector3(hardpoint.x, hardpoint.y, hardpoint.z);
  const solution = solveGunConvergenceLocal(
    muzzleLocal,
    cockpit,
    convergenceM
  );
  const targetWorld = solution.targetLocal
    .clone()
    .applyQuaternion(rotation)
    .add(aircraftPosition);
  const release = getProjectileReleaseState(
    pilot,
    WeaponType.MG_7_7,
    index
  );
  const projectileDirection = release.velocity
    .clone()
    .sub(aircraftVelocity)
    .normalize();
  const distanceAlongRay = targetWorld
    .clone()
    .sub(release.position)
    .dot(projectileDirection);
  const pointAtConvergence = release.position
    .clone()
    .addScaledVector(projectileDirection, distanceAlongRay);
  const missDistance = pointAtConvergence.distanceTo(targetWorld);
  const yawDeg = Math.atan2(
    solution.directionLocal.x,
    solution.directionLocal.z
  ) * 180 / Math.PI;
  const pitchDeg = Math.asin(solution.directionLocal.y) * 180 / Math.PI;

  assert.ok(
    missDistance < 1e-6,
    `gun ${index} misses convergence by ${missDistance} m`
  );
  if (sharedTargetWorld) {
    assert.ok(
      targetWorld.distanceTo(sharedTargetWorld) < 1e-9,
      `gun ${index} does not share the common convergence point`
    );
  } else {
    sharedTargetWorld = targetWorld;
  }
  console.log(
    `gun ${index}: yaw=${yawDeg.toFixed(4)}°, ` +
    `pitch=${pitchDeg.toFixed(4)}°, miss=${missDistance.toExponential(2)}m`
  );
});

assert.ok(sharedTargetWorld, "convergence target must be produced");
const eyeWorld = new Vector3(...cockpit.eye)
  .applyQuaternion(rotation)
  .add(aircraftPosition);
const sightWorld = new Vector3(...cockpit.sightAnchor)
  .applyQuaternion(rotation)
  .add(aircraftPosition);
const camera = new PerspectiveCamera(74, 16 / 9, 0.04, 2000);
camera.position.copy(eyeWorld);
camera.up.set(0, 1, 0).applyQuaternion(rotation);
camera.lookAt(
  eyeWorld.clone().add(
    new Vector3(0, 0, 1).applyQuaternion(rotation)
  )
);
camera.updateMatrixWorld(true);
const sightNdc = sightWorld.clone().project(camera);
const convergenceNdc = sharedTargetWorld.clone().project(camera);
const screenError = Math.hypot(
  sightNdc.x - convergenceNdc.x,
  sightNdc.y - convergenceNdc.y
);
assert.ok(
  screenError < 1e-9,
  "gun zero and holographic reticle must occupy the same screen position"
);

const sightDirection = new Vector3(...cockpit.sightAnchor)
  .sub(new Vector3(...cockpit.eye))
  .normalize();
const targetDirection = solveGunConvergenceLocal(
  new Vector3(
    falconMk2.hardpoints.positions[0].x,
    falconMk2.hardpoints.positions[0].y,
    falconMk2.hardpoints.positions[0].z
  ),
  cockpit,
  convergenceM
).targetLocal
  .sub(new Vector3(...cockpit.eye))
  .normalize();
assert.ok(
  sightDirection.angleTo(targetDirection) < 1e-9,
  "gun convergence target must lie on the holographic sight ray"
);

const spawned: Projectile[] = [];
pilot.ammo[WeaponType.MG_7_7] = 1200;
ProjectileSystem.spawnProjectile(
  pilot,
  WeaponType.MG_7_7,
  spawned,
  undefined,
  () => 0.5
);
assert.equal(spawned.length, 1, "deterministic spawn must create one projectile");
const spawnedDirection = new Vector3(
  spawned[0].vx,
  spawned[0].vy,
  spawned[0].vz
).sub(aircraftVelocity).normalize();
const expectedDirection = getProjectileReleaseState(
  pilot,
  WeaponType.MG_7_7,
  0
).velocity.sub(aircraftVelocity).normalize();
assert.ok(
  spawnedDirection.angleTo(expectedDirection) < 1e-9,
  "zero-dispersion spawn must preserve the convergence solution"
);

console.log(
  `PASS gun convergence: ${falconMk2.hardpoints.positions.length} guns, ` +
  `${convergenceM} m zero`
);
