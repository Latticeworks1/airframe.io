import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { componentGeometries } from "./cockpitComponent";
import seatEjectorJson    from "./content/cockpit/seat-ejector.json";
import stickJson          from "./content/cockpit/stick.json";
import throttleSingleJson from "./content/cockpit/throttle-single.json";
import throttleTwinJson   from "./content/cockpit/throttle-twin.json";
import bombsightJson      from "./content/cockpit/bombsight.json";
import { cockpitPanelState } from "./cockpitPanelState";
import { getInstrument, PANEL_LAYOUT, PANEL_W, PANEL_H } from "./instruments/index";
import "./instruments/index"; // register builtins

// Cockpit interior: merged structural shell + gunsight glass + canvas-texture instrument panel.
// Total draw calls: 3 (structure, glass, panel).

export interface CockpitDef {
  eye: [number, number, number];
  sightAnchor: [number, number, number];
  panelZ: number;
  panelY: number;
  panelW: number;
  panelH: number;
  aircraftId?: string;
}

export interface CockpitState {
  group: THREE.Group;
  eyeLocal: THREE.Vector3;
  sightAnchorLocal: THREE.Vector3;
  tickPanel(): void;
  dispose(): void;
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

    // Windshield pillar
    structuralGeometries.push(coloredBeamGeo(
      new THREE.Vector3(innerFrontX, panelTop + 0.025, def.panelZ - 0.010),
      new THREE.Vector3(side * canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
      pillarThickness, cPillar
    ));

    // Side console shelf
    const cabLen  = frontZ - rearZ;
    const cabCZ   = (frontZ + rearZ) / 2;
    const shelfW  = 0.060;
    const shelfH  = 0.016;
    const shelfY  = floorY + 0.35;
    const shelfX  = side * (frontInnerX - 0.012 - shelfW / 2);
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

  // 4. Control stick
  const stickZ     = eyeZ + 0.25;
  const stickBaseY = floorY + 0.035;
  for (const g of componentGeometries(
    stickJson,
    new THREE.Vector3(0, stickBaseY, stickZ),
    cConsole
  )) structuralGeometries.push(g);

  // 5. Throttle lever
  const throttleAmount    = 0.43;
  const throttleRailFront = new THREE.Vector3(-frontInnerX, frontTopY + 0.012, frontZ - 0.006);
  const throttleRailRear  = new THREE.Vector3(-rearInnerX,  rearTopY  + 0.012, rearZ);
  const throttleBase      = throttleRailFront.clone().lerp(throttleRailRear, throttleAmount);

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

  // 6. Ejector seat
  const seatZ           = eyeZ - 0.06;
  const seatCushionTopY = eyeY - 0.50;
  for (const g of componentGeometries(
    seatEjectorJson,
    new THREE.Vector3(0, seatCushionTopY, seatZ - 0.21),
    cPillar
  )) structuralGeometries.push(g);

  // 7. Aircraft-specific components
  if (aircraftId === "grizzly-a1") {
    for (const g of componentGeometries(
      bombsightJson,
      new THREE.Vector3(-0.26, panelTop + 0.026, def.panelZ - 0.064),
      cGunsight
    )) structuralGeometries.push(g);
  }

  if (aircraftId === "twinwolf" || aircraftId === "grizzly-a1") {
    for (const g of componentGeometries(
      throttleTwinJson,
      new THREE.Vector3(throttleBase.x - 0.050, throttleBase.y + 0.032, throttleBase.z),
      cConsole
    )) structuralGeometries.push(g);
  }

  // 8. Canopy frame
  const rearBulkExtH = rearArchY - rearTopY + 0.020;
  if (rearBulkExtH > 0.001) {
    structuralGeometries.push(coloredBoxGeo(
      rearOuterX * 2, rearBulkExtH, 0.035,
      0, rearTopY + rearBulkExtH / 2 - 0.010, rearZ,
      cPanelShell
    ));
  }

  structuralGeometries.push(coloredBoxGeo(
    canopyHalfW * 2 + 0.04, 0.036, 0.036,
    0, rearArchY, rearZ, cPillar
  ));

  structuralGeometries.push(coloredBeamGeo(
    new THREE.Vector3(0, canopyTopY, canopyFrontZ),
    new THREE.Vector3(0, rearArchY, rearZ),
    0.020, cPillar
  ));

  for (const side of [-1, 1]) {
    structuralGeometries.push(coloredBeamGeo(
      new THREE.Vector3(side * canopyHalfW, canopyTopY - 0.060, canopyFrontZ),
      new THREE.Vector3(side * canopyHalfW, rearArchY,          rearZ),
      0.020, cPillar
    ));
  }

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
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  const sightAnchorLocal = new THREE.Vector3(...def.sightAnchor);
  glassMesh.position.copy(sightAnchorLocal).addScaledVector(new THREE.Vector3(0, 0, 1), -0.003);
  glassMesh.rotation.set(-0.08, 0, 0);
  group.add(glassMesh);

  // Canopy glass panels
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

  group.add(quadMesh(cFrontC, cFrontL, cRearL, cRearC, canopyGlassMat));
  group.add(quadMesh(cFrontC, cRearC, cRearR, cFrontR, canopyGlassMat));

  const sideWallFrontL = new THREE.Vector3(-frontOuterX, frontTopY, frontZ);
  const sideWallRearL  = new THREE.Vector3(-rearOuterX,  rearTopY,  rearZ);
  group.add(quadMesh(cFrontL, sideWallFrontL, sideWallRearL, cRearL, canopyGlassMat));
  const sideWallFrontR = new THREE.Vector3(frontOuterX, frontTopY, frontZ);
  const sideWallRearR  = new THREE.Vector3(rearOuterX,  rearTopY,  rearZ);
  group.add(quadMesh(cFrontR, cRearR, sideWallRearR, sideWallFrontR, canopyGlassMat));

  const wGlassExt = pillarThickness * 0.55;
  const wBotC = new THREE.Vector3(0,                           panelTop + 0.025, def.panelZ - 0.010);
  const wBotL = new THREE.Vector3(-(frontInnerX + wGlassExt), panelTop + 0.025, def.panelZ - 0.010);
  const wBotR = new THREE.Vector3(  frontInnerX + wGlassExt,  panelTop + 0.025, def.panelZ - 0.010);
  const wTopL = new THREE.Vector3(-(canopyHalfW + wGlassExt), canopyTopY - 0.060, canopyFrontZ);
  const wTopR = new THREE.Vector3(  canopyHalfW + wGlassExt,  canopyTopY - 0.060, canopyFrontZ);
  group.add(quadMesh(cFrontC, wTopL, wBotL, wBotC, canopyGlassMat));
  group.add(quadMesh(cFrontC, wBotC, wBotR, wTopR, canopyGlassMat));

  // ── Instrument panel canvas texture ─────────────────────────────────────────
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width  = PANEL_W;
  panelCanvas.height = PANEL_H;
  const panelCtx = panelCanvas.getContext("2d")!;

  const bakedMap = new Map<string, OffscreenCanvas>();
  for (const slot of PANEL_LAYOUT) {
    const inst = getInstrument(slot.id);
    if (inst) bakedMap.set(slot.id, inst.bake(slot.r));
  }

  const panelTexture = new THREE.CanvasTexture(panelCanvas);
  panelTexture.minFilter = THREE.LinearFilter;
  panelTexture.magFilter = THREE.LinearFilter;
  panelTexture.generateMipmaps = false;

  const panelGeo = new THREE.PlaneGeometry(def.panelW, def.panelH);
  const panelMat = new THREE.MeshBasicMaterial({ map: panelTexture });
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.position.set(0, def.panelY + 0.0125, def.panelZ - 0.003);
  panelMesh.rotation.y = Math.PI;
  group.add(panelMesh);

  const IND_Y  = PANEL_H - 14;
  const IND_H  = 24;
  const IND_W  = 84;
  const INDICATORS = [
    { cx: 97,  label: "GEAR",   key: "gearDown"      as const, color: "#22c55e" },
    { cx: 257, label: "FLAPS",  key: "flapsOut"      as const, color: "#eab308" },
    { cx: 373, label: "AIRBRK", key: "airbrakeOn"    as const, color: "#ef4444" },
    { cx: 533, label: "ENG",    key: "engineDamaged" as const, color: "#ef4444" },
  ];

  function tickPanel() {
    const s = cockpitPanelState;
    const ctx = panelCtx;

    // The panel mesh uses rotation.y = PI which horizontally mirrors the texture.
    // Pre-mirroring the canvas here cancels that flip so instrument draw() methods
    // can use a normal coordinate system without any awareness of the 3D setup.
    ctx.save();
    ctx.translate(PANEL_W, 0);
    ctx.scale(-1, 1);

    const bg = ctx.createLinearGradient(0, 0, 0, PANEL_H);
    bg.addColorStop(0, "#0c1827");
    bg.addColorStop(1, "#060c14");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, PANEL_W, PANEL_H);

    for (const slot of PANEL_LAYOUT) {
      const inst = getInstrument(slot.id);
      const baked = bakedMap.get(slot.id);
      if (inst && baked) inst.draw(ctx, slot.cx, slot.cy, slot.r, s, baked);
    }

    for (const ind of INDICATORS) {
      const lit = !!s[ind.key];
      ctx.fillStyle = lit ? ind.color : "#091320";
      ctx.fillRect(ind.cx - IND_W / 2, IND_Y - IND_H / 2, IND_W, IND_H);
      ctx.strokeStyle = lit ? ind.color : "#162436";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ind.cx - IND_W / 2 + 2, IND_Y - IND_H / 2 + 2, IND_W - 4, IND_H - 4);
      ctx.fillStyle = lit ? "#ffffff" : "#1e3048";
      ctx.font = `bold ${Math.round(IND_H * 0.46)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ind.label, ind.cx, IND_Y);
    }

    ctx.strokeStyle = "#1e3a5c";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, PANEL_W - 2, PANEL_H - 2);

    ctx.restore();
    // Force the GPU-accelerated 2D pipeline to commit before WebGL reads the canvas.
    panelCtx.getImageData(0, 0, 1, 1);
    panelTexture.needsUpdate = true;
  }

  group.visible = false;

  return {
    group,
    eyeLocal: new THREE.Vector3(...def.eye),
    sightAnchorLocal,
    tickPanel,
    dispose() {
      merged.dispose();
      structMat.dispose();
      glassGeo.dispose();
      glassMat.dispose();
      canopyGlassMat.dispose();
      panelTexture.dispose();
      panelMat.dispose();
      panelGeo.dispose();
    },
  };
}
