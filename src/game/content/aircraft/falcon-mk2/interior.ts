import type { InteriorDef, InteriorCell } from "../../../voxelInterior";
import { solid, slab, faceZ, faceX, screen } from "../../../voxelInterior";

// voxelSize = 0.025 m per grid unit (2.5 cm — twice the previous resolution)
// +Z = nose, +Y = up, +X = right wing
//
// cockpitEye world [0, 1.28, 0.80] → interior grid [0, 51, 32]
// Canopy space: gx ±20, gy 30–62, gz 0–80
// Panel face: gz = 70 (1.75 m ahead)
// Glare shield top: gy = 52 (1.30 m — eye height, so panel reads as below horizon)
//
// Layout from labeled reference diagrams:
//   Panel center — attitude instruments (large cluster)
//   Panel left   — IAS, baro altimeter
//   Panel right  — engine instruments cluster
//   Glare shield — reflector gunsight above coaming, center
//   Center floor — control stick (close in, between legs, below eye)
//   Left console — throttle quadrant (live)
//   Right console— electrics / radio stacks

const VS = 0.025;

const FRAME  = 0x101828; // canopy arch / structural — very dark
const PANEL  = 0x162438; // instrument panel face
const COAM   = 0x1e3050; // glare shield coaming
const SCREEN = 0x050c08; // unlit display glass
const BEZEL  = 0x0c1820; // instrument bezel
const SIGHT  = 0x162434; // gunsight body
const SEAT   = 0x12203a; // seat fabric
const STICK  = 0x243858; // control stick stalk
const GRIP   = 0x2c4870; // stick grip / handle head
const TQBODY = 0x182c40; // throttle housing
const TQLVR  = 0x10d060; // throttle lever (live — overwritten per frame)
const GEAR   = 0x243040; // landing gear handle housing
const FLOOR  = 0x0c1424; // cockpit floor
const CONS   = 0x10202e; // side console face — darker than panel

