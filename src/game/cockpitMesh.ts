import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Cockpit interior: canvas-based panel + merged BoxGeometry structure.
// Total draw calls: 1 (ShaderMaterial panel) + 1 (merged structure) = 2 DC in FPV.
// All coordinates are in aircraft LOCAL space (same frame as cockpitEye in render.ts).

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

// ---- Panel ShaderMaterial ---------------------------------------------------
// Draws gauge bezels, tick marks, and live needles entirely in GLSL.
// Uniforms are updated per frame; no canvas redraw cost.

const PANEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PANEL_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;

uniform float uAspect;   // panelW / panelH
uniform float uSpeed;    // 0-1
uniform float uAlt;      // 0-1
uniform float uHeading;  // 0-1 (0=N, clockwise)
uniform float uThrottle; // 0-1.1

const float PI = 3.14159265;

const vec3 BG     = vec3(0.055, 0.090, 0.145);
const vec3 BEZEL  = vec3(0.200, 0.310, 0.460);
const vec3 GLASS  = vec3(0.018, 0.040, 0.065);
const vec3 TICK   = vec3(0.280, 0.460, 0.640);
const vec3 NEEDLE = vec3(0.980, 0.890, 0.680);
const vec3 HUB    = vec3(0.500, 0.650, 0.800);
const vec3 MFD    = vec3(0.010, 0.030, 0.040);
const vec3 WARN   = vec3(0.220, 0.050, 0.040);
const vec3 WARN2  = vec3(0.030, 0.150, 0.060);

// Aspect-corrected distance from uv to center c
float dist(vec2 uv, vec2 c) {
  return length(vec2((uv.x - c.x) * uAspect, uv.y - c.y));
}

// Draw one analog gauge. value in [0,1], sweeps 270° from bottom-left to bottom-right.
vec3 gauge(vec2 uv, vec2 c, float r, float value, bool live) {
  float d = dist(uv, c);
  float bezelW = r * 0.13;

  if (d > r + bezelW) return BG;

  // Bezel ring
  if (d > r - bezelW * 0.2) {
    float hi = smoothstep(r + bezelW, r + bezelW * 0.6, d);
    return mix(BG, BEZEL, hi);
  }

  vec3 col = GLASS;

  // Tick marks: 36 divisions, major every 3rd
  vec2 dc = vec2((uv.x - c.x) * uAspect, uv.y - c.y);
  float angle = atan(dc.x, dc.y);  // 0 at top, clockwise
  float normA = mod(angle / (2.0 * PI) + 1.5, 1.0);
  float tickDiv = 1.0 / 36.0;
  float nearT = mod(normA + tickDiv * 0.5, tickDiv);
  bool major = nearT < tickDiv * 0.12;
  bool minor = nearT < tickDiv * 0.06;
  float inTickZone = step(r * 0.70, d) * step(d, r * 0.92);
  if (major && inTickZone > 0.0)  col = mix(col, TICK, 0.90);
  else if (minor && inTickZone > 0.0) col = mix(col, TICK, 0.55);

  // Needle: 270° sweep starting from ~bottom-left (-135°), clockwise
  if (live) {
    float needleA = (-0.75 + value * 0.75) * 2.0 * PI;  // -135° to +135°
    vec2 nd = vec2(sin(needleA), cos(needleA));
    float along  = dot(dc / r, nd);
    float across = abs(dc.x / r * nd.y - dc.y / r * nd.x);
    bool onNeedle = along > 0.05 && along < 0.80 && across < 0.038;
    if (onNeedle) col = NEEDLE;
  }

  // Hub dot
  if (d < r * 0.06) col = HUB;

  return col;
}

