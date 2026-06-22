/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


import { Entity } from "./types/core";
import {
  PhysicalComponent,
  LocomotiveComponent,
  DestructibleComponent,
  WeaponizedComponent,
  SensoryComponent,
  ControlComponent,
  VisualComponent
} from "./types/components";

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
  pitchRateDegPerSec?: number;
  rollRateDegPerSec?: number;
  yawRateDegPerSec?: number;
  radarRange?: number;        // lead-indicator lock range in world units (default 4500)
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
    damage?: number;       // fractional change
    dispersion?: number;   // fractional change
  };
}

export enum MatchMode {
  AirSupremacy = "Air Supremacy",
  GroundStrike = "Ground Strike",
  Intercept = "Intercept",
  DuelArena = "Duel Arena",
  EndlessFront = "Endless Front",
}

export { KnownMaps } from "./game/content/maps/mapTypes";
export type { MapId } from "./game/content/maps/mapTypes";

export type CameraMode = "third-person" | "first-person" | "bombsight";

export interface BombSightInfo {
  x: number;
  y: number;
  timeToImpact: number;
  impactX: number;
  impactZ: number;
  valid: boolean;
}

export type CampaignObjectiveType = "destroy-ground" | "destroy-air";

export interface CampaignMissionDefinition {
  id: string;
  order: number;
  name: string;
  operation: string;
  briefing: string;
  mapId: string;
  mode: MatchMode;
  aircraftId: string;
  objectiveType: CampaignObjectiveType;
  objectiveLabel: string;
  targetCount: number;
  timeLimitSeconds: number;
  xpReward: number;
  startOnGround?: boolean;
}

