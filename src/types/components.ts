/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component } from "./core";
import { DamageModel, WeaponType, AmmoBelt, FlightCommand, ControlMode } from "../types";

export interface PhysicalComponent extends Component {
  type: "physical";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  roll: number;
  yaw: number;
  avx?: number;
  avy?: number;
  avz?: number;
}

export interface LocomotiveComponent extends Component {
  type: "locomotive";
  movementType: "aerodynamic" | "ground" | "carrier" | "ballistic";
  mass?: number;
  maxThrust?: number;
  throttle: number; // 0 to 1
  engineTemperature?: number;
  isStalling?: boolean;
  stallSeverity?: number;
  flaps?: "up" | "combat" | "landing";
  gearDeployed?: boolean;
  airbrakeDeployed?: boolean;
}

export interface DestructibleComponent extends Component {
  type: "destructible";
  hp: number;
  maxHp: number;
  isDead: boolean;
  damageModel?: DamageModel; // for complex plane damage
  fireCooldown?: number;     // for ground defense
}

export interface WeaponizedComponent extends Component {
  type: "weaponized";
  weapons: WeaponType[];
  ammo: Record<WeaponType, number>;
  ammoBelt: AmmoBelt;
  modifications: string[];
  cooldowns: Record<WeaponType, number>;
}

export interface SensoryComponent extends Component {
  type: "sensory";
  radarRange: number;
  lockedTargetId: string | null;
}

export interface ControlComponent extends Component {
  type: "control";
  controllerType: "human" | "bot-air" | "bot-ground" | "scripted";
  smoothedPitch?: number;
  smoothedRoll?: number;
  smoothedYaw?: number;
  elevatorDeflection?: number;
  aileronDeflection?: number;
  rudderDeflection?: number;
  pitchIntent?: number;
  rollIntent?: number;
  yawIntent?: number;
  lastCommand?: FlightCommand;
  controlMode?: ControlMode;
  invertMouseY?: boolean;
  invertMouseX?: boolean;
  aiState?: {
    behavior: "patrol" | "dogfight" | "pursuit" | "evade" | "bombing" | "rtb";
    targetId: string | null;
    timer: number;
    destinationX: number;
    destinationY: number;
    destinationZ: number;
    skills: {
      accuracy: number;
      aggression: number;
      avoidance: number;
    };
  };
}

export interface VisualComponent extends Component {
  type: "visual";
  meshType: "voxel" | "procedural" | "primitive" | "sprite";
  assetId: string;
  color: string;
  secondaryColor?: string;
  accentColor?: string;
}

// --- Environment components (Phase 5: Map/Atmosphere) ---

export interface TerrainComponent extends Component {
  type: "terrain";
  mapId: string;
  worldRadius: number;
  maxAltitude: number;
  hasWater: boolean;
}

export interface AtmosphereComponent extends Component {
  type: "atmosphere";
  fogNear: number;
  fogFar: number;
  fogColor: unknown; // ColorRepresentation from Three.js
  cloudDensity: number;
  sunElevationDeg: number;
}

import type { Entity } from "./core";

export function physical(e: Entity): PhysicalComponent {
  return e.components.get("physical") as PhysicalComponent;
}
export function locomotive(e: Entity): LocomotiveComponent {
  return e.components.get("locomotive") as LocomotiveComponent;
}
export function destructible(e: Entity): DestructibleComponent {
  return e.components.get("destructible") as DestructibleComponent;
}
export function weaponized(e: Entity): WeaponizedComponent {
  return e.components.get("weaponized") as WeaponizedComponent;
}
export function sensory(e: Entity): SensoryComponent {
  return e.components.get("sensory") as SensoryComponent;
}
export function control(e: Entity): ControlComponent {
  return e.components.get("control") as ControlComponent;
}
export function visual(e: Entity): VisualComponent {
  return e.components.get("visual") as VisualComponent;
}
export function terrain(e: Entity): TerrainComponent {
  return e.components.get("terrain") as TerrainComponent;
}
export function atmosphere(e: Entity): AtmosphereComponent {
  return e.components.get("atmosphere") as AtmosphereComponent;
}
