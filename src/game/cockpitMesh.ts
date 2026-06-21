import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Cockpit interior: canvas-based panel + merged BoxGeometry structure.
// Total draw calls: 1 (MeshBasicMaterial+CanvasTexture panel) + 1 (merged structure) = 2 DC in FPV.
// CanvasTexture works with both WebGPU and WebGL backends; ShaderMaterial is WebGL-only.

export interface CockpitDef {
  eye: [number, number, number];
  panelZ: number;
  panelY: number;
  panelW: number;
  panelH: number;
}

export interface CockpitState {
  group: THREE.Group;
  updateLive(speed01: number, alt01: number, heading01: number, throttle01: number): void;
  dispose(): void;
}

// ---- Canvas gauge helper ---------------------------------------------------

function drawGauge(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  value: number, live: boolean
) {
  // Glass face
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = "#071222";
  ctx.fill();

  // Tick marks — 36 minor, every 3rd major
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const major = i % 3 === 0;
    const inner = major ? r * 0.70 : r * 0.80;
    const outer = r * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.strokeStyle = major ? "#6ba3db" : "#3e6888";
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
  }

  // Needle — 270° sweep, 0 at bottom-left, 1 at bottom-right
  if (live) {
    const a = ((value * 0.75) - 0.375) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.80, cy + Math.sin(a) * r * 0.80);
    ctx.strokeStyle = "#FAE5AD";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Hub
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.065, 0, Math.PI * 2);
  ctx.fillStyle = "#8EBCE6";
  ctx.fill();

  // Bezel ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#426690";
  ctx.lineWidth = r * 0.18;
  ctx.stroke();
}

// ---- Structural geometry helper -------------------------------------------