export interface CampaignMissionState {
  missionId: string;
  name: string;
  objectiveLabel: string;
  progress: number;
  targetCount: number;
  completed: boolean;
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

export class Pilot {
  public entity: Entity;
  public invulnerableTimer?: number;
  public physicsTime?: number;
  public physicsDebug?: {
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
  public netSnap?: {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    qx: number; qy: number; qz: number; qw: number;
    at: number;
  };

  constructor(data?: Partial<Pilot> | Entity) {
    if (data && "components" in data) {
      this.entity = data as Entity;
      return;
    }

    const pData = data as Partial<Pilot> | undefined;

    const entity: Entity = {
      id: pData?.id ?? "",
      components: new Map()
    };
    this.entity = entity;

    const physical: PhysicalComponent = {
      type: "physical",
      x: pData?.x ?? 0,
      y: pData?.y ?? 0,
      z: pData?.z ?? 0,
      vx: pData?.vx ?? 0,
      vy: pData?.vy ?? 0,
      vz: pData?.vz ?? 0,
      pitch: pData?.pitch ?? 0,
      roll: pData?.roll ?? 0,
      yaw: pData?.yaw ?? 0,
      avx: pData?.avx,
      avy: pData?.avy,
      avz: pData?.avz
    };
    entity.components.set("physical", physical);

    const locomotive: LocomotiveComponent = {
      type: "locomotive",
      movementType: "aerodynamic",
      mass: pData?.specs?.mass,
      maxThrust: pData?.specs?.maxThrust,
      throttle: pData?.throttle ?? 0.8,
      engineTemperature: pData?.engineTemperature ?? 75,
      isStalling: pData?.isStalling,
      stallSeverity: pData?.stallSeverity,
      flaps: pData?.flaps,
      gearDeployed: pData?.gearDeployed,
      airbrakeDeployed: pData?.airbrakeDeployed
    };
    entity.components.set("locomotive", locomotive);

    const destructible: DestructibleComponent = {
      type: "destructible",
      hp: 100,
      maxHp: 100,
      isDead: (pData?.damage?.fuselage ?? 1) <= 0.05,
      damageModel: pData?.damage
    };
    entity.components.set("destructible", destructible);

    const weaponized: WeaponizedComponent = {
      type: "weaponized",
      weapons: pData?.specs?.weapons ?? [],
      ammo: (pData?.ammo ?? {}) as Record<WeaponType, number>,
      ammoBelt: pData?.ammoBelt ?? AmmoBelt.Universal,
      modifications: pData?.modifications ?? [],
      cooldowns: ((pData as any)?.weaponCooldowns ?? {}) as Record<WeaponType, number>
    };
    entity.components.set("weaponized", weaponized);

    const sensory: SensoryComponent = {
      type: "sensory",
      radarRange: pData?.specs?.radarRange ?? 4500,
      lockedTargetId: pData?.aiState?.targetId ?? null
    };
    entity.components.set("sensory", sensory);

    const control: ControlComponent = {
      type: "control",
      controllerType: pData?.isBot ? "bot-air" : "human",
      smoothedPitch: pData?.smoothedPitch,
      smoothedRoll: pData?.smoothedRoll,
      smoothedYaw: pData?.smoothedYaw,
      elevatorDeflection: pData?.elevatorDeflection,
      aileronDeflection: pData?.aileronDeflection,
      rudderDeflection: pData?.rudderDeflection,
      pitchIntent: pData?.pitchIntent,
      rollIntent: pData?.rollIntent,
      yawIntent: pData?.yawIntent,
      lastCommand: pData?.lastCommand,
      controlMode: pData?.controlMode,
      invertMouseY: pData?.invertMouseY,
      invertMouseX: pData?.invertMouseX,
      aiState: pData?.aiState
    };
    entity.components.set("control", control);

    const visual: VisualComponent = {
      type: "visual",
      meshType: "voxel",
      assetId: pData?.aircraftId ?? "",
      color: pData?.specs?.color ?? "",
      secondaryColor: pData?.specs?.secondaryColor,
      accentColor: pData?.specs?.accentColor
    };
    entity.components.set("visual", visual);

    (entity as any).name = pData?.name ?? "";
    (entity as any).team = pData?.team ?? 1;
    (entity as any).score = pData?.score ?? 0;
    (entity as any).kills = pData?.kills ?? 0;
    (entity as any).deaths = pData?.deaths ?? 0;
    (entity as any).xpEarned = pData?.xpEarned ?? 0;
    (entity as any)._specs = pData?.specs ?? null;

    this.invulnerableTimer = pData?.invulnerableTimer ?? 0;
    this.physicsTime = pData?.physicsTime;
    this.physicsDebug = pData?.physicsDebug;
    this.netSnap = pData?.netSnap;
  }

  get id(): string { return this.entity.id; }
  set id(v: string) { this.entity.id = v; }

  get name(): string { return (this.entity as any).name; }
  set name(v: string) { (this.entity as any).name = v; }

  get isBot(): boolean {
    const c = this.entity.components.get("control") as ControlComponent;
    return c.controllerType !== "human";
  }
  set isBot(v: boolean) {
    const c = this.entity.components.get("control") as ControlComponent;
    c.controllerType = v ? "bot-air" : "human";
  }

  get team(): 1 | 2 { return (this.entity as any).team; }
  set team(v: 1 | 2) { (this.entity as any).team = v; }

  get aircraftId(): string {
    const v = this.entity.components.get("visual") as VisualComponent;
    return v.assetId;
  }
  set aircraftId(v: string) {
    const vis = this.entity.components.get("visual") as VisualComponent;
    vis.assetId = v;
  }

  get specs(): AircraftSpecs {
    return (this.entity as any)._specs as AircraftSpecs;
  }
  set specs(v: AircraftSpecs) {
    (this.entity as any)._specs = v;
    const vis = this.entity.components.get("visual") as VisualComponent;
    const loc = this.entity.components.get("locomotive") as LocomotiveComponent;
    const sen = this.entity.components.get("sensory") as SensoryComponent;
    const wep = this.entity.components.get("weaponized") as WeaponizedComponent;
    vis.assetId = v.id;
    vis.color = v.color;
    vis.secondaryColor = v.secondaryColor;
    vis.accentColor = v.accentColor;
    loc.mass = v.mass;
    loc.maxThrust = v.maxThrust;
    sen.radarRange = v.radarRange ?? 4500;
    wep.weapons = v.weapons;
  }

  get x(): number { return (this.entity.components.get("physical") as PhysicalComponent).x; }
  set x(v: number) { (this.entity.components.get("physical") as PhysicalComponent).x = v; }
  get y(): number { return (this.entity.components.get("physical") as PhysicalComponent).y; }
  set y(v: number) { (this.entity.components.get("physical") as PhysicalComponent).y = v; }
  get z(): number { return (this.entity.components.get("physical") as PhysicalComponent).z; }
  set z(v: number) { (this.entity.components.get("physical") as PhysicalComponent).z = v; }

  get vx(): number { return (this.entity.components.get("physical") as PhysicalComponent).vx; }
  set vx(v: number) { (this.entity.components.get("physical") as PhysicalComponent).vx = v; }
  get vy(): number { return (this.entity.components.get("physical") as PhysicalComponent).vy; }
  set vy(v: number) { (this.entity.components.get("physical") as PhysicalComponent).vy = v; }
  get vz(): number { return (this.entity.components.get("physical") as PhysicalComponent).vz; }
  set vz(v: number) { (this.entity.components.get("physical") as PhysicalComponent).vz = v; }

  get pitch(): number { return (this.entity.components.get("physical") as PhysicalComponent).pitch; }
  set pitch(v: number) { (this.entity.components.get("physical") as PhysicalComponent).pitch = v; }
  get roll(): number { return (this.entity.components.get("physical") as PhysicalComponent).roll; }
  set roll(v: number) { (this.entity.components.get("physical") as PhysicalComponent).roll = v; }
  get yaw(): number { return (this.entity.components.get("physical") as PhysicalComponent).yaw; }
  set yaw(v: number) { (this.entity.components.get("physical") as PhysicalComponent).yaw = v; }

  get avx(): number | undefined { return (this.entity.components.get("physical") as PhysicalComponent).avx; }
  set avx(v: number | undefined) { (this.entity.components.get("physical") as PhysicalComponent).avx = v; }
  get avy(): number | undefined { return (this.entity.components.get("physical") as PhysicalComponent).avy; }
  set avy(v: number | undefined) { (this.entity.components.get("physical") as PhysicalComponent).avy = v; }
  get avz(): number | undefined { return (this.entity.components.get("physical") as PhysicalComponent).avz; }
  set avz(v: number | undefined) { (this.entity.components.get("physical") as PhysicalComponent).avz = v; }

  get throttle(): number { return (this.entity.components.get("locomotive") as LocomotiveComponent).throttle; }
  set throttle(v: number) { (this.entity.components.get("locomotive") as LocomotiveComponent).throttle = v; }
  get engineTemperature(): number { return (this.entity.components.get("locomotive") as LocomotiveComponent).engineTemperature ?? 75; }
  set engineTemperature(v: number) { (this.entity.components.get("locomotive") as LocomotiveComponent).engineTemperature = v; }
  get isStalling(): boolean | undefined { return (this.entity.components.get("locomotive") as LocomotiveComponent).isStalling; }
  set isStalling(v: boolean | undefined) { (this.entity.components.get("locomotive") as LocomotiveComponent).isStalling = v; }
  get stallSeverity(): number | undefined { return (this.entity.components.get("locomotive") as LocomotiveComponent).stallSeverity; }
  set stallSeverity(v: number | undefined) { (this.entity.components.get("locomotive") as LocomotiveComponent).stallSeverity = v; }
  get flaps(): "up" | "combat" | "landing" | undefined { return (this.entity.components.get("locomotive") as LocomotiveComponent).flaps; }
  set flaps(v: "up" | "combat" | "landing" | undefined) { (this.entity.components.get("locomotive") as LocomotiveComponent).flaps = v; }
  get gearDeployed(): boolean | undefined { return (this.entity.components.get("locomotive") as LocomotiveComponent).gearDeployed; }
  set gearDeployed(v: boolean | undefined) { (this.entity.components.get("locomotive") as LocomotiveComponent).gearDeployed = v; }
  get airbrakeDeployed(): boolean | undefined { return (this.entity.components.get("locomotive") as LocomotiveComponent).airbrakeDeployed; }
  set airbrakeDeployed(v: boolean | undefined) { (this.entity.components.get("locomotive") as LocomotiveComponent).airbrakeDeployed = v; }

  get damage(): DamageModel { return (this.entity.components.get("destructible") as DestructibleComponent).damageModel!; }
  set damage(v: DamageModel) {
    const d = this.entity.components.get("destructible") as DestructibleComponent;
    d.damageModel = v;
    d.isDead = v.fuselage <= 0.05;
  }

  get ammo(): Record<WeaponType, number> { return (this.entity.components.get("weaponized") as WeaponizedComponent).ammo; }
  set ammo(v: Record<WeaponType, number>) { (this.entity.components.get("weaponized") as WeaponizedComponent).ammo = v; }
  get ammoBelt(): AmmoBelt { return (this.entity.components.get("weaponized") as WeaponizedComponent).ammoBelt; }
  set ammoBelt(v: AmmoBelt) { (this.entity.components.get("weaponized") as WeaponizedComponent).ammoBelt = v; }
  get modifications(): string[] { return (this.entity.components.get("weaponized") as WeaponizedComponent).modifications; }
  set modifications(v: string[]) { (this.entity.components.get("weaponized") as WeaponizedComponent).modifications = v; }
  get weaponCooldowns(): Partial<Record<WeaponType, number>> { return (this.entity.components.get("weaponized") as WeaponizedComponent).cooldowns; }
  set weaponCooldowns(v: Partial<Record<WeaponType, number>>) { (this.entity.components.get("weaponized") as WeaponizedComponent).cooldowns = v as any; }

  get smoothedPitch(): number | undefined { return (this.entity.components.get("control") as ControlComponent).smoothedPitch; }
  set smoothedPitch(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).smoothedPitch = v; }
  get smoothedRoll(): number | undefined { return (this.entity.components.get("control") as ControlComponent).smoothedRoll; }
  set smoothedRoll(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).smoothedRoll = v; }
  get smoothedYaw(): number | undefined { return (this.entity.components.get("control") as ControlComponent).smoothedYaw; }
  set smoothedYaw(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).smoothedYaw = v; }
  get elevatorDeflection(): number | undefined { return (this.entity.components.get("control") as ControlComponent).elevatorDeflection; }
  set elevatorDeflection(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).elevatorDeflection = v; }
  get aileronDeflection(): number | undefined { return (this.entity.components.get("control") as ControlComponent).aileronDeflection; }
  set aileronDeflection(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).aileronDeflection = v; }
  get rudderDeflection(): number | undefined { return (this.entity.components.get("control") as ControlComponent).rudderDeflection; }
  set rudderDeflection(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).rudderDeflection = v; }
  get pitchIntent(): number | undefined { return (this.entity.components.get("control") as ControlComponent).pitchIntent; }
  set pitchIntent(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).pitchIntent = v; }
  get rollIntent(): number | undefined { return (this.entity.components.get("control") as ControlComponent).rollIntent; }
  set rollIntent(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).rollIntent = v; }
  get yawIntent(): number | undefined { return (this.entity.components.get("control") as ControlComponent).yawIntent; }
  set yawIntent(v: number | undefined) { (this.entity.components.get("control") as ControlComponent).yawIntent = v; }
  get lastCommand(): FlightCommand | undefined { return (this.entity.components.get("control") as ControlComponent).lastCommand; }
  set lastCommand(v: FlightCommand | undefined) { (this.entity.components.get("control") as ControlComponent).lastCommand = v; }
  get controlMode(): ControlMode | undefined { return (this.entity.components.get("control") as ControlComponent).controlMode; }
  set controlMode(v: ControlMode | undefined) { (this.entity.components.get("control") as ControlComponent).controlMode = v; }
  get invertMouseY(): boolean | undefined { return (this.entity.components.get("control") as ControlComponent).invertMouseY; }
  set invertMouseY(v: boolean | undefined) { (this.entity.components.get("control") as ControlComponent).invertMouseY = v; }
  get invertMouseX(): boolean | undefined { return (this.entity.components.get("control") as ControlComponent).invertMouseX; }
  set invertMouseX(v: boolean | undefined) { (this.entity.components.get("control") as ControlComponent).invertMouseX = v; }
  get aiState(): any { return (this.entity.components.get("control") as ControlComponent).aiState; }
  set aiState(v: any) { (this.entity.components.get("control") as ControlComponent).aiState = v; }

  get score(): number { return (this.entity as any).score; }
  set score(v: number) { (this.entity as any).score = v; }
  get kills(): number { return (this.entity as any).kills; }
  set kills(v: number) { (this.entity as any).kills = v; }
  get deaths(): number { return (this.entity as any).deaths; }
  set deaths(v: number) { (this.entity as any).deaths = v; }
  get xpEarned(): number { return (this.entity as any).xpEarned; }
  set xpEarned(v: number) { (this.entity as any).xpEarned = v; }
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

