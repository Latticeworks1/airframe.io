/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { Pilot, FlightCommand, AircraftSpecs } from "../types";
import { physical, locomotive, destructible, control } from "../types/components";
import { AerodynamicsEngine } from "./aeroSurfaceModel";
import { getTerrainHeight } from "./terrainModel";
import { MAP_REGISTRY } from "./content/maps/registry";
import { KnownMaps } from "./content/maps/mapTypes";
import { MODIFICATIONS } from "./content/modifications/modificationData";
import {
  LOCAL_FORWARD,
  LOCAL_UP,
  LOCAL_RIGHT,
  safeNormalize,
  airDensityAtAltitude
} from "./math";

const G = 9.81;

// AXIS CONTRACT

function getAircraftQuaternion(qx: number, qy: number, qz: number, qw: number) {
  return new Quaternion(qx, qy, qz, qw);
}

function getAircraftBasis(qx: number, qy: number, qz: number, qw: number) {
  const q = getAircraftQuaternion(qx, qy, qz, qw);

  return {
    q,
    forward: LOCAL_FORWARD.clone().applyQuaternion(q).normalize(),
    up: LOCAL_UP.clone().applyQuaternion(q).normalize(),
    right: LOCAL_RIGHT.clone().applyQuaternion(q).normalize()
  };
}

function approach(current: number, target: number, rate: number, dt: number): number {
  if (current < target) return Math.min(current + rate * dt, target);
  if (current > target) return Math.max(current - rate * dt, target);
  return current;
}

function getAoA(localVelocity: Vector3) {
  // Aircraft local +Z is nose-forward.
  // Positive AoA means nose above flight path.
  return Math.atan2(-localVelocity.y, localVelocity.z);
}

