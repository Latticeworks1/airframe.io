import type { VoxelAircraftDef, VoxelCell, VoxelZone } from "../../../voxelTypes";

// voxelSize=0.22 → 1 grid unit = 0.22 m
// Axis convention: +Z=nose, +Y=up, +X=right wing
// Vulcan-51 is an energy fighter — long, needle-nosed, highly swept delta wings.
const VS = 0.22;

const P = 0x4338CA; // deep indigo airframe
const S = 0x312E81; // shadow/underside
const A = 0xF43F5E; // red intake / accent stripe
const C = 0xBAE6FD; // canopy (small, streamlined)
const M = 0x1E1B4B; // dark metal

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

function build(): VoxelCell[] {
  const m = new Map<string, VoxelCell>();

  // ── FUSELAGE — long and narrow ────────────────────────────────────────────
  shell(m, -2, -2, -26,  2,  2, 26, P, "fuselage");

  // ── ENGINE SECTION — rear/large jet ──────────────────────────────────────
  shell(m, -3, -3, -26,  3,  3, -16, M, "engine");
  // Engine nozzle petals
  for (let x = -2; x <= 2; x++)
    for (let y = -2; y <= 2; y++)
      if (Math.abs(x) === 2 || Math.abs(y) === 2)
        set(m, x, y, -27, A, "engine");

  // ── TAIL ─────────────────────────────────────────────────────────────────
  shell(m, -2, -2, -26,  2,  2, -20, S, "tail");

  // ── NOSE CONE — long taper ────────────────────────────────────────────────
  for (let r = 1; r >= 0; r--) {
    const z = 27 + (1 - r);
    for (let x = -r; x <= r; x++)
      for (let y = -r; y <= r; y++)
        set(m, x, y, z, P, "engine");
  }
  set(m, 0, 0, 29, P, "engine"); // needle tip

  // ── INTAKE — bottom forward fuselage (chin intake like MiG-21) ────────────
  for (let x = -2; x <= 2; x++) {
    set(m, x, -2, 20, A, "engine");
    set(m, x, -2, 21, A, "engine");
    set(m, x, -2, 22, A, "engine");
  }
  // Intake duct recessed slightly
  for (let x = -1; x <= 1; x++) {
    set(m, x, -2, 23, M, "engine");
    set(m, x, -2, 24, M, "engine");
  }

  // ── SWEPT DELTA WINGS ─────────────────────────────────────────────────────
  // Right wing: leading edge sweeps from z=20 at root to z=-18 at tip (x=22)
  // Each x step, the leading edge moves 1.7z rearward (≈60° sweep)
  for (let x = 3; x <= 22; x++) {
    const xRel = x - 3;
    const zLead = Math.round(18 - xRel * 1.7);
    const zTrail = -18;
    for (let z = zTrail; z <= zLead; z++) {
      set(m,  x, -2, z, P, "rightWing");
      set(m, -x, -2, z, P, "leftWing");
    }
    // Leading edge stripe
    set(m,  x, -2, zLead, S, "rightWing");
    set(m, -x, -2, zLead, S, "leftWing");
  }

  // ── FUEL TANK — centreline under fuselage ────────────────────────────────
  for (let z = -10; z <= 10; z++)
    for (let x = -2; x <= 2; x++)
      set(m, x, -2, z, M, "fuelTank");

  // ── VERTICAL FIN — tall and swept ────────────────────────────────────────
  for (let y = 2; y <= 13; y++) {
    const zBase = Math.round(-20 + (13 - y) * 0.5);
    for (let z = zBase; z <= -10; z++)
      set(m, 0, y, z, S, "tail");
  }
  // Fin cap
  for (let z = -20; z <= -10; z++) set(m, 0, 13, z, A, "tail");

  // ── HORIZONTAL STABS — small delta at tail ────────────────────────────────
  for (let x = 1; x <= 8; x++) {
    const zLead = Math.round(-22 + x * 0.6);
    for (let z = zLead; z <= -22; z++) {
      set(m,  x, -2, z, S, "tail");
      set(m, -x, -2, z, S, "tail");
    }
  }

  // ── COCKPIT — small streamlined canopy ────────────────────────────────────
  shell(m, -1, 2, 14,  1, 5, 20, C, "cockpit");
  // Canopy base widens at fuselage junction
  for (let z = 14; z <= 20; z++) {
    set(m, -2, 2, z, C, "cockpit");
    set(m,  2, 2, z, C, "cockpit");
  }

  // ── COCKPIT INTERIOR ─────────────────────────────────────────────────────
  const INT = 0x1B1A3A;
  const DRK = 0x0C0C22;
  const THR = 0x22204A;

  // Instrument panel (minimal — high-speed jet, MFD-style)
  for (let x = -1; x <= 1; x++) {
    set(m, x, 2, 19, INT, "fuselage");
    set(m, x, 3, 19, DRK, "fuselage");
  }
  // HUD frame (canopy front rail)
  for (let x = -1; x <= 1; x++) set(m, x, 4, 19, M, "fuselage");
  // Side consoles (very narrow)
  for (let z = 15; z <= 18; z++) {
    set(m, -1, 2, z, INT, "fuselage");
    set(m,  1, 2, z, INT, "fuselage");
  }
  // Throttle — left side
  for (let z = 15; z <= 17; z++) set(m, -1, 3, z, THR, "fuselage");
  // Sidestick — right side
  set(m, 1, 3, 16, M, "fuselage");

  return Array.from(m.values());
}

export const vulcan51Voxels: VoxelAircraftDef = {
  id: "vulcan-51",
  voxelSize: VS,
  cells: build()
};
