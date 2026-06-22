/**
 * Generates Three.js JSON component files for cockpit interiors.
 * Run: npx tsx tools/bake-cockpit-components.ts
 *
 * Each component is authored here using the full Three.js geometry API
 * (CylinderGeometry, SphereGeometry, ConeGeometry, etc.) then serialised
 * via Object3D.toJSON() and written to src/game/content/cockpit/.
 * At runtime ObjectLoader.parse() reconstructs the object; geometry is
 * extracted, world-transforms baked in, and merged into the cockpit's
 * single structural draw call.
 *
 * Origin conventions per component:
 *   seat-ejector : seat-pan top surface = Y 0, rear edge = Z 0, centred X
 *   stick        : shaft base = Y 0, centred X/Z
 *   throttle-*   : base of handle = Y 0, centred X/Z
 *   bombsight    : mounting base = Y 0, centred X/Z
 */

import * as THREE from "three";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../src/game/content/cockpit");
mkdirSync(outDir, { recursive: true });

// ── Vertex-colour helper ─────────────────────────────────────────────────────

function applyVertexColors(geo: THREE.BufferGeometry, color: THREE.Color): void {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const count = geo.attributes.position.count;
  const normal = geo.attributes.normal;
  const buf = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    let s = 0.92;
    if      (ny >  0.5) s = 1.08;
    else if (ny < -0.5) s = 0.74;
    else if (nz < -0.5) s = 0.86;
    buf[i * 3]     = Math.min(1, color.r * s);
    buf[i * 3 + 1] = Math.min(1, color.g * s);
    buf[i * 3 + 2] = Math.min(1, color.b * s);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(buf, 3));
  geo.deleteAttribute("uv");
}

const SHARED_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.72,
  metalness: 0.25,
  side: THREE.DoubleSide,
});

function mesh(
  geo: THREE.BufferGeometry,
  color: THREE.Color,
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  applyVertexColors(geo, color);
  const m = new THREE.Mesh(geo, SHARED_MAT);
  m.position.set(px, py, pz);
  m.rotation.set(rx, ry, rz);
  return m;
}

function save(name: string, group: THREE.Group): void {
  const path = resolve(outDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(group.toJSON(), null, 2));
  console.log(`  ${path}`);
}

// ── Palette ──────────────────────────────────────────────────────────────────

const C = {
  seat:      new THREE.Color("#1e2d22"),
  seatMetal: new THREE.Color("#3d4a58"),
  grip:      new THREE.Color("#111722"),
  rod:       new THREE.Color("#52647d"),
  red:       new THREE.Color("#a62d2d"),
  blue:      new THREE.Color("#1d4ed8"),
  gunsight:  new THREE.Color("#29413d"),
  console:   new THREE.Color("#172233"),
};

// ── Ejector seat ─────────────────────────────────────────────────────────────
// Origin: seat-pan top at Y=0, cushion centred at (0,0,0.21) so Z=0 is rear edge.
// This keeps the natural reference point (top of cushion where a pilot sits) at origin.
{
  const g = new THREE.Group();
  g.name = "seat-ejector";

  // Seat cushion
  g.add(mesh(new THREE.BoxGeometry(0.44, 0.07, 0.42), C.seat, 0, -0.035, 0.21));

  // Backrest — built as a U-frame + centre pad so it reads as open-backed armour
  const backH   = 0.46;
  const backAng = 0.22;  // recline angle rad
  // Left rail
  g.add(mesh(new THREE.BoxGeometry(0.040, backH, 0.055), C.seatMetal, -0.19, backH / 2, -0.004, backAng));
  // Right rail
  g.add(mesh(new THREE.BoxGeometry(0.040, backH, 0.055), C.seatMetal,  0.19, backH / 2, -0.004, backAng));
  // Top crossbar
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.038, 0.055), C.seatMetal, 0, backH + 0.004, -0.004, backAng));
  // Pad (recessed inside the frame)
  g.add(mesh(new THREE.BoxGeometry(0.295, backH * 0.86, 0.030), C.seat, 0, backH * 0.44, -0.006, backAng));

  // Headrest — distinctive box with raised sides giving that ejection-seat silhouette
  const hrY = backH + 0.022;
  const hrZ = -Math.sin(backAng) * (backH + 0.022);
  g.add(mesh(new THREE.BoxGeometry(0.285, 0.170, 0.072), C.seat,      0, hrY + 0.085, hrZ, backAng));
  // Side cheeks that extend above to make the headrest look protective
  g.add(mesh(new THREE.BoxGeometry(0.030, 0.195, 0.072), C.seatMetal, -0.135, hrY + 0.100, hrZ, backAng));
  g.add(mesh(new THREE.BoxGeometry(0.030, 0.195, 0.072), C.seatMetal,  0.135, hrY + 0.100, hrZ, backAng));

  // Armrests — padded horizontal bars
  g.add(mesh(new THREE.BoxGeometry(0.038, 0.028, 0.31), C.seat, -0.232, 0.040, 0.14));
  g.add(mesh(new THREE.BoxGeometry(0.038, 0.028, 0.31), C.seat,  0.232, 0.040, 0.14));

  // Side support tubes — CylinderGeometry makes these clearly structural vs boxy
  const tubeH = 0.42;
  for (const sx of [-1, 1]) {
    // Front tube
    g.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, tubeH, 8), C.seatMetal,
      sx * 0.185, -tubeH / 2 - 0.000, 0.175));
    // Rear tube
    g.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, tubeH, 8), C.seatMetal,
      sx * 0.185, -tubeH / 2 - 0.000, -0.095));
  }
  // Cross-brace at bottom connecting front legs
  g.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.38, 8), C.seatMetal,
    0, -tubeH - 0.004, 0.175, 0, 0, Math.PI / 2));
  // Cross-brace at bottom connecting rear legs
  g.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.38, 8), C.seatMetal,
    0, -tubeH - 0.004, -0.095, 0, 0, Math.PI / 2));

  save("seat-ejector", g);
}

