import * as THREE from "three";
import type { MapDefinition } from "./content/maps/mapTypes";
import type { BakedMapGeometry } from "./content/maps/mapTypes";
import { sampleTerrainHeight, sampleHeightmapAt, getHeightmapData, TerrainLayout } from "./terrainModel";

// Budget tuned for mobile: total < 4000 instances across all types
const MAX_PINES      = 1200;
const MAX_BROADLEAF  = 800;
const MAX_BUILDINGS  = 400;

// ---- Geometry helpers -------------------------------------------------------

function mergeGeos(parts: { geo: THREE.BufferGeometry; dy: number }[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const { geo } of parts) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const pos  = new Float32Array(vCount * 3);
  const nor  = new Float32Array(vCount * 3);
  const idx  = new Uint32Array(iCount);
  let vi = 0, ii = 0;
  for (const { geo, dy } of parts) {
    const srcPos = geo.attributes.position.array as Float32Array;
    const srcNor = (geo.attributes.normal?.array ?? new Float32Array(srcPos.length)) as Float32Array;
    const srcIdx = geo.index;
    const n = geo.attributes.position.count;
    for (let i = 0; i < n; i++) {
      pos[(vi + i) * 3 + 0] = srcPos[i * 3 + 0];
      pos[(vi + i) * 3 + 1] = srcPos[i * 3 + 1] + dy;
      pos[(vi + i) * 3 + 2] = srcPos[i * 3 + 2];
      nor[(vi + i) * 3 + 0] = srcNor[i * 3 + 0];
      nor[(vi + i) * 3 + 1] = srcNor[i * 3 + 1];
      nor[(vi + i) * 3 + 2] = srcNor[i * 3 + 2];
    }
    if (srcIdx) {
      for (let i = 0; i < srcIdx.count; i++) idx[ii + i] = srcIdx.getX(i) + vi;
      ii += srcIdx.count;
    } else {
      for (let i = 0; i < n; i++) idx[ii + i] = vi + i;
      ii += n;
    }
    vi += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal",   new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!parts[0].geo.attributes.normal) g.computeVertexNormals();
  return g;
}

function makePineGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(1.5, 2.5, 12, 5);
  const crown = new THREE.ConeGeometry(10, 24, 5);
  const merged = mergeGeos([{ geo: trunk, dy: 6 }, { geo: crown, dy: 24 }]);
  trunk.dispose(); crown.dispose();
  return merged;
}

function makeBroadleafGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(1.5, 2.5, 10, 5);
  const crown = new THREE.SphereGeometry(11, 5, 4);
  const merged = mergeGeos([{ geo: trunk, dy: 5 }, { geo: crown, dy: 20 }]);
  trunk.dispose(); crown.dispose();
  return merged;
}

// ---- Point-in-polygon (ray cast) -------------------------------------------

function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], yi = ring[i * 2 + 1];
    const xj = ring[j * 2], yj = ring[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- Road ribbon mesh -------------------------------------------------------

function buildRoadRibbons(
  geom: BakedMapGeometry,
  worldRadius: number,
  getHeight: (x: number, z: number) => number
): THREE.Mesh | null {
  const widths: Record<string, number> = {
    motorway: 12, primary: 9, secondary: 6, tertiary: 4, track: 2.5
  };
  const colors: Record<string, number> = {
    motorway: 0x94a3b8, primary: 0x94a3b8, secondary: 0x64748b, tertiary: 0x475569, track: 0x374151
  };

  const positions: number[] = [];
  const normals:   number[] = [];
  const indices:   number[] = [];

  const D = worldRadius * 2;
  let base = 0;

  for (const road of geom.roads) {
    const pts = road.pts;
    const hw = (widths[road.kind] ?? 5) * 0.5;
    const _color = colors[road.kind] ?? 0x475569;
    void _color;

    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = (pts[i]     - 0.5) * D, az = (pts[i + 1] - 0.5) * D;
      const bx = (pts[i + 2] - 0.5) * D, bz = (pts[i + 3] - 0.5) * D;
      const ay = getHeight(ax, az) + 0.4;
      const by = getHeight(bx, bz) + 0.4;

      const dx = bx - ax, dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.1) continue;
      const nx = -dz / len * hw, nz = dx / len * hw;

      // Four verts: left-a, right-a, right-b, left-b
      positions.push(
        ax + nx, ay, az + nz,
        ax - nx, ay, az - nz,
        bx - nx, by, bz - nz,
        bx + nx, by, bz + nz
      );
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      indices.push(base, base+1, base+2, base, base+2, base+3);
      base += 4;
    }
  }

  if (indices.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal",   new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setIndex(indices);

  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x64748b,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }));
}

