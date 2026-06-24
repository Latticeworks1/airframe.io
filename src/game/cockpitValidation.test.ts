// Run with: node --import tsx/esm src/game/cockpitValidation.test.ts
// tsx is already a devDependency; Node 22+ required.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getCockpitDef } from "./content/aircraft/cockpitRegistry.js";
import { falconMk2 } from "./content/aircraft/falcon-mk2/index.js";

const CURRENT_DIR = import.meta.dirname;

const MESH_PATH = path.join(CURRENT_DIR, "cockpitMesh.ts");
const AIRCRAFT_RENDERER_PATH = path.join(CURRENT_DIR, "renderer", "AircraftRenderer.ts");
const CAMERA_MANAGER_PATH = path.join(CURRENT_DIR, "renderer", "CameraManager.ts");
const HUD_SYNC_MANAGER_PATH = path.join(CURRENT_DIR, "renderer", "HudSyncManager.ts");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function parseNumber(source: string, name: string): number {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*([\\d.-]+)`);
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Could not parse ${name}`);
  }
  return parseFloat(match[1]);
}

function projectNdc(
  point: [number, number, number],
  eye: [number, number, number],
  verticalFov = 74.0,
  aspect = 16 / 9
): [number, number] | null {
  const dx = point[0] - eye[0];
  const dy = point[1] - eye[1];
  const dz = point[2] - eye[2];
  if (dz <= 0) return null;
  const tanHalfFov = Math.tan((verticalFov * Math.PI) / 360);
  return [
    dx / (dz * tanHalfFov * aspect),
    dy / (dz * tanHalfFov),
  ];
}

