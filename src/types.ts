/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3 } from "three";

export enum AircraftClass {
  Balanced = "Balanced",
  Turnfighter = "Turnfighter",
  EnergyFighter = "EnergyFighter",
  Attacker = "Attacker",
  HeavyFighter = "HeavyFighter",
}

export enum ControlMode {
  MouseAim = "Mouse Aim",
  MouseJoystick = "Mouse Joystick",
  KeyboardDirect = "Keyboard Direct",
}

export interface AircraftSpecs {
  id: string;
  name: string;
  class: AircraftClass;
  description: string;
  mass: number;               // kg
  maxThrust: number;          // N
  cd0: number;                // CDo — zero-lift drag coefficient (dimensionless)
  cl0: number;                // CL0 — lift at zero AoA from wing camber (dimensionless)
  clAlpha: number;            // CLα — lift curve slope, per degree (deg⁻¹)
  energyRetention: number;    // speed retention through maneuvers [0.85–0.99]
  stallSpeedKmph: number;
  structuralLimitSpeedKmph: number;
  turnBleed: number;
  climbRate: number;          // m/s at sea level
  maxFuelSeconds: number;
  weapons: WeaponType[];
  durability: number;
  wingArea: number;           // Sw, m²
  aspectRatio: number;        // AR
  oswaldEfficiency: number;   // e — Oswald span efficiency
  aileronBoost?: number;      // aileron area multiplier (default 1.0)
  color: string;
  secondaryColor: string;
  accentColor: string;
}

export enum WeaponType {
  MG_7_7 = "7.7mm MG",
  HMG_12_7 = "12.7mm HMG",
  CANNON_20 = "20mm Cannon",
  CANNON_30 = "30mm Cannon",
  ROCKET = "Rockets",
  BOMB = "Small Bombs",
}

export interface WeaponSpecs {
  type: WeaponType;
  damage: number;
  fireRate: number; // rounds per second
  muzzleVelocity: number; // m/s
  ammoCapacity: number;
  burstCount: number; // for visual tracer grouping
  dispersion: number; // angle variation
  soundType: string;
}

export enum AmmoBelt {
  Universal = "Universal",
  Tracer = "Tracer",
  ArmorPiercing = "Armor-Piercing",
  Incendiary = "Incendiary",
  Stealth = "Stealth",
}

export enum ModificationSlot {
  Engine = "Engine Tuning",
  Airframe = "Airframe Weight",
  Weapon = "Weapon Polishing",
}

export interface Modification {
  id: string;
  name: string;
  description: string;
  slot: ModificationSlot;
  effects: {
    maxThrust?: number;    // fractional change, e.g. +0.08
    mass?: number;         // fractional change
    cd0?: number;          // absolute delta to CDo
    rollRate?: number;
    durability?: number;
  };
}

export enum MatchMode {
  AirSupremacy = "Air Supremacy",
  GroundStrike = "Ground Strike",
  Intercept = "Intercept",
  DuelArena = "Duel Arena",
  EndlessFront = "Endless Front",
}

export enum GameMap {
  IslandChain = "Island Chain",
  DesertCanyon = "Desert Canyon",
  AlpineValley = "Alpine Valley",
  StormFront = "Storm Front",
}

export interface MapSpecs {
  id: GameMap;
  name: string;
  description: string;
  hasCarriers: boolean;
  hasCanyons: boolean;
  cloudDensity: number; // 0 to 1
  antiAirCount: number;
  groundTargetsCount: number;
  skyColor: string;
  fogColor: string;
  groundColor: string;
  hasThunder: boolean;
}

// 8 Hit zones per aircraft
export interface DamageModel {
  engine: number;       // 1.0 (fully working) to 0.0 (dead/on fire)
  leftWing: number;     // 1.0 to 0.0
  rightWing: number;    // 1.0 to 0.0
  tail: number;         // 1.0 to 0.0
  cockpit: number;      // 1.0 to 0.0 (pilot injured, red screen, blurry)
  fuelTank: number;     // 1.0 to 0.0 (leaking / catching fire)
  fuselage: number;     // 1.0 to 0.0 (center structure)
  hasFire: boolean;     // burns engine / fuel tank over time
  hasOilLeak: boolean;  // splatters on windshield
}

export interface KeyState {
  w: boolean;
  s: boolean;
  a: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
  b: boolean;
  f: boolean;
  g: boolean;
  shift: boolean;
  control: boolean;
  space: boolean;
  r: boolean;
  arrowUp: boolean;
  arrowDown: boolean;
  arrowLeft: boolean;
  arrowRight: boolean;
}