function requireSpecInRange(
  specs: AircraftSpecs,
  keyName: "wingArea" | "aspectRatio" | "oswaldEfficiency",
  min: number,
  max: number
): number {
  const value = specs[keyName];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Aircraft spec "${specs.id}" is missing required aerodynamic field "${keyName}". ` +
        `Add a finite number for ${keyName} in aircraftData.ts.`
    );
  }

  if (value <= 0 || value < min || value > max) {
    throw new Error(
      `Aircraft spec "${specs.id}" has invalid aerodynamic field "${keyName}" = ${value}. ` +
        `Expected ${keyName} between ${min} and ${max}.`
    );
  }

  return value;
}

export function applyModifications(
  specs: AircraftSpecs,
  equippedIds: string[]
): AircraftSpecs {
  const modified = { ...specs };

  equippedIds.forEach(id => {
    const mod = MODIFICATIONS.find(m => m.id === id);
    if (!mod) return;

    const eff = mod.effects;
    if (eff.maxThrust !== undefined) {
      modified.maxThrust *= (1 + eff.maxThrust);
    }
    if (eff.mass !== undefined) {
      modified.mass *= (1 + eff.mass);
    }
    if (eff.cd0 !== undefined) {
      modified.cd0 = Math.max(0.001, modified.cd0 + eff.cd0);
    }
    if (eff.durability !== undefined) {
      modified.durability *= (1 + eff.durability);
    }
    if (eff.rollRate !== undefined) {
      modified.rollRateDegPerSec = (modified.rollRateDegPerSec ?? 90) * (1 + eff.rollRate);
    }
  });

  return modified;
}

/**
 * Updates aircraft flight dynamics using a custom aerodynamic force model.
 *
 * Aircraft local axes:
 * +Z = nose / forward
 * +Y = up
 * +X = right wing
 */
export function updateFlightPhysics(
  pilot: Pilot,
  command: FlightCommand,
  dt: number,
  mapId: string = KnownMaps.IslandChain
) {
  if (dt <= 0) return;
  dt = Math.min(dt, 0.05);

  // Extract components once to avoid repeated Map lookups on each property access
  const phys = physical(pilot.entity);
  const loco = locomotive(pilot.entity);
  const destr = destructible(pilot.entity);
  const ctrl = control(pilot.entity);
  const dm = destr.damageModel!;

  const specs = applyModifications(pilot.specs, pilot.modifications);

  requireSpecInRange(specs, "wingArea", 8, 70);
  requireSpecInRange(specs, "aspectRatio", 3, 12);
  requireSpecInRange(specs, "oswaldEfficiency", 0.55, 0.95);

  const pos = new Vector3(phys.x, phys.y, phys.z);
  const vel = new Vector3(phys.vx, phys.vy, phys.vz);

  let speed = vel.length();
  let speedKmph = speed * 3.6;

  let { q, forward } = getAircraftBasis(phys.qx, phys.qy, phys.qz, phys.qw);

  let pitchInput = command.pitch;
  let rollInput = command.roll;
  let yawInput = command.yaw;
  const throttleInput = command.throttleDelta;
  const boost = command.boost;
  const airbrake = command.airbrake;

  loco.throttle = MathUtils.clamp(
    loco.throttle + throttleInput * dt * 0.65,
    0.0,
    boost ? 1.1 : 1.0
  );

  if (boost) {
    loco.throttle = Math.min(1.1, loco.throttle + dt * 0.35);
  }

  const targetTemp = 50 + loco.throttle * 70;
  loco.engineTemperature = (loco.engineTemperature ?? 75) +
    (targetTemp - (loco.engineTemperature ?? 75)) * dt * 0.05;

  const engineHealth = dm.engine;
  const leftWingHealth = dm.leftWing;
  const rightWingHealth = dm.rightWing;
  const tailHealth = dm.tail;
  const cockpitHealth = dm.cockpit;
  const wingHealth = (leftWingHealth + rightWingHealth) / 2;
  const controlFactor = 0.3 + 0.7 * cockpitHealth;

  // Append roll asymmetry from wing damage
  rollInput -= (rightWingHealth - leftWingHealth) * 0.3;

  loco.airbrakeDeployed = command.airbrake;
  loco.flaps = command.flaps;
  loco.gearDeployed = command.gearDeployed;

  // Physical separation: Raw input -> Pilot Intent -> Actuator Deflection rate limit
  ctrl.pitchIntent = approach(ctrl.pitchIntent ?? 0, pitchInput, 3.2, dt);
  ctrl.rollIntent = approach(ctrl.rollIntent ?? 0, rollInput, 4.2, dt);
  ctrl.yawIntent = approach(ctrl.yawIntent ?? 0, yawInput, 2.2, dt);

  // Surfaces actuator physical lag
  ctrl.elevatorDeflection = approach(ctrl.elevatorDeflection ?? 0, ctrl.pitchIntent, 4.5, dt);
  ctrl.aileronDeflection = approach(ctrl.aileronDeflection ?? 0, ctrl.rollIntent, 5.5, dt);
  ctrl.rudderDeflection = approach(ctrl.rudderDeflection ?? 0, ctrl.yawIntent, 3.8, dt);

  // Apply continuous smoothed surface deflections downstream
  pitchInput = ctrl.elevatorDeflection;
  rollInput = ctrl.aileronDeflection;
  yawInput = ctrl.rudderDeflection;

  const currentPitchRate =
    (specs.pitchRateDegPerSec ?? 45) * (0.3 + 0.7 * tailHealth) * controlFactor;

  const currentRollRate =
    (specs.rollRateDegPerSec ?? 90) * (0.4 + 0.6 * wingHealth) * controlFactor;

  const currentYawRate =
    (specs.yawRateDegPerSec ?? 30) * (0.3 + 0.7 * tailHealth) * controlFactor;

  // Active Angular Velocity matching pilot model (X = Pitch, Y = Yaw, Z = Roll)
  const localAngularVelocity = new Vector3(
    phys.avx ?? 0, // pitch
    phys.avy ?? 0, // yaw
    phys.avz ?? 0  // roll
  );

  const terrainInfo = getTerrainHeight(pos.x, pos.z, mapId);
  const altitudeAGL = Math.max(0, pos.y - terrainInfo.height);

  // Invoke high-fidelity aero surface calculations
  const aero = AerodynamicsEngine.computeForces({
    pilot,
    specs,
    controls: {
      pitchInput,
      rollInput,
      yawInput,
      airbrake: !!airbrake
    },
    localAngularVelocity,
    altitudeAGL
  });

  // Calculate pre-rotation airspeed and angles to determine stall conditions accurately
  const wind = new Vector3(0, 0, 0);
  const airVelocityWorld = vel.clone().sub(wind);
  const airspeed = airVelocityWorld.length();
  const airspeedKmph = airspeed * 3.6;

  const initialInvQ = q.clone().invert();
  const initialLocalVelocity = airVelocityWorld.clone().applyQuaternion(initialInvQ);

  const initialAlpha = getAoA(initialLocalVelocity);
  const initialAlphaDeg = Math.abs(MathUtils.radToDeg(initialAlpha));

  const isStallingByAoA = initialAlphaDeg > 17.5;
  const isSupportedByGround = altitudeAGL <= 1.5;
  const isCurrentlyStalled = !isSupportedByGround && (isStallingByAoA || (airspeedKmph < specs.stallSpeedKmph));

  // 1. Aerodynamic and structural restoring moments accelerate local angular rates
  const inertiaVal = AerodynamicsEngine.estimateInertia(specs);
  localAngularVelocity.x += (aero.torque.x / Math.max(1, inertiaVal.x)) * dt; // Pitch rate (around X)
  localAngularVelocity.y += (aero.torque.y / Math.max(1, inertiaVal.y)) * dt; // Yaw rate (around Y)
  localAngularVelocity.z += (aero.torque.z / Math.max(1, inertiaVal.z)) * dt; // Roll rate (around Z)

  const maxRateLimit = 6.0;
  localAngularVelocity.x = MathUtils.clamp(localAngularVelocity.x, -maxRateLimit, maxRateLimit);
  localAngularVelocity.y = MathUtils.clamp(localAngularVelocity.y, -maxRateLimit, maxRateLimit);
  localAngularVelocity.z = MathUtils.clamp(localAngularVelocity.z, -maxRateLimit, maxRateLimit);

  // 2. Control authority rolls off realistically at low speeds to simulate lack of over-wing flow
  let controlAuthority = MathUtils.clamp((airspeedKmph / specs.stallSpeedKmph) * 1.12, 0.04, 1.25);
  if (isCurrentlyStalled) {
    // Reduce control authority significantly when stalled to prevent pilot/bot from overriding the nose-drop
    controlAuthority *= 0.22;
  }

  const directPitchRate = -pitchInput * (currentPitchRate * Math.PI / 180) * controlAuthority;
  const directYawRate = -yawInput * (currentYawRate * Math.PI / 180) * controlAuthority;
  const directRollRate = rollInput * (currentRollRate * Math.PI / 180) * controlAuthority;

  // Blending direct arcade assist (35%) and full rigid-body torque integration (65%)
  const finalPitchRate = MathUtils.lerp(localAngularVelocity.x, directPitchRate, 0.35); // Pitch (local X)
  const finalYawRate = MathUtils.lerp(localAngularVelocity.y, directYawRate, 0.35);   // Yaw (local Y)
  const finalRollRate = MathUtils.lerp(localAngularVelocity.z, directRollRate, 0.35);  // Roll (local Z)

  // 3. Inject Stall Wing Drop instability and nose-heavy recovery moment
  if (isCurrentlyStalled) {
    loco.isStalling = true;
    loco.stallSeverity = MathUtils.clamp(
      isStallingByAoA
        ? (initialAlphaDeg - 17.5) / 10
        : (specs.stallSpeedKmph * 1.05 - airspeedKmph) / (specs.stallSpeedKmph * 0.35),
      0.1,
      1.0
    );

    // Wing drop spins: when stalled, steering actions or minor slips flip the wing into an uncontrolled roll and deep dive
    if (airspeedKmph > 18) {
      const dropFreq = Date.now() * 0.0015;
      const wingDropFactor = loco.stallSeverity * (specs.rollRateDegPerSec ?? 90) * (Math.PI / 180) * 1.6;
      localAngularVelocity.z += Math.sin(dropFreq) * wingDropFactor * dt; // Z is roll
      localAngularVelocity.y += Math.cos(dropFreq + 1.1) * wingDropFactor * 0.35 * dt; // Y is yaw
    }

    // Nose-heavy center-of-gravity moment forces a rapid pitching drop to recover airspeed
    // This must apply at all speeds to ensure the aircraft naturally falls nose-down when stalled
    localAngularVelocity.x -= 0.92 * loco.stallSeverity * dt; // X is pitch
  } else {
    loco.isStalling = false;
    loco.stallSeverity = 0;
  }

  const totalPitchRate = finalPitchRate;
  const totalYawRate   = finalYawRate;
  const totalRollRate  = finalRollRate;

  // 4. One-Shot Quaternion Integration to perfectly evolve attitude without Euler locks
  const qCurrent = getAircraftQuaternion(phys.qx, phys.qy, phys.qz, phys.qw);
  const omega = new Vector3(totalPitchRate, totalYawRate, totalRollRate);
  const omegaMag = omega.length();
  if (omegaMag > 1e-8) {
    const axis = omega.clone().normalize();
    const dq = new Quaternion().setFromAxisAngle(axis, omegaMag * dt);
    qCurrent.multiply(dq);
    qCurrent.normalize();
  }

  phys.qx = qCurrent.x;
  phys.qy = qCurrent.y;
  phys.qz = qCurrent.z;
  phys.qw = qCurrent.w;

  // Takeoff & rollout attitude stabilization: prevent wings dipping or nose diving below takeoff speed on ground
  const terrainCheckForAttitude = getTerrainHeight(pos.x, pos.z, mapId);
  if (pos.y <= terrainCheckForAttitude.height + 1.2 && speed * 3.6 < 130) {
    const euler = new Euler().setFromQuaternion(qCurrent, "YXZ");
    euler.x = MathUtils.clamp(euler.x, -0.01, 0.05);
    euler.z = 0;
    qCurrent.setFromEuler(euler);
    phys.qx = qCurrent.x;
    phys.qy = qCurrent.y;
    phys.qz = qCurrent.z;
    phys.qw = qCurrent.w;
  }

  // Store angular rates back into the pilot's kinematic registers
  phys.avx = totalPitchRate; // X is pitch
  phys.avy = totalYawRate;   // Y is yaw
  phys.avz = totalRollRate;  // Z is roll

  // Recalculate 3D basis vectors
  ({ q, forward } = getAircraftBasis(phys.qx, phys.qy, phys.qz, phys.qw));

  // Compute aerodynamic forces using updated orientation frame
  speed = vel.length();
  speedKmph = speed * 3.6;

  const rho = airDensityAtAltitude(pos.y);

  // 1. Compute engine thrust and apply altitude power dropoff
  const altitudePower = MathUtils.clamp(
    rho / 1.225,
    0.35,
    1.0
  );

  const throttle01 = MathUtils.clamp(loco.throttle, 0, 1.0);
  const thrustBoost = boost ? 1.08 : 1.0;
  // Propeller thrust falls as forward speed approaches the aircraft's design
  // envelope. Without this lapse, constant static thrust remains available at
  // every speed and the high-power aircraft accelerate beyond 1,000 km/h.
  const envelopeRatio = speedKmph / Math.max(1, specs.structuralLimitSpeedKmph);
  const thrustSpeedLapse = MathUtils.clamp(
    1 - 0.72 * envelopeRatio * envelopeRatio,
    0.18,
    1
  );

  const actualThrust =
    specs.maxThrust *
    throttle01 *
    engineHealth *
    altitudePower *
    thrustBoost *
    thrustSpeedLapse;

  const thrustForce = forward.clone().multiplyScalar(actualThrust);
  const gravityForce = new Vector3(0, -specs.mass * G, 0);

  // 2. Sum physical forces (Thrust + Gravity + component aero surface forces)
  // aero.force integrates Lift, Drag, Sideslip, induced drag, and global gear/airbrake forces computed per-surface!
  const totalForce = new Vector3()
    .add(thrustForce)
    .add(gravityForce)
    .add(aero.force);

  // In a vertical climb the AoA is near 0° so the per-surface stall drag never
  // fires. We impose an additional downward force when stalled so altitude loss
  // is guaranteed regardless of aircraft orientation or available thrust.
  if (isCurrentlyStalled) {
    totalForce.y -= specs.mass * G * loco.stallSeverity * 2.4;
  }

  const accel = totalForce.divideScalar(specs.mass);
  vel.addScaledVector(accel, dt);

  const stalled = loco.isStalling ?? false;

  let alignmentAlpha = MathUtils.clamp(
    (airspeedKmph / Math.max(1, specs.stallSpeedKmph)) * 0.08,
    0.01,
    0.12
  );

  if (stalled) {
    alignmentAlpha *= 0.35;
  }

  const newSpeed = vel.length();
  const travelDir = safeNormalize(vel.clone(), forward);
  const blendedDir = travelDir
    .clone()
    .lerp(forward, alignmentAlpha)
    .normalize();

  vel.copy(blendedDir).multiplyScalar(newSpeed);

  if (speedKmph > specs.structuralLimitSpeedKmph) {
    const excess = speedKmph - specs.structuralLimitSpeedKmph;

    if (excess > 10) {
      const severity = Math.min(1, excess / 180);
      dm.leftWing = Math.max(0, dm.leftWing - dt * 0.05 * severity);
      dm.rightWing = Math.max(0, dm.rightWing - dt * 0.05 * severity);
      dm.fuselage = Math.max(0.1, dm.fuselage - dt * 0.02 * severity);
    }
  }

  pos.addScaledVector(vel, dt);

  const terrain = getTerrainHeight(pos.x, pos.z, mapId);
  const groundElevation = terrain.height;

  if (pos.y < groundElevation) {
    const sinkRate = -vel.y;
    pos.y = groundElevation;
    vel.y = 0; // Touchdown: vertical velocity is zeroed.

    const isAirfield = terrain.isAirfield || groundElevation <= 12;

    if (!isAirfield) {
      // Off-airfield rough landing
      if (loco.gearDeployed && sinkRate < 4.0 && speedKmph < 185) {
        dm.fuselage = Math.max(0.15, dm.fuselage - dt * 0.12);
        const rolloutSpeed = Math.max(0, vel.length() - dt * 45.0);
        vel.copy(forward).multiplyScalar(rolloutSpeed);
        if (rolloutSpeed * 3.6 < 5 && loco.throttle < 0.1) vel.set(0, 0, 0);
      } else {
        dm.fuselage = 0;
        dm.engine = 0;
      }
    } else {
      // Landing on actual airfield runway
      if (loco.gearDeployed) {
        if (sinkRate >= 8.5) {
          dm.fuselage = 0;
          dm.engine = 0;
        } else if (sinkRate >= 4.5) {
          dm.fuselage = Math.max(0.1, dm.fuselage - 0.45);
          loco.gearDeployed = false;
          dm.engine = Math.max(0.0, dm.engine - 0.25);
          const rolloutSpeed = Math.max(0, vel.length() - dt * 65.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && loco.throttle < 0.1) vel.set(0, 0, 0);
        } else {
          const rolloutSpeed = Math.max(0, vel.length() - dt * 14.5);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && loco.throttle < 0.1) vel.set(0, 0, 0);
        }
      } else {
        // Belly slide (Gear-Up Landing on runway)
        if (sinkRate >= 5.5) {
          dm.fuselage = 0;
          dm.engine = 0;
        } else if (sinkRate >= 2.8) {
          dm.fuselage = Math.max(0.1, dm.fuselage - 0.55);
          dm.engine = 0.0;
          const rolloutSpeed = Math.max(0, vel.length() - dt * 55.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && loco.throttle < 0.1) vel.set(0, 0, 0);
        } else {
          dm.fuselage = Math.max(0.15, dm.fuselage - 0.22);
          dm.engine = Math.max(0.0, dm.engine - 0.4);
          const rolloutSpeed = Math.max(0, vel.length() - dt * 42.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && loco.throttle < 0.1) vel.set(0, 0, 0);
        }
      }
    }
  }

  const maxAltitude = MAP_REGISTRY[mapId]?.world.maxAltitude ?? 7500;

  if (pos.y > maxAltitude) {
    pos.y = maxAltitude;
    vel.y = Math.min(0, vel.y);
  }

  if (dm.hasFire) {
    dm.fuelTank = Math.max(0, dm.fuelTank - dt * 0.04);
    dm.fuselage = Math.max(0, dm.fuselage - dt * 0.03);
    dm.engine = Math.max(0, dm.engine - dt * 0.02);

    if (speedKmph > 450 && Math.random() < 0.1 * dt) {
      dm.hasFire = false;
    }
  }

  // Keep DestructibleComponent dead-flag consistent with fuselage health
  destr.isDead = dm.fuselage <= 0.05;

  phys.x = pos.x;
  phys.y = pos.y;
  phys.z = pos.z;
  phys.vx = vel.x;
  phys.vy = vel.y;
  phys.vz = vel.z;
}

/**
 * Perform a component-level hit damage raycast/bounding check.
 *
 * hitSpot uses aircraft local axes:
 * +Z = nose / engine
 * -Z = tail
 * +X = right wing
 * -X = left wing
 * +Y = canopy / top
 */
export function applyComponentDamage(
  pilot: Pilot,
  damage: number,
  bulletType: string,
  hitSpot: Vector3 | string
) {
  const zone = typeof hitSpot === "string" ? hitSpot : determineHitZone(hitSpot);
  const dm = destructible(pilot.entity).damageModel!;

  const baseScale = 100 / pilot.specs.durability;
  const scaledDamageMultiplier = baseScale * 0.12;
  const damageValue = damage * scaledDamageMultiplier;

  switch (zone) {
    case "engine":
      dm.engine = Math.max(0, dm.engine - damageValue);
      if (dm.engine < 0.4 && Math.random() < 0.2) dm.hasFire = true;
      break;
    case "leftWing":
      dm.leftWing = Math.max(0, dm.leftWing - damageValue);
      break;
    case "rightWing":
      dm.rightWing = Math.max(0, dm.rightWing - damageValue);
      break;
    case "tail":
      dm.tail = Math.max(0, dm.tail - damageValue * 0.9);
      break;
    case "cockpit":
      dm.cockpit = Math.max(0.1, dm.cockpit - damageValue * 0.85);
      if (Math.random() < 0.05) dm.hasOilLeak = true;
      break;
    case "fuelTank":
      dm.fuelTank = Math.max(0, dm.fuelTank - damageValue);
      if (dm.fuelTank < 0.5 && Math.random() < 0.18) dm.hasFire = true;
      break;
    default:
      dm.fuselage = Math.max(0, dm.fuselage - damageValue * 0.7);
      break;
  }
}

function determineHitZone(
  spot: Vector3
): "engine" | "leftWing" | "rightWing" | "tail" | "cockpit" | "fuelTank" | "fuselage" {
  if (spot.z > 0.4) {
    return "engine";
  }

  if (spot.z < -0.5) {
    return "tail";
  }

  if (Math.abs(spot.x) > 0.28) {
    return spot.x < 0 ? "leftWing" : "rightWing";
  }

  if (spot.y > 0.22 && spot.z > 0.0 && spot.z < 0.3) {
    return "cockpit";
  }

  if (spot.y < -0.1 && spot.z < 0.1 && spot.z > -0.3) {
    return "fuelTank";
  }

  return "fuselage";
}

export class FlightPhysicsEngine {
  public static update = updateFlightPhysics;
  public static applyDamage = applyComponentDamage;
}