function lerp(
  a: [number, number, number],
  b: [number, number, number],
  amount: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function testCockpitValidation() {
  console.log("[*] Running cockpit validations...");

  const cockpit = getCockpitDef("falcon-mk2");
  if (!cockpit) {
    throw new Error("Could not find falcon-mk2 cockpit definition");
  }

  const meshSource = read(MESH_PATH);
  const aircraftRendererSource = read(AIRCRAFT_RENDERER_PATH);
  const cameraManagerSource = read(CAMERA_MANAGER_PATH);
  const hudSyncManagerSource = read(HUD_SYNC_MANAGER_PATH);

  const eye = cockpit.eye;
  const panelZ = cockpit.panelZ;
  const panelY = cockpit.panelY;
  const panelW = cockpit.panelW;
  const panelH = cockpit.panelH;
  const panelTop = panelY + panelH / 2;
  const panelBottom = panelY - panelH / 2;

  const panelDepth            = parseNumber(meshSource, "panelDepth");
  const pillarThickness       = parseNumber(meshSource, "pillarThickness");
  const panelJunctionOverlap  = parseNumber(meshSource, "panelJunctionOverlap");
  const panelSidePostWidth    = parseNumber(meshSource, "panelSidePostWidth");
  const floorOffset           = parseNumber(meshSource, "floorOffset");
  const rearExtension         = parseNumber(meshSource, "rearExtension");
  const rearTopDrop           = parseNumber(meshSource, "rearTopDrop");
  
  const canopyHalfW           = parseNumber(meshSource, "canopyHalfW");
  const sightGlassWidth       = parseNumber(meshSource, "sightGlassW");
  const sightGlassHeight      = parseNumber(meshSource, "sightGlassH");
  
  // Derived dimensions from cockpitMesh.ts builder geometry
  const pillarRearInset       = panelW / 2 - canopyHalfW; // e.g. 0.69 - 0.42 = 0.27
  const pillarRearRise        = 0.26; // eyeY + 0.32 - 0.060
  const pillarRearExtension   = 0.14; // eyeZ - (eyeZ - 0.14)

  console.log(`[*] Cockpit shell: eye=[${eye.join(", ")}], panel=${panelW.toFixed(2)}x${panelH.toFixed(2)}, depth=${panelDepth.toFixed(3)}`);

  // Basic layout assertions
  assert.ok(panelDepth <= 0.08, "Instrument-panel shell is unnecessarily deep.");
  assert.ok(pillarThickness <= 0.03, "Windshield pillars are too thick.");
  assert.ok(panelW >= 1.3, "Instrument panel is narrower than the requested view.");
  assert.ok(panelJunctionOverlap >= 0.02, "Panel-to-sidewall overlap is too small to seal the seam.");
  assert.ok(panelSidePostWidth > panelJunctionOverlap, "Panel side post cannot bridge the panel-to-hull junction.");

  // Check camera eye alignment
  const renderEye = falconMk2.render.camera.cockpitEye;
  assert.deepStrictEqual(renderEye, eye, "Cockpit mesh eye and first-person camera eye disagree.");

  // Validate gauge circles fit in panel
  const gaugeCircles = [
    [-0.36 * panelW, panelBottom + 0.74 * panelH, 0.122 * panelW * 0.5625],
    [-0.36 * panelW, panelBottom + 0.44 * panelH, 0.122 * panelW * 0.5625],
    [-0.36 * panelW, panelBottom + 0.16 * panelH, 0.122 * panelW * 0.5625 * 0.78],
    [0, panelBottom + 0.60 * panelH, 0.178 * panelW * 0.5625],
    [0, panelBottom + 0.20 * panelH, 0.122 * panelW * 0.5625],
    [0.36 * panelW, panelBottom + 0.72 * panelH, 0.112 * panelW * 0.5625],
    [0.36 * panelW, panelBottom + 0.44 * panelH, 0.112 * panelW * 0.5625 * 0.88],
    [0.36 * panelW, panelBottom + 0.18 * panelH, 0.112 * panelW * 0.5625 * 0.80],
  ];

  gaugeCircles.forEach((circle, idx) => {
    const [x, y, radius] = circle;
    assert.ok(
      Math.abs(x) + radius <= panelW / 2,
      `Gauge ${idx + 1} exceeds panel width boundary`
    );
    assert.ok(
      panelBottom <= y - radius && y + radius <= panelTop,
      `Gauge ${idx + 1} exceeds panel height boundary`
    );
  });

  // Holographic sight validation
  const sightCenter: [number, number, number] = [0, panelTop + 0.150, panelZ - 0.165];
  const sightNdc = projectNdc(sightCenter, eye);
  assert.ok(sightNdc, "Could not project sight center to NDC");
  assert.ok(Math.abs(sightNdc[0]) <= 0.01, "Holographic sight is not centered on the forward axis.");

  const tanHalfFov = Math.tan((74.0 * Math.PI) / 360);
  const sightScreenWidth = sightGlassWidth / ((sightCenter[2] - eye[2]) * tanHalfFov * (16 / 9)) / 2;
  const sightScreenHeight = sightGlassHeight / ((sightCenter[2] - eye[2]) * tanHalfFov) / 2;

  assert.ok(
    0.06 <= sightScreenWidth && sightScreenWidth <= 0.12,
    "Holographic sight width misses the sketched screen area."
  );
  assert.ok(
    0.10 <= sightScreenHeight && sightScreenHeight <= 0.22,
    "Holographic sight height misses the sketched screen area."
  );

  // Side rails and windshield pillars path calculations
  const pillarBase: [number, number, number] = [
    panelW / 2 - panelJunctionOverlap,
    panelTop + 0.025,
    panelZ - 0.010,
  ];
  const pillarRear: [number, number, number] = [
    panelW / 2 - pillarRearInset,
    eye[1] + pillarRearRise,
    eye[2] - pillarRearExtension,
  ];
  const sideFront: [number, number, number] = [
    panelW / 2 - panelJunctionOverlap,
    panelTop + 0.032,
    panelZ - 0.014,
  ];
  const sideRear: [number, number, number] = [
    panelW / 2 + 0.19,
    eye[1] - rearTopDrop + 0.012,
    eye[2] - rearExtension,
  ];

  const pillarBaseNdc = projectNdc(pillarBase, eye);
  assert.ok(pillarBaseNdc, "Could not project pillar base to NDC");
  assert.ok(
    0.55 <= pillarBaseNdc[0] && pillarBaseNdc[0] <= 0.70,
    "Pillar base X misses the reference cockpit proportions."
  );
  assert.ok(
    -0.08 <= pillarBaseNdc[1] && pillarBaseNdc[1] <= 0.08,
    "Pillar base Y misses the reference cockpit proportions."
  );

  assert.ok(
    pillarRear[2] < eye[2] - 0.10,
    "Windshield pillar still terminates in front of the camera."
  );
  assert.ok(
    sideRear[2] < eye[2] - 0.20,
    "Cockpit side wall does not extend behind the camera."
  );

  // Pillar sweep
  let topCrossing: [number, number] | null = null;
  for (let step = 0; step <= 80; step++) {
    const point = lerp(pillarBase, pillarRear, step / 80);
    if (point[2] <= eye[2] + 0.03) continue;
    const ndc = projectNdc(point, eye);
    if (ndc) {
      if (ndc[1] >= 1.0 && topCrossing === null) {
        topCrossing = ndc;
      }
      assert.ok(
        Math.abs(ndc[0]) >= 0.30,
        "Windshield pillar enters the central sight picture."
      );
    }
  }
  assert.ok(topCrossing, "Pillar does not cross the top edge");
  console.log("[*] topCrossing X is:", topCrossing[0], "Y is:", topCrossing[1]);
  assert.ok(
    0.85 <= topCrossing[0] && topCrossing[0] <= 1.90,
    "Windshield pillar misses the upper screen corner."
  );

  // Side rail sweep
  let sideEdgeCrossing: [number, number] | null = null;
  for (let step = 0; step <= 80; step++) {
    const point = lerp(sideFront, sideRear, step / 80);
    if (point[2] <= eye[2] + 0.03) continue;
    const ndc = projectNdc(point, eye);
    if (ndc) {
      if (ndc[0] >= 1.0 && sideEdgeCrossing === null) {
        sideEdgeCrossing = ndc;
      }
      assert.ok(
        !(Math.abs(ndc[0]) <= 1.0 && ndc[1] > 0.15),
        "Side rail rises into the forward sight picture."
      );
    }
  }
  assert.ok(sideEdgeCrossing, "Side rail does not cross side edge");
  assert.ok(
    -0.28 <= sideEdgeCrossing[1] && sideEdgeCrossing[1] <= 0.02,
    "Side rail misses the reference edge perspective."
  );

  assert.ok(
    floorOffset >= 0.60,
    "Cockpit floor is high enough to hide the restored controls."
  );

  const requiredGeometry = [
    "coloredClosedHullGeo",
    "wallVerts",
    "firewallTop",
    "panelSidePostWidth",
    "stickBaseY",
    "throttleAmount",
    "rearExtension",
  ];
  requiredGeometry.forEach((identifier) => {
    assert.ok(
      meshSource.includes(identifier),
      `Required cockpit component missing: ${identifier}`
    );
  });

  const bannedGeometry = [
    "coloredTriangleGeo",
    "sillRear",
    "sillFront",
    "corner block",
    "Glare Shield Lip",
  ];
  bannedGeometry.forEach((identifier) => {
    assert.ok(
      !meshSource.includes(identifier),
      `Obsolete open/layered component still present: ${identifier}`
    );
  });

  // Renderer components requirements
  assert.ok(
    aircraftRendererSource.includes("voxState.spinMesh.visible = !inFPV"),
    "Voxel spin geometry is not hidden during FPV updates."
  );
  assert.ok(
    aircraftRendererSource.includes("voxState.spinMesh.visible = !isFirstPerson"),
    "Voxel spin geometry is not hidden during FPV transitions."
  );
  assert.ok(
    cameraManagerSource.includes('if (this.cameraMode === "first-person")') ||
    cameraManagerSource.includes('else if (this.cameraMode === "first-person")'),
    "First-person turbulence branch is missing."
  );
  assert.ok(
    cameraManagerSource.includes("this.reticleTurbulenceX = shakeX * sightBuffet"),
    "Turbulence is not transferred to the reflector reticle."
  );
  assert.ok(
    hudSyncManagerSource.includes("cockpit.sightAnchorLocal"),
    "First-person reticle is not anchored to the sight glass."
  );
  assert.ok(
    cameraManagerSource.includes("ckEntry?.eyeLocal.clone()"),
    "First-person camera does not use the cockpit eye anchor."
  );

  // Check turbulence does not translate camera independently
  const firstPersonTurbulence = cameraManagerSource.match(
    /if\s*\(this\.cameraMode === "first-person"\)\s*\{([\s\S]*?)\}\s*else\s*\{/
  );
  assert.ok(
    firstPersonTurbulence,
    "Could not isolate first-person turbulence logic body"
  );
  assert.ok(
    !firstPersonTurbulence[1].includes("this.camera.position.add"),
    "First-person turbulence independently moves the cockpit camera."
  );

  console.log("[SUCCESS] Cockpit layout and rendering constraints are satisfied.");
}

try {
  testCockpitValidation();
} catch (e) {
  console.error("FAIL cockpit validation test:", e);
  process.exit(1);
}
