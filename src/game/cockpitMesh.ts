import * as THREE from "three";

// Cockpit interior built from Three.js geometry primitives + canvas textures.
// This replaces voxel-grid interiors for the main player aircraft.
// All coordinates are in aircraft LOCAL space (same frame as cockpitEye).

export interface CockpitDef {
  eye: [number, number, number];  // camera eye in local space (from render.ts)
  panelZ: number;  // instrument panel face z-position (m)
  panelY: number;  // panel center y-position (m)
  panelW: number;  // panel width (m)
  panelH: number;  // panel height (m)
}

export interface CockpitState {
  group: THREE.Group;
  dispose: () => void;
}

// ---- canvas panel texture ---------------------------------------------------

function drawPanelCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;

  // Base panel — dark blue-grey
  ctx.fillStyle = "#141e30";
  ctx.fillRect(0, 0, w, h);

  // Subtle surface texture — slightly lighter in center, darker at edges
  const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.65);
  grad.addColorStop(0, "rgba(40,60,90,0.25)");
  grad.addColorStop(1, "rgba(0,0,0,0.30)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // -- helper: draw a circular analog gauge --
  function gauge(cx: number, cy: number, r: number, label?: string) {
    // Outer bezel ring — raised edge highlight
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#3a5070";
    ctx.lineWidth = Math.max(2, r * 0.10);
    ctx.stroke();

    // Inner face — very dark glass
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.fillStyle = "#060c12";
    ctx.fill();

    // Tick marks around the face
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * Math.PI * 2;
      const major = i % 3 === 0;
      const inner = r * 0.86 * (major ? 0.70 : 0.80);
      const outer = r * 0.86 * 0.90;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.strokeStyle = major ? "#5080a0" : "#304860";
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
    }
    ctx.restore();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = "#7090b0";
    ctx.fill();

    // Optional label below gauge
    if (label) {
      ctx.fillStyle = "#4a6a8a";
      ctx.font = `${Math.round(r * 0.22)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, cx, cy + r + r * 0.30);
    }
  }

  // -- helper: draw a rectangular MFD screen --
  function mfd(x: number, y: number, sw: number, sh: number) {
    // Bezel
    ctx.fillStyle = "#1a2c44";
    ctx.fillRect(x - 4, y - 4, sw + 8, sh + 8);
    // Screen glass
    ctx.fillStyle = "#040c10";
    ctx.fillRect(x, y, sw, sh);
    // Dim green glow border
    ctx.strokeStyle = "#0d2818";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, sw - 4, sh - 4);
  }

  // ── Layout matches labeled reference images ──────────────────────────────
  // Panel dimensions passed in as w×h. Reference layout:
  //   Left column (x ~ w*0.15): IAS, altimeter, radio compass
  //   Center (x ~ w*0.50): attitude + heading (large cluster)
  //   Right column (x ~ w*0.85): engine instruments

  const lx = w * 0.14;  // left column center x
  const cx = w * 0.50;  // center column
  const rx = w * 0.86;  // right column

  const gr = h * 0.15;  // small gauge radius
  const grl = h * 0.18; // large gauge radius

  // Center — attitude indicator (large, dominant)
  gauge(cx, h * 0.38, grl * 1.1, "ATT");
  // Center — heading indicator below
  gauge(cx, h * 0.76, grl * 0.8, "HDG");

  // Left column
  gauge(lx, h * 0.26, gr, "IAS");
  gauge(lx, h * 0.58, gr, "ALT");
  gauge(lx, h * 0.84, gr * 0.75, "RDO");

  // Right column — engine instruments
  gauge(rx, h * 0.26, gr, "RPM");
  gauge(rx, h * 0.56, gr * 0.85, "EGT");
  gauge(rx, h * 0.82, gr * 0.75, "OIL");

  // Center MFD between left gauges and attitude cluster
  mfd(w * 0.25, h * 0.18, w * 0.16, h * 0.30);

  // Warning light strip across the top of the panel
  const wlColors = ["#400000","#402000","#004000","#001040","#003030","#200040"];
  for (let i = 0; i < wlColors.length; i++) {
    const wx = w * 0.28 + i * w * 0.08;
    ctx.fillStyle = wlColors[i];
    ctx.fillRect(wx, h * 0.03, w * 0.06, h * 0.06);
    ctx.strokeStyle = "#2a3a50";
    ctx.lineWidth = 1;
    ctx.strokeRect(wx, h * 0.03, w * 0.06, h * 0.06);
  }

  return c;
}

// ---- structural geometry helpers -------------------------------------------

function box(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotX = 0, rotY = 0, rotZ = 0,
  color = 0x0e1828
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  return mesh;
}

// ---- build -----------------------------------------------------------------

export function buildCockpitMesh(def: CockpitDef): CockpitState {
  const group = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const [, eyeY, eyeZ] = def.eye;

  // ── INSTRUMENT PANEL FACE ─────────────────────────────────────────────────
  // PlaneGeometry in XY plane, rotated to face pilot (face toward -Z).
  const PW = def.panelW;
  const PH = def.panelH;
  const canvasRes = 1024;
  const panelCanvas = drawPanelCanvas(canvasRes, Math.round(canvasRes * (PH / PW)));
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;

  const panelGeo = new THREE.PlaneGeometry(PW, PH);
  const panelMat = new THREE.MeshBasicMaterial({ map: panelTex, side: THREE.FrontSide });
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  // Panel faces -Z (toward pilot). PlaneGeometry faces +Z by default; rotate 180° around Y.
  panelMesh.rotation.y = Math.PI;
  panelMesh.position.set(0, def.panelY, def.panelZ);
  group.add(panelMesh);
  disposables.push(panelGeo);
  mats.push(panelMat);

  // ── GLARE SHIELD ──────────────────────────────────────────────────────────
  // Horizontal ledge sitting just above the panel top, at eye height.
  // Thickness 3cm, depth 0.35m (runs from panel z back toward pilot).
  const gsDep = 0.35;
  const gsY = def.panelY + PH / 2 + 0.015; // just above panel top
  const gsZ = def.panelZ - gsDep / 2;
  const gsMesh = box(PW * 0.95, 0.030, gsDep, 0, gsY, gsZ, 0, 0, 0, 0x1a2c40);
  group.add(gsMesh);
  disposables.push(gsMesh.geometry);
  mats.push(gsMesh.material as THREE.Material);

  // Glare shield front lip (thin vertical face visible to pilot)
  const glipMesh = box(PW * 0.95, 0.060, 0.015, 0, gsY - 0.015, def.panelZ - gsDep, 0, 0, 0, 0x1e3050);
  group.add(glipMesh);
  disposables.push(glipMesh.geometry);
  mats.push(glipMesh.material as THREE.Material);

  // ── GUNSIGHT ──────────────────────────────────────────────────────────────
  // Small body on glare shield center, right at eye level.
  const gsBody = box(0.06, 0.06, 0.12, 0, gsY + 0.05, gsZ - 0.05, 0, 0, 0, 0x162434);
  group.add(gsBody);
  disposables.push(gsBody.geometry);
  mats.push(gsBody.material as THREE.Material);

  // ── CANOPY FRAME / A-PILLARS ──────────────────────────────────────────────
  // Each A-pillar is a thin box (3cm × 3cm cross-section) running at an angle
  // from behind-shoulder level up to the glare shield rail.

  // Pillar runs from:
  //   bottom: [±(PW/2+0.05), eyeY - 0.05, eyeZ + 0.10]  (just behind eye, shoulder level)
  //   top:    [±(PW/2+0.05), eyeY + 0.28, def.panelZ - 0.05] (top of glare shield)
  //
  // We compute length and angle from these two points.
  const pBotZ = eyeZ + 0.05;
  const pBotY = eyeY - 0.10;
  const pTopZ = def.panelZ - 0.05;
  const pTopY = eyeY + 0.28;
  const pX = PW / 2 + 0.04;

  const dz = pTopZ - pBotZ;
  const dy = pTopY - pBotY;
  const pLen = Math.sqrt(dz * dz + dy * dy);
  const pAngle = -Math.atan2(dy, dz); // rotation around X axis

  const midY = (pBotY + pTopY) / 2;
  const midZ = (pBotZ + pTopZ) / 2;

  for (const side of [-1, 1]) {
    const pillar = box(0.030, pLen, 0.030, side * pX, midY, midZ, pAngle, 0, 0, 0x0e1828);
    group.add(pillar);
    disposables.push(pillar.geometry);
    mats.push(pillar.material as THREE.Material);
  }

  // Top canopy rail — horizontal bar running fore-aft above pilot
  const railLen = pTopZ - pBotZ + 0.15;
  const railZ = (pBotZ + pTopZ) / 2;
  const topRail = box(PW * 0.95, 0.025, railLen, 0, pTopY + 0.015, railZ, 0, 0, 0, 0x0e1828);
  group.add(topRail);
  disposables.push(topRail.geometry);
  mats.push(topRail.material as THREE.Material);

  // Center canopy bow — thin vertical fin at top center
  const bowH = pTopY - pBotY + 0.06;
  const bowZ = midZ;
  const centerBow = box(0.020, bowH, railLen * 0.92, 0, midY + 0.03, bowZ, 0, 0, 0, 0x0e1828);
  group.add(centerBow);
  disposables.push(centerBow.geometry);
  mats.push(centerBow.material as THREE.Material);

  // Rear arch above and behind pilot head
  const archY = pBotY + 0.10;
  const archZ = pBotZ - 0.12;
  const rearArch = box(PW * 0.95, 0.025, 0.025, 0, archY, archZ, 0, 0, 0, 0x0e1828);
  group.add(rearArch);
  disposables.push(rearArch.geometry);
  mats.push(rearArch.material as THREE.Material);

  // ── CONTROL STICK ─────────────────────────────────────────────────────────
  // Between the legs — close to pilot, below instrument sightline.
  // Stick at eyeZ + 0.25m, from floor to just below glare shield
  const stickZ = eyeZ + 0.22;
  const stickH = 0.32;
  const stickBaseY = eyeY - 0.45;
  const stick = box(0.022, stickH, 0.022, 0, stickBaseY + stickH / 2, stickZ, 0, 0, 0, 0x243858);
  group.add(stick);
  disposables.push(stick.geometry);
  mats.push(stick.material as THREE.Material);

  // Stick grip
  const gripMesh = box(0.055, 0.075, 0.055, 0, stickBaseY + stickH + 0.037, stickZ, 0, 0, 0, 0x2c4870);
  group.add(gripMesh);
  disposables.push(gripMesh.geometry);
  mats.push(gripMesh.material as THREE.Material);

  group.visible = false;

  return {
    group,
    dispose: () => {
      panelTex.dispose();
      disposables.forEach(g => g.dispose());
      mats.forEach(m => m.dispose());
    },
  };
}
