import type { VoxelZone } from '../voxelTypes';

export interface Vec3JSON {
  x: number;
  y: number;
  z: number;
}

export interface VoxelCommandJSON {
  op: 'shell' | 'solid';
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  color: string;
  zone: VoxelZone;
  tags?: string[];
}

export interface BlockJSON {
  id: string;
  kind: 'box' | 'wedge' | 'cylinder' | 'sphere';
  role: 'fuselage' | 'nose' | 'canopy' | 'wing' | 'tail' | 'engine' | 'propeller' | 'weapon' | 'decor';
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: [number, number, number];
  material: string;
  tags?: string[];
  damageComponent?: 'engine' | 'leftWing' | 'rightWing' | 'tail' | 'cockpit' | 'fuelTank' | 'fuselage';
}

export interface AircraftJSON {
  id: string;
  name: string;
  class: string;
  description: string;
  mass: number;
  maxThrust: number;
  cd0: number;
  cl0: number;
  clAlpha: number;
  wingArea: number;
  aspectRatio: number;
  oswaldEfficiency: number;
  energyRetention: number;
  stallSpeedKmph: number;
  structuralLimitSpeedKmph: number;
  turnBleed: number;
  climbRate: number;
  maxFuelSeconds: number;
  weapons: string[];
  durability: number;
  color: string;
  secondaryColor: string;
  accentColor: string;
  aileronBoost?: number;
  pitchRateDegPerSec?: number;
  rollRateDegPerSec?: number;
  yawRateDegPerSec?: number;
  radarRange?: number;
  aero: {
    leftWingPos: Vec3JSON;
    rightWingPos: Vec3JSON;
    leftAileronPos: Vec3JSON;
    rightAileronPos: Vec3JSON;
    elevatorPos: Vec3JSON;
    rudderPos: Vec3JSON;
  };
  damage: {
    engineVolume: { min: number[]; max: number[] };
    cockpitVolume: { min: number[]; max: number[] };
    fuelTankVolume: { min: number[]; max: number[] };
  };
  hardpoints: {
    gunConvergenceM?: number;
    positions: Vec3JSON[];
    rocketPositions?: Vec3JSON[];
    bombPositions?: Vec3JSON[];
  };
  render: {
    materials: Record<string, string>;
    camera: {
      cockpitEye: [number, number, number];
      firstPersonFov?: number;
      hiddenBlockIds?: string[];
    };
    blocks: BlockJSON[];
  };
  cockpit: {
    eye: [number, number, number];
    sightAnchor: [number, number, number];
    panelZ: number;
    panelY: number;
    panelW: number;
    panelH: number;
  };
  voxels: {
    voxelSize: number;
    palette: Record<string, string>;
    commands: VoxelCommandJSON[];
  };
}

export interface StructurePlacementJSON {
  structureId: string;
  x: number;
  z: number;
  rotationY: number;
}

export interface MapJSON {
  id: string;
  name: string;
  description: string;
  seed: number;
  cloudDensity: number;
  world: {
    radius: number;
    waterHeight: number;
    defaultGroundHeight: number;
    maxAltitude: number;
  };
  spawn: {
    distMin: number;
    distMax: number;
    aglMin: number;
    aglMax: number;
    initialSpeedMs: number;
    spreadZ: number;
  };
  terrain: {
    kind: string;
    path: string;
    elevationScale: number;
  };
  layout: {
    carriers: StructurePlacementJSON[];
    hasThunder: boolean;
    antiAirCount: number;
    groundTargetsCount: number;
  };
  visual: {
    skyColor: string;
    fogColor: string;
    groundColor: string;
  };
  palette: {
    base: string;
    colors: string[];
    roadColor: string;
  };
  tileOrigin: {
    lat: number;
    lon: number;
    zoom: number;
  };
  atmosphere: Record<string, unknown>;
}

export interface WeaponSpecJSON {
  damage: number;
  fireRate: number;
  muzzleVelocity: number;
  ammoCapacity: number;
  burstCount: number;
  dispersion: number;
  soundType: string;
}

export interface ModificationJSON {
  id: string;
  name: string;
  description: string;
  slot: string;
  effects: Record<string, number>;
}
