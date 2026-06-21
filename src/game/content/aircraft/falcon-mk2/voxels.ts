import type { VoxelAircraftDef, VoxelCell, VoxelZone } from "../../../voxelTypes";

// voxelSize=0.25 → 1 grid unit = 0.25 m
// Axis convention (matches CLAUDE.md): +Z=nose, +Y=up, +X=right wing
const VS = 0.25;

// colour palette from materials
const P = 0x6B7280; // primary grey
const S = 0xEAB308; // secondary yellow
const A = 0xEF4444; // accent red
const C = 0x38BDF8; // canopy sky-blue
const M = 0x475569; // metal dark-slate

function set(
  m: Map<string, VoxelCell>,
  gx: number, gy: number, gz: number,
  color: number, zone: VoxelZone,
  tags?: string[]
) {
  m.set(`${gx},${gy},${gz}`, { gx, gy, gz, color, zone, tags });
}

// Shell of an axis-aligned box (surface voxels only)
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

// Flat slab (y constant, x/z range)
function slab(
  m: Map<string, VoxelCell>,
  x0: number, z0: number, x1: number, z1: number,
  y: number, color: number, zone: VoxelZone
) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      set(m, x, y, z, color, zone);
}

// Solid fill
function solid(
  m: Map<string, VoxelCell>,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  color: number, zone: VoxelZone
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        set(m, x, y, z, color, zone);
}

function build(): VoxelCell[] {
  const m = new Map<string, VoxelCell>();

  // ── FUSELAGE SHELL ───────────────────────────────────────────────────────
  // 7 wide × 7 tall × 41 long  (±3 in x/y, z∈[-20,20])
  shell(m, -3, -3, -20,  3,  3, 20, P, "fuselage");

  // ── ENGINE / NOSE ZONE ───────────────────────────────────────────────────
  // Override forward section and nose cone
  shell(m, -3, -3, 14,   3,  3, 20, S, "engine");   // engine section of fuselage
  // Nose cone taper (z 21-25)
  for (let r = 2; r >= 0; r--) {
    const z = 21 + (2 - r);
    for (let x = -r; x <= r; x++)
      for (let y = -r; y <= r; y++)
        set(m, x, y, z, S, "engine");
  }

  // ── TAIL SECTION ─────────────────────────────────────────────────────────
  shell(m, -3, -3, -20,  3,  3, -14, M, "tail");

  // ── CANOPY / COCKPIT ─────────────────────────────────────────────────────
  shell(m, -2, 3, -1,    2,  6,   8, C, "cockpit");

  // ── FUEL TANK ────────────────────────────────────────────────────────────
  // Bottom face of fuselage in mid section
  for (let x = -3; x <= 3; x++)
    for (let z = -8; z <= 4; z++)
      set(m, x, -3, z, M, "fuelTank");

  // Engine nozzle at tail end
  solid(m, -2, -2, -21,  2,  2, -21, A, "fuelTank");

  // ── MAIN WINGS ───────────────────────────────────────────────────────────
  // z∈[-3,6], one voxel thick at y=-1 (hugs fuselage underside)
  // Centre strip (x∈[-3,3]) overlaps fuselage base — culled as interior, intentional
  slab(m,   4, -3,  28,  6, -1, P, "rightWing");
  slab(m, -28, -3,  -4,  6, -1, P, "leftWing");

  // Wing leading-edge accent (nose-facing edge, z=6)
  for (let x = 4; x <= 28; x++) set(m, x, -1, 6, S, "rightWing");
  for (let x = -28; x <= -4; x++) set(m, x, -1, 6, S, "leftWing");

  // Wing tips (outermost column accent)
  for (let z = -3; z <= 6; z++) {
    set(m, -28, -1, z, S, "leftWing");
    set(m,  28, -1, z, S, "rightWing");
  }

  // ── VERTICAL TAIL FIN ────────────────────────────────────────────────────
  // x=0, y∈[3,11], z∈[-18,-11]
  for (let y = 3; y <= 11; y++)
    for (let z = -18; z <= -11; z++)
      set(m, 0, y, z, S, "tail");

  // ── HORIZONTAL ELEVATORS ─────────────────────────────────────────────────
  slab(m, -9, -19,  9, -15, 0, P, "tail");

  // ── PROPELLER BLADES (spinZ tagged) ──────────────────────────────────────
  for (let x = -11; x <= 11; x++) set(m, x, 0, 22, M, "engine", ["spinZ"]);
  for (let y = -11; y <= 11; y++) set(m, 0, y, 22, M, "engine", ["spinZ"]);

  // ── FPV COCKPIT INTERIOR ──────────────────────────────────────────────────
  // Zone "fuselage" so setCockpitVisible(false) does not hide these.
  // From outside they are occluded by the canopy shell cells; in FPV mode
  // the canopy cells are hidden, exposing the interior.
  //
  // Camera eye sits at approx (0, 5, 3) in grid units looking +Z.
  // Cockpit shell interior: x∈[-1,1], y∈[4,5], z∈[0,7]
  //
  // Art direction: voxel-realism hybrid — instrument panel uses the same
  // 0.25m voxel grid as the exterior. A future pass may halve VS for the
  // interior to add finer instrument detail without affecting exterior geometry.

  const INT = 0x1a2535;  // instrument panel dark blue-gray
  const DRK = 0x0c1320;  // deep background panel
  const THR = 0x252f3e;  // throttle / console

  // Instrument panel — horizontal shelf below pilot view, z=5-7, y=4
  for (let z = 5; z <= 7; z++)
    for (let x = -1; x <= 1; x++)
      set(m, x, 4, z, INT, "fuselage");

  // Vertical instrument face — forward face of panel (z=7, y=4-5)
  for (let y = 4; y <= 5; y++)
    for (let x = -1; x <= 1; x++)
      set(m, x, y, 7, DRK, "fuselage");

  // Left side console — strip along floor, left of pilot
  for (let z = 1; z <= 6; z++) set(m, -1, 4, z, INT, "fuselage");

  // Right side console
  for (let z = 1; z <= 6; z++) set(m, 1, 4, z, INT, "fuselage");

  // Throttle quadrant — raised on left, forward section
  for (let z = 1; z <= 4; z++) set(m, -1, 5, z, THR, "fuselage");

  // Center stick (between knees)
  set(m, 0, 4, 2, M, "fuselage");
  set(m, 0, 4, 3, M, "fuselage");

  return Array.from(m.values());
}

export const falconMk2Voxels: VoxelAircraftDef = {
  id: "falcon-mk2",
  voxelSize: VS,
  cells: build()
};
