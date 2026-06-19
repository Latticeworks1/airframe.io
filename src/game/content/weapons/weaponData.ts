/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeaponType, WeaponSpecs } from "../../../types";

export const WEAPON_SPECS_MAP: Record<WeaponType, WeaponSpecs> = {
  [WeaponType.MG_7_7]: {
    type: WeaponType.MG_7_7,
    damage: 6,
    fireRate: 16,
    muzzleVelocity: 820,
    ammoCapacity: 1200,
    burstCount: 3,
    dispersion: 0.015,
    soundType: "fast"
  },
  [WeaponType.HMG_12_7]: {
    type: WeaponType.HMG_12_7,
    damage: 13,
    fireRate: 11,
    muzzleVelocity: 880,
    ammoCapacity: 600,
    burstCount: 2,
    dispersion: 0.01,
    soundType: "heavy"
  },
  [WeaponType.CANNON_20]: {
    type: WeaponType.CANNON_20,
    damage: 32,
    fireRate: 8,
    muzzleVelocity: 760,
    ammoCapacity: 240,
    burstCount: 1,
    dispersion: 0.008,
    soundType: "cannon_light"
  },
  [WeaponType.CANNON_30]: {
    type: WeaponType.CANNON_30,
    damage: 85,
    fireRate: 5,
    muzzleVelocity: 610,
    ammoCapacity: 90,
    burstCount: 1,
    dispersion: 0.012,
    soundType: "cannon_heavy"
  },
  [WeaponType.ROCKET]: {
    type: WeaponType.ROCKET,
    damage: 180,
    fireRate: 1.5,
    muzzleVelocity: 420,
    ammoCapacity: 12,
    burstCount: 1,
    dispersion: 0.02,
    soundType: "rocket"
  },
  [WeaponType.BOMB]: {
    type: WeaponType.BOMB,
    damage: 350,
    fireRate: 0.8,
    muzzleVelocity: 15,
    ammoCapacity: 4,
    burstCount: 1,
    dispersion: 0.03,
    soundType: "bomb"
  }
};
