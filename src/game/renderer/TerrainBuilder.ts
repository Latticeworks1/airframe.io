/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MapDefinition, BakedMapGeometry } from "../content/maps/mapTypes";
import { getTerrainLayout, loadHeightmap, sampleHeightmapAt } from "../terrainModel";
import { renderMapGeometry, renderPaletteFallback } from "../mapGeometryRenderer";
import { ScatterRenderer } from "../scatterRenderer";
import { buildGlbCollider } from "../terrainCollider";

function createWaterNormalMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * Math.PI * 2;
      const ny = (y / size) * Math.PI * 2;

      let dx = 0;
      let dy = 0;

      // Overlapping sine waves for high-quality ocean surface normals
      dx += Math.cos(nx * 4 + ny * 2) * 4;
      dy += Math.cos(nx * 4 + ny * 2) * 2;

      dx += Math.cos(nx * 8 - ny * 4) * 8;
      dy += Math.cos(nx * 8 - ny * 4) * -4;

      dx += Math.cos(nx * 16 + ny * 8) * 16;
      dy += Math.cos(nx * 16 + ny * 8) * 8;

      const strength = 0.035;
      const vx = -dx * strength;
      const vy = -dy * strength;
      const vz = 1.0;

      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const nx_norm = vx / len;
      const ny_norm = vy / len;
      const nz_norm = vz / len;

      const idx = (y * size + x) * 4;
      data[idx]     = Math.floor((nx_norm * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny_norm * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz_norm * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export class TerrainBuilder {
  private scene: THREE.Scene;
  private mapDef: MapDefinition;

  public groundMaterial: THREE.MeshLambertMaterial | null = null;
  public heightmapGeo: THREE.PlaneGeometry | null = null;
  public scatterRenderer: ScatterRenderer | null = null;
  public loadedTiles = new Map<string, THREE.Object3D>();
  public pendingTiles = new Set<string>();
  public islands: THREE.Mesh[] = [];
  public carriers: THREE.Group[] = [];
  public waterNormalMap: THREE.CanvasTexture | null = null;

  constructor(scene: THREE.Scene, mapDef: MapDefinition) {
    this.scene = scene;
    this.mapDef = mapDef;
  }

  private mat(color: THREE.ColorRepresentation, emissive = false) {
    if (emissive) {
      return new THREE.MeshBasicMaterial({ color });
    }
    return new THREE.MeshLambertMaterial({
      color,
      flatShading: true
    });
  }

  public async buildTerrain() {
    const def = this.mapDef.terrain;
    const world = this.mapDef.world;
    const layout = getTerrainLayout(this.mapDef);

    const landMat = new THREE.MeshLambertMaterial({
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.groundMaterial = landMat;

    const waterColor = new THREE.Color(
      this.mapDef.visual.groundColor ?? this.mapDef.palette.colors[0] ?? "#0369a1"
    );

    // Water surface
    {
      this.waterNormalMap = createWaterNormalMap();
      this.waterNormalMap.repeat.set(800, 800);

      const waterMat = new THREE.MeshStandardMaterial({
        color: waterColor,
        roughness: 0.15,
        metalness: 0.1,
        normalMap: this.waterNormalMap,
        normalScale: new THREE.Vector2(0.15, 0.15),
        polygonOffset: true,
        polygonOffsetFactor: -2, // Pushed further away than landMat (which is -1) to prevent z-fighting at steep camera angles
        polygonOffsetUnits: -2
      });
      const waterMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(world.radius * 2, world.radius * 2),
        waterMat
      );
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.y = world.waterHeight + 0.3;
      this.scene.add(waterMesh);
    }

    // Continue the surface beyond the finite terrain so its edge cannot show.
    // This must start with the same color as the water and participate in scene
    // fog. A solid fog-colored plane creates a bright horizontal shelf whenever
    // the camera is close enough to the map boundary to see it before fog starts.
    {
      const skirtSize = world.radius * 12;
      const skirtMat = new THREE.MeshBasicMaterial({
        color: waterColor,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -2, // Pushed further away than landMat (which is -1) to prevent z-fighting at a distance
        polygonOffsetUnits: -2
      });
      const skirtMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(skirtSize, skirtSize),
        skirtMat
      );
      skirtMesh.rotation.x = -Math.PI / 2;
      skirtMesh.position.y = world.waterHeight - 0.1;
      skirtMesh.renderOrder = -1;
      this.scene.add(skirtMesh);
    }

    if (def.kind === "heightmap") {
      const segs = 512; // Unconditionally use 512 for a smoother shoreline
      const planeGeo = new THREE.PlaneGeometry(world.radius * 2, world.radius * 2, segs, segs);
      planeGeo.rotateX(-Math.PI / 2);
      this.heightmapGeo = planeGeo;
      const planeMesh = new THREE.Mesh(planeGeo, landMat);
      planeMesh.receiveShadow = true;
      this.scene.add(planeMesh);

      try {
        const hd = await loadHeightmap(def.path, world.radius, def.elevationScale);
        const pos = planeGeo.attributes.position as THREE.BufferAttribute;
        const wh = world.waterHeight;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          const h = sampleHeightmapAt(hd, x, z);
          pos.setY(i, h < wh ? Math.min(h, wh - 6.0) : h); // Snapping to wh - 6.0 instead of wh - 15.0 for a less aggressive cliff
        }
        pos.needsUpdate = true;
        planeGeo.computeVertexNormals();
      } catch (e) {
        console.error("Failed to load heightmap:", e);
      }
    } else if (def.kind === "glb") {
      const loader = new GLTFLoader();
      loader.load(def.path, (gltf) => {
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(gltf.scene);
        this.islands.push(...(gltf.scene.children as THREE.Mesh[]));
        buildGlbCollider(gltf.scene, this.mapDef.id, this.mapDef.world.radius, this.mapDef.world.maxAltitude);
      });
    } else if (def.kind === "tiled-glb") {
      // Tile manager handles loading in updateTiles
    } else {
      const groundSize = world.radius * 2;
      const landGeo = new THREE.BoxGeometry(groundSize, 12, groundSize);
      const landMesh = new THREE.Mesh(landGeo, landMat);
      landMesh.position.y = -8;
      landMesh.receiveShadow = true;
      this.scene.add(landMesh);

      for (const block of layout.blocks) {
        const color =
          block.material === "snow"
            ? 0xf0f4f8
            : block.material === "rock"
            ? 0x64748b
            : block.material === "clay"
            ? 0xc2410c
            : block.material === "rockDark"
            ? 0x334155
            : block.material === "landDark"
            ? 0x166534
            : 0x15803d;

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...block.scale), this.mat(color));
        mesh.position.set(...block.position);
        mesh.rotation.y = block.rotationY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.islands.push(mesh);
      }
    }

    // Airfield strips
    for (const feature of layout.features) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(55, 12, 650), this.mat(0x334155));
      strip.position.set(feature.position[0], 4, feature.position[2]);
      this.scene.add(strip);
    }

    // Carrier models
    for (const cd of this.mapDef.layout.carriers) {
      const carrier = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(80, 26, 400), this.mat(0x475569));
      hull.position.y = 8;
      carrier.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(74, 4, 390), this.mat(0x1e293b));
      deck.position.y = 23;
      carrier.add(deck);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(18, 46, 42), this.mat(0x334155));
      tower.position.set(31, 48, -38);
      carrier.add(tower);
      const runway = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 320), this.mat(0xf8fafc, true));
      runway.position.y = 26;
      carrier.add(runway);
      carrier.position.set(cd.x, 0, cd.z);
      carrier.rotation.y = cd.rotationY;
      this.scene.add(carrier);
      this.carriers.push(carrier);
    }
  }

  public initScatter(geom?: BakedMapGeometry) {
    if (this.scatterRenderer) return;
    const layout = getTerrainLayout(this.mapDef);
    this.scatterRenderer = new ScatterRenderer(this.scene, this.mapDef, layout, geom);
  }

  public updateTiles(playerX: number, playerZ: number) {
    const def = this.mapDef.terrain;
    if (def.kind !== "tiled-glb") return;

    const { tileDir, tileSize, tileGrid, loadRadius } = def;
    const half = Math.floor(tileGrid / 2);
    const loader = new GLTFLoader();

    const needed = new Set<string>();
    for (let row = 0; row < tileGrid; row++) {
      for (let col = 0; col < tileGrid; col++) {
        const tx = (col - half) * tileSize;
        const tz = (row - half) * tileSize;
        const dx = tx - playerX,
          dz = tz - playerZ;
        if (Math.sqrt(dx * dx + dz * dz) > loadRadius) continue;
        needed.add(`${row}_${col}`);
      }
    }

    // Dispose out-of-range tiles
    for (const [key, obj] of this.loadedTiles) {
      if (!needed.has(key)) {
        this.scene.remove(obj);
        this.loadedTiles.delete(key);
      }
    }

    // Load new tiles
    for (const key of needed) {
      if (this.loadedTiles.has(key) || this.pendingTiles.has(key)) continue;
      const [row, col] = key.split("_").map(Number);
      const tx = (col - half) * tileSize;
      const tz = (row - half) * tileSize;
      this.pendingTiles.add(key);
      loader.load(
        `${tileDir}/${key}.glb`,
        (gltf) => {
          gltf.scene.position.set(tx, 0, tz);
          this.scene.add(gltf.scene);
          this.loadedTiles.set(key, gltf.scene);
          this.pendingTiles.delete(key);
        },
        undefined,
        () => {
          this.pendingTiles.delete(key);
        }
      );
    }
  }

  public updateWater(dt: number) {
    if (this.waterNormalMap) {
      // Slow drift of the normal map offset to animate waves
      this.waterNormalMap.offset.x += 0.008 * dt;
      this.waterNormalMap.offset.y += 0.005 * dt;
    }
  }

  public loadMapTiles() {
    if (!this.groundMaterial) return;

    const fallback = renderPaletteFallback(this.mapDef.palette);
    this.groundMaterial.map = fallback;
    this.groundMaterial.needsUpdate = true;

    const textureLoader = new THREE.TextureLoader();
    const baseUrl = ((import.meta as any).env?.BASE_URL || "/").replace(/\/$/, "");
    textureLoader.load(
      `${baseUrl}/maps/${this.mapDef.id}.satellite.png`,
      (satTex) => {
        if (!this.groundMaterial) return;
        satTex.wrapS = THREE.ClampToEdgeWrapping;
        satTex.wrapT = THREE.ClampToEdgeWrapping;
        satTex.colorSpace = THREE.SRGBColorSpace;
        this.groundMaterial.map = satTex;
        this.groundMaterial.needsUpdate = true;
        fallback.dispose();

        fetch(`${baseUrl}/maps/${this.mapDef.id}.geom.json`)
          .then((r) => (r.ok ? (r.json() as Promise<BakedMapGeometry>) : Promise.reject(r.status)))
          .then((geom) => this.initScatter(geom))
          .catch(() => this.initScatter());
      },
      undefined,
      () => {
        fetch(`${baseUrl}/maps/${this.mapDef.id}.geom.json`)
          .then((r) => (r.ok ? (r.json() as Promise<BakedMapGeometry>) : Promise.reject(r.status)))
          .then((geom) => {
            if (!this.groundMaterial) return;
            const tex = renderMapGeometry(geom, this.mapDef.palette);
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            this.groundMaterial.map = tex;
            this.groundMaterial.needsUpdate = true;
            fallback.dispose();
            this.initScatter(geom);
          })
          .catch(() => {
            this.initScatter();
          });
      }
    );
  }

  public dispose() {
    if (this.scatterRenderer) {
      this.scatterRenderer.dispose();
      this.scatterRenderer = null;
    }
    if (this.waterNormalMap) {
      this.waterNormalMap.dispose();
      this.waterNormalMap = null;
    }
    for (const obj of this.loadedTiles.values()) {
      this.scene.remove(obj);
    }
    this.loadedTiles.clear();
    this.pendingTiles.clear();
  }
}