export class GroundTarget {
  public entity: Entity;

  constructor(data?: Partial<GroundTarget> | Entity) {
    if (data && "components" in data) {
      this.entity = data as Entity;
      return;
    }

    const tData = data as Partial<GroundTarget> | undefined;

    const entity: Entity = {
      id: tData?.id ?? "",
      components: new Map()
    };
    this.entity = entity;

    const physical: PhysicalComponent = {
      type: "physical",
      x: tData?.x ?? 0,
      y: tData?.y ?? 0,
      z: tData?.z ?? 0,
      vx: 0, vy: 0, vz: 0,
      pitch: 0, yaw: 0, roll: 0
    };
    entity.components.set("physical", physical);

    const destructible: DestructibleComponent = {
      type: "destructible",
      hp: tData?.hp ?? 100,
      maxHp: tData?.maxHp ?? 100,
      isDead: tData?.isDead ?? false,
      fireCooldown: tData?.fireCooldown
    };
    entity.components.set("destructible", destructible);

    const visual: VisualComponent = {
      type: "visual",
      meshType: "primitive",
      assetId: tData?.type ?? "",
      color: ""
    };
    entity.components.set("visual", visual);

    (entity as any).name = tData?.name ?? "";
    (entity as any).team = tData?.team ?? 1;
  }