// ── Control stick ────────────────────────────────────────────────────────────
// Origin: shaft base at Y=0.
{
  const g = new THREE.Group();
  g.name = "stick";

  const fwd = -0.08; // forward lean angle (rad)

  // Shaft — tapered cylinder
  g.add(mesh(new THREE.CylinderGeometry(0.010, 0.013, 0.295, 10), C.rod,
    0, 0.1475, 0, fwd));

  // Grip body — wider cylinder
  const gripY = 0.312;
  const gripZ = -Math.sin(fwd) * gripY;
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.076, 10), C.grip,
    0, gripY + 0.038, gripZ));

  // Grip top cap — sphere gives a proper knob feel
  g.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), C.grip,
    0, gripY + 0.080, gripZ));

  // Trigger — small box protruding forward
  g.add(mesh(new THREE.BoxGeometry(0.013, 0.013, 0.018), C.red,
    0, gripY + 0.055, gripZ - 0.034));

  save("stick", g);
}

// ── Throttle handle (single-engine, red grip) ────────────────────────────────
// Origin: rail-mount base at Y=0. Forward lean baked in.
function makeThrottle(name: string, gripColor: THREE.Color): void {
  const g = new THREE.Group();
  g.name = name;

  const lean = -0.24; // forward lean (rad) — matches current cockpit

  // Shaft
  g.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.082, 8), C.rod,
    0, 0.041, 0, lean));

  // Grip block
  const gripY = 0.090;
  const gripZ = -Math.sin(lean) * gripY;
  g.add(mesh(new THREE.BoxGeometry(0.038, 0.022, 0.030), gripColor,
    0, gripY + 0.011, gripZ + 0.014, lean));

  // Thumb button on top of grip
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.010, 8), C.rod,
    0, gripY + 0.025, gripZ - 0.002, lean));

  save(name, g);
}

makeThrottle("throttle-single", C.red);
makeThrottle("throttle-twin",   C.blue);

// ── Bomb sight (Grizzly A1) ──────────────────────────────────────────────────
// Origin: mounting-bracket base at Y=0, centred X/Z.
{
  const g = new THREE.Group();
  g.name = "bombsight";

  // Main scope body — cylinder (much more authentic than a box)
  g.add(mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.112, 14), C.gunsight,
    0, 0.056, 0));

  // Objective lens hood (front)
  g.add(mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.022, 14), C.seatMetal,
    0, 0.113, 0));

  // Mid-body band
  g.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 14), C.seatMetal,
    0, 0.072, 0));

  // Eyepiece tube — angled toward pilot (–Z direction ≈ aft)
  const epAng = -0.28;
  g.add(mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.096, 10), C.gunsight,
    0, 0.136, 0.038, epAng));

  // Rubber eye cup at end of eyepiece
  g.add(mesh(new THREE.CylinderGeometry(0.019, 0.013, 0.014, 10), C.grip,
    0, 0.178, 0.074, epAng));

  // Vertical mounting bracket
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.058, 0.012), C.seatMetal, 0, -0.029, 0));

  // Horizontal mount arm
  g.add(mesh(new THREE.BoxGeometry(0.036, 0.010, 0.010), C.seatMetal, 0, -0.058, 0));

  save("bombsight", g);
}

console.log("bake-cockpit-components: done");
