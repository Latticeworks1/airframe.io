/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { Pilot, FlightCommand, AircraftSpecs, GameMap } from "../types";
import { AerodynamicsEngine } from "./aeroSurfaceModel";
import { getTerrainHeight } from "./terrainModel";
import { LOCAL_FORWARD, LOCAL_UP, LOCAL_RIGHT, airDensityAtAltitude } from "./math";
import { MAP_DEFINITIONS } from "./content/maps/mapDefinitions";

const G = 9.81;
const SEA_LEVEL_AIR_DENSITY = 1.225;

function getAircraftQuaternion(pitch: number, yaw: number, roll: number) {
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, "YXZ"));
}

function getAircraftBasis(pitch: number, yaw: number, roll: number) {
  const q = getAircraftQuaternion(pitch, yaw, roll);

  return {
    q,
    forward: LOCAL_FORWARD.clone().applyQuaternion(q).normalize(),
    up: LOCAL_UP.clone().applyQuaternion(q).normalize(),
    right: LOCAL_RIGHT.clone().applyQuaternion(q).normalize()
  };
}

function wrapPi(v: number) {
  return MathUtils.euclideanModulo(v + Math.PI, Math.PI * 2) - Math.PI;
}

function approach(current: number, target: number, rate: number, dt: number): number {
  if (current < target) return Math.min(current + rate * dt, target);
  if (current > target) return Math.max(current - rate * dt, target);
  return current;
}

