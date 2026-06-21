import type { InteriorDef, InteriorCell } from "../../../voxelInterior";
import { shell, solid, slab, faceZ, faceX, screen, lever } from "../../../voxelInterior";

// voxelSize = 0.05 m → 5 cm per grid unit
// Axis convention matches exterior: +Z = nose, +Y = up, +X = right wing
//
// cockpitEye world = [0, 1.28, 0.80] → interior grid = [0, 25.6, 16]
// Canopy interior bounds (world → grid):
//   x: ±0.50 m → gx ±10
//   y: 0.75–1.50 m → gy 15–30
//   z: −0.25–2.00 m → gz −5–40
// Instrument panel face at gz=35 (1.75 m), 19 cells ahead of eye.

const VS = 0.05;

// palette
const PANEL  = 0x141c28; // base panel dark blue-grey
const TRIM   = 0x1e2d40; // console trim / raised surfaces
const SCREEN = 0x080f08; // unlit screen glass
const FRAME  = 0x0f1a0f; // screen bezel
const STALK  = 0x202838; // lever stalk
const GRIP   = 0x2a9060; // throttle grip (live — overwritten each frame)
const SEAT   = 0x16202e; // seat fabric
const STRUCT = 0x1a2238; // structural colour (floor, walls)
const PEDAL  = 0x1e2434; // rudder pedals

function build(): InteriorCell[] {
  const m = new Map<string, InteriorCell>();

  // ── FLOOR ──────────────────────────────────────────────────────────────────
  slab(m, -9, 5, 9, 36, 15, STRUCT);

  // ── LEFT SIDEWALL ──────────────────────────────────────────────────────────
  faceX(m, 5, 15, 36, 30, -10, PANEL);
  // Left console raised surface
  solid(m, -9, 20, 10, -7, 23, 30, TRIM);

  // ── RIGHT SIDEWALL ─────────────────────────────────────────────────────────
  faceX(m, 5, 15, 36, 30, 10, PANEL);

  // ── INSTRUMENT PANEL FACE ──────────────────────────────────────────────────
  faceZ(m, -9, 15, 9, 26, 35, PANEL);

  // Center MFD
  screen(m, -4, 17, 4, 24, 35, FRAME, SCREEN);

  // Left gauge cluster
  screen(m, -8, 17, -5, 22, 35, FRAME, SCREEN);

  // Right gauge cluster
  screen(m, 5, 17, 8, 22, 35, FRAME, SCREEN);

  // Glare shield — horizontal lip between top of panel and canopy
  slab(m, -7, 28, 7, 35, 26, PANEL);
  // Glare shield front lip
  faceZ(m, -7, 24, 7, 26, 28, TRIM);

  // ── SEAT ───────────────────────────────────────────────────────────────────
  // Seat cushion
  slab(m, -4, 5, 4, 12, 16, SEAT);
  // Seat back
  shell(m, -4, 16, 4, 4, 27, 8, SEAT);

  // ── THROTTLE QUADRANT (left console) ───────────────────────────────────────
  // Throttle gate slot
  faceX(m, 12, 21, 26, 25, -6, TRIM);
  // Throttle lever stalk — live grip slides yBase=21 to yTop=25
  lever(m, -6, 19, 21, 24, 25, STALK, GRIP, "throttle:21:4");

  // ── RUDDER PEDALS ──────────────────────────────────────────────────────────
  solid(m, -4, 14, 28, -2, 15, 30, PEDAL);
  solid(m,  2, 14, 28,  4, 15, 30, PEDAL);

  // ── CONTROL STICK ──────────────────────────────────────────────────────────
  for (let y = 16; y <= 20; y++) m.set(`0,${y},22`, { gx: 0, gy: y, gz: 22, color: STALK });
  // Stick grip
  solid(m, -1, 20, 21, 1, 22, 23, TRIM);

  return Array.from(m.values());
}

export const falconMk2Interior: InteriorDef = {
  voxelSize: VS,
  cells: build(),
};