  get id(): string { return this.entity.id; }
  set id(v: string) { this.entity.id = v; }

  get name(): string { return (this.entity as any).name; }
  set name(v: string) { (this.entity as any).name = v; }

  get team(): 1 | 2 { return (this.entity as any).team; }
  set team(v: 1 | 2) { (this.entity as any).team = v; }

  get type(): "convoy" | "radar" | "anti-air" | "bunker" | "carrier" {
    return (this.entity.components.get("visual") as VisualComponent).assetId as any;
  }
  set type(v: "convoy" | "radar" | "anti-air" | "bunker" | "carrier") {
    (this.entity.components.get("visual") as VisualComponent).assetId = v;
  }

  get x(): number { return (this.entity.components.get("physical") as PhysicalComponent).x; }
  set x(v: number) { (this.entity.components.get("physical") as PhysicalComponent).x = v; }
  get y(): number { return (this.entity.components.get("physical") as PhysicalComponent).y; }
  set y(v: number) { (this.entity.components.get("physical") as PhysicalComponent).y = v; }
  get z(): number { return (this.entity.components.get("physical") as PhysicalComponent).z; }
  set z(v: number) { (this.entity.components.get("physical") as PhysicalComponent).z = v; }

  get hp(): number { return (this.entity.components.get("destructible") as DestructibleComponent).hp; }
  set hp(v: number) { (this.entity.components.get("destructible") as DestructibleComponent).hp = v; }
  get maxHp(): number { return (this.entity.components.get("destructible") as DestructibleComponent).maxHp; }
  set maxHp(v: number) { (this.entity.components.get("destructible") as DestructibleComponent).maxHp = v; }
  get isDead(): boolean { return (this.entity.components.get("destructible") as DestructibleComponent).isDead; }
  set isDead(v: boolean) { (this.entity.components.get("destructible") as DestructibleComponent).isDead = v; }

  get fireCooldown(): number | undefined { return (this.entity.components.get("destructible") as DestructibleComponent).fireCooldown; }
  set fireCooldown(v: number | undefined) { (this.entity.components.get("destructible") as DestructibleComponent).fireCooldown = v; }
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
  completedCampaignMissions?: string[];
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
  isBot: boolean;
}
