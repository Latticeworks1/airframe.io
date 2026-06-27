import * as THREE from "three";
import { registerHeightmap } from "./terrainModel";
import type { HeightmapData } from "./terrainModel";

const GRID = 128;

export async function buildGlbCollider(
  glbScene: THREE.Object3D,
  mapId: string,
  worldRadius: number,
  maxAltitude: number
): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  glbScene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      meshes.push(child);
    }
  });

  if (meshes.length === 0) return;

  const raycaster = new THREE.Raycaster();
  raycaster.ray.direction.set(0, -1, 0);

  const heights = new Float32Array(GRID * GRID);
  let maxH = 0;

  const step = (worldRadius * 2) / (GRID - 1);
  const origin = new THREE.Vector3();

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = -worldRadius + col * step;
      const z = -worldRadius + row * step;
      origin.set(x, maxAltitude + 1000, z);
      raycaster.ray.origin.copy(origin);
      const hits = raycaster.intersectObjects(meshes, false);
      const h = hits.length > 0 ? Math.max(0, hits[0].point.y) : 0;
      heights[row * GRID + col] = h;
      if (h > maxH) maxH = h;
    }
  }

  const elevationScale = Math.max(100, Math.ceil(maxH / 100) * 100);
  const normalized = new Float32Array(GRID * GRID);
  for (let i = 0; i < heights.length; i++) {
    normalized[i] = heights[i] / elevationScale;
  }

  const data: HeightmapData = {
    buffer: normalized,
    width: GRID,
    height: GRID,
    worldRadius,
    elevationScale,
  };

  registerHeightmap(mapId, data);
}
