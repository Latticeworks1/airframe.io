/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { falconMk2 } from "./falcon-mk2";
import { kite9 } from "./kite-9";
import { vulcan51 } from "./vulcan-51";
import { grizzlyA1 } from "./grizzly-a1";
import { twinwolf } from "./twinwolf";
import { AircraftDefinition } from "./types";

export const AIRCRAFT_DEFINITIONS: AircraftDefinition[] = [
  falconMk2,
  kite9,
  vulcan51,
  grizzlyA1,
  twinwolf
];

export const DEFAULT_AIRCRAFT = AIRCRAFT_DEFINITIONS.map(d => d.specs);
export const AIRCRAFT_SPECS = DEFAULT_AIRCRAFT;
