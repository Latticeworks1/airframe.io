import type { VoxelAircraftDef, VoxelCell, VoxelZone } from "../../../voxelTypes";

// voxelSize=0.20 → 1 grid unit = 0.20 m  (finer scale → small, tight silhouette)
// Axis convention: +Z=nose, +Y=up, +X=right wing
const VS = 0.20;

const P = 0x2D6A4F; // forest green (classic WWII-era paint)
const S = 0x1B4332; // shadow green
const A = 0xD4A017; // yellow roundel accent
const C = 0x93C5FD; // bubble canopy
const M = 0x374151; // engine cowling metal

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

  // ── FUSELAGE — compact rounded body ──────────────────────────────────────
  shell(m, -3, -3, -18,  3,  3, 18, P, "fuselage");

  // ── TAIL ─────────────────────────────────────────────────────────────────
  shell(m, -3, -3, -18,  3,  3, -12, S, "tail");

  // ── ENGINE COWLING — forward cylinder (front-engined prop fighter) ────────
  shell(m, -4, -4, 12,   4,  4, 20, M, "engine");
  // Cowling lip
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++)
      if (Math.abs(x) === 4 || Math.abs(y) === 4)
        set(m, x, y, 20, M, "engine");

  // ── FUEL TANK — bottom fuselage mid-section ──────────────────────────────
  for (let x = -3; x <= 3; x++)
    for (let z = -8; z <= 4; z++)
      set(m, x, -3, z, S, "fuelTank");

  // ── BUBBLE CANOPY — tall, prominent, slightly offset forward ─────────────
  shell(m, -2, 3, -3,  2, 7, 5, C, "cockpit");
  // Widen the bubble base
  for (let z = -3; z <= 5; z++) {
    set(m, -3, 3, z, C, "cockpit");
    set(m,  3, 3, z, C, "cockpit");
  }

  // ── ELLIPTICAL WINGS — widest at z=0, taper toward nose and tail ─────────
  const wingProfile: [number, number, number][] = [
    [-18, -8, 2], [-14, -8, 2], [-10, -6, 2], [-6, -4, 4],
  ]; // [xOuter, zMin, zMax] for the right half
  const wingSpans: [number, number, number][] = [
    [4, -10, 6], [6, -10, 6], [10, -10, 6], [14, -10, 4],
    [18, -8, 4], [22, -6, 2], [26, -4, 0],
  ];
  for (const [x, zMin, zMax] of wingSpans) {
    for (let z = zMin; z <= zMax; z++) {
      set(m,  x, -2, z, P, "rightWing");
      set(m, -x, -2, z, P, "leftWing");
    }
  }
  // Fill from fuselage edge to wing root
  slab(m, 4, -10, 4, 6, -2, P, "rightWing");
  slab(m, -4, -10, -4, 6, -2, P, "leftWing");

  // Leading-edge accent
  for (let x = 4; x <= 26; x++) set(m,  x, -2, 6, A, "rightWing");
  for (let x = 4; x <= 26; x++) set(m, -x, -2, 6, A, "leftWing");

  // ── VERTICAL FIN — rounded, taller ───────────────────────────────────────
  for (let y = 3; y <= 12; y++)
    for (let z = -16; z <= -8; z++)
      set(m, 0, y, z, P, "tail");
  // Fin trailing edge accent
  for (let y = 3; y <= 12; y++) set(m, 0, y, -16, A, "tail");

  // ── HORIZONTAL STABS ─────────────────────────────────────────────────────
  slab(m, -10, -18, 10, -14, 0, S, "tail");

  // ── PROPELLER (spinZ) ────────────────────────────────────────────────────
  for (let x = -12; x <= 12; x++) set(m, x, 0, 21, M, "engine", ["spinZ"]);
  for (let y = -12; y <= 12; y++) set(m, 0, y, 21, M, "engine", ["spinZ"]);

  // ── COCKPIT INTERIOR ─────────────────────────────────────────────────────
  const INT = 0x1C2B1A;
  const DRK = 0x0E1A0D;
  const THR = 0x24331E;

  // Instrument panel (compact — small fighter, minimal panel)
  for (let z = 2; z <= 4; z++)
    for (let x = -1; x <= 1; x++)
      set(m, x, 3, z, INT, "fuselage");
  // Instrument face
  for (let y = 3; y <= 4; y++)
    for (let x = -1; x <= 1; x++)
      set(m, x, y, 4, DRK, "fuselage");
  // Left console (throttle — left side of seat)
  for (let z = -1; z <= 3; z++) set(m, -2, 3, z, INT, "fuselage");
  for (let z = -1; z <= 3; z++) set(m, -2, 4, z, THR, "fuselage");
  // Control stick
  set(m, 0, 3, 0, M, "fuselage");
  set(m, 0, 3, 1, M, "fuselage");

  // Roundel markings on wing surfaces
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 || dz === 0) {
        set(m, 14 + dx, -2, 0 + dz, A, "rightWing");
        set(m, -(14 + dx), -2, 0 + dz, A, "leftWing");
      }
    }

  // Remove previous wingProfile variable usage (was unused, declared above)
  void wingProfile;

  return Array.from(m.values());
}

export const kite9Voxels: VoxelAircraftDef = {
  id: "kite-9",
  voxelSize: VS,
  cells: build()
};
