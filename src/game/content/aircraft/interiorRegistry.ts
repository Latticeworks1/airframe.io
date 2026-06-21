import type { InteriorDef } from "../../voxelInterior";
import { falconMk2Interior } from "./falcon-mk2/interior";

const INTERIOR_DEFS = new Map<string, InteriorDef>([
  ["falcon-mk2", falconMk2Interior],
]);

// Returns undefined for aircraft without a defined interior; the caller
// must handle that gracefully (FPV falls back to DoubleSide exterior only).
export function getInteriorDef(aircraftId: string): InteriorDef | undefined {
  return INTERIOR_DEFS.get(aircraftId);
}
