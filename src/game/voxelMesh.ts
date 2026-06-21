import * as THREE from "three";
import type { Vector3 } from "three";
import type { VoxelAircraftDef, VoxelZone } from "./voxelTypes";

// ---- types -----------------------------------------------------------------

type CellState = {
  idx: number;
  // When true the cell lives in state.spinMesh instead of state.mesh.
  inSpinMesh: boolean;
  alive: boolean;
  zone: VoxelZone;
  tags?: string[];
  gx: number;
  gy: number;
  gz: number;
  exposed: boolean;
};

export interface VoxelMeshState {
  // Static geometry (all non-spinZ cells). Only updated on deformation.
  mesh: THREE.InstancedMesh;
  // spinZ cells get their own tiny InstancedMesh so that the per-frame matrix
  // upload is proportional to the number of propeller blades (≤23) rather than
  // the total cell count (≤1909).
  spinMesh: THREE.InstancedMesh | null;
  cells: Map<string, CellState>;
  voxelSize: number;
  spinCells: { idx: number; gx: number; gy: number; gz: number }[];
  spinAngle: number;
  // Tracks cockpit visibility so setCockpitVisible only uploads on transitions.
  cockpitHidden: boolean;
}

// ---- module-level scratch --------------------------------------------------

const DIRS: [number, number, number][] = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
];

const _dummy = new THREE.Object3D();
const _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();

// ---- builder ---------------------------------------------------------------

export function buildVoxelMesh(def: VoxelAircraftDef): VoxelMeshState {
  const grid = new Set<string>(def.cells.map(c => cellKey(c.gx, c.gy, c.gz)));

  // Include all authored cells rather than filtering/culling internal cells at startup.
  const staticSurface = def.cells.filter(c => !c.tags?.includes("spinZ"));
  const spinSurface   = def.cells.filter(c =>  c.tags?.includes("spinZ"));

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });

  // Main mesh — static cells
  const mesh = new THREE.InstancedMesh(geo, mat, staticSurface.length);
  mesh.castShadow = false;
  mesh.count = staticSurface.length;

  // Spin mesh — separate so only these ~23 matrices upload every frame
  let spinMesh: THREE.InstancedMesh | null = null;
  if (spinSurface.length > 0) {
    spinMesh = new THREE.InstancedMesh(geo.clone(), mat.clone(), spinSurface.length);
    spinMesh.castShadow = false;
    spinMesh.count = spinSurface.length;
  }

  const cells = new Map<string, CellState>();
  const spinCells: VoxelMeshState["spinCells"] = [];
  const s = def.voxelSize;
  const gap = s * 0.96;

  for (let i = 0; i < staticSurface.length; i++) {
    const c = staticSurface[i];
    const exposed = DIRS.some(([dx, dy, dz]) => !grid.has(cellKey(c.gx + dx, c.gy + dy, c.gz + dz)));
    if (exposed) {
      _setMatrix(_dummy, c.gx * s, c.gy * s, c.gz * s, gap);
      mesh.setMatrixAt(i, _dummy.matrix);
    } else {
      mesh.setMatrixAt(i, _hiddenMatrix);
    }
    mesh.setColorAt!(i, _col.setHex(c.color));
    cells.set(cellKey(c.gx, c.gy, c.gz), {
      idx: i, inSpinMesh: false, alive: true, zone: c.zone,
      tags: c.tags, gx: c.gx, gy: c.gy, gz: c.gz, exposed
    });
  }

  for (let i = 0; i < spinSurface.length; i++) {
    const c = spinSurface[i];
    const exposed = DIRS.some(([dx, dy, dz]) => !grid.has(cellKey(c.gx + dx, c.gy + dy, c.gz + dz)));
    if (exposed) {
      _setMatrix(_dummy, c.gx * s, c.gy * s, c.gz * s, gap);
      spinMesh!.setMatrixAt(i, _dummy.matrix);
    } else {
      spinMesh!.setMatrixAt(i, _hiddenMatrix);
    }
    spinMesh!.setColorAt!(i, _col.setHex(c.color));
    cells.set(cellKey(c.gx, c.gy, c.gz), {
      idx: i, inSpinMesh: true, alive: true, zone: c.zone,
      tags: c.tags, gx: c.gx, gy: c.gy, gz: c.gz, exposed
    });
    spinCells.push({ idx: i, gx: c.gx, gy: c.gy, gz: c.gz });
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (spinMesh) {
    spinMesh.instanceMatrix.needsUpdate = true;
    if (spinMesh.instanceColor) spinMesh.instanceColor.needsUpdate = true;
  }

  return { mesh, spinMesh, cells, voxelSize: s, spinCells, spinAngle: 0, cockpitHidden: false };
}

// ---- ray traversal ---------------------------------------------------------