// ---- ScatterRenderer --------------------------------------------------------

export class ScatterRenderer {
  private meshes: THREE.Object3D[] = [];
  private scene: THREE.Scene;

  constructor(
    scene: THREE.Scene,
    mapDef: MapDefinition,
    layout: TerrainLayout,
    geom?: BakedMapGeometry,
    scatterScale = 1.0,
    shadows = true
  ) {
    this.scene = scene;
    this.build(mapDef, layout, geom, scatterScale, shadows);
  }

  private build(
    mapDef: MapDefinition,
    layout: TerrainLayout,
    geom?: BakedMapGeometry,
    scatterScale = 1.0,
    shadows = true
  ) {
    const rand = mulberry32(mapDef.seed ^ 0xdeadbeef);
    const R    = mapDef.world.radius;
    const D    = R * 2;

    const heightAt = (x: number, z: number): number => {
      if (mapDef.terrain.kind === "heightmap") {
        const hd = getHeightmapData(mapDef.terrain.path);
        if (hd) return sampleHeightmapAt(hd, x, z);
      }
      return sampleTerrainHeight(x, z, layout).height;
    };

    // --- Road ribbons from OSM geometry ---
    if (geom && geom.roads.length > 0) {
      const ribbon = buildRoadRibbons(geom, R, heightAt);
      if (ribbon) {
        this.scene.add(ribbon);
        this.meshes.push(ribbon);
      }
    }

    // --- Determine forest and urban seed zones ---
    // Each zone is a center (world-space) + radius for candidate generation fallback
    const forestZones: { cx: number; cz: number; r: number }[] = [];
    const urbanZones:  { cx: number; cz: number; r: number }[] = [];

    if (geom) {
      for (const lu of geom.landUse) {
        if (lu.kind !== "forest" && lu.kind !== "scrub" && lu.kind !== "urban") continue;
        let sx = 0, sz = 0;
        const n = lu.ring.length >> 1;
        for (let i = 0; i < lu.ring.length; i += 2) { sx += lu.ring[i]; sz += lu.ring[i+1]; }
        const cx = (sx / n - 0.5) * D, cz = (sz / n - 0.5) * D;
        const r = Math.sqrt(D * D * 0.04); // rough polygon radius
        if (lu.kind === "urban") urbanZones.push({ cx, cz, r });
        else forestZones.push({ cx, cz, r });
      }
    }

    // For procedural maps with no OSM geom: derive zones from terrain blocks
    if (forestZones.length === 0) {
      for (const block of layout.blocks) {
        if (block.surface === "land" || block.surface === "mountain") {
          forestZones.push({ cx: block.position[0], cz: block.position[2], r: block.scale[0] * 0.7 });
        }
      }
    }

    const maxPines = Math.max(1, Math.floor(MAX_PINES * scatterScale));
    const maxBroadleaf = Math.max(1, Math.floor(MAX_BROADLEAF * scatterScale));
    const maxBuildings = Math.max(1, Math.floor(MAX_BUILDINGS * scatterScale));

    // --- Pine trees ---
    const pineGeo = makePineGeo();
    const pineMat = new THREE.MeshLambertMaterial({ color: 0x2d5a1b, flatShading: true });
    const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, maxPines);
    pineMesh.count = 0;
    pineMesh.castShadow = shadows;
    pineMesh.receiveShadow = shadows;
    this.scene.add(pineMesh);
    this.meshes.push(pineMesh);

    const broadGeo = makeBroadleafGeo();
    const broadMat = new THREE.MeshLambertMaterial({ color: 0x3a7d2c, flatShading: true });
    const broadMesh = new THREE.InstancedMesh(broadGeo, broadMat, maxBroadleaf);
    broadMesh.count = 0;
    broadMesh.castShadow = shadows;
    broadMesh.receiveShadow = shadows;
    this.scene.add(broadMesh);
    this.meshes.push(broadMesh);

    const dummy = new THREE.Object3D();
    let pineCount = 0, broadCount = 0;

