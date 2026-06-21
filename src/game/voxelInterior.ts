import * as THREE from "three";

export interface InteriorCell {
  gx: number;
  gy: number;
  gz: number;
  color: number;
  liveId?: string; // if set, this cell is updated per-frame by updateInteriorLive
}

export interface InteriorDef {
  voxelSize: number; // meters per grid unit — much finer than exterior (e.g. 0.05)
  cells: InteriorCell[];
}

export interface InteriorMeshState {
  mesh: THREE.InstancedMesh;
  // Per-frame-updated cells keyed by liveId. Each liveId maps to one instance index.
  liveIndices: Map<string, number>;
  voxelSize: number;
}

// ---- scratch ----------------------------------------------------------------

const _dummy = new THREE.Object3D();
const _col = new THREE.Color();
const _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

// ---- builder helpers --------------------------------------------------------
// These emit InteriorCells into a Map keyed by "gx,gy,gz" for deduplication.

type CellMap = Map<string, InteriorCell>;

function set(m: CellMap, gx: number, gy: number, gz: number, color: number, liveId?: string) {
  m.set(`${gx},${gy},${gz}`, { gx, gy, gz, color, liveId });
}

// Hollow shell of an axis-aligned box.
export function shell(
  m: CellMap,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  color: number
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1)
          set(m, x, y, z, color);
}

// Filled box.
export function solid(
  m: CellMap,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  color: number
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        set(m, x, y, z, color);
}

// Horizontal flat slab (y constant).
export function slab(
  m: CellMap,
  x0: number, z0: number, x1: number, z1: number,
  y: number, color: number
) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      set(m, x, y, z, color);
}

// Vertical face perpendicular to Z (instrument panel face, seat back face, etc.)
export function faceZ(
  m: CellMap,
  x0: number, y0: number, x1: number, y1: number,
  z: number, color: number
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      set(m, x, y, z, color);
}

// Vertical face parallel to Z (side wall).
export function faceX(
  m: CellMap,
  z0: number, y0: number, z1: number, y1: number,
  x: number, color: number
) {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      set(m, x, y, z, color);
}

// ---- semantic builders ------------------------------------------------------

// A framed instrument screen face — one cell deep, with a darker inner bezel.
export function screen(
  m: CellMap,
  x0: number, y0: number, x1: number, y1: number,
  z: number,
  frameColor: number,
  glassColor: number
) {
  faceZ(m, x0, y0, x1, y1, z, frameColor);
  // inner glass one cell inset
  if (x1 - x0 >= 2 && y1 - y0 >= 2)
    faceZ(m, x0 + 1, y0 + 1, x1 - 1, y1 - 1, z, glassColor);
}

// A throttle/control lever: a column with a moveable grip cap.
// The grip cells are tagged with liveId so worldRenderer can slide them.
export function lever(
  m: CellMap,
  x: number, z: number,
  yBase: number, yStalk: number, yGrip: number,
  stalkColor: number, gripColor: number,
  liveId: string
) {
  for (let y = yBase; y <= yStalk; y++) set(m, x, y, z, stalkColor);
  // grip — live cell that slides between yBase and yGrip
  set(m, x, yGrip, z, gripColor, liveId);
}

// ---- build ------------------------------------------------------------------

export function buildInteriorMesh(def: InteriorDef): InteriorMeshState {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // Interior uses a fresh material — FrontSide, no emissive, unaffected by
  // the FPV DoubleSide toggle applied to the exterior voxel material.
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });

  const count = def.cells.length;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  mesh.userData.isInterior = true;

  const s = def.voxelSize;
  const liveIndices = new Map<string, number>();

  for (let i = 0; i < count; i++) {
    const c = def.cells[i];
    _dummy.position.set(c.gx * s, c.gy * s, c.gz * s);
    _dummy.scale.setScalar(s);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    mesh.setColorAt!(i, _col.setHex(c.color));
    if (c.liveId) liveIndices.set(c.liveId, i);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return { mesh, liveIndices, voxelSize: s };
}

// Update live cells per frame. throttle ∈ [0,1.1], altM = altitude in metres.
export function updateInteriorLive(
  state: InteriorMeshState,
  def: InteriorDef,
  throttle: number,
  altM: number
) {
  if (state.liveIndices.size === 0) return;
  let dirty = false;

  for (const [liveId, idx] of state.liveIndices) {
    const cell = def.cells[idx];
    if (!cell) continue;

    if (liveId.startsWith("throttle")) {
      // Slide grip cell vertically with throttle ratio
      const base = parseFloat(liveId.split(":")[1] ?? "0");
      const travel = parseFloat(liveId.split(":")[2] ?? "0");
      const gripY = base + travel * (1 - Math.min(throttle, 1.0));
      _dummy.position.set(cell.gx * state.voxelSize, gripY * state.voxelSize, cell.gz * state.voxelSize);
      _dummy.scale.setScalar(state.voxelSize);
      _dummy.updateMatrix();
      state.mesh.setMatrixAt(idx, _dummy.matrix);
      // color shifts green → amber → red with throttle
      const t = Math.min(throttle, 1.1) / 1.1;
      const r = Math.round(Math.min(255, t * 2 * 255));
      const g = Math.round(Math.min(255, (1 - t) * 2 * 255 + 80));
      _col.setRGB(r / 255, g / 255, 0.05);
      state.mesh.setColorAt!(idx, _col);
      dirty = true;
    } else if (liveId === "altstrip") {
      // Color cycles through a 0–14000m range
      const ratio = Math.min(altM, 14000) / 14000;
      _col.setHSL(0.55 - ratio * 0.4, 0.8, 0.25 + ratio * 0.2);
      state.mesh.setColorAt!(idx, _col);
      dirty = true;
    }
  }

  if (dirty) {
    state.mesh.instanceMatrix.needsUpdate = true;
    if (state.mesh.instanceColor) state.mesh.instanceColor.needsUpdate = true;
  }
}

export function disposeInteriorMesh(state: InteriorMeshState) {
  state.mesh.geometry.dispose();
  (state.mesh.material as THREE.Material).dispose();
}
