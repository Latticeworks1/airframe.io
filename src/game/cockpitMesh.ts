import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { componentGeometries } from "./cockpitComponent";
import seatEjectorJson    from "./content/cockpit/seat-ejector.json";
import stickJson          from "./content/cockpit/stick.json";
import throttleSingleJson from "./content/cockpit/throttle-single.json";
import throttleTwinJson   from "./content/cockpit/throttle-twin.json";
import bombsightJson      from "./content/cockpit/bombsight.json";

// Cockpit interior: FAA 6-pack canvas panel + merged structural shell + gunsight glass.
// Total draw calls: 3 (panel, structure, glass).

export interface CockpitDef {
  eye: [number, number, number];
  sightAnchor: [number, number, number];
  panelZ: number;
  panelY: number;
  panelW: number;
  panelH: number;
  // Drives aircraft-specific component selection (seat variant, throttle layout,
  // bomber sight). Omitting falls back to the standard single-seat fighter layout.
  aircraftId?: string;
}

export interface CockpitState {
  group: THREE.Group;
  eyeLocal: THREE.Vector3;
  sightAnchorLocal: THREE.Vector3;
  updateLive(
    speed01: number,
    alt01: number,
    heading01: number,
    throttle01: number,
    pitch_rad: number,
    roll_rad: number,
    gearDown: boolean,
    flapsOut: boolean,
    airbrakeOn: boolean,
    engineDamaged: boolean
  ): void;
  dispose(): void;
}

// ── FAA 6-pack gauge helpers ────────────────────────────────────────────────

function bezel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#3a4a5e";
  ctx.lineWidth = r * 0.16;
  ctx.stroke();
}

function gaugeBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = "#07111f";
  ctx.fill();
  bezel(ctx, cx, cy, r);
}

function needle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  angleCW_rad: number,
  length = 0.78,
  color = "#FAE5AD",
  width = 2
) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(angleCW_rad - Math.PI / 2) * r * length,
    cy + Math.sin(angleCW_rad - Math.PI / 2) * r * length
  );
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = "#8ebce6";
  ctx.fill();
}

function tickRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  count: number,
  startAngle: number,
  sweepAngle: number,
  majorEvery: number
) {
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (i / count) * sweepAngle - Math.PI / 2;
    const major = i % majorEvery === 0;
    const inner = major ? r * 0.70 : r * 0.80;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * r * 0.90, cy + Math.sin(a) * r * 0.90);
    ctx.strokeStyle = major ? "#6ba3db" : "#2e4a68";
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  text: string,
  yOff = 0.60
) {
  ctx.fillStyle = "#7a9ab8";
  ctx.font = `bold ${Math.round(r * 0.32)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + r * yOff);
}

// ── Airspeed Indicator ──────────────────────────────────────────────────────
// 270° sweep: 0 kt at 7 o'clock (225°), max at 5 o'clock (135°).
function drawASI(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  speed01: number
) {
  gaugeBase(ctx, cx, cy, r);
  const start = (225 / 180) * Math.PI;
  const sweep = (270 / 180) * Math.PI;

  // Color arcs (white flap, green normal, yellow caution)
  const arcData: [number, number, string][] = [
    [0.10, 0.35, "#e0e0e0"],  // white – flap range
    [0.35, 0.75, "#22c55e"],  // green – normal ops
    [0.75, 0.95, "#eab308"],  // yellow – caution
  ];
  for (const [t0, t1, color] of arcData) {
    ctx.beginPath();
    ctx.arc(
      cx, cy, r * 0.88,
      start + t0 * sweep - Math.PI / 2,
      start + t1 * sweep - Math.PI / 2
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.07;
    ctx.stroke();
  }

  tickRing(ctx, cx, cy, r, 27, start, sweep, 3);
  const needleAngle = start + speed01 * sweep;
  needle(ctx, cx, cy, r, needleAngle);
  label(ctx, cx, cy, r, "KIAS");
}

// ── Attitude Indicator (ADI) ────────────────────────────────────────────────
// pitch_rad: positive = nose up. roll_rad: positive = right bank.
function drawADI(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  pitch_rad: number,
  roll_rad: number
) {
  bezel(ctx, cx, cy, r);

  ctx.save();
  ctx.translate(cx, cy);

  // Clip to instrument face
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.clip();

  // Earth fill
  ctx.fillStyle = "#5c3314";
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // Sky fill — rotated + shifted by pitch. Positive pitch → horizon moves down.
  ctx.save();
  ctx.rotate(roll_rad);
  const pitchOffset = Math.sin(THREE.MathUtils.clamp(pitch_rad, -0.52, 0.52)) * r * 1.6;
  ctx.fillStyle = "#17457a";
  ctx.fillRect(-r * 3, -r * 3, r * 6, r * 3 + pitchOffset);

  // Horizon line
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 1.2, pitchOffset);
  ctx.lineTo(r * 1.2, pitchOffset);
  ctx.stroke();

  // Pitch ladder (±5, ±10°)
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "#e8e8e8";
  ctx.font = `bold ${Math.round(r * 0.22)}px monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const deg of [-10, -5, 5, 10]) {
    const yOff = pitchOffset - Math.sin((deg / 180) * Math.PI) * r * 1.6;
    const half = deg % 10 === 0 ? r * 0.42 : r * 0.26;
    ctx.beginPath();
    ctx.moveTo(-half, yOff);
    ctx.lineTo(half, yOff);
    ctx.stroke();
    if (deg % 10 === 0) {
      ctx.fillText(String(Math.abs(deg)), -half - r * 0.08, yOff);
    }
  }
  ctx.restore();

  // Bank marks (fixed to instrument, not rotating)
  const bankAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  for (const deg of bankAngles) {
    const a = (deg / 180) * Math.PI - Math.PI / 2;
    const inner = deg % 30 === 0 ? r * 0.82 : r * 0.87;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.strokeStyle = "#c8d8e8";
    ctx.lineWidth = deg === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Bank pointer triangle (rotates with roll)
  ctx.save();
  ctx.rotate(roll_rad);
  ctx.beginPath();
  ctx.moveTo(0, -(r * 0.82));
  ctx.lineTo(-r * 0.05, -(r * 0.72));
  ctx.lineTo(r * 0.05, -(r * 0.72));
  ctx.closePath();
  ctx.fillStyle = "#e8e8e8";
  ctx.fill();
  ctx.restore();

  // Fixed miniature aircraft wings
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.52, 0); ctx.lineTo(-r * 0.18, 0); ctx.lineTo(-r * 0.08, r * 0.12);
  ctx.moveTo(r * 0.52, 0); ctx.lineTo(r * 0.18, 0); ctx.lineTo(r * 0.08, r * 0.12);
  ctx.moveTo(-r * 0.08, 0); ctx.lineTo(r * 0.08, 0);
  ctx.stroke();

  ctx.restore();
}

// ── Altimeter ───────────────────────────────────────────────────────────────
// alt01 = 0..1 mapping to 0..14000 ft. Single large needle makes one full
// revolution per 1000 ft; a smaller needle counts thousands.
function drawAltimeter(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  alt01: number
) {
  gaugeBase(ctx, cx, cy, r);
  tickRing(ctx, cx, cy, r, 50, 0, Math.PI * 2, 5);

  const altFt = alt01 * 14000;
  const longAngle  = ((altFt % 1000) / 1000) * Math.PI * 2;
  const shortAngle = ((altFt % 10000) / 10000) * Math.PI * 2;

  // Thousands needle (shorter, wider)
  needle(ctx, cx, cy, r, shortAngle, 0.56, "#c8c8c8", 3);
  // Hundreds needle (longer, thin)
  needle(ctx, cx, cy, r, longAngle, 0.80, "#FAE5AD", 2);

  label(ctx, cx, cy, r, "ALT ft");
}

