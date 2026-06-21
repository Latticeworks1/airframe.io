import type { InteriorDef, InteriorCell } from "../../../voxelInterior";
import { solid, slab, faceZ, faceX, screen } from "../../../voxelInterior";

// voxelSize = 0.05 m per grid unit
// +Z = nose, +Y = up, +X = right wing
//
// cockpitEye: world [0, 1.28, 0.80] → interior grid [0, 26, 16]
// Canopy space: gx ±10, gy 15–30, gz −5 to 40
// Panel face: gz = 35 (1.75 m ahead of eye)
//
// Layout derived from reference cockpit diagrams:
//   Center panel  — attitude instruments (largest cluster)
//   Left panel    — IAS, baro altimeter
//   Right panel   — engine instruments
//   Glare shield  — gunsight reflector above coaming
//   Center floor  — control stick (prominent), landing gear handle
//   Left console  — throttle quadrant (live)
//   Right console — electrics / radio stacks

const VS = 0.05;

// palette — MeshBasicMaterial renders these at face value, no lighting factor
const FRAME  = 0x101828; // canopy arch / structural frame — near black
const PANEL  = 0x1a2c44; // instrument panel base
const COAM   = 0x22304e; // glare shield coaming — slightly lighter
const SCREEN = 0x060e0a; // unlit display glass
const BEZEL  = 0x0e1c20; // instrument bezel ring
const SIGHT  = 0x182838; // gunsight body
const SEAT   = 0x14203a; // seat fabric
const STICK  = 0x283858; // control stick / stalk
const GRIP   = 0x30486a; // stick grip / handle heads
const TQBODY = 0x1c2c40; // throttle quadrant housing
const TQLVR  = 0x18d870; // throttle lever (live — overwritten per frame)
const GEAR   = 0x283040; // landing gear handle
const FLOOR  = 0x0e1626; // cockpit floor
const CONS   = 0x14203a; // side console surfaces
const RADIO  = 0x0c1820; // radio/electrics stacks (dark boxes)