export function findVoxelImpact(
  state: VoxelMeshState,
  segA: Vector3,
  segB: Vector3
): THREE.Vector3 | null {
  const s = state.voxelSize;
  const si = 1 / s;

  const dx = segB.x - segA.x;
  const dy = segB.y - segA.y;
  const dz = segB.z - segA.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return null;

  const nx = dx / len, ny = dy / len, nz = dz / len;

  let ix = Math.floor(segA.x * si);
  let iy = Math.floor(segA.y * si);
  let iz = Math.floor(segA.z * si);

  const stepX = nx >= 0 ? 1 : -1;
  const stepY = ny >= 0 ? 1 : -1;
  const stepZ = nz >= 0 ? 1 : -1;

  const boundX = (ix + (stepX > 0 ? 1 : 0)) * s;
  const boundY = (iy + (stepY > 0 ? 1 : 0)) * s;
  const boundZ = (iz + (stepZ > 0 ? 1 : 0)) * s;

  let tMaxX = Math.abs(nx) < 1e-9 ? Infinity : (boundX - segA.x) / nx;
  let tMaxY = Math.abs(ny) < 1e-9 ? Infinity : (boundY - segA.y) / ny;
  let tMaxZ = Math.abs(nz) < 1e-9 ? Infinity : (boundZ - segA.z) / nz;

  const tDeltaX = Math.abs(nx) < 1e-9 ? Infinity : s / Math.abs(nx);
  const tDeltaY = Math.abs(ny) < 1e-9 ? Infinity : s / Math.abs(ny);
  const tDeltaZ = Math.abs(nz) < 1e-9 ? Infinity : s / Math.abs(nz);

  const startCell = state.cells.get(cellKey(ix, iy, iz));
  if (startCell?.alive) return new THREE.Vector3(ix * s, iy * s, iz * s);

  let t = 0;
  while (t < len) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX; ix += stepX; tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY; iy += stepY; tMaxY += tDeltaY;
    } else {
      t = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ;
    }
    if (t > len) break;
    const cell = state.cells.get(cellKey(ix, iy, iz));
    if (cell?.alive) return new THREE.Vector3(ix * s, iy * s, iz * s);
  }

  return null;
}

// ---- deformation -----------------------------------------------------------

export const VOXEL_BLAST_RADII: Record<string, number> = {
  gun:    0,    // point strike — removes only the directly hit voxel
  rocket: 0.75,
  bomb:   2.50,
};

export function deformAtImpact(
  state: VoxelMeshState,
  localMeters: Vector3,
  blastMeters: number
): boolean {
  const s = state.voxelSize;
  const gx = Math.round(localMeters.x / s);
  const gy = Math.round(localMeters.y / s);
  const gz = Math.round(localMeters.z / s);
  const struckCell = state.cells.get(cellKey(gx, gy, gz));

  let changed = false;
  let staticDirty = false;
  let spinDirty = false;

  const deadCells: CellState[] = [];

  if (struckCell?.alive) {
    _hideCell(state, struckCell);
    struckCell.alive = false;
    deadCells.push(struckCell);
    changed = true;
    if (struckCell.inSpinMesh) spinDirty = true; else staticDirty = true;
  }

  if (blastMeters > 0) {
    const r2 = blastMeters * blastMeters;
    for (const cell of state.cells.values()) {
      if (!cell.alive) continue;
      const ddx = cell.gx * s - localMeters.x;
      const ddy = cell.gy * s - localMeters.y;
      const ddz = cell.gz * s - localMeters.z;
      if (ddx * ddx + ddy * ddy + ddz * ddz < r2) {
        _hideCell(state, cell);
        cell.alive = false;
        deadCells.push(cell);
        changed = true;
        if (cell.inSpinMesh) spinDirty = true; else staticDirty = true;
      }
    }
  }

  if (deadCells.length > 0) {
    const exposedAndChanged = new Set<CellState>();
    for (const dc of deadCells) {
      _exposeNeighbors(state, dc.gx, dc.gy, dc.gz, exposedAndChanged);
    }
    for (const ec of exposedAndChanged) {
      if (ec.inSpinMesh) spinDirty = true; else staticDirty = true;
    }
  }

  if (staticDirty) state.mesh.instanceMatrix.needsUpdate = true;
  if (spinDirty && state.spinMesh) state.spinMesh.instanceMatrix.needsUpdate = true;
  return changed;
}

// ---- animation -------------------------------------------------------------