function build(): InteriorCell[] {
  const m = new Map<string, InteriorCell>();

  // ── FLOOR ─────────────────────────────────────────────────────────────────
  // Floor spans beneath the pilot from behind seat to panel base.
  slab(m, -18, 8, 18, 72, 30, FLOOR);

  // ── CANOPY ARCH / A-PILLARS ───────────────────────────────────────────────
  // Each A-pillar is ONE CELL THICK — a structural rib, not a slab.
  // Left A-pillar: follows the canopy frame from rear arch forward to coaming.
  // gx = -19 (one cell in from the outer canopy wall).
  for (let gz = 8; gz <= 58; gz++) {
    // Rear section rises steeply; forward section levels off at gy=60 (coaming height)
    const gy = gz < 22 ? 58 + Math.round((22 - gz) * 0.4)
             : gz < 58 ? 60
             : 60;
    m.set(`-19,${gy},${gz}`, { gx: -19, gy, gz, color: FRAME });
    // Vertical strut going DOWN from arch to eye-level sill
    for (let y = 50; y <= gy; y++)
      m.set(`-19,${y},${gz}`, { gx: -19, gy: y, gz, color: FRAME });
  }
  // Left sill rail — horizontal ledge at gy=50, gx=-18 to -19, connects arch to panel side
  slab(m, -19, 20, -18, 70, 50, FRAME);

  // Right A-pillar and sill rail (mirror)
  for (let gz = 8; gz <= 58; gz++) {
    const gy = gz < 22 ? 58 + Math.round((22 - gz) * 0.4) : 60;
    m.set(`19,${gy},${gz}`, { gx: 19, gy, gz, color: FRAME });
    for (let y = 50; y <= gy; y++)
      m.set(`19,${y},${gz}`, { gx: 19, gy: y, gz, color: FRAME });
  }
  slab(m, 18, 20, 19, 70, 50, FRAME);

  // Rear arch — spans across behind the pilot's head
  slab(m, -18, 8, 18, 20, 62, FRAME);   // top bar
  faceX(m, 8, 50, 20, 62, -18, FRAME);  // left side of arch
  faceX(m, 8, 50, 20, 62,  18, FRAME);  // right side of arch

  // Top canopy rail running fore-aft at gy=62 (roof of canopy)
  slab(m, -17, 8, 17, 58, 62, FRAME);

  // Center canopy bow — ONE CELL WIDE divider running fore-aft along the center line
  for (let gz = 8; gz <= 57; gz++)
    m.set(`0,62,${gz}`, { gx: 0, gy: 62, gz, color: FRAME });

  // ── GLARE SHIELD / COAMING ────────────────────────────────────────────────
  // Sits at gy=52 (just above eye at gy=51), gz=56-70.
  // One cell thick so it's a visible ledge but doesn't block the sky.
  slab(m, -14, 56, 14, 70, 52, COAM);
  // Coaming front lip (faces pilot from gz=56)
  faceZ(m, -14, 48, 14, 52, 56, COAM);

  // ── GUNSIGHT ──────────────────────────────────────────────────────────────
  // Reflector sight: narrow body on center line at gy=52-55, gz=60-65.
  // Two cells wide so it frames the gunsight glass without blocking view.
  solid(m, -2, 52, 60, 2, 56, 65, SIGHT);
  // Sight glass — thin amber plate at gy=57
  slab(m, -3, 61, 3, 65, 57, 0x1a3a28);

  // ── INSTRUMENT PANEL (center section only — NOT wall to wall) ─────────────
  // Real cockpits have a narrower center panel with separate side consoles.
  // Center panel: gx -14 to 14, gy 30 to 52, gz 70.
  faceZ(m, -14, 30, 14, 52, 70, PANEL);

  // ── INSTRUMENT SCREENS ────────────────────────────────────────────────────
  // Center — attitude instruments (large, dominant cluster per reference image 4)
  screen(m, -7, 33, 7, 50, 70, BEZEL, SCREEN);

  // Left — IAS (upper) + baro alt (lower)
  screen(m, -13, 42, -8, 51, 70, BEZEL, SCREEN); // IAS
  screen(m, -13, 31, -8, 41, 70, BEZEL, SCREEN); // altimeter

  // Right — engine instruments (two gauges stacked)
  screen(m,  8, 42, 13, 51, 70, BEZEL, SCREEN); // engine upper
  screen(m,  8, 31, 13, 41, 70, BEZEL, SCREEN); // engine lower

  // ── SIDE CONSOLES ─────────────────────────────────────────────────────────
  // Left console surface — lower than panel top, runs from gz=20 to gz=68
  slab(m, -18, 20, -15, 68, 44, CONS);
  // Right console surface
  slab(m, 15, 20, 18, 68, 44, CONS);

  // Left console front lip (connects to panel side)
  faceZ(m, -18, 30, -15, 44, 68, CONS);
  // Right console front lip
  faceZ(m, 15, 30, 18, 44, 68, CONS);

  // ── THROTTLE QUADRANT (left console) ──────────────────────────────────────
  // Gate housing on left console — gz = 28 to 56
  solid(m, -17, 44, 28, -15, 50, 56, TQBODY);
  // Gate slot (one-cell channel the lever rides in)
  for (let gz = 28; gz <= 56; gz++)
    m.set(`-16,47,${gz}`, { gx: -16, gy: 47, gz, color: STICK });
  // Live throttle lever grip — slides gz=28 (idle) → gz=56 (WEP)
  m.set(`-16,50,28`, { gx: -16, gy: 50, gz: 28, color: TQLVR, liveId: "throttle:28:28" });

  // ── RIGHT CONSOLE — radio / electrics stacks ──────────────────────────────
  solid(m, 15, 44,  9, 17, 50, 34, 0x0c1820);
  solid(m, 15, 44, 36, 17, 50, 52, 0x0c1820);

  // ── SEAT ──────────────────────────────────────────────────────────────────
  // Seat cushion — behind pilot, gz = 4 to 22, gx ±8
  slab(m, -8, 4, 8, 22, 30, SEAT);
  // Seat back — high ejection-seat back from floor to headrest
  faceZ(m, -8, 30, 8, 58, 4, SEAT);
  // Headrest block
  solid(m, -4, 56, 2, 4, 60, 8, GRIP);

  // ── CONTROL STICK ─────────────────────────────────────────────────────────
  // The stick is BETWEEN THE PILOT'S LEGS — close to the camera, below eye level.
  // gz=38 (one meter ahead of eye at gz=32), gy=30-44.
  // At this position it is OUT of the direct sightline to the instrument panel.
  for (let gy = 30; gy <= 44; gy++)
    m.set(`0,${gy},38`, { gx: 0, gy, gz: 38, color: STICK });
  // Grip block at top — small, knuckle-sized
  solid(m, -2, 43, 37, 2, 47, 40, GRIP);
  // Forward trigger nub
  m.set(`1,45,39`, { gx: 1, gy: 45, gz: 39, color: STICK });

  // ── LANDING GEAR HANDLE ───────────────────────────────────────────────────
  // Left of stick base, per reference image 5
  solid(m, -5, 30, -4, -3, 38, 40, GEAR);
  m.set(`-4,39,38`, { gx: -4, gy: 39, gz: 38, color: 0x882020 }); // red knob

  // ── RUDDER PEDALS ─────────────────────────────────────────────────────────
  solid(m, -8, 28, -4, -5, 30, 62, GRIP);
  solid(m,  5, 28, 62,  8, 30, 66, GRIP);

  return Array.from(m.values());
}

export const falconMk2Interior: InteriorDef = {
  voxelSize: VS,
  cells: build(),
};
