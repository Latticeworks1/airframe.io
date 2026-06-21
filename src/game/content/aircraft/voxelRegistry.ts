import type { VoxelAircraftDef } from "../../voxelTypes";
import { falconMk2Voxels } from "./falcon-mk2/voxels";
import { grizzlyA1Voxels } from "./grizzly-a1/voxels";
import { kite9Voxels } from "./kite-9/voxels";
import { vulcan51Voxels } from "./vulcan-51/voxels";
import { twinwolfVoxels } from "./twinwolf/voxels";

const VOXEL_DEFS: VoxelAircraftDef[] = [
  falconMk2Voxels,
  grizzlyA1Voxels,
  kite9Voxels,
  vulcan51Voxels,
  twinwolfVoxels,
];

const _registry = new Map<string, VoxelAircraftDef>(
  VOXEL_DEFS.map(d => [d.id, d])
);

export function getVoxelDef(aircraftId: string): VoxelAircraftDef | undefined {
  return _registry.get(aircraftId);
}
