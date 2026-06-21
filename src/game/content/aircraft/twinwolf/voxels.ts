import type { VoxelAircraftDef, VoxelCell, VoxelZone } from "../../../voxelTypes";

// voxelSize=0.28 → 1 grid unit = 0.28 m
// Axis convention: +Z=nose, +Y=up, +X=right wing
// Twinwolf is a twin-boom heavy fighter — two engine nacelles flanking a
// narrow central fuselage pod, joined by a centre wing section.
const VS = 0.28;

const P = 0x475569; // slate-gray fuselage
const S = 0x1E293B; // shadow / underside metal
const A = 0xF87171; // red accent / exhaust
const C = 0x38BDF8; // canopy
const M = 0x334155; // engine nacelle dark

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

  // ── CENTRAL FUSELAGE POD — narrow, high cockpit ───────────────────────────
  shell(m, -2, -1, -18,  2,  5, 20, P, "fuselage");

  // ── RIGHT ENGINE NACELLE ───────────────────────────────────────────────────
  shell(m, 8, -3, -22, 14, 2, 18, M, "engine");
  // Right exhaust
  for (let x = 9; x <= 13; x++)
    for (let y = -2; y <= 1; y++)
      if (Math.abs(x - 11) + Math.abs(y + 0.5) < 3)
        set(m, x, y, -23, A, "engine");
  // Right intake opening
  for (let x = 9; x <= 13; x++) set(m, x, -1, 19, A, "engine");

  // ── LEFT ENGINE NACELLE ────────────────────────────────────────────────────
  shell(m, -14, -3, -22, -8, 2, 18, M, "engine");
  for (let x = -13; x <= -9; x++)
    for (let y = -2; y <= 1; y++)
      if (Math.abs(x + 11) + Math.abs(y + 0.5) < 3)
        set(m, x, y, -23, A, "engine");
  for (let x = -13; x <= -9; x++) set(m, x, -1, 19, A, "engine");

  // ── TAIL SECTION on fuselage pod ─────────────────────────────────────────
  shell(m, -2, -1, -18,  2,  3, -12, S, "tail");

  // ── NOSE CONE (central pod) ────────────────────────────────────────────────
  for (let r = 1; r >= 0; r--) {
    const z = 21 + (1 - r);
    for (let x = -r; x <= r; x++)
      for (let y = -r + 1; y <= r + 1; y++)
        set(m, x, y, z, P, "engine");
  }

  // ── CENTRE WING SECTION — joins pod to nacelles ────────────────────────────
  // Flat wing between x=-14 and x=14, one voxel thick at y=-1, z from -8 to 8
  slab(m, -14, -8, 14, 8, -1, P, "fuselage");
  // Slight thickening at root
  slab(m, -6, -8, 6, 8, 0, P, "fuselage");

  // ── OUTER WING EXTENSIONS ─────────────────────────────────────────────────
  // Right outer
  slab(m, 15, -10, 30, 6, -1, P, "rightWing");
  // Left outer
  slab(m, -30, -10, -15, 6, -1, P, "leftWing");
  // Wing tip accent
  for (let z = -10; z <= 6; z++) {
    set(m,  30, -1, z, A, "rightWing");
    set(m, -30, -1, z, A, "leftWing");
  }
  // Leading edge
  for (let x = 15; x <= 30; x++) set(m,  x, -1,  6, S, "rightWing");
  for (let x = 15; x <= 30; x++) set(m, -x, -1,  6, S, "leftWing");

  // ── FUEL TANK — underside centre ─────────────────────────────────────────
  for (let x = -2; x <= 2; x++)
    for (let z = -6; z <= 8; z++)
      set(m, x, -1, z, S, "fuelTank");

  // ── TWIN TAIL FINS — on nacelles ─────────────────────────────────────────
  for (let y = 2; y <= 9; y++)
    for (let z = -20; z <= -12; z++) {
      set(m,  11, y, z, P, "tail");
      set(m, -11, y, z, P, "tail");
    }
  // Fin caps
  for (let z = -20; z <= -12; z++) {
    set(m,  11, 9, z, A, "tail");
    set(m, -11, 9, z, A, "tail");
  }

  // ── HORIZONTAL CROSS-TAIL — spans between nacelle fins ───────────────────
  slab(m, -11, -22, 11, -18, 6, S, "tail");

  // ── COCKPIT CANOPY — high on central pod ─────────────────────────────────
  shell(m, -2, 5, 4,  2, 9, 16, C, "cockpit");
  // Canopy base flange
  for (let z = 4; z <= 16; z++) {
    set(m, -2, 5, z, P, "cockpit");
    set(m,  2, 5, z, P, "cockpit");
  }

  // ── COCKPIT INTERIOR ─────────────────────────────────────────────────────
  const INT = 0x1A2535;
  const DRK = 0x0C1320;
  const THR = 0x243040;

  // Instrument panel
  for (let z = 13; z <= 15; z++)
    for (let x = -1; x <= 1; x++)
      set(m, x, 5, z, INT, "fuselage");
  // Instrument face
  for (let y = 5; y <= 7; y++)
    for (let x = -1; x <= 1; x++)
      set(m, x, y, 15, DRK, "fuselage");
  // Twin throttles (twin engine — two levers left side)
  for (let z = 6; z <= 12; z++) set(m, -2, 5, z, INT, "fuselage");
  for (let z = 6; z <= 10; z++) set(m, -2, 6, z, THR, "fuselage");
  for (let z = 6; z <= 8;  z++) set(m, -2, 7, z, THR, "fuselage");
  // Right console
  for (let z = 6; z <= 12; z++) set(m, 2, 5, z, INT, "fuselage");
  // Control stick
  set(m, 0, 5, 8,  M, "fuselage");
  set(m, 0, 6, 8,  M, "fuselage");

  // ── TWIN PROPELLERS (spinZ) ───────────────────────────────────────────────
  for (let x = 9; x <= 13;  x++) set(m, x, 0, 19, M, "engine", ["spinZ"]);
  for (let y = -3; y <= 3;  y++) set(m, 11, y, 19, M, "engine", ["spinZ"]);
  for (let x = -13; x <= -9; x++) set(m, x, 0, 19, M, "engine", ["spinZ"]);
  for (let y = -3; y <= 3;  y++) set(m, -11, y, 19, M, "engine", ["spinZ"]);

  return Array.from(m.values());
}

export const twinwolfVoxels: VoxelAircraftDef = {
  id: "twinwolf",
  voxelSize: VS,
  cells: build()
};
