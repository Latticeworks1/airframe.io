/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AircraftSpecs } from "../../../types";
import { BlockPrimitiveDef } from "../primitives/primitiveTypes";

export interface AircraftRenderDef {
  id: string;
  materials: Record<string, string>;
  blocks: BlockPrimitiveDef[];
  camera: {
    cockpitEye: [number, number, number];
    firstPersonFov?: number;
    hiddenBlockIds?: string[];
  };
}

export interface AeroSpecs {
  leftWingPos: { x: number; y: number; z: number };
  rightWingPos: { x: number; y: number; z: number };
  leftAileronPos: { x: number; y: number; z: number };
  rightAileronPos: { x: number; y: number; z: number };
  elevatorPos: { x: number; y: number; z: number };
  rudderPos: { x: number; y: number; z: number };
}

export interface HardpointSpecs {
  positions: { x: number; y: number; z: number }[];
  rocketPositions?: { x: number; y: number; z: number }[];
  bombPositions?: { x: number; y: number; z: number }[];
}

export interface DamageZoneSpecs {
  engineVolume: { min: number[]; max: number[] };
  cockpitVolume: { min: number[]; max: number[] };
  fuelTankVolume: { min: number[]; max: number[] };
}

export interface AircraftDefinition {
  specs: AircraftSpecs;
  render: AircraftRenderDef;
  aero: AeroSpecs;
  hardpoints: HardpointSpecs;
  damage: DamageZoneSpecs;
}
