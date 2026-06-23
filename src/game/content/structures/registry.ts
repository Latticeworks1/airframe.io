import type { StructureDef, StructurePlacement, ResolvedCarrier } from "./structureTypes";
import { carrierNimitz } from "./carrier-nimitz";

export const STRUCTURE_REGISTRY: Record<string, StructureDef> = {
  [carrierNimitz.id]: carrierNimitz,
};

export function resolveCarriers(placements: StructurePlacement[]): ResolvedCarrier[] {
  return placements.map(p => {
    const def = STRUCTURE_REGISTRY[p.structureId];
    if (!def) throw new Error(`Unknown structure: ${p.structureId}`);
    return {
      structureId: p.structureId,
      x: p.x,
      z: p.z,
      rotationY: p.rotationY,
      deckWidth: def.deckWidth,
      deckLength: def.deckLength,
      deckHeight: def.deckHeight,
    };
  });
}
