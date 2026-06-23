export interface StructureDef {
  id: string;
  kind: "carrier" | "airfield" | "outpost";
  // Carrier-specific dimensions used by terrain height sampling and spawn logic.
  deckWidth: number;
  deckLength: number;
  deckHeight: number;
}

// A placement binds a structure definition to a world-space transform.
// The map JSON only encodes this; intrinsic dimensions come from the registry.
export interface StructurePlacement {
  structureId: string;
  x: number;
  z: number;
  rotationY: number;
}

// Full carrier geometry resolved by joining a placement with its definition.
export interface ResolvedCarrier extends StructurePlacement {
  deckWidth: number;
  deckLength: number;
  deckHeight: number;
}