function getAoA(localVelocity: Vector3) {
  // Aircraft local +Z is nose-forward. Positive AoA means nose above flight path.
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
    if (id === "fuel-heavy") {
      modified.maxThrust *= 1.12;
      modified.durability *= 0.95;
    } else if (id === "engine-polishing") {
      modified.cd0 *= 0.94;
    } else if (id === "stripped-frame") {
      modified.mass *= 0.92;
      modified.durability *= 0.9;
    } else if (id === "reinforced-skin") {
      modified.durability *= 1.2;
      modified.mass *= 1.05;
      modified.cd0 *= 1.02;
    } else if (id === "polished-guns") {
      modified.aileronBoost = Math.min(1.5, (modified.aileronBoost ?? 1.0) * 1.10);
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
  mapId: GameMap = GameMap.IslandChain
) {
  if (dt <= 0) return;
  dt = Math.min(dt, 0.05);

  pilot.physicsTime = (pilot.physicsTime ?? 0) + dt;
  const simTime = pilot.physicsTime;

  const specs = applyModifications(pilot.specs, pilot.modifications);

  const wingArea = requireSpecInRange(specs, "wingArea", 8, 70);
  const aspectRatio = requireSpecInRange(specs, "aspectRatio", 3, 12);
  const oswaldEfficiency = requireSpecInRange(
    specs,
    "oswaldEfficiency",
    0.55,
    0.95
  );

  const pos = new Vector3(pilot.x, pilot.y, pilot.z);
  const vel = new Vector3(pilot.vx, pilot.vy, pilot.vz);

  let speed = vel.length();
  let speedKmph = speed * 3.6;

  let { q, forward, up, right } = getAircraftBasis(
    pilot.pitch,
    pilot.yaw,
    pilot.roll
  );

  let pitchInput = command.pitch;
  let rollInput = command.roll;
  let yawInput = command.yaw;
  const throttleInput = command.throttleDelta;
  const boost = command.boost;
  const airbrake = command.airbrake;

  pilot.throttle = MathUtils.clamp(
    pilot.throttle + throttleInput * dt * 0.65,
    0.0,
    boost ? 1.1 : 1.0
  );

  if (boost) {
    pilot.throttle = Math.min(1.1, pilot.throttle + dt * 0.35);
  }

  const targetTemp = 50 + pilot.throttle * 70;
  pilot.engineTemperature +=
    (targetTemp - pilot.engineTemperature) * dt * 0.05;

  const engineHealth = pilot.damage.engine;
  const leftWingHealth = pilot.damage.leftWing;
  const rightWingHealth = pilot.damage.rightWing;
  const tailHealth = pilot.damage.tail;
  const cockpitHealth = pilot.damage.cockpit;
  const wingHealth = (leftWingHealth + rightWingHealth) / 2;
  const controlFactor = 0.3 + 0.7 * cockpitHealth;

  // Append roll asymmetry from wing damage
  rollInput -= (rightWingHealth - leftWingHealth) * 0.3;

  pilot.airbrakeDeployed = command.airbrake;
  pilot.flaps = command.flaps;
  pilot.gearDeployed = command.gearDeployed;

  // Physical separation: Raw input -> Pilot Intent -> Actuator Deflection rate limit
  pilot.pitchIntent = approach(pilot.pitchIntent ?? 0, pitchInput, 8.0, dt);
  pilot.rollIntent = approach(pilot.rollIntent ?? 0, rollInput, 10.0, dt);
  pilot.yawIntent = approach(pilot.yawIntent ?? 0, yawInput, 5.0, dt);

  // Surfaces actuator physical lag
  pilot.elevatorDeflection = approach(pilot.elevatorDeflection ?? 0, pilot.pitchIntent, 12.0, dt);
  pilot.aileronDeflection = approach(pilot.aileronDeflection ?? 0, pilot.rollIntent, 14.0, dt);
  pilot.rudderDeflection = approach(pilot.rudderDeflection ?? 0, pilot.yawIntent, 8.0, dt);

  // Apply continuous smoothed surface deflections downstream
  pitchInput = pilot.elevatorDeflection;
  rollInput = pilot.aileronDeflection;
  yawInput = pilot.rudderDeflection;

  // Damage and stall scale the control surface deflections sent to the aero model.
  // Cockpit damage reduces pilot authority over all axes; stall collapses elevator grip.
  const stallSev = pilot.stallSeverity ?? 0;
  const stallInputScale = MathUtils.lerp(1.0, 0.40, MathUtils.clamp(stallSev, 0, 1));
  const pitchScale = (0.3 + 0.7 * tailHealth) * controlFactor * stallInputScale;
  const rollScale  = (0.4 + 0.6 * wingHealth) * controlFactor;
  const yawScale   = (0.3 + 0.7 * tailHealth) * controlFactor;

  // Auto turn coordination — couple roll into rudder so banked turns stay coordinated.
  const autoRudder = rollInput * 0.35;

  // Active Angular Velocity — persistent rigid-body state (X = Pitch, Y = Yaw, Z = Roll)
  const localAngularVelocity = new Vector3(
    pilot.avx ?? 0,
    pilot.avy ?? 0,
    pilot.avz ?? 0
  );

  const terrainInfo = getTerrainHeight(pos.x, pos.z, mapId);
  const altitudeAGL = Math.max(0, pos.y - terrainInfo.height);

  // Surface deflections sent to aero — damage and stall scale them directly here
  // so control authority loss is physically expressed as reduced surface angle, not
  // as a post-hoc scalar on an arcade rate target.
  const aero = AerodynamicsEngine.computeForces({
    pilot,
    specs,
    controls: {
      pitchInput: pitchInput * pitchScale,
      rollInput:  rollInput  * rollScale,
      yawInput:   (yawInput + autoRudder) * yawScale,
      airbrake: !!airbrake
    },
    localAngularVelocity,
    altitudeAGL
  });

  const wind = new Vector3(0, 0, 0);
  const airVelocityWorld = vel.clone().sub(wind);
  const airspeed = airVelocityWorld.length();
  const airspeedKmph = airspeed * 3.6;

  const initialInvQ = q.clone().invert();
  const initialLocalVelocity = airVelocityWorld.clone().applyQuaternion(initialInvQ);

  const initialAlpha = getAoA(initialLocalVelocity);
  const initialAlphaDeg = Math.abs(MathUtils.radToDeg(initialAlpha));

  const localVelSpeed = initialLocalVelocity.length();

  // Symmetric stall: both wings simultaneously exceeding critical AoA due to high pitch —
  // triggers full stall effects (buffet, authority loss, recovery torque).
  // Asymmetric: one wing locally stalled (e.g. roll-rate-induced tip stall at moderate
  // pitch AoA) — produces directed wing drop only, no elevator authority collapse.
  const symmetricStall = aero.leftWingStalled && aero.rightWingStalled;
  const asymmetricStall = aero.leftWingStalled !== aero.rightWingStalled;
  const stalledWingSide = (aero.rightWingStalled && !aero.leftWingStalled) ? 1 : -1;
  const isStallingByAoA = symmetricStall;
  const isCurrentlyStalled = isStallingByAoA || (airspeedKmph < specs.stallSpeedKmph);

  // Euler's rigid-body moment equations: τ = I·dω/dt + ω×(I·ω).
  // In principal axes (Ixz≈0 for symmetric aircraft), for axes 1=X(pitch), 2=Y(yaw), 3=Z(roll):
  //   dω₁/dt = (M₁ - (I₃-I₂)·ω₂·ω₃) / I₁
  //   dω₂/dt = (M₂ - (I₁-I₃)·ω₃·ω₁) / I₂
  //   dω₃/dt = (M₃ - (I₂-I₁)·ω₁·ω₂) / I₃
  const inertiaVal = AerodynamicsEngine.estimateInertia(specs);
  const Ip = inertiaVal.x; // pitch inertia (about X, wing-to-wing axis)
  const Iy = inertiaVal.y; // yaw inertia   (about Y, vertical axis)
  const Ir = inertiaVal.z; // roll inertia  (about Z, nose axis)
  const avq = localAngularVelocity.x; // pitch rate (ω₁)
  const avr = localAngularVelocity.y; // yaw rate   (ω₂)
  const avp = localAngularVelocity.z; // roll rate  (ω₃)
  // d(pitch)/dt = (torque_x - (Ir-Iy)·avr·avp) / Ip
  localAngularVelocity.x += (aero.torque.x - avr * avp * (Ir - Iy)) / Math.max(1, Ip) * dt;
  // d(yaw)/dt   = (torque_y - (Ip-Ir)·avp·avq) / Iy
  localAngularVelocity.y += (aero.torque.y - avp * avq * (Ip - Ir)) / Math.max(1, Iy) * dt;
  // d(roll)/dt  = (torque_z - (Iy-Ip)·avq·avr) / Ir
  localAngularVelocity.z += (aero.torque.z - avq * avr * (Iy - Ip)) / Math.max(1, Ir) * dt;

  const maxRateLimit = 6.0;
  localAngularVelocity.x = MathUtils.clamp(localAngularVelocity.x, -maxRateLimit, maxRateLimit);
  localAngularVelocity.y = MathUtils.clamp(localAngularVelocity.y, -maxRateLimit, maxRateLimit);
  localAngularVelocity.z = MathUtils.clamp(localAngularVelocity.z, -maxRateLimit, maxRateLimit);

  // 3. Inject realistic Stall Buffeting & Wing Drop instability
  let stallBuffetRoll = 0;
  let stallBuffetPitch = 0;
  let stallBuffetYaw = 0;

  if (isCurrentlyStalled) {
    pilot.isStalling = true;
    pilot.stallSeverity = MathUtils.clamp(
      isStallingByAoA
        ? (initialAlphaDeg - 17.5) / 10
        : (specs.stallSpeedKmph * 1.05 - airspeedKmph) / (specs.stallSpeedKmph * 0.35),
      0.1,
      1.0
    );

    // High frequency buffeting (structural shaking)
    const shakeTime = simTime;
    const buffetFreq = 25.0; // 25 Hz structural flutter
    const buffetAmp = pilot.stallSeverity * 0.32;
    stallBuffetRoll = Math.sin(shakeTime * (buffetFreq + 1.2)) * buffetAmp;       // Z axis
    stallBuffetPitch = Math.cos(shakeTime * buffetFreq) * buffetAmp * 0.75;       // X axis
    stallBuffetYaw = Math.sin(shakeTime * (buffetFreq - 4.0)) * buffetAmp * 0.22; // Y axis

    // Symmetric wing drop and static-margin recovery.
    if (airspeedKmph > 18) {
      const spinRate = localAngularVelocity.length();
      const spinSaturation = Math.max(0, 1 - spinRate / 2.5);
      const dropFreq = simTime * 1.5;
      const wingDropAccel = pilot.stallSeverity * 1.2 * spinSaturation;
      localAngularVelocity.z += Math.sin(dropFreq) * wingDropAccel * dt;
      localAngularVelocity.y += Math.cos(dropFreq + 1.1) * wingDropAccel * 0.3 * dt;

      if (localVelSpeed > 5) {
        const velDirLocal = initialLocalVelocity.clone().normalize();
        const rotAxis = new Vector3(0, 0, 1).cross(velDirLocal);
        const sinA = rotAxis.length();
        if (sinA > 0.02) {
          rotAxis.divideScalar(sinA);
          const recoveryRate = 2.0 * pilot.stallSeverity;
          localAngularVelocity.x += rotAxis.x * recoveryRate * dt;
          localAngularVelocity.y += rotAxis.y * recoveryRate * dt;
          localAngularVelocity.z += rotAxis.z * recoveryRate * dt;
        }
      }
    }
  } else {
    pilot.isStalling = false;
    pilot.stallSeverity = 0;
  }

  // Asymmetric stall: one wing stalled while the other is attached — produces a
  // directed roll toward the stalled side without triggering full-stall authority loss.
  if (asymmetricStall && !isCurrentlyStalled && airspeedKmph > 18) {
    const spinRate = localAngularVelocity.length();
    const spinSaturation = Math.max(0, 1 - spinRate / 2.5);
    localAngularVelocity.z += stalledWingSide * 0.8 * spinSaturation * dt;
  }

  // Capture rates after stall torques have been applied so wing-drop and
  // static-margin recovery contribute to both orientation integration and
  // the angular velocity state carried into the next tick.
  const finalPitchRate = localAngularVelocity.x;
  const finalYawRate   = localAngularVelocity.y;
  const finalRollRate  = localAngularVelocity.z;

  // Combine integrated rates, inputs and buffeting components
  const totalPitchRate = finalPitchRate + stallBuffetPitch; // Pitch is X
  const totalYawRate = finalYawRate + stallBuffetYaw;       // Yaw is Y
  const totalRollRate = finalRollRate + stallBuffetRoll;     // Roll is Z

  // 4. One-Shot Quaternion Integration to perfectly evolve attitude without Euler locks
  const qCurrent = getAircraftQuaternion(pilot.pitch, pilot.yaw, pilot.roll);
  const omega = new Vector3(totalPitchRate, totalYawRate, totalRollRate);
  const omegaMag = omega.length();
  if (omegaMag > 1e-8) {
    const axis = omega.clone().normalize();
    const dq = new Quaternion().setFromAxisAngle(axis, omegaMag * dt);
    qCurrent.multiply(dq);
    qCurrent.normalize();
  }

  const nextEuler = new Euler().setFromQuaternion(qCurrent, "YXZ");
  pilot.pitch = nextEuler.x;
  pilot.yaw = wrapPi(nextEuler.y);
  pilot.roll = wrapPi(nextEuler.z);

  // Takeoff & rollout attitude stabilization: prevent wings dipping or nose diving below takeoff speed on ground
  const terrainCheckForAttitude = getTerrainHeight(pos.y > 0 ? pos.x : pos.x, pos.y > 0 ? pos.z : pos.z, mapId);
  if (pos.y <= terrainCheckForAttitude.height + 1.2 && speed * 3.6 < 130) {
    pilot.pitch = MathUtils.clamp(pilot.pitch, -0.01, 0.05); // slight positive nose lift permitted, no tuck or extreme pitch
    pilot.roll = 0; // maintain wings level on takeoff run
  }

  // Store angular rates back into the pilot's kinematic registers
  pilot.avx = finalPitchRate; // X is pitch
  pilot.avy = finalYawRate;   // Y is yaw
  pilot.avz = finalRollRate;  // Z is roll

  // Recalculate 3D basis vectors
  ({ q, forward, up, right } = getAircraftBasis(
    pilot.pitch,
    pilot.yaw,
    pilot.roll
  ));

  // Compute aerodynamic forces using updated orientation frame
  speed = vel.length();
  speedKmph = speed * 3.6;

  const rho = airDensityAtAltitude(pos.y);

  // 1. Compute engine thrust and apply altitude power dropoff
  const altitudePower = MathUtils.clamp(
    rho / SEA_LEVEL_AIR_DENSITY,
    0.35,
    1.0
  );

  const throttle01 = MathUtils.clamp(pilot.throttle, 0, 1.0);
  const thrustBoost = boost ? 1.08 : 1.0;

  const actualThrust =
    specs.maxThrust *
    throttle01 *
    engineHealth *
    altitudePower *
    thrustBoost;

  const thrustForce = forward.clone().multiplyScalar(actualThrust);
  const gravityForce = new Vector3(0, -specs.mass * G, 0);

  // Fuselage body drag: at high AoA or sideslip the fuselage side presents as a bluff body,
  // creating drag that opposes any velocity component perpendicular to the nose axis (+Z).
  // This is what prevents spin divergence in the real aircraft — the surface aero model only
  // covers wings and control surfaces, not the fuselage cross-section.
  const invQ = q.clone().invert();
  const localVelForFus = vel.clone().applyQuaternion(invQ);
  const transLocalVel = new Vector3(localVelForFus.x, localVelForFus.y, 0);
  const transSpeed = transLocalVel.length();
  let fuselageDragForce = new Vector3();
  if (transSpeed > 0.5) {
    const transDir = transLocalVel.clone().normalize().applyQuaternion(q);
    const fusDragMag = 0.5 * rho * transSpeed * transSpeed * specs.wingArea * 0.22;
    fuselageDragForce = transDir.multiplyScalar(-fusDragMag);
  }

  // 2. Sum physical forces (Thrust + Gravity + surface aero forces + fuselage body drag)
  const totalForce = new Vector3()
    .add(thrustForce)
    .add(gravityForce)
    .add(aero.force)
    .add(fuselageDragForce);

  const accel = totalForce.divideScalar(specs.mass);
  vel.addScaledVector(accel, dt);

  if (speedKmph > specs.structuralLimitSpeedKmph) {
    const excess = speedKmph - specs.structuralLimitSpeedKmph;

    if (excess > 10) {
      const severity = Math.min(1, excess / 180);
      pilot.damage.leftWing = Math.max(
        0,
        pilot.damage.leftWing - dt * 0.05 * severity
      );
      pilot.damage.rightWing = Math.max(
        0,
        pilot.damage.rightWing - dt * 0.05 * severity
      );
      pilot.damage.fuselage = Math.max(
        0.1,
        pilot.damage.fuselage - dt * 0.02 * severity
      );
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
      if (pilot.gearDeployed && sinkRate < 4.0 && speedKmph < 185) {
        // High damage rollout over rough fields
        pilot.damage.fuselage = Math.max(0.15, pilot.damage.fuselage - dt * 0.12);
        const rolloutSpeed = Math.max(0, vel.length() - dt * 45.0);
        vel.copy(forward).multiplyScalar(rolloutSpeed);
        if (rolloutSpeed * 3.6 < 5 && pilot.throttle < 0.1) vel.set(0, 0, 0);
      } else {
        // Off-airfield high speed crash
        pilot.damage.fuselage = 0;
        pilot.damage.engine = 0;
      }
    } else {
      // Landing on actual airfield runway
      if (pilot.gearDeployed) {
        if (sinkRate >= 8.5) {
          // Instant high impact crash
          pilot.damage.fuselage = 0;
          pilot.damage.engine = 0;
        } else if (sinkRate >= 4.5) {
          // Gear collapse / hard landing (damages engine & collapses gear!)
          pilot.damage.fuselage = Math.max(0.1, pilot.damage.fuselage - 0.45);
          pilot.gearDeployed = false;
          pilot.damage.engine = Math.max(0.0, pilot.damage.engine - 0.25);
          // Friction rollout as a belly slide
          const rolloutSpeed = Math.max(0, vel.length() - dt * 65.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && pilot.throttle < 0.1) vel.set(0, 0, 0);
        } else {
          // Clean gear landing with standard airfield rollout
          const rolloutSpeed = Math.max(0, vel.length() - dt * 14.5);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && pilot.throttle < 0.1) vel.set(0, 0, 0);
        }
      } else {
        // Belly slide (Gear-Up Landing on runway)
        if (sinkRate >= 5.5) {
          // Fatal slide crash
          pilot.damage.fuselage = 0;
          pilot.damage.engine = 0;
        } else if (sinkRate >= 2.8) {
          // Rough belly slide
          pilot.damage.fuselage = Math.max(0.1, pilot.damage.fuselage - 0.55);
          pilot.damage.engine = 0.0; // Engine failure
          const rolloutSpeed = Math.max(0, vel.length() - dt * 55.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && pilot.throttle < 0.1) vel.set(0, 0, 0);
        } else {
          // Gentle belly slide
          pilot.damage.fuselage = Math.max(0.15, pilot.damage.fuselage - 0.22);
          pilot.damage.engine = Math.max(0.0, pilot.damage.engine - 0.4);
          const rolloutSpeed = Math.max(0, vel.length() - dt * 42.0);
          vel.copy(forward).multiplyScalar(rolloutSpeed);
          if (rolloutSpeed * 3.6 < 5 && pilot.throttle < 0.1) vel.set(0, 0, 0);
        }
      }
    }
  }

  const maxAltitude = MAP_DEFINITIONS[mapId].world.maxAltitude;

  if (pos.y > maxAltitude) {
    pos.y = maxAltitude;
    vel.y = Math.min(0, vel.y);
  }

  if (pilot.damage.hasFire) {
    pilot.damage.fuelTank = Math.max(0, pilot.damage.fuelTank - dt * 0.04);
    pilot.damage.fuselage = Math.max(0, pilot.damage.fuselage - dt * 0.03);
    pilot.damage.engine = Math.max(0, pilot.damage.engine - dt * 0.02);

    if (speedKmph > 450 && Math.random() < 0.1 * dt) {
      pilot.damage.hasFire = false;
    }
  }

  pilot.physicsDebug = {
    aoaDeg:            aero.aoaDeg,
    sideslipDeg:       aero.sideslipDeg,
    mach:              aero.mach,
    dynamicPressure:   aero.dynamicPressure,
    aeroTorqueX:       aero.torque.x,
    aeroTorqueY:       aero.torque.y,
    aeroTorqueZ:       aero.torque.z,
    leftWingStalled:   aero.leftWingStalled,
    rightWingStalled:  aero.rightWingStalled,
    stallSeverity:     pilot.stallSeverity ?? 0,
    elevatorDeflection: pilot.elevatorDeflection ?? 0,
    aileronDeflection:  pilot.aileronDeflection ?? 0,
    rudderDeflection:   pilot.rudderDeflection ?? 0,
  };

  pilot.x = pos.x;
  pilot.y = pos.y;
  pilot.z = pos.z;
  pilot.vx = vel.x;
  pilot.vy = vel.y;
  pilot.vz = vel.z;
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
  hitSpot: Vector3
) {
  const zone = determineHitZone(hitSpot);

  const baseScale = 100 / pilot.specs.durability;
  const scaledDamageMultiplier = baseScale * 0.12;
  const damageValue = damage * scaledDamageMultiplier;

  switch (zone) {
    case "engine":
      pilot.damage.engine = Math.max(0, pilot.damage.engine - damageValue);
      if (pilot.damage.engine < 0.4 && Math.random() < 0.2) {
        pilot.damage.hasFire = true;
      }
      break;

    case "leftWing":
      pilot.damage.leftWing = Math.max(0, pilot.damage.leftWing - damageValue);
      break;

    case "rightWing":
      pilot.damage.rightWing = Math.max(0, pilot.damage.rightWing - damageValue);
      break;

    case "tail":
      pilot.damage.tail = Math.max(0, pilot.damage.tail - damageValue * 0.9);
      break;

    case "cockpit":
      pilot.damage.cockpit = Math.max(
        0.1,
        pilot.damage.cockpit - damageValue * 0.85
      );
      if (Math.random() < 0.05) {
        pilot.damage.hasOilLeak = true;
      }
      break;

    case "fuelTank":
      pilot.damage.fuelTank = Math.max(0, pilot.damage.fuelTank - damageValue);
      if (pilot.damage.fuelTank < 0.5 && Math.random() < 0.18) {
        pilot.damage.hasFire = true;
      }
      break;

    default:
      pilot.damage.fuselage = Math.max(
        0,
        pilot.damage.fuselage - damageValue * 0.7
      );
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