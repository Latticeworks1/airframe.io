/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Legacy backward-compatible facade for new src/game/content structure
import { DEFAULT_AIRCRAFT as REGISTRY_DEFAULT_AIRCRAFT } from "./content/aircraft/registry";
import { WEAPON_SPECS_MAP as REGISTRY_WEAPON_SPECS_MAP } from "./content/weapons/weaponData";
import { MODIFICATIONS as REGISTRY_MODIFICATIONS } from "./content/modifications/modificationData";

export const DEFAULT_AIRCRAFT = REGISTRY_DEFAULT_AIRCRAFT;
export const WEAPON_SPECS_MAP = REGISTRY_WEAPON_SPECS_MAP;
export const MODIFICATIONS = REGISTRY_MODIFICATIONS;
export { AIRCRAFT_DEFINITIONS } from "./content/aircraft/registry";
