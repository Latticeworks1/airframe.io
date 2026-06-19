/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Pilot, AircraftSpecs } from "../types";

// AXIS CONTRACT (shared across all physics and rendering modules)
// Aircraft local +Z = nose / forward / guns
// Aircraft local +Y = up
// Aircraft local +X = right wing
export const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
export const LOCAL_UP = new THREE.Vector3(0, 1, 0);
export const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function closestPointOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): THREE.Vector3 {
  const ab = b.clone().sub(a);
  const denom = ab.lengthSq();
  if (denom < 1e-8) return a.clone();
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / denom, 0, 1);
  return a.clone().addScaledVector(ab, t);
}

export function getPlaneHitRadius(specs: AircraftSpecs): number {
  if (specs.class === "HeavyFighter") return 34;
  if (specs.class === "Attacker") return 36;
  if (specs.class === "Turnfighter") return 24;
  return 28;
}

export function getForwardVector(pilot: Pilot): THREE.Vector3 {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ")
  );
  return LOCAL_FORWARD.clone().applyQuaternion(q).normalize();
}

export function airDensityAtAltitude(altitudeMeters: number): number {
  return 1.225 * Math.exp(-Math.max(0, altitudeMeters) / 8500);
}

export function safeNormalize(v: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  if (v.lengthSq() < 1e-8) return fallback.clone();
  return v.normalize();
}
