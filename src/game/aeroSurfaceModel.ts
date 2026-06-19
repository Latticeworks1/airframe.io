/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from "three";
import { Pilot, AircraftSpecs } from "../types";
import { LOCAL_FORWARD, LOCAL_UP, LOCAL_RIGHT, airDensityAtAltitude, safeNormalize } from "./math";
export type AeroControls = {
  pitchInput: number;    // -1 nose down, +1 nose up
  rollInput: number;     // -1 roll left, +1 roll right
  yawInput: number;      // -1 yaw left, +1 yaw right
  airbrake: boolean;
};
export type AeroSurface = {
  name: string;
  area: number;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  controlAxis?: "elevator" | "leftAileron" | "rightAileron" | "rudder";
  maxDeflectionDeg?: number;
  liftSlopePerDeg?: number;  // CLα per degree
  cl0?: number;              // CL0 — zero-AoA lift from camber (main wings only)
  dragScale?: number;
  aspectRatio?: number;
};
export type AeroDebugVector = {
  name: string;
  origin: THREE.Vector3;
  vector: THREE.Vector3;
  color: number;
};
export type AeroState = {
  force: THREE.Vector3;
  torque: THREE.Vector3;
  aoaDeg: number;
  sideslipDeg: number;
  mach: number;
  dynamicPressure: number;
  leftWingStalled: boolean;
  rightWingStalled: boolean;
  stalled: boolean;       // true if either wing is stalled
  groundEffect: number;
  debug: AeroDebugVector[];
};
const SPEED_OF_SOUND = 343;
const GROUND_EFFECT_MAX = 1.22;
function getAircraftQuaternion(pilot: Pilot) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
  );
}
function getMach(speedMps: number, altitudeMeters: number) {
  // Simple approximation: speed of sound falls a little with altitude.
  const localSpeedOfSound = THREE.MathUtils.clamp(
    SPEED_OF_SOUND - altitudeMeters * 0.003,
    295,
    SPEED_OF_SOUND
  );
  return speedMps / localSpeedOfSound;
}
function getMachDragMultiplier(mach: number) {
  // Arcade-friendly compressibility rise.
  // Below 0.72: basically no effect.
  // 0.72-1.05: drag wave starts climbing.
  // Above 1.05: heavy wave drag.
  if (mach < 0.72) return 1.0;
  if (mach < 1.05) {
    const t = (mach - 0.72) / 0.33;
    return 1.0 + t * t * 1.8;
  }
  return 2.8 + Math.min(4.0, (mach - 1.05) * 4.5);
}
function getMachControlMultiplier(mach: number) {
  // High speed control stiffening / compressibility.
  if (mach < 0.7) return 1.0;
  if (mach < 1.0) return THREE.MathUtils.lerp(1.0, 0.72, (mach - 0.7) / 0.3);
  return THREE.MathUtils.clamp(0.72 - (mach - 1.0) * 0.25, 0.45, 0.72);
}
function getGroundEffectMultiplier(altitudeMeters: number, wingSpanApprox: number) {
  // Ground effect mostly matters below roughly one wingspan.
  // It increases lift and reduces induced drag.
  const h = Math.max(0, altitudeMeters - 8);
  const span = Math.max(6, wingSpanApprox);
  if (h > span) return 1.0;
  const t = 1 - h / span;
  return THREE.MathUtils.clamp(1 + t * t * 0.22, 1.0, GROUND_EFFECT_MAX);
}
function getLiftCoefficient(alphaDeg: number, clSlopePerDeg: number, clMax: number, ar?: number) {
  // Low-AR surfaces (fins, deltas) sustain attached flow well past the 2D stall angle
  // due to leading-edge vortex lift. Scale stall angle up for AR < 3.
  const arFactor = (ar !== undefined && ar < 3) ? (1 + (3 - ar) / ar) : 1.0;
  const stallDeg = 17 * arFactor;
  const stallWidth = 10.0 * arFactor;
  const stalledCL = 0.42;

  const absA = Math.abs(alphaDeg);
  const sign = alphaDeg >= 0 ? 1 : -1;

  if (absA <= stallDeg) {
    let cl = clSlopePerDeg * alphaDeg;
    if (sign < 0) cl *= 0.75;
    return THREE.MathUtils.clamp(cl, -clMax * 0.75, clMax);
  } else {
    const stallT = THREE.MathUtils.clamp((absA - stallDeg) / stallWidth, 0, 1);
    let cl = THREE.MathUtils.lerp(clMax, stalledCL, stallT);
    if (sign < 0) cl *= 0.75;
    return cl * sign;
  }
}
function getParasiticDragCoefficient(alphaDeg: number, baseCd: number) {
  const absA = Math.abs(alphaDeg);
  let cd = baseCd;
  cd += absA * absA * 0.00055;
  if (absA > 17) {
    const stallT = THREE.MathUtils.clamp((absA - 17) / 10.0, 0, 1);
    cd += stallT * 0.18; // Stall drag penalty curve
  }
  return cd;
}
function getDefaultSurfaces(specs: AircraftSpecs): AeroSurface[] {
  // Values are proportional game geometry.
  // These should eventually move into aircraftData.ts per aircraft.
  const wingArea = specs.wingArea;
  const mainWingArea = wingArea * 0.72;
  const aileronArea = wingArea * 0.08;
  const hStabArea = wingArea * 0.16;
  const vStabArea = wingArea * 0.15;
  return [
    {
      name: "leftWing",
      area: mainWingArea * 0.5,
      pos: new THREE.Vector3(-2.8, 0, 0.4),
      normal: LOCAL_UP.clone(),
      aspectRatio: specs.aspectRatio,
      liftSlopePerDeg: specs.clAlpha,
      cl0: specs.cl0 * 0.5,  // half of total CL0 per wing half
      dragScale: 1.0
    },
    {
      name: "rightWing",
      area: mainWingArea * 0.5,
      pos: new THREE.Vector3(2.8, 0, 0.4),
      normal: LOCAL_UP.clone(),
      aspectRatio: specs.aspectRatio,
      liftSlopePerDeg: specs.clAlpha,
      cl0: specs.cl0 * 0.5,
      dragScale: 1.0
    },
    {
      name: "leftAileron",
      area: aileronArea * (specs.aileronBoost ?? 1.0),
      pos: new THREE.Vector3(-4.8, 0, 0.2),
      normal: LOCAL_UP.clone(),
      aspectRatio: 4.5,
      controlAxis: "leftAileron",
      maxDeflectionDeg: 18,
      liftSlopePerDeg: 0.08,
      dragScale: 1.15
    },
    {
      name: "rightAileron",
      area: aileronArea * (specs.aileronBoost ?? 1.0),
      pos: new THREE.Vector3(4.8, 0, 0.2),
      normal: LOCAL_UP.clone(),
      aspectRatio: 4.5,
      controlAxis: "rightAileron",
      maxDeflectionDeg: 18,
      liftSlopePerDeg: 0.08,
      dragScale: 1.15
    },
    {
      name: "hStab",
      area: hStabArea,
      pos: new THREE.Vector3(0, 0, -5.4),
      normal: LOCAL_UP.clone(),
      aspectRatio: 4.0,
      controlAxis: "elevator",
      maxDeflectionDeg: 24,
      liftSlopePerDeg: 0.085,
      dragScale: 1.1
    },
    {
      name: "vStab",
      area: vStabArea,
      pos: new THREE.Vector3(0, 1.1, -5.2),
      normal: LOCAL_RIGHT.clone(),
      aspectRatio: 1.5,
      controlAxis: "rudder",
      maxDeflectionDeg: 30,
      liftSlopePerDeg: 0.082,
      dragScale: 1.15
    }
  ];
}
function getSurfaceDeflectionDeg(surface: AeroSurface, controls: AeroControls) {
  if (!surface.controlAxis) return 0;
  const maxDeflection = surface.maxDeflectionDeg ?? 20;
  switch (surface.controlAxis) {
    case "elevator":
      return -controls.pitchInput * maxDeflection;
    case "leftAileron":
      return -controls.rollInput * maxDeflection;
    case "rightAileron":
      return controls.rollInput * maxDeflection;
    case "rudder":
      return controls.yawInput * maxDeflection;
    default:
      return 0;
  }
}
function getLocalVelocityAtSurface(
  localVelocity: THREE.Vector3,
  localAngularVelocity: THREE.Vector3,
  localSurfacePos: THREE.Vector3
) {
  // Velocity at point = body linear velocity + omega × r.
  return localVelocity.clone().add(
    localAngularVelocity.clone().cross(localSurfacePos)
  );
}
function getSurfaceAoA(surface: AeroSurface, localSurfaceVelocity: THREE.Vector3) {
  if (surface.controlAxis === "rudder") {
    return THREE.MathUtils.radToDeg(
      Math.atan2(localSurfaceVelocity.x, localSurfaceVelocity.z)
    );
  }
  return THREE.MathUtils.radToDeg(
    Math.atan2(-localSurfaceVelocity.y, localSurfaceVelocity.z)
  );
}
function forcePerpendicularToAirflow(
  preferredWorldNormal: THREE.Vector3,
  airVelocityWorld: THREE.Vector3
) {
  const airDir = safeNormalize(airVelocityWorld.clone(), LOCAL_FORWARD);
  const n = preferredWorldNormal
    .clone()
    .sub(airDir.clone().multiplyScalar(preferredWorldNormal.dot(airDir)));
  return safeNormalize(n, preferredWorldNormal);
}
function getRotationalDampingTorque(
  localAngularVelocity: THREE.Vector3,
  dynamicPressure: number,
  specs: AircraftSpecs,
  machControlMultiplier: number
) {
  // Rotational damping: aircraft naturally resists pitch/yaw/roll rates.
  // Roll damping is strong. Pitch is medium. Yaw is medium-high.
  const area = specs.wingArea;
  const span = Math.sqrt(specs.aspectRatio * specs.wingArea);
  const chord = specs.wingArea / Math.max(1, span);
  const rollDamping = dynamicPressure * area * span * span * 0.009;
  const pitchDamping = dynamicPressure * area * chord * chord * 0.08;
  const yawDamping = dynamicPressure * area * span * span * 0.010;
  return new THREE.Vector3(
    -localAngularVelocity.x * pitchDamping, // x is Pitch
    -localAngularVelocity.y * yawDamping,   // y is Yaw
    -localAngularVelocity.z * rollDamping    // z is Roll
  ).multiplyScalar(machControlMultiplier);
}
function getNaturalStabilityTorque(
  aoaDeg: number,
  sideslipDeg: number,
  pilot: Pilot,
  dynamicPressure: number,
  specs: AircraftSpecs
) {
  // Natural pitch/yaw correction.
  // Positive AoA pushes nose back down.
  // Positive sideslip pushes nose back into airflow.
  const area = specs.wingArea;
  const span = Math.sqrt(specs.aspectRatio * specs.wingArea);
  const chord = specs.wingArea / Math.max(1, span);
  const tailHealth = pilot.damage.tail;
  const wingHealth = (pilot.damage.leftWing + pilot.damage.rightWing) * 0.5;
  const pitchRestoring =
    -THREE.MathUtils.degToRad(aoaDeg) *
    dynamicPressure *
    area *
    chord *
    0.20 *
    tailHealth;
  const yawRestoring =
    -THREE.MathUtils.degToRad(sideslipDeg) *
    dynamicPressure *
    area *
    span *
    0.18 *
    tailHealth;
  // Dihedral / roll stability: disabled per user request for max manual/realistic flight control.
  const rollRestoring = 0;
  // Local angular torque axes (Corrected physical mapping):
  // x = pitch moment from elevator & pitch stability
  // y = yaw moment from rudder & directional stability
  // z = roll moment from ailerons & dihedral/roll stability
  return new THREE.Vector3(
    pitchRestoring,
    yawRestoring,
    rollRestoring
  );
}
function applyDamageToSurface(surface: AeroSurface, pilot: Pilot) {
  let health = 1.0;
  if (surface.name === "leftAileron") health *= pilot.damage.leftWing;
  if (surface.name === "rightAileron") health *= pilot.damage.rightWing;
  if (surface.name === "leftWing") health *= pilot.damage.leftWing;
  if (surface.name === "rightWing") health *= pilot.damage.rightWing;
  if (surface.name === "hStab" || surface.name === "vStab") {
    health *= pilot.damage.tail;
  }
  return THREE.MathUtils.clamp(health, 0, 1);
}
export function computeAeroSurfaceForces(args: {
  pilot: Pilot;
  specs: AircraftSpecs;
  controls: AeroControls;
  localAngularVelocity: THREE.Vector3;
  surfaces?: AeroSurface[];
  altitudeAGL?: number;
}): AeroState {
  const { pilot, specs, controls } = args;
  const qBodyToWorld = getAircraftQuaternion(pilot);
  const qWorldToBody = qBodyToWorld.clone().invert();
  const position = new THREE.Vector3(pilot.x, pilot.y, pilot.z);
  const velocityWorld = new THREE.Vector3(pilot.vx, pilot.vy, pilot.vz);
  const localVelocity = velocityWorld.clone().applyQuaternion(qWorldToBody);
  const speed = velocityWorld.length();
  const rho = airDensityAtAltitude(pilot.y);
  const dynamicPressure = 0.5 * rho * speed * speed;
  const mach = getMach(speed, pilot.y);
  
  // Physically correct AoA and Sideslip coordinates (no abs/max clamping)
  const aoaDeg = THREE.MathUtils.radToDeg(
    Math.atan2(-localVelocity.y, localVelocity.z)
  );
  const sideslipDeg = THREE.MathUtils.radToDeg(
    Math.atan2(localVelocity.x, localVelocity.z)
  );

  const machDragMultiplier = getMachDragMultiplier(mach);
  const machControlMultiplier = getMachControlMultiplier(mach);
  const wingSpanApprox = Math.sqrt(specs.aspectRatio * specs.wingArea);
  
  // Ground effect based on user's altitude above ground level (AGL)
  const altAGL = args.altitudeAGL !== undefined ? args.altitudeAGL : Math.max(0, pilot.y);
  const groundEffect = getGroundEffectMultiplier(altAGL, wingSpanApprox);
  
  const totalForceWorld = new THREE.Vector3();
  const totalTorqueLocal = new THREE.Vector3();
  const debug: AeroDebugVector[] = [];
  
  if (speed < 2) {
    return {
      force: totalForceWorld,
      torque: totalTorqueLocal,
      aoaDeg: 0,
      sideslipDeg: 0,
      mach,
      dynamicPressure: 0,
      leftWingStalled: false,
      rightWingStalled: false,
      stalled: false,
      groundEffect,
      debug
    };
  }
  
  let leftWingStalled = false;
  let rightWingStalled = false;
  const surfaces = args.surfaces ?? getDefaultSurfaces(specs);
  
  for (const surface of surfaces) {
    const health = applyDamageToSurface(surface, pilot);
    if (health <= 0.01) continue;
    const localSurfaceVelocity = getLocalVelocityAtSurface(
      localVelocity,
      args.localAngularVelocity,
      surface.pos
    );
    const surfaceSpeed = localSurfaceVelocity.length();
    if (surfaceSpeed < 1) continue;
    
    // Flap aerodynamic bonuses
    let flapLiftBonus = 0;
    let flapCLMaxBonus = 0;
    let flapDragPenalty = 0;
    if (pilot.flaps === "combat") {
      flapLiftBonus = 0.15;
      flapCLMaxBonus = 0.18;
      flapDragPenalty = 0.015;
    } else if (pilot.flaps === "landing") {
      flapLiftBonus = 0.32;
      flapCLMaxBonus = 0.42;
      flapDragPenalty = 0.045;
    }

    const deflectionDeg = getSurfaceDeflectionDeg(surface, controls) * machControlMultiplier;
    const surfaceAoA = getSurfaceAoA(surface, localSurfaceVelocity) + deflectionDeg;
    const clSlope = surface.liftSlopePerDeg ?? 0.09;
    
    const isMainWing = surface.name === "leftWing" || surface.name === "rightWing";
    
    const surfaceAR = surface.aspectRatio ?? specs.aspectRatio;
    let clBase = getLiftCoefficient(
      surfaceAoA,
      clSlope,
      1.35 + (isMainWing ? flapCLMaxBonus : 0),
      surfaceAR
    );
    if (isMainWing) {
      // CL0: camber contributes base lift at zero AoA — applied before stall check
      clBase += (surface.cl0 ?? 0);
      clBase += flapLiftBonus;
      const arFactor = surfaceAR < 3 ? (1 + (3 - surfaceAR) / surfaceAR) : 1.0;
      if (Math.abs(surfaceAoA) > 17 * arFactor) {
        if (surface.name === "leftWing") leftWingStalled = true;
        if (surface.name === "rightWing") rightWingStalled = true;
      }
    }

    const isVertical = surface.controlAxis === "rudder";
    const groundLiftBoost = isVertical ? 1.0 : groundEffect;
    const cl = clBase * health * groundLiftBoost;
    const localAirVelocityWorld = localSurfaceVelocity
      .clone()
      .applyQuaternion(qBodyToWorld);

    // Rotate surface normal with control deflection for realistic physical force direction
    const deflectionRad = THREE.MathUtils.degToRad(deflectionDeg);
    const hingeAxis = isVertical ? LOCAL_UP : LOCAL_RIGHT;
    const rotatedLocalNormal = surface.normal.clone().applyAxisAngle(hingeAxis, deflectionRad);
    const normalWorld = rotatedLocalNormal.applyQuaternion(qBodyToWorld);

    const liftDirWorld = forcePerpendicularToAirflow(normalWorld, localAirVelocityWorld);
    const surfaceQ = 0.5 * rho * surfaceSpeed * surfaceSpeed;
    const liftMag = surfaceQ * surface.area * cl;
    
    let cdBase = getParasiticDragCoefficient(
      surfaceAoA,
      specs.cd0 * (surface.dragScale ?? 1.0)
    );
    if (isMainWing) {
      cdBase += flapDragPenalty;
    }

    // Induced drag uses surface aspect ratio or spec default
    const ar = surface.aspectRatio ?? specs.aspectRatio;
    const inducedCd =
      (cl * cl) /
      Math.max(0.001, Math.PI * ar * specs.oswaldEfficiency);
    const groundDragReduction = isVertical ? 1.0 : 1 / groundEffect;
    const cd = (cdBase + inducedCd * groundDragReduction) * machDragMultiplier;
    const dragDirWorld = safeNormalize(localAirVelocityWorld.clone(), LOCAL_FORWARD)
      .multiplyScalar(-1);
    const dragMag = surfaceQ * surface.area * cd;
    const liftForceWorld = liftDirWorld.multiplyScalar(liftMag);
    const dragForceWorld = dragDirWorld.multiplyScalar(dragMag);
    const surfaceForceWorld = liftForceWorld.clone().add(dragForceWorld);
    totalForceWorld.add(surfaceForceWorld);
    
    // Torque calculation r x F
    const rWorld = surface.pos.clone().applyQuaternion(qBodyToWorld);
    const torqueWorld = new THREE.Vector3().crossVectors(rWorld, surfaceForceWorld);
    const torqueLocal = torqueWorld.clone().applyQuaternion(qWorldToBody);
    totalTorqueLocal.add(torqueLocal);
    
    debug.push({
      name: `${surface.name}:lift`,
      origin: position.clone().add(rWorld),
      vector: liftForceWorld.clone().multiplyScalar(0.0008),
      color: 0x22c55e
    });
    debug.push({
      name: `${surface.name}:drag`,
      origin: position.clone().add(rWorld),
      vector: dragForceWorld.clone().multiplyScalar(0.0008),
      color: 0xef4444
    });
  }
  
  // Global central Airbrake drag force instead of duplicating across individual surfaces
  if (controls.airbrake) {
    const brakeArea = specs.wingArea * 0.15;
    const brakeCd = 0.85;
    const brakeForceMag = dynamicPressure * brakeArea * brakeCd;
    const dragDirWorld = safeNormalize(velocityWorld.clone(), LOCAL_FORWARD).multiplyScalar(-1);
    const brakeForceWorld = dragDirWorld.clone().multiplyScalar(brakeForceMag);
    totalForceWorld.add(brakeForceWorld);
  }

  // Global central Landing Gear drag force belonging to the fuselage
  if (pilot.gearDeployed) {
    const gearArea = specs.wingArea * 0.08;
    const gearCd = 0.45;
    const gearForceMag = dynamicPressure * gearArea * gearCd;
    const dragDirWorld = safeNormalize(velocityWorld.clone(), LOCAL_FORWARD).multiplyScalar(-1);
    const gearForceWorld = dragDirWorld.clone().multiplyScalar(gearForceMag);
    totalForceWorld.add(gearForceWorld);
  }

  // Flap pitching torque (nose-down / negative torque around local X Pitch axis)
  if (pilot.flaps && pilot.flaps !== "up") {
    const flapCm = pilot.flaps === "combat" ? -0.06 : -0.14;
    const span = Math.sqrt(specs.aspectRatio * specs.wingArea);
    const chord = specs.wingArea / Math.max(1, span);
    const flapTorqueX = flapCm * dynamicPressure * specs.wingArea * chord;
    totalTorqueLocal.x += flapTorqueX;
  }
  const dampingTorque = getRotationalDampingTorque(
    args.localAngularVelocity,
    dynamicPressure,
    specs,
    machControlMultiplier
  );
  const stabilityTorque = getNaturalStabilityTorque(
    aoaDeg,
    sideslipDeg,
    pilot,
    dynamicPressure,
    specs
  );
  totalTorqueLocal.add(dampingTorque);
  totalTorqueLocal.add(stabilityTorque);
  debug.push({
    name: "velocity",
    origin: position.clone(),
    vector: velocityWorld.clone().multiplyScalar(0.08),
    color: 0x38bdf8
  });
  debug.push({
    name: "stabilityTorque",
    origin: position.clone(),
    vector: stabilityTorque.clone().applyQuaternion(qBodyToWorld).multiplyScalar(0.0006),
    color: 0xeab308
  });
  debug.push({
    name: "dampingTorque",
    origin: position.clone(),
    vector: dampingTorque.clone().applyQuaternion(qBodyToWorld).multiplyScalar(0.0006),
    color: 0xa855f7
  });
  return {
    force: totalForceWorld,
    torque: totalTorqueLocal,
    aoaDeg,
    sideslipDeg,
    mach,
    dynamicPressure,
    leftWingStalled,
    rightWingStalled,
    stalled: leftWingStalled || rightWingStalled,
    groundEffect,
    debug
  };
}
export function estimateInertia(specs: AircraftSpecs) {
  const span = Math.sqrt(specs.aspectRatio * specs.wingArea);
  const chord = specs.wingArea / Math.max(1, span);
  const length = Math.max(7, chord * 4.2);
  // Physically motivated inertia for a propeller fighter: mass is concentrated
  // near the fuselage centerline, so roll inertia (Iz) is much smaller than
  // the uniform-box formula suggests. Reference values for similar-mass WWII
  // fighters sit around: Ix(pitch) 15-25k, Iy(yaw) 18-35k, Iz(roll) 4-8k kg·m².
  // pitch: driven by fuselage length squared — use full length contribution
  const ixx = (specs.mass / 12) * (1.2 * 1.2 + length * length);
  // yaw: length and partial span (payload distributed toward center)
  const iyy = (specs.mass / 12) * (length * length + span * span * 0.5);
  // roll: mostly fuselage + inner wing mass, tip mass is light — span fraction 0.15
  const izz = (specs.mass / 12) * (span * span * 0.15 + 1.2 * 1.2);
  return new THREE.Vector3(ixx, iyy, izz);
}

export class AerodynamicsEngine {
  public static computeForces = computeAeroSurfaceForces;
  public static estimateInertia = estimateInertia;
}