function build(): InteriorCell[] {
  const m = new Map<string, InteriorCell>();

  // ── FLOOR ─────────────────────────────────────────────────────────────────
  slab(m, -9, 2, 9, 36, 15, FLOOR);

  // ── CANOPY FRAME ──────────────────────────────────────────────────────────
  // Rear arch behind pilot head — spans across the top like a roll hoop.
  slab(m, -8, 3, 8, 10, 30, FRAME);     // top of arch
  faceX(m, 3, 25, 10, 30, -8, FRAME);  // left side of arch
  faceX(m, 3, 25, 10, 30,  8, FRAME);  // right side of arch

  // Left A-pillar — runs from shoulder level upward and forward to glare shield
  // Bottom post beside left shoulder
  faceX(m, 10, 25, 14, 30, -9, FRAME);
  // Sloping rail along canopy left side up to panel coaming
  for (let gz = 14; gz <= 29; gz++) {
    const gy = 29 - Math.round((gz - 14) * 0.1); // very slight downward slope
    m.set(`-9,${gy},${gz}`, { gx: -9, gy, gz, color: FRAME });
  }

  // Right A-pillar — mirror
  faceX(m, 10, 25, 14, 30, 9, FRAME);
  for (let gz = 14; gz <= 29; gz++) {
    const gy = 29 - Math.round((gz - 14) * 0.1);
    m.set(`9,${gy},${gz}`, { gx: 9, gy, gz, color: FRAME });
  }

  // Top canopy rail — forward from rear arch to panel coaming across top
  slab(m, -8, 10, 8, 29, 30, FRAME);

  // Center canopy bow — thin vertical divider running fore-aft at top center
  for (let gz = 8; gz <= 28; gz++)
    m.set(`0,30,${gz}`, { gx: 0, gy: 30, gz, color: FRAME });

  // ── GLARE SHIELD / COAMING ─────────────────────────────────────────────────
  // Horizontal surface between top of panel and canopy glass
  slab(m, -7, 29, 7, 35, 26, COAM);
  // Front lip of coaming (faces pilot, visible from eye position)
  faceZ(m, -7, 24, 7, 26, 29, COAM);

  // ── GUNSIGHT ───────────────────────────────────────────────────────────────
  // Reflector sight body sits on the glare shield center line.
  // Pilots look through this — keep it narrow (2 cells wide) so it doesn't obstruct.
  solid(m, -1, 26, 28, 1, 30, 29, SIGHT);
  // Sight glass (thin horizontal pane at gy=30)
  slab(m, -2, 30, 2, 33, 30, 0x1a3a2e);

  // ── INSTRUMENT PANEL FACE ─────────────────────────────────────────────────
  faceZ(m, -9, 15, 9, 26, 35, PANEL);

  // Center cluster — attitude instruments (largest group, image 4 center)
  screen(m, -4, 16, 4, 24, 35, BEZEL, SCREEN);

  // Left cluster — IAS (upper) + baro altimeter (lower), image 4 left
  screen(m, -8, 21, -5, 25, 35, BEZEL, SCREEN); // IAS
  screen(m, -8, 16, -5, 20, 35, BEZEL, SCREEN); // altimeter

  // Right cluster — engine instruments, image 4 right
  screen(m, 5, 21,  8, 25, 35, BEZEL, SCREEN); // upper engine gauge
  screen(m, 5, 16,  8, 20, 35, BEZEL, SCREEN); // lower engine gauge

  // ── LEFT SIDE CONSOLE ─────────────────────────────────────────────────────
  faceX(m, 15, 15, 35, 26, -10, CONS);
  // Console raised surface
  solid(m, -9, 15, 11, -7, 22, 28, TQBODY);

  // Throttle quadrant — images 4 and 5 show throttle handle on left
  // Gate runs along gz=14 to gz=26, grip slides with throttle
  for (let gz = 14; gz <= 26; gz++)
    m.set(`-7,21,${gz}`, { gx: -7, gy: 21, gz, color: STICK });
  // Live grip cell — slides from gz=14 (idle) to gz=26 (WEP)
  m.set(`-7,22,20`, { gx: -7, gy: 22, gz: 20, color: TQLVR, liveId: "throttle:14:12" });

  // ── RIGHT SIDE CONSOLE ─────────────────────────────────────────────────────
  faceX(m, 15, 15, 35, 26, 10, CONS);
  // Radio/electrics stacks — image 5 right side
  solid(m, 8, 15, 9, 9, 21, 24, RADIO);
  solid(m, 8, 15, 9, 9, 21, 26, RADIO);

  // ── SEAT ──────────────────────────────────────────────────────────────────
  // Cushion
  slab(m, -4, 2, 4, 11, 16, SEAT);
  // Seat back — references show high-backed ejection seat
  faceZ(m, -4, 16, 4, 28, 2, SEAT);
  // Headrest
  solid(m, -2, 26, 2, 2, 29, 4, GRIP);

  // ── CONTROL STICK ─────────────────────────────────────────────────────────
  // Image 5: tall central column, prominent.
  // Base at floor level, extends to above instrument glareshield height.
  for (let gy = 16; gy <= 23; gy++)
    m.set(`0,${gy},20`, { gx: 0, gy, gz: 20, color: STICK });
  // Grip block at top
  solid(m, -1, 22, -1, 1, 25, 21, GRIP);
  // Side handle nub (trigger side — forward-right)
  solid(m, 0, 23, 0, 1, 24, 22, STICK);

  // ── LANDING GEAR HANDLE ───────────────────────────────────────────────────
  // Image 5: center console, beside the stick base
  solid(m, -3, 15, -3, -2, 19, 24, GEAR);
  m.set(`-2,20,24`, { gx: -2, gy: 20, gz: 24, color: 0x703010 }); // red knob

  // ── RUDDER PEDALS ─────────────────────────────────────────────────────────
  solid(m, -4, 14, -2, -2, 15, 30, GRIP);
  solid(m,  2, 14, 30,  4, 15, 32, GRIP);

  return Array.from(m.values());
}

export const falconMk2Interior: InteriorDef = {
  voxelSize: VS,
  cells: build(),
};