// ── Turn Coordinator ────────────────────────────────────────────────────────
// Shows bank angle via a banked miniature aircraft. Standard rate = 15° bank.
function drawTurnCoordinator(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  roll_rad: number
) {
  gaugeBase(ctx, cx, cy, r);

  // Standard rate tick marks at ±15° (2 min turn)
  for (const side of [-1, 1]) {
    const a = (side * 25 / 180) * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    ctx.lineTo(cx + Math.cos(a) * r * 0.90, cy + Math.sin(a) * r * 0.90);
    ctx.strokeStyle = "#6ba3db";
    ctx.lineWidth = 2;
    ctx.stroke();
    // L/R labels
    ctx.fillStyle = "#6ba3db";
    ctx.font = `bold ${Math.round(r * 0.28)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(side < 0 ? "L" : "R", cx + side * r * 0.56, cy - r * 0.18);
  }

  // Banked miniature aircraft
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(THREE.MathUtils.clamp(roll_rad, -0.6, 0.6) * 0.8);
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  // Wings
  ctx.moveTo(-r * 0.58, r * 0.06); ctx.lineTo(-r * 0.18, r * 0.06);
  ctx.lineTo(-r * 0.08, r * 0.18);
  ctx.moveTo(r * 0.58, r * 0.06); ctx.lineTo(r * 0.18, r * 0.06);
  ctx.lineTo(r * 0.08, r * 0.18);
  // Fuselage dot
  ctx.moveTo(-r * 0.08, r * 0.06); ctx.lineTo(r * 0.08, r * 0.06);
  ctx.stroke();
  ctx.restore();

  // Inclinometer ball (slip/skid) — always centered for now
  const ballY = cy + r * 0.62;
  ctx.beginPath();
  ctx.arc(cx, ballY, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = "#FAE5AD";
  ctx.fill();
  ctx.strokeStyle = "#3a4a5e";
  ctx.lineWidth = 1;
  ctx.stroke();

  label(ctx, cx, cy, r, "COORD", 0.38);
}

// ── Heading Indicator (DI) ──────────────────────────────────────────────────
// heading01 = 0..1 maps to 0..360°. Compass rose rotates; lubber line fixed.
function drawHeading(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  heading01: number
) {
  gaugeBase(ctx, cx, cy, r);

  const hdgRad = heading01 * Math.PI * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-hdgRad);

  // Major cardinal + intercardinal marks
  const cardinals = ["N", "E", "S", "W"];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const major = i % 9 === 0;
    const semi  = i % 3 === 0 && !major;
    const inner = major ? r * 0.60 : semi ? r * 0.70 : r * 0.80;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 0.90, Math.sin(a) * r * 0.90);
    ctx.strokeStyle = major ? "#e8e8e8" : semi ? "#6ba3db" : "#2e4a68";
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
    if (major) {
      const idx = i / 9;
      ctx.fillStyle = cardinals[idx] === "N" ? "#ef4444" : "#e8e8e8";
      ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        cardinals[idx],
        Math.cos(a) * r * 0.54,
        Math.sin(a) * r * 0.54
      );
    }
  }
  ctx.restore();

  // Fixed lubber line at 12 o'clock
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.90);
  ctx.lineTo(cx, cy - r * 0.68);
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 3;
  ctx.stroke();

  label(ctx, cx, cy, r, "HDG");
}

// ── Vertical Speed Indicator ────────────────────────────────────────────────
// vsi01 = signed −1..+1, 0 = level. Center = 9 o'clock. Up sweep = climb.
function drawVSI(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  vsi01: number
) {
  gaugeBase(ctx, cx, cy, r);
  // Scale ticks: 0 at left (9 o'clock), +UP at top (12), -DOWN at bottom.
  tickRing(ctx, cx, cy, r, 16, -Math.PI / 2, Math.PI * 2, 4);

  // VSI sweep: 180° total centered on the 9 o'clock (−π/2 from top).
  // 0 → 9 o'clock = −π (pointing left), climb → top = −π/2
  const a = -Math.PI - vsi01 * (Math.PI * 0.75);
  needle(ctx, cx, cy, r, a + Math.PI / 2, 0.78, "#FAE5AD", 2);

  // Zero marker at 9 o'clock
  ctx.fillStyle = "#6ba3db";
  ctx.font = `bold ${Math.round(r * 0.24)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("0", cx - r * 0.54, cy);

  label(ctx, cx, cy, r, "VSI");
}

// ── Geometry helpers ────────────────────────────────────────────────────────

function quadMesh(
  a: THREE.Vector3, b: THREE.Vector3,
  c: THREE.Vector3, d: THREE.Vector3,
  mat: THREE.Material
): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z,
    a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// ── Structural geometry helpers ─────────────────────────────────────────────

function coloredBoxGeo(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  color: THREE.Color,
  rx = 0, ry = 0, rz = 0
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.deleteAttribute("uv");

  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;

  for (let i = 0; i < count; i++) {
    const normalY = normal.getY(i);
    const normalZ = normal.getZ(i);
    const localY  = pos.getY(i);
    let shade = 0.94;
    if (normalY > 0.5) shade = 1.08;
    else if (normalY < -0.5) shade = 0.76;
    else if (normalZ < -0.5) shade = 0.88;
    if (localY < -h * 0.2) shade *= 0.92;
    colors[i * 3]     = Math.min(1, color.r * shade);
    colors[i * 3 + 1] = Math.min(1, color.g * shade);
    colors[i * 3 + 2] = Math.min(1, color.b * shade);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

function coloredBeamGeo(
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number,
  color: THREE.Color
): THREE.BufferGeometry {
  const center = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize()
  );
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  return coloredBoxGeo(
    thickness, length, thickness,
    center.x, center.y, center.z,
    color, euler.x, euler.y, euler.z
  );
}

function coloredClosedHullGeo(
  vertices: THREE.Vector3[],
  quads: [number, number, number, number][],
  color: THREE.Color
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [a, b, c, d] of quads) {
    for (const index of [a, b, c, a, c, d]) {
      const v = vertices[index];
      positions.push(v.x, v.y, v.z);
      colors.push(color.r, color.g, color.b);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color",    new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
  geometry.computeVertexNormals();
  return geometry;
}

// ── Build ────────────────────────────────────────────────────────────────────

export function buildCockpitMesh(def: CockpitDef): CockpitState {
  const group = new THREE.Group();
  const aircraftId = def.aircraftId ?? "";
  const [, eyeY, eyeZ] = def.eye;
  const PW = def.panelW;
  const PH = def.panelH;
  const panelTop = def.panelY + PH / 2;

  const CW = 512;
  const CH = Math.round(CW * PH / PW);
  const canvas = document.createElement("canvas");
  canvas.width  = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d")!;

  let _speed01 = 0, _alt01 = 0, _heading01 = 0;
  let _pitch_rad = 0, _roll_rad = 0;
  let _prevAlt01 = 0, _vsi01 = 0;
  let _gearDown = false, _flapsOut = false, _airbrakeOn = false, _engineDamaged = false;

  function drawPanel() {
    ctx.save();
    // Compensate for BackSide UV.x mirror
    ctx.translate(CW, 0);
    ctx.scale(-1, 1);

    ctx.fillStyle = "#0d1520";
    ctx.fillRect(0, 0, CW, CH);

    const gr = CW * 0.079;  // ~40 px – outer gauges
    const ar = CW * 0.092;  // ~47 px – ADI is slightly larger

    const rowTop = CH * 0.27;
    const rowBot = CH * 0.73;
    const col1 = CW * 0.165;
    const col2 = CW * 0.500;
    const col3 = CW * 0.835;

    // Top row: ASI | ADI | ALT
    drawASI(ctx, col1, rowTop, gr, _speed01);
    drawADI(ctx, col2, rowTop, ar, _pitch_rad, _roll_rad);
    drawAltimeter(ctx, col3, rowTop, gr, _alt01);

    // Bottom row: Turn Coordinator | Heading | VSI
    drawTurnCoordinator(ctx, col1, rowBot, gr, _roll_rad);
    drawHeading(ctx, col2, rowBot, gr, _heading01);
    drawVSI(ctx, col3, rowBot, gr, _vsi01);

    // Indicator light strip — one lamp per real pilot state, bottom of panel
    const indCY  = CH * 0.91;
    const indH   = CH * 0.046;
    const indW   = CW * 0.095;
    const indGap = CW * 0.005;
    const indSpecs: [number, string, boolean, string][] = [
      [CW * 0.165, "GEAR",  _gearDown,       "#22c55e"],
      [CW * 0.390, "FLAPS", _flapsOut,       "#eab308"],
      [CW * 0.610, "AIRBRK", _airbrakeOn,    "#ef4444"],
      [CW * 0.835, "ENG",   _engineDamaged,  "#ef4444"],
    ];
    for (const [cx, name, lit, litColor] of indSpecs) {
      ctx.fillStyle = lit ? litColor : "#0d1825";
      ctx.fillRect(cx - indW / 2, indCY - indH / 2, indW, indH);
      ctx.strokeStyle = lit ? litColor : "#1e3048";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - indW / 2 + indGap, indCY - indH / 2 + indGap, indW - indGap * 2, indH - indGap * 2);
      ctx.fillStyle = lit ? "#ffffff" : "#1e3048";
      ctx.font = `bold ${Math.round(indH * 0.52)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, cx, indCY);
    }

    // Thin bevel
    ctx.strokeStyle = "#2d4a6e";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, CW - 3, CH - 3);

    ctx.restore();
    tex.needsUpdate = true;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  // Panel face sits 8 mm in front of the structural shell's front face to
  // eliminate z-fighting; polygon offset provides additional GPU-level guard.
  const panelMat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 8,
  });
  drawPanel();

  const panelGeo = new THREE.PlaneGeometry(PW, PH);
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.position.set(0, def.panelY, def.panelZ - 0.008);
  group.add(panelMesh);

  // ── Structural colors ──────────────────────────────────────────────────────
  const cPanelShell = new THREE.Color("#202a38");
  const cSidePanel  = new THREE.Color("#26364f");
  const cConsole    = new THREE.Color("#172233");
  const cFloor      = new THREE.Color("#0b1019");
  const cPillar     = new THREE.Color("#465977");
  const cGunsight   = new THREE.Color("#29413d");

  const panelDepth            = 0.055;
  const pillarThickness       = 0.024;
  const panelJunctionOverlap  = 0.028;
  const panelSidePostWidth    = 0.060;
  const structuralGeometries: THREE.BufferGeometry[] = [];

  // 1. Panel shell (glare shield on top)
  structuralGeometries.push(coloredBoxGeo(
    PW + 0.04, PH + 0.035, panelDepth,
    0, def.panelY + 0.0125, def.panelZ + panelDepth / 2,
    cPanelShell
  ));

  // 2. Cockpit tub
  const floorOffset        = 0.72;
  const rearExtension      = 0.52;
  const rearTopDrop        = 0.36;
  const floorY   = eyeY - floorOffset;
  const rearZ    = eyeZ - rearExtension;
  const frontZ   = def.panelZ - 0.008;
  const frontInnerX  = PW / 2 - panelJunctionOverlap;
  const frontOuterX  = PW / 2 + 0.105;
  const rearInnerX   = PW / 2 + 0.19;
  const rearOuterX   = PW / 2 + 0.34;
  const frontTopY    = panelTop + 0.020;
  const rearTopY     = eyeY - rearTopDrop;

  // Canopy geometry constants — hoisted so windshield pillars can share them.
  const canopyTopY   = eyeY + 0.32;
  const rearArchY    = eyeY + 0.20;
  const canopyHalfW  = 0.42;
  const canopyFrontZ = eyeZ - 0.14;

  // Floor
  structuralGeometries.push(coloredBoxGeo(
    rearOuterX * 2, 0.026, frontZ - rearZ,
    0, floorY, (frontZ + rearZ) / 2,
    cFloor
  ));
  // Firewall (below panel)
  const firewallTop = def.panelY - PH / 2;
  structuralGeometries.push(coloredBoxGeo(
    PW + 0.21, firewallTop - floorY, 0.036,
    0, floorY + (firewallTop - floorY) / 2, def.panelZ + 0.012,
    cPanelShell
  ));
  // Rear bulkhead
  structuralGeometries.push(coloredBoxGeo(
    rearOuterX * 2, rearTopY - floorY, 0.035,
    0, floorY + (rearTopY - floorY) / 2, rearZ,
    cPanelShell
  ));

  for (const side of [-1, 1]) {
    const innerFrontX = side * frontInnerX;
    const outerFrontX = side * frontOuterX;
    const innerRearX  = side * rearInnerX;
    const outerRearX  = side * rearOuterX;

    // Panel junction post
    structuralGeometries.push(coloredBoxGeo(
      panelSidePostWidth, PH + 0.075, panelDepth + 0.035,
      side * (PW / 2 + panelSidePostWidth / 2 - panelJunctionOverlap),
      def.panelY + 0.004, def.panelZ + 0.004,
      cPanelShell
    ));

    // Side wall trapezoid
    const wallVerts = [
      new THREE.Vector3(innerFrontX, floorY,    frontZ),
      new THREE.Vector3(outerFrontX, floorY,    frontZ),
      new THREE.Vector3(outerFrontX, frontTopY, frontZ),
      new THREE.Vector3(innerFrontX, frontTopY, frontZ),
      new THREE.Vector3(innerRearX,  floorY,    rearZ),
      new THREE.Vector3(outerRearX,  floorY,    rearZ),
      new THREE.Vector3(outerRearX,  rearTopY,  rearZ),
      new THREE.Vector3(innerRearX,  rearTopY,  rearZ),
    ];
    structuralGeometries.push(coloredClosedHullGeo(wallVerts, [
      [0,1,2,3],[4,7,6,5],[0,3,7,4],[1,5,6,2],[0,4,5,1],[3,2,6,7],
    ], cSidePanel));

    // Console rail
    const railFront = new THREE.Vector3(innerFrontX, frontTopY + 0.012, frontZ - 0.006);
    const railRear  = new THREE.Vector3(innerRearX,  rearTopY  + 0.012, rearZ);
    structuralGeometries.push(coloredBeamGeo(railFront, railRear, 0.032, cConsole));

    // Windshield pillar: base at panel corner, top at canopy front bow corner.
    structuralGeometries.push(coloredBeamGeo(
      new THREE.Vector3(innerFrontX, panelTop + 0.025, def.panelZ - 0.010),
      new THREE.Vector3(side * canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
      pillarThickness, cPillar
    ));


    // Side console shelf — a horizontal surface at approximately thigh height,
    // positioned inboard of the side wall inner face so it reads as a distinct
    // shelf rather than merging with the wall geometry.
    // Outer edge sits 12 mm clear of frontInnerX (0.662) to ensure no overlap
    // with the trapezoidal side wall at any Z.
    const cabLen  = frontZ - rearZ;
    const cabCZ   = (frontZ + rearZ) / 2;
    const shelfW  = 0.060;
    const shelfH  = 0.016;
    const shelfY  = floorY + 0.35;  // thigh/seat height; clearly below eye (1.50) but visible
    const shelfX  = side * (frontInnerX - 0.012 - shelfW / 2);  // outer edge 12 mm inside frontInnerX
    structuralGeometries.push(coloredBoxGeo(
      shelfW, shelfH, cabLen,
      shelfX, shelfY, cabCZ,
      cConsole
    ));

    // Switch panel face on top of the shelf
    const spFaceH = 0.007;
    const spFaceY = shelfY + shelfH / 2 + spFaceH / 2;
    structuralGeometries.push(coloredBoxGeo(
      shelfW - 0.016, spFaceH, cabLen * 0.78,
      shelfX, spFaceY, cabCZ,
      new THREE.Color("#090b10")
    ));

  }

  // 3. Gunsight body
  const sightBodyZ  = def.panelZ - 0.11;
  const sightGlassZ = def.sightAnchor[2];
  const sightGlassW = 0.17;
  const sightGlassH = 0.15;
  structuralGeometries.push(coloredBoxGeo(
    0.090, 0.070, 0.130,
    0, panelTop + 0.045, sightBodyZ,
    cGunsight
  ));
  for (const side of [-1, 1]) {
    structuralGeometries.push(coloredBoxGeo(
      0.014, 0.100, 0.020,
      side * 0.070, panelTop + 0.090, sightGlassZ + 0.010,
      cGunsight
    ));
  }

  // 4. Control stick — JSON component (CylinderGeometry shaft, SphereGeometry knob)
  const stickZ     = eyeZ + 0.25;
  const stickBaseY = floorY + 0.035;
  for (const g of componentGeometries(
    stickJson,
    new THREE.Vector3(0, stickBaseY, stickZ),
    cConsole
  )) structuralGeometries.push(g);

  // 5. Throttle lever — JSON component (CylinderGeometry handle)
  const throttleAmount    = 0.43;
  const throttleRailFront = new THREE.Vector3(-frontInnerX, frontTopY + 0.012, frontZ - 0.006);
  const throttleRailRear  = new THREE.Vector3(-rearInnerX,  rearTopY  + 0.012, rearZ);
  const throttleBase      = throttleRailFront.clone().lerp(throttleRailRear, throttleAmount);

  // Throttle base sled (structural, stays as box)
  structuralGeometries.push(coloredBoxGeo(
    0.055, 0.012, 0.070,
    throttleBase.x, throttleBase.y + 0.020, throttleBase.z,
    cConsole
  ));
  for (const g of componentGeometries(
    throttleSingleJson,
    new THREE.Vector3(throttleBase.x, throttleBase.y + 0.032, throttleBase.z),
    cConsole
  )) structuralGeometries.push(g);

  // 6. Ejector seat — JSON component (cylinder rails, framed backrest, cheek headrest)
  const seatZ           = eyeZ - 0.06;
  const seatCushionTopY = eyeY - 0.50;
  for (const g of componentGeometries(
    seatEjectorJson,
    new THREE.Vector3(0, seatCushionTopY, seatZ - 0.21),
    cPillar
  )) structuralGeometries.push(g);

  // 7. Aircraft-specific components.

  // Grizzly A1: cylindrical bomb-sight scope on left glare shield
  if (aircraftId === "grizzly-a1") {
    for (const g of componentGeometries(
      bombsightJson,
      new THREE.Vector3(-0.26, panelTop + 0.026, def.panelZ - 0.064),
      cGunsight
    )) structuralGeometries.push(g);
  }

  // Twinwolf and Grizzly: second throttle handle (blue) offset 50 mm from first
  if (aircraftId === "twinwolf" || aircraftId === "grizzly-a1") {
    for (const g of componentGeometries(
      throttleTwinJson,
      new THREE.Vector3(throttleBase.x - 0.050, throttleBase.y + 0.032, throttleBase.z),
      cConsole
    )) structuralGeometries.push(g);
  }

  // 8. Canopy frame — overhead and rear coverage

  // Extend the rear bulkhead up to the arch (fills the gap above rearTopY)
  const rearBulkExtH = rearArchY - rearTopY + 0.020;
  if (rearBulkExtH > 0.001) {
    structuralGeometries.push(coloredBoxGeo(
      rearOuterX * 2, rearBulkExtH, 0.035,
      0, rearTopY + rearBulkExtH / 2 - 0.010, rearZ,
      cPanelShell
    ));
  }

  // Rear header arch bar
  structuralGeometries.push(coloredBoxGeo(
    canopyHalfW * 2 + 0.04, 0.036, 0.036,
    0, rearArchY, rearZ, cPillar
  ));

  // Center canopy spine
  structuralGeometries.push(coloredBeamGeo(
    new THREE.Vector3(0, canopyTopY, canopyFrontZ),
    new THREE.Vector3(0, rearArchY, rearZ),
    0.020, cPillar
  ));

  // Side canopy rails
  for (const side of [-1, 1]) {
    structuralGeometries.push(coloredBeamGeo(
      new THREE.Vector3(side * canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
      new THREE.Vector3(side * canopyHalfW, rearArchY,          rearZ),
      0.020, cPillar
    ));
  }

  // Front canopy bow — closes the open front edge between the two rail ends.
  structuralGeometries.push(coloredBeamGeo(
    new THREE.Vector3(-canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
    new THREE.Vector3( canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
    0.020, cPillar
  ));

  const merged = mergeGeometries(structuralGeometries);
  structuralGeometries.forEach(g => g.dispose());

  const structMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.25,
    emissive: new THREE.Color("#0a111c"),
    emissiveIntensity: 0.75,
    side: THREE.DoubleSide,
  });
  const structMesh = new THREE.Mesh(merged, structMat);
  group.add(structMesh);

  // Gunsight glass
  const glassGeo = new THREE.BoxGeometry(sightGlassW, sightGlassH, 0.004);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  const sightAnchorLocal = new THREE.Vector3(...def.sightAnchor);
  glassMesh.position.copy(sightAnchorLocal);
  glassMesh.rotation.set(-0.08, 0, 0);
  group.add(glassMesh);

  // Canopy glass — three panels (left, right, and center crown) covering the
  // overhead area that would otherwise reveal the void when looking backward.
  const canopyGlassMat = new THREE.MeshBasicMaterial({
    color: 0x0d1829, transparent: true, opacity: 0.36,
    depthWrite: false, side: THREE.DoubleSide,
  });

  const cFrontL = new THREE.Vector3(-canopyHalfW, canopyTopY - 0.060, canopyFrontZ);
  const cFrontR = new THREE.Vector3( canopyHalfW, canopyTopY - 0.060, canopyFrontZ);
  const cFrontC = new THREE.Vector3(0,            canopyTopY,          canopyFrontZ);
  const cRearL  = new THREE.Vector3(-canopyHalfW, rearArchY,           rearZ);
  const cRearR  = new THREE.Vector3( canopyHalfW, rearArchY,           rearZ);
  const cRearC  = new THREE.Vector3(0,            rearArchY,           rearZ);

  // Left overhead panel: center front → left rail front → left rail rear → center rear
  group.add(quadMesh(cFrontC, cFrontL, cRearL, cRearC, canopyGlassMat));
  // Right overhead panel: mirror
  group.add(quadMesh(cFrontC, cRearC, cRearR, cFrontR, canopyGlassMat));

  // Left side panel: left rail → outer fuselage wall at matching Z extents
  const sideWallFrontL = new THREE.Vector3(-frontOuterX, frontTopY, frontZ);
  const sideWallRearL  = new THREE.Vector3(-rearOuterX,  rearTopY,  rearZ);
  group.add(quadMesh(cFrontL, sideWallFrontL, sideWallRearL, cRearL, canopyGlassMat));
  // Right side panel: mirror
  const sideWallFrontR = new THREE.Vector3(frontOuterX, frontTopY, frontZ);
  const sideWallRearR  = new THREE.Vector3(rearOuterX,  rearTopY,  rearZ);
  group.add(quadMesh(cFrontR, cRearR, sideWallRearR, sideWallFrontR, canopyGlassMat));

  // Windshield: two panes from panel top to the front canopy bow.
  // Outer edge of each pane extends half-pillar-thickness past the pillar center
  // so the glass visually overlaps the pillar body and leaves no gap at the edges.
  const wGlassExt = pillarThickness * 0.55;
  const wBotC = new THREE.Vector3(0,                           panelTop + 0.025, def.panelZ - 0.010);
  const wBotL = new THREE.Vector3(-(frontInnerX + wGlassExt), panelTop + 0.025, def.panelZ - 0.010);
  const wBotR = new THREE.Vector3(  frontInnerX + wGlassExt,  panelTop + 0.025, def.panelZ - 0.010);
  const wTopL = new THREE.Vector3(-(canopyHalfW + wGlassExt), canopyTopY - 0.060, canopyFrontZ);
  const wTopR = new THREE.Vector3(  canopyHalfW + wGlassExt,  canopyTopY - 0.060, canopyFrontZ);
  group.add(quadMesh(cFrontC, wTopL, wBotL, wBotC, canopyGlassMat));
  group.add(quadMesh(cFrontC, wBotC, wBotR, wTopR, canopyGlassMat));

  group.visible = false;

  return {
    group,
    eyeLocal: new THREE.Vector3(...def.eye),
    sightAnchorLocal,
    updateLive(speed01, alt01, heading01, _throttle01, pitch_rad, roll_rad, gearDown, flapsOut, airbrakeOn, engineDamaged) {
      _speed01        = speed01;
      _vsi01          = THREE.MathUtils.clamp((_alt01 - _prevAlt01) * 8, -1, 1);
      _prevAlt01      = _alt01;
      _alt01          = alt01;
      _heading01      = heading01;
      _pitch_rad      = pitch_rad;
      _roll_rad       = roll_rad;
      _gearDown       = gearDown;
      _flapsOut       = flapsOut;
      _airbrakeOn     = airbrakeOn;
      _engineDamaged  = engineDamaged;
      drawPanel();
    },
    dispose() {
      panelGeo.dispose();   panelMat.dispose();
      tex.dispose();        canvas.remove();
      merged.dispose();     structMat.dispose();
      glassGeo.dispose();   glassMat.dispose();
    },
  };
}
