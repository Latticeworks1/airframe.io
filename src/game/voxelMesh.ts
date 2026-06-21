import * as THREE from "three";
import type { Vector3 } from "three";
import type { VoxelAircraftDef, VoxelZone } from "./voxelTypes";

// ---- internal state per live pilot ----------------------------------------

export interface VoxelMeshState {
  mesh: THREE.InstancedMesh;
  cells: Map<string, { idx: number; alive: boolean; zone: VoxelZone; gx: number; gy: number; gz: number }>;
  voxelSize: number;
}

const DIRS: [number, number, number][] = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
];

const _dummy = new THREE.Object3D();
const _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();

// ---- builder ---------------------------------------------------------------

export function buildVoxelMesh(def: VoxelAircraftDef): VoxelMeshState {
  const grid = new Set<string>(def.cells.map(c => key(c.gx, c.gy, c.gz)));

  // Only allocate instances for surface voxels — at least one empty neighbour
  const surface = def.cells.filter(c =>
    DIRS.some(([dx, dy, dz]) => !grid.has(key(c.gx + dx, c.gy + dy, c.gz + dz)))
  );

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, surface.length);
  mesh.castShadow = false;
  mesh.count = surface.length;

  const cells = new Map<string, VoxelMeshState["cells"] extends Map<string, infer V> ? V : never>();
  const s = def.voxelSize;
  const gap = s * 0.96; // slight inset so adjacent voxels show a thin seam

  for (let i = 0; i < surface.length; i++) {
    const c = surface[i];
    _dummy.position.set(c.gx * s, c.gy * s, c.gz * s);
    _dummy.scale.setScalar(gap);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    mesh.setColorAt!(i, _col.setHex(c.color));
    cells.set(key(c.gx, c.gy, c.gz), {
      idx: i, alive: true, zone: c.zone, gx: c.gx, gy: c.gy, gz: c.gz
    });
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return { mesh, cells, voxelSize: s };
}

// ---- deformation -----------------------------------------------------------

export function deformAtImpact(
  state: VoxelMeshState,
  localMeters: Vector3,
  blastMeters: number
): boolean {
  const s = state.voxelSize;
  const r2 = blastMeters * blastMeters;
  let changed = false;

  for (const cell of state.cells.values()) {
    if (!cell.alive) continue;
    const dx = cell.gx * s - localMeters.x;
    const dy = cell.gy * s - localMeters.y;
    const dz = cell.gz * s - localMeters.z;
    if (dx * dx + dy * dy + dz * dz < r2) {
      mesh_hide(state, cell);
      cell.alive = false;
      changed = true;
    }
  }

  if (changed) state.mesh.instanceMatrix.needsUpdate = true;
  return changed;
}

function mesh_hide(state: VoxelMeshState, cell: { idx: number }) {
  state.mesh.setMatrixAt(cell.idx, _hiddenMatrix);
}

// ---- cleanup ---------------------------------------------------------------

export function disposeVoxelMesh(state: VoxelMeshState) {
  state.mesh.geometry.dispose();
  (state.mesh.material as THREE.Material).dispose();
}

// ---- helpers ---------------------------------------------------------------

function key(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}