    // Generate tree candidates
    const totalTrees = maxPines + maxBroadleaf;
    const candidatesPerZone = forestZones.length > 0
      ? Math.ceil(totalTrees * 1.5 / forestZones.length)
      : 0;

    for (const zone of forestZones) {
      for (let i = 0; i < candidatesPerZone && (pineCount + broadCount) < totalTrees; i++) {
        // Sample within zone using rejection sampling in a box
        const angle = rand() * Math.PI * 2;
        const dist  = Math.sqrt(rand()) * zone.r;
        const wx = zone.cx + Math.cos(angle) * dist;
        const wz = zone.cz + Math.sin(angle) * dist;

        if (Math.abs(wx) > R || Math.abs(wz) > R) continue;

        // Test OSM polygon if available
        if (geom && geom.landUse.length > 0) {
          const nx = wx / D + 0.5, nz = wz / D + 0.5;
          const inForest = geom.landUse.some(
            lu => (lu.kind === "forest" || lu.kind === "scrub") && pointInRing(nx, nz, lu.ring)
          );
          if (!inForest) continue;
        }

        const wy = heightAt(wx, wz);
        if (wy <= mapDef.world.waterHeight + 1) continue; // skip underwater

        const scale = 0.7 + rand() * 0.7;
        dummy.position.set(wx, wy - 1.0, wz);
        dummy.rotation.y = rand() * Math.PI * 2;
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();

        // Alpine maps get more pines; tropical gets more broadleaf
        const isPine = mapDef.terrain.kind === "alpine"
          ? rand() < 0.85
          : rand() < 0.55;

        if (isPine && pineCount < maxPines) {
          pineMesh.setMatrixAt(pineCount++, dummy.matrix);
        } else if (!isPine && broadCount < maxBroadleaf) {
          broadMesh.setMatrixAt(broadCount++, dummy.matrix);
        }
      }
    }

    pineMesh.count = pineCount;
    broadMesh.count = broadCount;
    if (pineCount > 0) pineMesh.instanceMatrix.needsUpdate = true;
    if (broadCount > 0) broadMesh.instanceMatrix.needsUpdate = true;

    // --- Buildings (urban clusters) ---
    if (urbanZones.length > 0 || geom?.landUse.some(lu => lu.kind === "urban")) {
      const bldGeo  = new THREE.BoxGeometry(1, 1, 1);
      const bldMat  = new THREE.MeshLambertMaterial({ color: 0x94a3b8, flatShading: true });
      const bldMesh = new THREE.InstancedMesh(bldGeo, bldMat, maxBuildings);
      bldMesh.count = 0;
      bldMesh.castShadow = shadows;
      bldMesh.receiveShadow = shadows;
      this.scene.add(bldMesh);
      this.meshes.push(bldMesh);

      let bldCount = 0;
      const zones = urbanZones.length > 0 ? urbanZones : forestZones.slice(0, 3);
      const perZone = Math.ceil(maxBuildings / zones.length);

      for (const zone of zones) {
        for (let i = 0; i < perZone && bldCount < maxBuildings; i++) {
          const angle = rand() * Math.PI * 2;
          const dist  = Math.sqrt(rand()) * zone.r * 0.6;
          const wx = zone.cx + Math.cos(angle) * dist;
          const wz = zone.cz + Math.sin(angle) * dist;
          if (Math.abs(wx) > R || Math.abs(wz) > R) continue;

          if (geom && geom.landUse.length > 0) {
            const nx = wx / D + 0.5, nz = wz / D + 0.5;
            const inUrban = geom.landUse.some(lu => lu.kind === "urban" && pointInRing(nx, nz, lu.ring));
            if (!inUrban) continue;
          }

          const wy = heightAt(wx, wz);
          if (wy <= mapDef.world.waterHeight + 1) continue;

          const w = 8  + rand() * 24;
          const h = 6  + rand() * 34;
          const d = 8  + rand() * 20;
          dummy.position.set(wx, wy + h * 0.5 - 0.5, wz);
          dummy.rotation.y = rand() * Math.PI * 0.5;
          dummy.scale.set(w, h, d);
          dummy.updateMatrix();
          bldMesh.setMatrixAt(bldCount++, dummy.matrix);
        }
      }
      bldMesh.count = bldCount;
      if (bldCount > 0) bldMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const obj of this.meshes) {
      this.scene.remove(obj);
      if (obj instanceof THREE.InstancedMesh || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat.dispose();
      }
    }
    this.meshes = [];
  }
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
