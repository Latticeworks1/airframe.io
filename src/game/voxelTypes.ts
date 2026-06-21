import type { Vector3 } from "three";

export type VoxelZone =
  | "fuselage" | "engine" | "leftWing" | "rightWing"
  | "tail" | "cockpit" | "fuelTank";

export interface VoxelCell {
  gx: number;
  gy: number;
  gz: number;
  color: number;
  zone: VoxelZone;
  tags?: string[];
}

export interface VoxelAircraftDef {
  id: string;
  voxelSize: number;  // meters per grid unit
  cells: VoxelCell[];
}

export interface VoxelImpact {
  targetId: string;
  localOffsetMeters: Vector3;
  blastRadius: number;
}