void main() {
  // BackSide rendering: UV.x is mirrored relative to the pilot's left/right.
  // Flip x so gauge layout matches authoring (left column on pilot's left).
  vec2 uv = vec2(1.0 - vUv.x, vUv.y);

  vec3 col = BG;

  // ── Left column: IAS · ALT · compass ──────────────────────────────────────
  float lr = 0.12;
  vec3 g;

  g = gauge(uv, vec2(0.14, 0.76), lr, uSpeed,   true);
  if (dist(uv, vec2(0.14, 0.76)) < lr + lr * 0.14) col = g;

  g = gauge(uv, vec2(0.14, 0.44), lr, uAlt,     true);
  if (dist(uv, vec2(0.14, 0.44)) < lr + lr * 0.14) col = g;

  g = gauge(uv, vec2(0.14, 0.14), lr * 0.78, uHeading, true);
  if (dist(uv, vec2(0.14, 0.14)) < lr * 0.78 + lr * 0.10) col = g;

  // ── Centre: attitude (large) + heading ────────────────────────────────────
  float cr = 0.175;
  g = gauge(uv, vec2(0.50, 0.60), cr, 0.5, false);
  if (dist(uv, vec2(0.50, 0.60)) < cr + cr * 0.14) col = g;

  g = gauge(uv, vec2(0.50, 0.18), lr, uHeading, true);
  if (dist(uv, vec2(0.50, 0.18)) < lr + lr * 0.14) col = g;

  // ── Right column: throttle · EGT · oil ────────────────────────────────────
  float rr = 0.11;
  g = gauge(uv, vec2(0.86, 0.74), rr, clamp(uThrottle / 1.1, 0.0, 1.0), true);
  if (dist(uv, vec2(0.86, 0.74)) < rr + rr * 0.14) col = g;

  g = gauge(uv, vec2(0.86, 0.44), rr * 0.88, 0.68, false);
  if (dist(uv, vec2(0.86, 0.44)) < rr * 0.88 + rr * 0.12) col = g;

  g = gauge(uv, vec2(0.86, 0.16), rr * 0.80, 0.52, false);
  if (dist(uv, vec2(0.86, 0.16)) < rr * 0.80 + rr * 0.12) col = g;

  // ── MFD screen block ──────────────────────────────────────────────────────
  float inMFD = step(0.26, uv.x) * step(uv.x, 0.42) * step(0.52, uv.y) * step(uv.y, 0.88);
  col = mix(col, MFD, inMFD);
  // Subtle green border on MFD
  float mfdBorder = step(0.255, uv.x)*step(uv.x, 0.425)*step(0.515, uv.y)*step(uv.y, 0.885)
                  - step(0.268, uv.x)*step(uv.x, 0.413)*step(0.527, uv.y)*step(uv.y, 0.873);
  col = mix(col, vec3(0.04, 0.14, 0.06), mfdBorder);

  // ── Warning light strip ───────────────────────────────────────────────────
  float warnY = step(0.91, uv.y);
  float warnX = step(0.25, uv.x) * step(uv.x, 0.75);
  float warnPos = (uv.x - 0.25) / 0.50;
  vec3 warnCol = mix(WARN, WARN2, step(0.5, warnPos));
  float warnGrid = step(fract(warnPos * 6.0), 0.85); // 6 warning lights with gaps
  col = mix(col, warnCol * warnGrid, warnY * warnX * 0.85);

  // ── Edge bevel: thin raised border ───────────────────────────────────────
  float edge = max(max(1.0 - uv.x, uv.x - 0.0), max(1.0 - uv.y, uv.y));
  float bevel = step(0.97, edge);
  col = mix(col, BEZEL * 0.6, bevel);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Structural geometry helpers -------------------------------------------

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number,
                rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

// ---- Build -----------------------------------------------------------------

export function buildCockpitMesh(def: CockpitDef): CockpitState {
  const group = new THREE.Group();
  const [, eyeY, eyeZ] = def.eye;
  const PW = def.panelW;
  const PH = def.panelH;
  const panelTop = def.panelY + PH / 2;

  // ── Panel face — ShaderMaterial, 1 DC, live via uniforms ─────────────────
  const panelUniforms = {
    uAspect:   { value: PW / PH },
    uSpeed:    { value: 0.0 },
    uAlt:      { value: 0.0 },
    uHeading:  { value: 0.0 },
    uThrottle: { value: 0.0 },
  };
  // BackSide renders the face pointing toward -Z (pilot direction) without
  // any mesh rotation. rotation.y=PI would reverse winding order and cull the
  // face with FrontSide. The UV x-flip in the shader corrects the mirror.
  const panelMat = new THREE.ShaderMaterial({
    vertexShader:   PANEL_VERT,
    fragmentShader: PANEL_FRAG,
    uniforms:       panelUniforms,
    side:           THREE.BackSide,
  });
  const panelGeo = new THREE.PlaneGeometry(PW, PH);
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.position.set(0, def.panelY, def.panelZ);
  group.add(panelMesh);

  // ── Glare shield — horizontal slab flush against panel top, no gap ────────
  // Positioned so its rear face is at panelZ, extending forward toward pilot.
  // The bottom of the slab is at panelTop (y=panelTop), so it butts directly
  // against the top edge of the panel face. Both share z=panelZ at their contact.
  const gsDep = 0.32;
  const gsThk = 0.028;
  const gsGeos: THREE.BufferGeometry[] = [];
  gsGeos.push(boxGeo(PW * 0.94, gsThk, gsDep,
    0, panelTop + gsThk / 2, def.panelZ - gsDep / 2));
  // Coaming front lip (thin vertical face, visible to pilot)
  gsGeos.push(boxGeo(PW * 0.94, 0.055, 0.012,
    0, panelTop - 0.027, def.panelZ - gsDep));

  // ── Gunsight body ─────────────────────────────────────────────────────────
  gsGeos.push(boxGeo(0.055, 0.055, 0.10,
    0, panelTop + gsThk + 0.042, def.panelZ - gsDep + 0.04));
  // Sight glass — thin horizontal plate
  gsGeos.push(boxGeo(0.080, 0.004, 0.065,
    0, panelTop + gsThk + 0.088, def.panelZ - gsDep + 0.07));

  // ── A-pillars ─────────────────────────────────────────────────────────────
  // Pillar runs from base (behind shoulder, at sill height) to top (glare shield level).
  const pBotY = eyeY - 0.15;
  const pBotZ = eyeZ + 0.08;
  const pTopY = eyeY + 0.30;
  const pTopZ = def.panelZ - 0.04;
  const pX = PW / 2 + 0.04;

  const dz = pTopZ - pBotZ;
  const dy = pTopY - pBotY;
  const pLen = Math.sqrt(dz * dz + dy * dy);
  const pAngle = -Math.atan2(dy, dz); // rotation around X

  for (const side of [-1, 1]) {
    gsGeos.push(boxGeo(0.028, pLen, 0.028,
      side * pX, (pBotY + pTopY) / 2, (pBotZ + pTopZ) / 2,
      pAngle, 0, 0));
  }

  // ── Canopy top rail and rear arch ─────────────────────────────────────────
  const railLen = pTopZ - pBotZ + 0.18;
  const railZ   = (pBotZ + pTopZ) / 2;
  // Top rail (fore-aft at arch height)
  gsGeos.push(boxGeo(PW * 0.92, 0.022, railLen,
    0, pTopY + 0.012, railZ));
  // Center bow (thin vertical fin)
  gsGeos.push(boxGeo(0.018, pTopY - pBotY + 0.06, railLen * 0.88,
    0, (pBotY + pTopY) / 2 + 0.03, railZ));
  // Rear arch
  gsGeos.push(boxGeo(PW * 0.92, 0.022, 0.022,
    0, pBotY + 0.08, pBotZ - 0.10));
  // Left and right sill rails (horizontal ledge at sill height)
  for (const side of [-1, 1]) {
    gsGeos.push(boxGeo(0.018, 0.014, railLen,
      side * (PW / 2 + 0.02), pBotY, railZ));
  }

  // ── Cockpit sidewalls and floor ───────────────────────────────────────────
  // These exist below the canopy sill (pBotY) so the pilot doesn't see through
  // the fuselage sides in FPV. Above the sill, the A-pillars + open glass handle
  // the view. Wall depth spans from rear arch to instrument panel face.
  const sillY  = pBotY;               // y = eyeY - 0.15
  const floorY = eyeY - 0.50;         // cockpit floor
  const wallH  = sillY - floorY;      // wall height below sill
  const wallZMid  = (pBotZ - 0.15 + def.panelZ) / 2;
  const wallZSpan = def.panelZ - (pBotZ - 0.15);

  // Left sidewall panel
  gsGeos.push(boxGeo(0.018, wallH, wallZSpan,
    -(PW / 2 + 0.06), floorY + wallH / 2, wallZMid));
  // Right sidewall panel
  gsGeos.push(boxGeo(0.018, wallH, wallZSpan,
    PW / 2 + 0.06, floorY + wallH / 2, wallZMid));
  // Floor panel
  gsGeos.push(boxGeo(PW * 1.2, 0.018, wallZSpan,
    0, floorY, wallZMid));
  // Rear bulkhead (behind pilot seat)
  gsGeos.push(boxGeo(PW * 1.2, wallH, 0.018,
    0, floorY + wallH / 2, pBotZ - 0.18));

  // ── Control stick ─────────────────────────────────────────────────────────
  const stickZ = eyeZ + 0.26;
  const stickH = 0.30;
  const stickBaseY = eyeY - 0.46;
  gsGeos.push(boxGeo(0.020, stickH, 0.020, 0, stickBaseY + stickH / 2, stickZ));
  gsGeos.push(boxGeo(0.050, 0.068, 0.050, 0, stickBaseY + stickH + 0.034, stickZ));

  // Merge all structural geometry into a single mesh — 1 DC total for structure
  const merged = mergeGeometries(gsGeos);
  gsGeos.forEach(g => g.dispose());
  const structMat = new THREE.MeshBasicMaterial({ color: 0x0d1828 });
  const structMesh = new THREE.Mesh(merged, structMat);
  group.add(structMesh);

  group.visible = false;

  return {
    group,
    updateLive(speed01, alt01, heading01, throttle01) {
      panelUniforms.uSpeed.value    = speed01;
      panelUniforms.uAlt.value      = alt01;
      panelUniforms.uHeading.value  = heading01;
      panelUniforms.uThrottle.value = throttle01;
    },
    dispose() {
      panelGeo.dispose();
      panelMat.dispose();
      merged.dispose();
      structMat.dispose();
    },
  };
}
