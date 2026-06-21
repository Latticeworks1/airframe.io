import type { VoxelAircraftDef } from "../../voxelTypes";
import { falconMk2Voxels } from "./falcon-mk2/voxels";

// Add each aircraft's voxel definition here as they are authored.
// Aircraft not listed fall back to the existing block-primitive renderer.
const VOXEL_DEFS: VoxelAircraftDef[] = [
  falconMk2Voxels
];

const _registry = new Map<string, VoxelAircraftDef>(
  VOXEL_DEFS.map(d => [d.id, d])
);

export function getVoxelDef(aircraftId: string): VoxelAircraftDef | undefined {
  return _registry.get(aircraftId);
}