function coloredBoxGeo(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  color: THREE.Color,
  rx = 0, ry = 0, rz = 0
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);

  // Set vertex colors
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const pos = geo.attributes.position;

  for (let i = 0; i < count; i++) {
    const vy = pos.getY(i);
    const vx = pos.getX(i);
    const vz = pos.getZ(i);

    // Simulate ambient occlusion (darken corners and bottom surfaces)
    let ao = 1.0;
    if (vy < -h * 0.45) ao *= 0.72;
    if (Math.abs(vx) > w * 0.42) ao *= 0.88;
    if (Math.abs(vz) > d * 0.42) ao *= 0.88;

    colors[i * 3]     = color.r * ao;
    colors[i * 3 + 1] = color.g * ao;
    colors[i * 3 + 2] = color.b * ao;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---- Build -----------------------------------------------------------------

export function buildCockpitMesh(def: CockpitDef): CockpitState {
  const group = new THREE.Group();
  const [, eyeY, eyeZ] = def.eye;
  const PW = def.panelW;
  const PH = def.panelH;
  const panelTop = def.panelY + PH / 2;

  // ── Panel face — CanvasTexture, 1 DC, live per updateLive() ──────────────
  // Canvas is 512 × (512*PH/PW) pixels. BackSide renders the -Z face of the
  // plane (the face toward the camera at smaller z). The canvas is drawn with
  // ctx.scale(-1,1) to compensate for the UV.x mirror that BackSide introduces.
  const CW = 512;
  const CH = Math.round(CW * PH / PW);
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d")!;

  let _speed01 = 0, _alt01 = 0, _heading01 = 0, _throttle01 = 0;

  function drawPanel() {
    // Horizontal mirror to compensate BackSide UV.x flip
    ctx.save();
    ctx.translate(CW, 0);
    ctx.scale(-1, 1);

    // Background
    ctx.fillStyle = "#121C2E";
    ctx.fillRect(0, 0, CW, CH);

    // UV y=0 is canvas bottom → canvas_y = CH*(1-uv_y)
    const lr = CW * 0.122 * 0.5625;

    // Left column: IAS, altitude, compass heading
    drawGauge(ctx, CW * 0.14, CH * (1 - 0.74), lr,        _speed01,   true);
    drawGauge(ctx, CW * 0.14, CH * (1 - 0.44), lr,        _alt01,     true);
    drawGauge(ctx, CW * 0.14, CH * (1 - 0.16), lr * 0.78, _heading01, true);

    // Center: attitude (static), lower heading
    const cr = CW * 0.178 * 0.5625;
    drawGauge(ctx, CW * 0.50, CH * (1 - 0.60), cr,        0.5,        false);
    drawGauge(ctx, CW * 0.50, CH * (1 - 0.20), lr,        _heading01, true);

    // Right column: throttle, EGT, oil
    const rr = CW * 0.112 * 0.5625;
    drawGauge(ctx, CW * 0.86, CH * (1 - 0.72), rr,        Math.min(_throttle01 / 1.1, 1.0), true);
    drawGauge(ctx, CW * 0.86, CH * (1 - 0.44), rr * 0.88, 0.68, false);
    drawGauge(ctx, CW * 0.86, CH * (1 - 0.18), rr * 0.80, 0.52, false);

    // MFD block
    const mfdX = CW * 0.26, mfdY = CH * (1 - 0.88), mfdW = CW * 0.16, mfdH = CH * 0.36;
    ctx.fillStyle = "#020A0B";
    ctx.fillRect(mfdX, mfdY, mfdW, mfdH);
    ctx.strokeStyle = "#0A3818";
    ctx.lineWidth = 2;
    ctx.strokeRect(mfdX, mfdY, mfdW, mfdH);

    // Warning-light strip
    const warnY = CH * (1 - 1.0);
    const warnH = CH * 0.09;
    const warnX0 = CW * 0.25, warnW = CW * 0.50;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i < 3 ? "#421009" : "#0A2A12";
      ctx.fillRect(warnX0 + (warnW / 6) * i + 1, warnY, warnW / 6 - 2, warnH - 1);
    }

    // Thin bevel at panel edges
    ctx.strokeStyle = "#2d4a6e";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, CW - 3, CH - 3);

    ctx.restore();

    tex.needsUpdate = true;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panelMat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  drawPanel();

  // Plane is slightly oversized to completely seal any gaps/seams around the cockpit frame.
  const panelGeo = new THREE.PlaneGeometry(PW * 1.08, PH * 1.08);
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.position.set(0, def.panelY, def.panelZ);
  group.add(panelMesh);

  // ── Cockpit Shading Color Palette ───────────────────────────────────────
  const cStructure  = new THREE.Color("#1a222e"); // Dark slate grey structure frame
  const cFloor      = new THREE.Color("#0b0e14"); // Dark charcoal floor
  const cDesk       = new THREE.Color("#131822"); // Side console desks
  const cPanel      = new THREE.Color("#090b10"); // Switch panels
  const cGrip       = new THREE.Color("#080a0e"); // Stick grip handle
  const cRod        = new THREE.Color("#3b4759"); // Stick metal rod
  const cGunsight   = new THREE.Color("#16221f"); // Gunsight body
  const cPillar     = new THREE.Color("#252c38"); // A-pillars
  const cShield     = new THREE.Color("#0c0f14"); // Glare shield
  const cRed        = new THREE.Color("#991b1b");
  const cYellow     = new THREE.Color("#ca8a04");
  const cGreen      = new THREE.Color("#166534");
  const cGrey       = new THREE.Color("#475569");

  // ── Glare shield ─────────────────────────────────────────────────────────
  const gsDep = 0.11;
  const gsThk = 0.010;
  const gsGeos: THREE.BufferGeometry[] = [];
  // Slightly wider than PW to merge seamlessly into the side walls and prevent gaps
  gsGeos.push(coloredBoxGeo(PW * 1.02, gsThk, gsDep,
    0, panelTop + gsThk / 2, def.panelZ - gsDep / 2, cShield));
  gsGeos.push(coloredBoxGeo(PW * 1.02, 0.010, 0.012,
    0, panelTop - 0.005, def.panelZ - gsDep, cShield));

  // ── Gunsight body ─────────────────────────────────────────────────────────
  gsGeos.push(coloredBoxGeo(0.055, 0.055, 0.10,
    0, eyeY - 0.046, def.panelZ - gsDep + 0.04, cGunsight));

  // ── A-pillars ─────────────────────────────────────────────────────────────
  // Base behind the eye so only the upper portion (near the panel) enters the
  // forward FOV, appearing as a narrow edge strip rather than a wide wedge.
  const pBotY = eyeY - 0.15;
  const pBotZ = eyeZ - 0.20;
  const pTopY = eyeY + 0.30;
  const pTopZ = def.panelZ - 0.04;
  const pX = PW / 2 + 0.04;

  const dz = pTopZ - pBotZ;
  const dy = pTopY - pBotY;
  const pLen = Math.sqrt(dz * dz + dy * dy);
  const pAngle = -Math.atan2(dy, dz);

  for (const side of [-1, 1]) {
    gsGeos.push(coloredBoxGeo(0.028, pLen, 0.028,
      side * pX, (pBotY + pTopY) / 2, (pBotZ + pTopZ) / 2,
      cPillar, pAngle, 0, 0));
  }

  // ── Canopy side rails and top spine ───────────────────────────────────────
  const railLen = pTopZ - pBotZ + 0.18;
  const railZ   = (pBotZ + pTopZ) / 2;
  // Thin center spine along the canopy ceiling instead of a wide plate
  gsGeos.push(coloredBoxGeo(0.025, 0.022, railLen,
    0, pTopY + 0.012, railZ, cStructure));
  // Removed vertical central partition that blocks the gun reticle/sight line
  gsGeos.push(coloredBoxGeo(PW * 0.92, 0.022, 0.022,
    0, pBotY + 0.08, pBotZ - 0.10, cStructure));
  for (const side of [-1, 1]) {
    gsGeos.push(coloredBoxGeo(0.018, 0.014, railLen,
      side * (PW / 2 + 0.02), pBotY, railZ, cStructure));
  }

  // ── Cockpit interior tub (floor, side walls, rear bulkhead) ──────────────
  const cabLen = def.panelZ - (eyeZ - 0.40);
  const cabCenterZ = (def.panelZ + (eyeZ - 0.40)) / 2;
  const floorOffset = 0.72;
  const floorY = eyeY - floorOffset;
  const wallH = pBotY - floorY;
  const wallY = (floorY + pBotY) / 2;

  // Floor (made slightly wider to sit under the side walls and prevent seam leaks)
  gsGeos.push(coloredBoxGeo(PW * 1.12, 0.02, cabLen, 0, floorY, cabCenterZ, cFloor));
  // Side walls
  gsGeos.push(coloredBoxGeo(0.02, wallH, cabLen, -PW / 2 - 0.01, wallY, cabCenterZ, cStructure));
  gsGeos.push(coloredBoxGeo(0.02, wallH, cabLen, PW / 2 + 0.01, wallY, cabCenterZ, cStructure));
  // Rear bulkhead (extended slightly in width and height to completely seal the rear cabin)
  gsGeos.push(coloredBoxGeo(PW * 1.12, wallH + 0.04, 0.02, 0, wallY, eyeZ - 0.40, cStructure));
  // Firewall front bulkhead (seals the space under the raised instrument panel)
  const firewallH = (def.panelY - PH / 2) - floorY;
  const firewallY = floorY + firewallH / 2;
  gsGeos.push(coloredBoxGeo(PW * 1.12, firewallH, 0.02, 0, firewallY, def.panelZ + 0.01, cStructure));

  // ── Side Console Desks ───────────────────────────────────────────────────
  const deskW = 0.05;
  const deskH = 0.02;
  const deskY = floorY + deskH / 2;
  gsGeos.push(coloredBoxGeo(deskW, deskH, cabLen, -PW / 2 + deskW / 2 + 0.01, deskY, cabCenterZ, cDesk));
  gsGeos.push(coloredBoxGeo(deskW, deskH, cabLen, PW / 2 - deskW / 2 - 0.01, deskY, cabCenterZ, cDesk));

  // ── Switch Panels on Desks ───────────────────────────────────────────────
  const panelW = deskW - 0.02;
  const panelH_geom = 0.006;
  const panelY_geom = deskY + deskH / 2 + panelH_geom / 2;
  // Left desk panel
  gsGeos.push(coloredBoxGeo(panelW, panelH_geom, cabLen * 0.8, -PW / 2 + deskW / 2 + 0.01, panelY_geom, cabCenterZ, cPanel));
  // Right desk panel
  gsGeos.push(coloredBoxGeo(panelW, panelH_geom, cabLen * 0.8, PW / 2 - deskW / 2 - 0.01, panelY_geom, cabCenterZ, cPanel));

  // ── Tiny Switch Buttons on Panels (Detailing) ───────────────────────────
  const buttonSize = 0.008;
  const buttonY = panelY_geom + buttonSize / 2;
  const numButtons = 6;
  for (let i = 0; i < numButtons; i++) {
    const offsetZ = -cabLen * 0.3 + (cabLen * 0.6 * i) / (numButtons - 1);
    const colorLeft = i % 3 === 0 ? cRed : i % 3 === 1 ? cYellow : cGrey;
    const colorRight = i % 2 === 0 ? cGreen : cGrey;
    
    // Left console buttons
    gsGeos.push(coloredBoxGeo(buttonSize, buttonSize * 1.5, buttonSize,
      -PW / 2 + deskW / 2 + 0.01 + (i % 2 === 0 ? -0.02 : 0.02), buttonY, cabCenterZ + offsetZ, colorLeft));
    // Right console buttons
    gsGeos.push(coloredBoxGeo(buttonSize, buttonSize * 1.5, buttonSize,
      PW / 2 - deskW / 2 - 0.01 + (i % 2 === 0 ? -0.02 : 0.02), buttonY, cabCenterZ + offsetZ, colorRight));
  }

  // ── Throttle Quadrant Lever (Detailing) ──────────────────────────────────
  const throttleBaseX = -PW / 2 + 0.025;
  const throttleBaseY = panelY_geom + 0.004;
  const throttleBaseZ = cabCenterZ - 0.25;
  // Lever mount plate
  gsGeos.push(coloredBoxGeo(0.025, 0.008, 0.04, throttleBaseX, throttleBaseY, throttleBaseZ, cStructure));
  // Metal lever arm (sticking up and angled forward)
  gsGeos.push(coloredBoxGeo(0.006, 0.025, 0.008, throttleBaseX, throttleBaseY + 0.012, throttleBaseZ + 0.005, cGrey, 0.25, 0, 0));
  // Red throttle knob handle
  gsGeos.push(coloredBoxGeo(0.005, 0.005, 0.006, throttleBaseX, throttleBaseY + 0.024, throttleBaseZ + 0.009, cRed));

  // ── Control stick ─────────────────────────────────────────────────────────
  const stickZ = eyeZ + 0.26;
  const stickH = 0.22;
  const stickBaseY = eyeY - (floorOffset - 0.14);
  // Metal rod lever
  gsGeos.push(coloredBoxGeo(0.020, stickH, 0.020, 0, stickBaseY + stickH / 2, stickZ, cRod));
  // Grip handle
  gsGeos.push(coloredBoxGeo(0.038, 0.050, 0.038, 0, stickBaseY + stickH + 0.025, stickZ, cGrip));
  // Red trigger button on grip
  gsGeos.push(coloredBoxGeo(0.008, 0.008, 0.008, 0, stickBaseY + stickH + 0.036, stickZ + 0.014, cRed));

  const merged = mergeGeometries(gsGeos);
  gsGeos.forEach(g => g.dispose());

  // MeshStandardMaterial: supports lighting, roughness/metalness, and vertex colors!
  // This gives true 3D depth, material response, and dynamic ambient occlusion.
  const structMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });
  const structMesh = new THREE.Mesh(merged, structMat);
  group.add(structMesh);

  // ── Transparent Gunsight Glass Plate ─────────────────────────────────────
  const glassGeo = new THREE.BoxGeometry(0.080, 0.004, 0.065);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide
  });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.set(0, eyeY, def.panelZ - gsDep + 0.07);
  glassMesh.rotation.set(-0.6, 0, 0);
  group.add(glassMesh);

  group.visible = false;

  return {
    group,
    updateLive(speed01, alt01, heading01, throttle01) {
      _speed01    = speed01;
      _alt01      = alt01;
      _heading01  = heading01;
      _throttle01 = throttle01;
      drawPanel();
    },
    dispose() {
      panelGeo.dispose();
      panelMat.dispose();
      tex.dispose();
      canvas.remove();
      merged.dispose();
      structMat.dispose();
      glassGeo.dispose();
      glassMat.dispose();
    },
  };
}