export interface InputEdges {
  flapsPressed: boolean;
  gearPressed: boolean;
  cameraPressed: boolean;
  resetPressed: boolean;
}

export interface InputFrame {
  held: KeyState;
  edges: InputEdges;
  mousePos: { x: number; y: number };
  mouseDelta: { x: number; y: number };
  rightMouse: boolean;
}

export interface FlightCommand {
  pitch: number;          // -1 nose down, +1 nose up
  roll: number;           // -1 left, +1 right
  yaw: number;            // -1 left, +1 right
  throttleDelta: number;  // -1 to +1
  boost: boolean;
  airbrake: boolean;
  primaryFire: boolean;
  secondaryFire: boolean;
  flaps: "up" | "combat" | "landing";
  gearDeployed: boolean;
}

export interface Pilot {
  id: string;
  name: string;
  isBot: boolean;
  team: 1 | 2;
  aircraftId: string;
  specs: AircraftSpecs;
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
  isStalling?: boolean;
  stallSeverity?: number;
  throttle: number; // 0 to 1
  engineTemperature: number; // 50 to 130 C
  damage: DamageModel;
  ammo: Record<WeaponType, number>;
  ammoBelt: AmmoBelt;
  modifications: string[]; // modification IDs
  score: number;
  kills: number;
  deaths: number;
  xpEarned: number;
  smoothedPitch?: number;
  smoothedRoll?: number;
  smoothedYaw?: number;
  physicsTime?: number;       // deterministic sim-time accumulator (seconds)
  physicsDebug?: {
    aoaDeg: number;
    sideslipDeg: number;
    mach: number;
    dynamicPressure: number;
    aeroTorqueX: number;
    aeroTorqueY: number;
    aeroTorqueZ: number;
    leftWingStalled: boolean;
    rightWingStalled: boolean;
    stallSeverity: number;
    elevatorDeflection: number;
    aileronDeflection: number;
    rudderDeflection: number;
  };
  pitchIntent?: number;
  rollIntent?: number;
  yawIntent?: number;
  elevatorDeflection?: number;
  aileronDeflection?: number;
  rudderDeflection?: number;
  flaps?: "up" | "combat" | "landing";
  gearDeployed?: boolean;
  airbrakeDeployed?: boolean;
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
      accuracy: number;     // 0 to 1
      aggression: number;   // 0 to 1
      avoidance: number;    // 0 to 1
    };
  };
}

export interface Projectile {
  id: string;
  ownerId: string;
  ownerTeam: 1 | 2;
  type: WeaponType;
  belt: AmmoBelt;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number; // remaining frames/seconds
  isRocket: boolean;
}

export interface GroundTarget {
  id: string;
  name: string;
  team: 1 | 2; // team it BELONGS to (fighters of other team attack it)
  type: "convoy" | "radar" | "anti-air" | "bunker" | "carrier";
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  isDead: boolean;
  fireCooldown?: number;
}

export interface SkyZone {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  owningTeam: 0 | 1 | 2; // 0 = neutral, 1 = team 1, 2 = team 2
  captureProgress: number; // -100 to 100
}

export interface BomberWave {
  id: string;
  team: 1 | 2;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  isDead: boolean;
  targetX: number;
  targetZ: number;
}

export interface UserProgression {
  totalXp: number;
  planeXp: Record<string, number>; // aircraftSpecs.id -> xp
  unlockedPlanes: string[]; // aircraftSpecs.id
  equippedMods: Record<string, string[]>; // aircraftSpecs.id -> modId[]
  selectedPlaneId: string;
  selectedBelt: AmmoBelt;
  nickname?: string;
  isLoggedIn?: boolean;
  rankCode?: string;
  invertMouseY?: boolean;
  invertMouseX?: boolean;
  controlMode?: ControlMode;
  stats: {
    battlesPlayed: number;
    kills: number;
    deaths: number;
    groundTargetsDestroyed: number;
    victories: number;
  };
  customizations: {
    skin: string;
    tracerColor: string;
    noseArt: string;
  };
}

export interface KillEvent {
  id: string;
  killerName: string;
  killerTeam: 1 | 2;
  victimName: string;
  victimTeam: 1 | 2;
  method: string;
  timestamp: number;
}

export interface LeadIndicatorInfo {
  x: number;      // target screen X % (0-100)
  y: number;      // target screen Y % (0-100)
  sX: number;     // lead dot screen X % (0-100)
  sY: number;     // lead dot screen Y % (0-100)
  name: string;   // pilot name
  distance: number; // distance in meters
}
