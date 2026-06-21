import type { VoxelAircraftDef, VoxelCell, VoxelZone } from "../../../voxelTypes";

// voxelSize=0.30 → 1 grid unit = 0.30 m  (slightly coarser than Falcon — emphasises bulk)
// Axis convention: +Z=nose, +Y=up, +X=right wing
const VS = 0.30;

const P = 0x4B5563; // olive-gray fuselage
const S = 0x374151; // shadow / underbody
const A = 0xF97316; // engine exhaust orange
const C = 0x7DD3FC; // canopy glass
const M = 0x1F2937; // dark metal

function set(
  m: Map<string, VoxelCell>,
  gx: number, gy: number, gz: number,
  color: number, zone: VoxelZone,
  tags?: string[]
) {
  m.set(`${gx},${gy},${gz}`, { gx, gy, gz, color, zone, tags });
}

function shell(
  m: Map<string, VoxelCell>,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  color: number, zone: VoxelZone
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1)
          set(m, x, y, z, color, zone);
}

function slab(
  m: Map<string, VoxelCell>,
  x0: number, z0: number, x1: number, z1: number,
  y: number, color: number, zone: VoxelZone
) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      set(m, x, y, z, color, zone);
}

function build(): VoxelCell[] {
  const m = new Map<string, VoxelCell>();

  // ── FUSELAGE — wide boxy body ─────────────────────────────────────────────
  shell(m, -4, -4, -24,  4,  4, 24, P, "fuselage");

  // ── ENGINE SECTION — rear 1/3, darker ────────────────────────────────────
  shell(m, -4, -4, -24,  4,  4, -12, S, "engine");
  // Twin exhaust nozzles at tail
  for (let x = -3; x <= -1; x++) set(m, x, -1, -25, A, "engine");
  for (let x =  1; x <=  3; x++) set(m, x, -1, -25, A, "engine");

  // ── TAIL SECTION ─────────────────────────────────────────────────────────
  shell(m, -4, -4, -24,  4,  4, -18, S, "tail");

  // ── NOSE SECTION — tapered ───────────────────────────────────────────────
  shell(m, -3, -3, 20,   3,  3, 26, P, "engine");
  // Nose taper
  for (let r = 2; r >= 0; r--) {
    const z = 27 + (2 - r);
    for (let x = -r; x <= r; x++)
      for (let y = -r; y <= r; y++)
        set(m, x, y, z, S, "engine");
  }

  // ── FUEL TANK — bottom underside ─────────────────────────────────────────
  for (let x = -4; x <= 4; x++)
    for (let z = -10; z <= 8; z++)
      set(m, x, -4, z, M, "fuelTank");

  // ── COCKPIT BUBBLE — set forward and high ────────────────────────────────
  shell(m, -2, 4, 10,  2, 8, 18, C, "cockpit");

  // ── MAIN WINGS — straight, very wide ────────────────────────────────────
  // Right wing
  slab(m,  5, -10, 36,  2, -2, P, "rightWing");
  slab(m,  5,   4, 36, -2, -2, P, "rightWing"); // trailing edge
  // Left wing
  slab(m, -36, -10,  -5, 2, -2, P, "leftWing");
  slab(m, -36,   4,  -5, -2, -2, P, "leftWing");
  // Wing leading edge accents
  for (let x =  5; x <= 36; x++) set(m, x,  -2,  2, A, "rightWing");
  for (let x = -36; x <= -5; x++) set(m, x, -2,  2, A, "leftWing");
  // Wingtip acccent
  for (let z = -10; z <= 4; z++) {
    set(m,  36, -2, z, S, "rightWing");
    set(m, -36, -2, z, S, "leftWing");
  }

  // ── ENGINE PODS under wings ───────────────────────────────────────────────
  // Right pod
  shell(m, 12, -5, -16, 18, -2, 14, S, "engine");
  for (let x = 12; x <= 18; x++) set(m, x, -3, -17, A, "engine");
  // Left pod
  shell(m, -18, -5, -16, -12, -2, 14, S, "engine");
  for (let x = -18; x <= -12; x++) set(m, x, -3, -17, A, "engine");

  // ── VERTICAL TAIL FIN ─────────────────────────────────────────────────────
  for (let y = 4; y <= 13; y++)
    for (let z = -22; z <= -13; z++)
      set(m, 0, y, z, S, "tail");

  // ── HORIZONTAL STABILIZERS ───────────────────────────────────────────────
  slab(m, -12, -24, 12, -20, 0, P, "tail");

  // ── COCKPIT INTERIOR ─────────────────────────────────────────────────────
  const INT = 0x1C2A38;
  const DRK = 0x0D1620;
  const THR = 0x243040;

  // Instrument shelf (wide panel befitting an attack aircraft)
  for (let z = 13; z <= 17; z++)
    for (let x = -2; x <= 2; x++)
      set(m, x, 4, z, INT, "fuselage");

  // Instrument face
  for (let y = 4; y <= 6; y++)
    for (let x = -2; x <= 2; x++)
      set(m, x, y, 17, DRK, "fuselage");

  // Side consoles
  for (let z = 11; z <= 16; z++) {
    set(m, -2, 4, z, INT, "fuselage");
    set(m,  2, 4, z, INT, "fuselage");
  }

  // Throttle bank (left side, multi-lever for twin engine)
  for (let z = 11; z <= 15; z++) set(m, -2, 5, z, THR, "fuselage");
  for (let z = 11; z <= 15; z++) set(m, -2, 6, z, THR, "fuselage");

  // Control column (floor-mounted for attack plane)
  set(m, 0, 4, 12, M, "fuselage");
  set(m, 0, 5, 12, M, "fuselage");

  return Array.from(m.values());
}

export const grizzlyA1Voxels: VoxelAircraftDef = {
  id: "grizzly-a1",
  voxelSize: VS,
  cells: build()
};