export function animateSpinCells(
  state: VoxelMeshState,
  dt: number,
  throttle: number
): void {
  if (!state.spinMesh || state.spinCells.length === 0) return;
  state.spinAngle += (15 + throttle * 40) * dt;

  const s = state.voxelSize;
  const gap = s * 0.96;
  const cos = Math.cos(state.spinAngle);
  const sin = Math.sin(state.spinAngle);
  let dirty = false;

  for (const sc of state.spinCells) {
    const cell = state.cells.get(cellKey(sc.gx, sc.gy, sc.gz));
    if (!cell?.alive) continue;
    const rx = cos * sc.gx * s - sin * sc.gy * s;
    const ry = sin * sc.gx * s + cos * sc.gy * s;
    _setMatrix(_dummy, rx, ry, sc.gz * s, gap);
    state.spinMesh.setMatrixAt(cell.idx, _dummy.matrix);
    dirty = true;
  }

  if (dirty) state.spinMesh.instanceMatrix.needsUpdate = true;
}

// ---- cockpit visibility ----------------------------------------------------

export function setCockpitVisible(state: VoxelMeshState, visible: boolean): void {
  if (state.cockpitHidden === !visible) return;

  const s = state.voxelSize;
  const gap = s * 0.96;
  let changed = false;

  for (const cell of state.cells.values()) {
    if (cell.zone !== "cockpit") continue;
    if (!cell.alive) continue;
    const targetMesh = cell.inSpinMesh ? state.spinMesh! : state.mesh;
    if (visible && cell.exposed) {
      _setMatrix(_dummy, cell.gx * s, cell.gy * s, cell.gz * s, gap);
      targetMesh.setMatrixAt(cell.idx, _dummy.matrix);
    } else {
      targetMesh.setMatrixAt(cell.idx, _hiddenMatrix);
    }
    changed = true;
  }

  state.cockpitHidden = !visible;
  if (changed) {
    state.mesh.instanceMatrix.needsUpdate = true;
    if (state.spinMesh) state.spinMesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- respawn reset ---------------------------------------------------------

export function resetVoxelMesh(state: VoxelMeshState): void {
  const s = state.voxelSize;
  const gap = s * 0.96;

  for (const cell of state.cells.values()) {
    cell.alive = true;
    cell.exposed = DIRS.some(([dx, dy, dz]) => !state.cells.has(cellKey(cell.gx + dx, cell.gy + dy, cell.gz + dz)));
    const targetMesh = cell.inSpinMesh ? state.spinMesh! : state.mesh;
    if (cell.exposed) {
      _setMatrix(_dummy, cell.gx * s, cell.gy * s, cell.gz * s, gap);
      targetMesh.setMatrixAt(cell.idx, _dummy.matrix);
    } else {
      targetMesh.setMatrixAt(cell.idx, _hiddenMatrix);
    }
  }

  state.spinAngle = 0;
  state.cockpitHidden = false;
  state.mesh.instanceMatrix.needsUpdate = true;
  if (state.spinMesh) state.spinMesh.instanceMatrix.needsUpdate = true;
}

// ---- cleanup ---------------------------------------------------------------

export function disposeVoxelMesh(state: VoxelMeshState): void {
  state.mesh.geometry.dispose();
  (state.mesh.material as THREE.Material).dispose();
  if (state.spinMesh) {
    state.spinMesh.geometry.dispose();
    (state.spinMesh.material as THREE.Material).dispose();
  }
}

// ---- private helpers -------------------------------------------------------

function _hideCell(state: VoxelMeshState, cell: CellState): void {
  const m = cell.inSpinMesh ? state.spinMesh! : state.mesh;
  m.setMatrixAt(cell.idx, _hiddenMatrix);
}

function _setMatrix(obj: THREE.Object3D, x: number, y: number, z: number, scale: number): void {
  obj.position.set(x, y, z);
  obj.scale.setScalar(scale);
  obj.rotation.set(0, 0, 0);
  obj.updateMatrix();
}

function _exposeNeighbors(state: VoxelMeshState, gx: number, gy: number, gz: number, exposedAndChanged: Set<CellState>) {
  const s = state.voxelSize;
  const gap = s * 0.96;
  for (const [dx, dy, dz] of DIRS) {
    const nx = gx + dx;
    const ny = gy + dy;
    const nz = gz + dz;
    const neighbor = state.cells.get(cellKey(nx, ny, nz));
    if (neighbor && neighbor.alive && !neighbor.exposed) {
      const isExposedNow = DIRS.some(([ndx, ndy, ndz]) => {
        const neighborNeighbor = state.cells.get(cellKey(nx + ndx, ny + ndy, nz + ndz));
        return !neighborNeighbor || !neighborNeighbor.alive;
      });
      if (isExposedNow) {
        neighbor.exposed = true;
        exposedAndChanged.add(neighbor);
        const targetMesh = neighbor.inSpinMesh ? state.spinMesh! : state.mesh;
        _setMatrix(_dummy, neighbor.gx * s, neighbor.gy * s, neighbor.gz * s, gap);
        targetMesh.setMatrixAt(neighbor.idx, _dummy.matrix);
      }
    }
  }
}

function cellKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}
