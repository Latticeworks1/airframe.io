/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  Pilot,
  Projectile,
  GroundTarget,
  SkyZone,
  LeadIndicatorInfo,
  InputFrame,
  CameraMode,
  BombSightInfo,
  WeaponType
} from "../types";
import { getTerrainLayout, getTerrainHeight, loadHeightmap, sampleHeightmapAt } from "./terrainModel";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AIRCRAFT_DEFINITIONS } from "./content/aircraft/registry";
import { createAircraftMesh } from "./content/aircraft/aircraftBuilder";
import { LOCAL_FORWARD } from "./math";
import {
  createSkyDome,
  getSkyEnvironment,
  SkyEnvironment,
  SkyDomeMesh,
  updateSkyDome
} from "./skyDome";
import { ScreenEffectsPass } from "./screenEffects";
import { CloudField } from "./cloudField";
import { getProjectileReleaseState } from "./projectileSystem";
import { MapDefinition } from "./content/maps/mapTypes";
import type { BakedMapGeometry } from "./content/maps/mapTypes";
import { renderMapGeometry, renderPaletteFallback } from "./mapGeometryRenderer";
import { WEAPON_SPECS_MAP } from "./content/weapons/weaponData";
import { ScatterRenderer } from "./scatterRenderer";
import {
  buildVoxelMesh,
  deformAtImpact,
  disposeVoxelMesh,
  findVoxelImpact,
  animateSpinCells,
  setCockpitVisible,
  resetVoxelMesh,
  VoxelMeshState
} from "./voxelMesh";
import { getVoxelDef } from "./content/aircraft/voxelRegistry";
import type { Vector3 } from "three";




/**
 * Handles all 3D scene elements, camera dynamics, blocky geometry generation, and particle updates.
 */
export class WorldRenderer {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: WebGPURenderer;
  private container!: HTMLDivElement;

  private aircraftGroupMap = new Map<string, THREE.Group>();
  private voxelStateMap = new Map<string, VoxelMeshState>();
  private cloudField: CloudField | null = null;
  private islands: THREE.Mesh[] = [];
  private carriers: THREE.Group[] = [];
  private groundTargetMeshes = new Map<string, THREE.Group>();
  private listProjectiles: {
    bulletId: string;
    mesh: THREE.Object3D;
    type: Projectile["type"];
    age: number;
  }[] = [];
  private zoneAnchors: THREE.Group[] = [];

  private smokeParticles: { mesh: THREE.Mesh; scaleSpeed: number; vel: THREE.Vector3; life: number }[] = [];
  private explosionBlobs: { mesh: THREE.Mesh; shrinkSpeed: number; vel: THREE.Vector3; life: number }[] = [];

  private mapDef!: MapDefinition;
  public cameraMode: CameraMode = "third-person";
  public leadIndicator2D: LeadIndicatorInfo | null = null;
  public bombSightInfo: BombSightInfo | null = null;

  private targetCameraOffset = new THREE.Vector3(0, 5.5, 17);
  private cameraLookAtTarget = new THREE.Vector3();
  private freeLookYaw = 0;
  private freeLookPitch = 0;
  private cameraModeTransitionPending = true;
  private cameraShakeTime = 0;
  private groundMaterial: THREE.MeshLambertMaterial | null = null;
  private heightmapGeo: THREE.PlaneGeometry | null = null;
  private scatterRenderer: ScatterRenderer | null = null;
  private loadedTiles = new Map<string, THREE.Object3D>();
  private pendingTiles = new Set<string>();
  private skyDome: SkyDomeMesh | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private skyLight: THREE.HemisphereLight | null = null;
  private skyEnvironment: SkyEnvironment | null = null;
  private lightningDelay = 0;
  private lightningPhase = 0;
  private screenEffects: ScreenEffectsPass | null = null;
  private rendererReady = false;
  private lastPlayerDamageTotal: number | null = null;

  constructor(container: HTMLDivElement, mapDef: MapDefinition, onReady: () => void) {
    this.container = container;
    this.mapDef = mapDef;
    this.init().then(() => onReady());
  }

  public setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;

    this.cameraMode = mode;
    this.freeLookYaw = 0;
    this.freeLookPitch = 0;
    this.cameraModeTransitionPending = true;
  }

  public getRenderStats() {
    const info = (this.renderer as unknown as { info?: { render?: { calls?: number; triangles?: number } } }).info;
    return {
      drawCalls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0
    };
  }

  private async init() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    const skyEnvironment = getSkyEnvironment(this.mapDef.atmosphere);
    this.skyEnvironment = skyEnvironment;
    this.scene.background = skyEnvironment.backgroundColor.clone();
    this.scene.fog = new THREE.Fog(
      skyEnvironment.fogColor,
      skyEnvironment.fogNear,
      skyEnvironment.fogFar
    );

    this.camera = new THREE.PerspectiveCamera(65, width / height, 1, 15000);
    this.camera.position.set(0, 200, 300);

    const hasWebGPU = typeof navigator !== "undefined" && !!(navigator as any).gpu;
    try {
      this.renderer = new WebGPURenderer({
        antialias: true,
        powerPreference: "high-performance",
        forceWebGL: !hasWebGPU
      });
      await this.renderer.init();
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (err) {
      console.warn("WebGPURenderer WebGPU backend failed to init, trying WebGL fallback...", err);
      try {
        this.renderer = new WebGPURenderer({
          antialias: true,
          powerPreference: "high-performance",
          forceWebGL: true
        });
        await this.renderer.init();
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      } catch (err2) {
        console.error("All rendering backends failed:", err2);
        const errDiv = document.createElement("div");
        errDiv.style.color = "#ef4444";
        errDiv.style.padding = "20px";
        errDiv.style.textAlign = "center";
        errDiv.style.background = "#1e293b";
        errDiv.style.borderRadius = "8px";
        errDiv.style.margin = "20px";
        errDiv.innerText = "Fatal: WebGPU/WebGL 2 not supported by your browser or graphics driver.";
        this.container.appendChild(errDiv);
        throw err2;
      }
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = skyEnvironment.exposure;
    this.renderer.domElement.style.imageRendering = "auto";
    this.container.appendChild(this.renderer.domElement);
    this.screenEffects = new ScreenEffectsPass(
      this.renderer,
      skyEnvironment.cloudVeilColor
    );

    this.skyLight = new THREE.HemisphereLight(
      skyEnvironment.skyLightColor,
      skyEnvironment.groundLightColor,
      skyEnvironment.ambientIntensity
    );
    this.scene.add(this.skyLight);

    this.sunLight = new THREE.DirectionalLight(
      skyEnvironment.sunColor,
      skyEnvironment.sunIntensity
    );
    this.sunLight.position
      .copy(skyEnvironment.sunDirection)
      .multiplyScalar(3000);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 10000;
    const sd = 800;
    this.sunLight.shadow.camera.left = -sd;
    this.sunLight.shadow.camera.right = sd;
    this.sunLight.shadow.camera.top = sd;
    this.sunLight.shadow.camera.bottom = -sd;
    this.sunLight.shadow.bias = -0.0002;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.lightningDelay = THREE.MathUtils.lerp(
      skyEnvironment.profile.lightning.minDelay,
      skyEnvironment.profile.lightning.maxDelay,
      Math.random()
    );

    this.skyDome = createSkyDome(this.mapDef.atmosphere);
    this.scene.add(this.skyDome);

    await this.buildTerrain();
    this.cloudField = new CloudField(this.mapDef);
    this.scene.add(this.cloudField.mesh);
    this.loadMapTiles();

    window.addEventListener("resize", this.handleResize);
    this.rendererReady = true;
  }

  private handleResize = () => {
    if (!this.container || !this.renderer) return;

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.screenEffects?.resize(this.renderer);
  };

  public destroy() {
    window.removeEventListener("resize", this.handleResize);

    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      this.skyDome.material.dispose();
      this.skyDome = null;
    }

    if (this.sunLight) {
      this.scene.remove(this.sunLight);
      this.sunLight.dispose();
      this.sunLight = null;
    }

    if (this.skyLight) {
      this.scene.remove(this.skyLight);
      this.skyLight.dispose();
      this.skyLight = null;
    }

    this.screenEffects?.dispose();
    this.screenEffects = null;

    if (this.scatterRenderer) {
      this.scatterRenderer.dispose();
      this.scatterRenderer = null;
    }

    for (const obj of this.loadedTiles.values()) this.scene.remove(obj);
    this.loadedTiles.clear();
    this.pendingTiles.clear();

    if (this.cloudField) {
      this.scene.remove(this.cloudField.mesh);
      this.cloudField.dispose();
      this.cloudField = null;
    }

    if (this.renderer?.domElement) {
      this.renderer.domElement.remove();
    }

    this.renderer?.dispose();
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

  private async buildTerrain() {
    const def    = this.mapDef.terrain;
    const world  = this.mapDef.world;
    const layout = getTerrainLayout(this.mapDef);

    const landMat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.groundMaterial = landMat;

    // Water surface at waterHeight + 0.3 so it floats just above ocean-floor
    // heightmap vertices without any polygonOffset — negative offsets push the
    // plane forward in the depth buffer, which causes it to overdraw shoreline land.
    {
      const waterColor = new THREE.Color(this.mapDef.palette.colors[0] ?? "#0369a1");
      const waterMat = new THREE.MeshBasicMaterial({ color: waterColor });
      const waterMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(world.radius * 2, world.radius * 2),
        waterMat
      );
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.y = world.waterHeight + 0.3;
      this.scene.add(waterMesh);
    }

    // Infinite skirt plane sits well below water so the horizon blends into
    // the fog color rather than dropping into void at the map boundary.
    {
      const skirtSize = world.radius * 12;
      const fogColor = new THREE.Color(this.mapDef.atmosphere.fogColor);
      const skirtMat = new THREE.MeshBasicMaterial({ color: fogColor, fog: false, depthWrite: false });
      const skirtMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(skirtSize, skirtSize),
        skirtMat
      );
      skirtMesh.rotation.x = -Math.PI / 2;
      skirtMesh.position.y = world.waterHeight - 20;
      skirtMesh.renderOrder = -1;
      this.scene.add(skirtMesh);
    }

    if (def.kind === "heightmap") {
      // Subdivided plane displaced by heightmap — load async then displace verts
      const segs = window.devicePixelRatio >= 2 ? 128 : 256; // fewer segs on mobile
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
          // Clamp sub-water vertices down so ocean floor never intersects the water plane.
          pos.setY(i, h < wh ? Math.min(h, wh - 1.5) : h);
        }
        pos.needsUpdate = true;
        planeGeo.computeVertexNormals();
      } catch (e) {
        console.error("Failed to load heightmap:", e);
      }

    } else if (def.kind === "glb") {
      const loader = new GLTFLoader();
      loader.load(def.path, gltf => {
        gltf.scene.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(gltf.scene);
        this.islands.push(...(gltf.scene.children as THREE.Mesh[]));
      });

    } else if (def.kind === "tiled-glb") {
      // Tile manager: first tick of updateTiles populates initial tiles
      // Nothing needed at build time — updateTiles handles loading

    } else {
      // Procedural terrain blocks (islands, canyons, alpine, storm-islands)
      const groundSize = world.radius * 2;
      const landGeo = new THREE.BoxGeometry(groundSize, 12, groundSize);
      const landMesh = new THREE.Mesh(landGeo, landMat);
      landMesh.position.y = -8;
      landMesh.receiveShadow = true;
      this.scene.add(landMesh);

      for (const block of layout.blocks) {
        const color = block.material === "snow"    ? 0xf0f4f8
                    : block.material === "rock"    ? 0x64748b
                    : block.material === "clay"    ? 0xc2410c
                    : block.material === "rockDark"? 0x334155
                    : block.material === "landDark"? 0x166534
                    :                               0x15803d;

        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(...block.scale),
          this.mat(color)
        );
        mesh.position.set(...block.position);
        mesh.rotation.y = block.rotationY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.islands.push(mesh);
      }
    }

    // Airfield strips (all procedural terrain kinds)
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

    // Scatter pass — deferred so geom fetch can complete first via loadMapTiles
    // ScatterRenderer is initialized after geometry arrives (see loadMapTiles)
  }

  private initScatter(geom?: BakedMapGeometry) {
    if (this.scatterRenderer) return;
    const layout = getTerrainLayout(this.mapDef);
    this.scatterRenderer = new ScatterRenderer(this.scene, this.mapDef, layout, geom);
  }

  private updateTiles(playerX: number, playerZ: number) {
    const def = this.mapDef.terrain;
    if (def.kind !== "tiled-glb") return;

    const { tileDir, tileSize, tileGrid, loadRadius } = def;
    const half   = Math.floor(tileGrid / 2);
    const loader = new GLTFLoader();

    const needed = new Set<string>();
    for (let row = 0; row < tileGrid; row++) {
      for (let col = 0; col < tileGrid; col++) {
        const tx = (col - half) * tileSize;
        const tz = (row - half) * tileSize;
        const dx = tx - playerX, dz = tz - playerZ;
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
      loader.load(`${tileDir}/${key}.glb`, gltf => {
        gltf.scene.position.set(tx, 0, tz);
        this.scene.add(gltf.scene);
        this.loadedTiles.set(key, gltf.scene);
        this.pendingTiles.delete(key);
      }, undefined, () => { this.pendingTiles.delete(key); });
    }
  }

  private loadMapTiles() {
    if (!this.groundMaterial) return;

    // Apply a fast palette-based texture immediately so the ground is never black
    const fallback = renderPaletteFallback(this.mapDef.palette);
    this.groundMaterial.map = fallback;
    this.groundMaterial.needsUpdate = true;

    // First try to load pre-baked satellite imagery
    const textureLoader = new THREE.TextureLoader();
    const baseUrl = ((import.meta as any).env.BASE_URL || "/").replace(/\/$/, "");
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

        // Load geometry JSON in background just to seed scatter objects on their real positions
        fetch(`${baseUrl}/maps/${this.mapDef.id}.geom.json`)
          .then(r => r.ok ? r.json() as Promise<BakedMapGeometry> : Promise.reject(r.status))
          .then(geom => this.initScatter(geom))
          .catch(() => this.initScatter());
      },
      undefined,
      () => {
        // Fallback to OSM geom overlay canvas if satellite is not available
        fetch(`${baseUrl}/maps/${this.mapDef.id}.geom.json`)
          .then(r => r.ok ? r.json() as Promise<BakedMapGeometry> : Promise.reject(r.status))
          .then(geom => {
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

  private generateProceduralAircraft(
    id: string,
    colorHex: string,
    secHex: string,
    accentHex: string
  ): THREE.Group {
    const def = AIRCRAFT_DEFINITIONS.find(a => a.specs.id === id);
    if (!def) {
      return new THREE.Group();
    }

    const renderDef = {
      ...def.render,
      materials: {
        ...def.render.materials,
        primary: colorHex || def.render.materials.primary,
        secondary: secHex || def.render.materials.secondary,
        accent: accentHex || def.render.materials.accent,
      }
    };

    return createAircraftMesh(renderDef);
  }

  public deformAircraft(pilotId: string, localOffsetMeters: Vector3, blastMeters: number) {
    const state = this.voxelStateMap.get(pilotId);
    if (state) deformAtImpact(state, localOffsetMeters, blastMeters);
  }

  public resetVoxelState(pilotId: string) {
    const state = this.voxelStateMap.get(pilotId);
    if (state) resetVoxelMesh(state);
  }

  // Returns the struck voxel centre (local metres), null if aircraft uses voxels
  // but segment misses, or undefined if the aircraft has no voxel definition.
  public findVoxelImpact(
    pilotId: string,
    segStartLocal: THREE.Vector3,
    segEndLocal: THREE.Vector3
  ): THREE.Vector3 | null | undefined {
    const state = this.voxelStateMap.get(pilotId);
    if (!state) return undefined;
    return findVoxelImpact(state, segStartLocal, segEndLocal);
  }

  public createSmokeTail(
    x: number,
    y: number,
    z: number,
    colorHex: number = 0x64748b,
    scale: number = 1.0
  ) {
    const geo = new THREE.BoxGeometry(
      1.2 + Math.random() * 1.2,
      1.2 + Math.random() * 1.2,
      1.2 + Math.random() * 1.2
    );

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    this.smokeParticles.push({
      mesh,
      scaleSpeed: 1.4 * scale,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 6
      ),
      life: 1.0 + Math.random() * 1.5
    });
  }

  public triggerExplosion(
    x: number,
    y: number,
    z: number,
    sizeMultiplier: number = 1.0
  ) {
    const shardCount = Math.floor(16 * sizeMultiplier);
    const colors = [0xef4444, 0xf97316, 0xeab308, 0x475569];

    for (let i = 0; i < shardCount; i++) {
      const geo = new THREE.BoxGeometry(
        1.0 + Math.random() * 2 * sizeMultiplier,
        1.0 + Math.random() * 2 * sizeMultiplier,
        1.0 + Math.random() * 2 * sizeMultiplier
      );

      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 0.9
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      this.explosionBlobs.push({
        mesh,
        shrinkSpeed: 0.8 / sizeMultiplier,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 50 * sizeMultiplier,
          (Math.random() - 0.3) * 40 * sizeMultiplier,
          (Math.random() - 0.5) * 50 * sizeMultiplier
        ),
        life: 0.6 + Math.random() * 0.9
      });
    }
  }

  public updateWorld(
    pilots: Pilot[],
    playerPilotId: string,
    projectiles: Projectile[],
    groundTargets: GroundTarget[],
    targetReticlePos: THREE.Vector3,
    skyZones: SkyZone[],
    matchMode: string,
    inputFrame: InputFrame,
    dt: number
  ) {
    if (!this.rendererReady) return;
    dt = THREE.MathUtils.clamp(dt, 0, 0.05);

    const player = pilots.find(p => p.id === playerPilotId);
    if (player) {
      this.sunLight.position.set(
        player.x + this.skyEnvironment.sunDirection.x * 2000,
        player.y + this.skyEnvironment.sunDirection.y * 2000,
        player.z + this.skyEnvironment.sunDirection.z * 2000
      );
      this.sunLight.target.position.set(player.x, player.y, player.z);
      this.sunLight.target.updateMatrixWorld();
    }

    this.syncGroundEnemies(groundTargets, dt);
    this.syncSkyZones(skyZones);

    const activePilotIds = new Set<string>();

    for (const p of pilots) {
      activePilotIds.add(p.id);

      let group = this.aircraftGroupMap.get(p.id);

      if (!group) {
        const voxDef = getVoxelDef(p.specs.id);
        if (voxDef) {
          group = new THREE.Group();
          const state = buildVoxelMesh(voxDef);
          group.add(state.mesh);
          if (state.spinMesh) group.add(state.spinMesh);
          this.voxelStateMap.set(p.id, state);
        } else {
          group = this.generateProceduralAircraft(
            p.specs.id,
            p.specs.color,
            p.specs.secondaryColor,
            p.specs.accentColor
          );
        }
        this.scene.add(group);
        this.aircraftGroupMap.set(p.id, group);
      }

      group.position.set(p.x, p.y, p.z);
      group.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, "YXZ"));

      // Voxel aircraft: animate spinZ instances and manage cockpit visibility.
      const voxState = this.voxelStateMap.get(p.id);
      if (voxState) {
        animateSpinCells(voxState, dt, p.throttle);
        if (p.id === playerPilotId) {
          setCockpitVisible(voxState, this.cameraMode !== "first-person");
        }
      }

      // Animate any block with the "spinZ" tag (non-voxel aircraft only)
      if (!voxState) group.traverse(child => {
        if (child.userData.tags && child.userData.tags.includes("spinZ")) {
          child.rotation.z += (15 + p.throttle * 40) * dt;
        }

        const bombTag = (child.userData.tags as string[] | undefined)?.find(
          tag => tag.startsWith("ordnance:bomb:")
        );
        if (bombTag) {
          const bombIndex = Number(bombTag.split(":")[2]);
          const bombsRemaining = p.ammo[WeaponType.BOMB] ?? 0;
          child.visible = Number.isFinite(bombIndex) && bombIndex < bombsRemaining;
        }

        // Apply visual component damage reduction
        const component = child.userData.damageComponent as any;
        if (component && (p.damage as any)[component] !== undefined) {
          const value = (p.damage as any)[component];
          if (typeof value === "number") {
            child.visible = value > 0.05;
            if (child.userData.initialScaleY === undefined) {
              child.userData.initialScaleY = child.scale.y;
            }
            child.scale.y = Math.max(0.15, value) * child.userData.initialScaleY;
          }
        }
      });

      const wingDmg = (p.damage.leftWing + p.damage.rightWing) / 2;

      if (p.damage.hasFire) {
        if (Math.random() < 0.4) {
          this.createSmokeTail(p.x, p.y, p.z, 0xd97706, 1.2);
          this.createSmokeTail(
            p.x - p.vx * 0.05,
            p.y - p.vy * 0.05,
            p.z - p.vz * 0.05,
            0x1f2937,
            1.6
          );
        }
      } else if (p.damage.engine < 0.7) {
        if (Math.random() < 0.25) {
          this.createSmokeTail(p.x, p.y, p.z, 0x475569, 0.9);
        }
      } else if (wingDmg < 0.75) {
        if (Math.random() < 0.15) {
          this.createSmokeTail(p.x, p.y, p.z, 0xf1f5f9, 0.6);
        }
      }
    }

    for (const cachedId of Array.from(this.aircraftGroupMap.keys())) {
      if (!activePilotIds.has(cachedId)) {
        const mesh = this.aircraftGroupMap.get(cachedId);
        if (mesh) this.scene.remove(mesh);
        this.aircraftGroupMap.delete(cachedId);
        const voxState = this.voxelStateMap.get(cachedId);
        if (voxState) {
          disposeVoxelMesh(voxState);
          this.voxelStateMap.delete(cachedId);
        }
      }
    }

    this.syncProjectiles(projectiles, playerPilotId, dt);
    this.updateParticles(dt);
    this.updateCamera(pilots, playerPilotId, inputFrame, dt);

    const playerPilot = pilots.find(p => p.id === playerPilotId);
    if (playerPilot) this.updateTiles(playerPilot.x, playerPilot.z);
    this.cloudField?.update(dt);

    // Project Lead Indicator for Targeting HUD Overlay
    let lockedAdv: Pilot | null = null;
    let bestDot = 0.94;
    let lockedDist = 0;

    if (playerPilot) {
      const oppTeam = playerPilot.team === 1 ? 2 : 1;
      const adversaries = pilots.filter(p => p.team === oppTeam && p.damage.fuselage > 0);
      const pGroup = this.aircraftGroupMap.get(playerPilotId);
      
      if (pGroup) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pGroup.quaternion).normalize();
        
        adversaries.forEach(p => {
          const dx = p.x - playerPilot.x;
          const dy = p.y - playerPilot.y;
          const dz = p.z - playerPilot.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          if (dist > 50 && dist < (playerPilot.specs.radarRange ?? 4500)) {
            const dir = new THREE.Vector3(dx, dy, dz).normalize();
            const dot = forward.dot(dir);
            if (dot > bestDot) {
              bestDot = dot;
              lockedAdv = p;
              lockedDist = dist;
            }
          }
        });
      }
    }

    if (lockedAdv && playerPilot) {
      const adv = lockedAdv as Pilot;

      const primaryWeapon = playerPilot.specs.weapons.find(
        w => w !== WeaponType.ROCKET && w !== WeaponType.BOMB && (playerPilot.ammo[w] ?? 0) > 0
      );
      const muzzleVelocity = primaryWeapon ? WEAPON_SPECS_MAP[primaryWeapon].muzzleVelocity : 820;

      const tdx = adv.x - playerPilot.x;
      const tdy = adv.y - playerPilot.y;
      const tdz = adv.z - playerPilot.z;
      const toTarget = new THREE.Vector3(tdx, tdy, tdz).normalize();
      const closingSpeed = toTarget.dot(
        new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz)
      );
      const t = lockedDist / Math.max(1, muzzleVelocity + closingSpeed);

      const futureX = adv.x + adv.vx * t;
      const futureY = adv.y + adv.vy * t;
      const futureZ = adv.z + adv.vz * t;

      const pTarget = new THREE.Vector3(adv.x, adv.y, adv.z).project(this.camera);
      const pLead = new THREE.Vector3(futureX, futureY, futureZ).project(this.camera);

      if (pTarget.z <= 1.0 && pLead.z <= 1.0) {
        this.leadIndicator2D = {
          x: (pTarget.x * 0.5 + 0.5) * 100,
          y: (-pTarget.y * 0.5 + 0.5) * 100,
          sX: (pLead.x * 0.5 + 0.5) * 100,
          sY: (-pLead.y * 0.5 + 0.5) * 100,
          name: adv.name,
          distance: Math.round(lockedDist)
        };
      } else {
        this.leadIndicator2D = null;
      }
    } else {
      this.leadIndicator2D = null;
    }

    if (this.skyDome) {
      updateSkyDome(
        this.skyDome,
        this.camera,
        this.scene.fog instanceof THREE.Fog ? this.scene.fog : null,
        dt
      );
    }
    this.updateAtmosphere(dt);

    const playerDamageTotal = playerPilot
      ? playerPilot.damage.engine +
        playerPilot.damage.leftWing +
        playerPilot.damage.rightWing +
        playerPilot.damage.tail +
        playerPilot.damage.cockpit +
        playerPilot.damage.fuelTank +
        playerPilot.damage.fuselage
      : null;

    if (
      playerDamageTotal !== null &&
      this.lastPlayerDamageTotal !== null &&
      playerDamageTotal < this.lastPlayerDamageTotal - 0.0001
    ) {
      const damageDelta = this.lastPlayerDamageTotal - playerDamageTotal;
      this.screenEffects?.triggerDamage(THREE.MathUtils.clamp(0.45 + damageDelta * 1.4, 0, 1));
    }
    this.lastPlayerDamageTotal = playerDamageTotal;

    if (this.screenEffects) {
      const cloudDensity = playerPilot && this.cloudField
        ? this.cloudField.sampleDensity(
            new THREE.Vector3(playerPilot.x, playerPilot.y, playerPilot.z)
          )
        : 0;

      this.screenEffects.render(
        this.renderer,
        this.scene,
        this.camera,
        dt,
        playerPilot?.damage.hasOilLeak ?? false,
        cloudDensity
      );
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateAtmosphere(dt: number) {
    const environment = this.skyEnvironment;
    const sunLight = this.sunLight;
    const skyLight = this.skyLight;

    if (!environment || !sunLight || !skyLight) return;

    const lightning = environment.profile.lightning;
    if (!lightning.enabled) return;

    if (this.lightningPhase <= 0) {
      this.lightningDelay -= dt;
      if (this.lightningDelay <= 0) {
        this.lightningPhase = 0.34;
        this.lightningDelay = THREE.MathUtils.lerp(
          lightning.minDelay,
          lightning.maxDelay,
          Math.random()
        );
      }
    } else {
      this.lightningPhase = Math.max(0, this.lightningPhase - dt);
    }

    let flash = 0;
    if (this.lightningPhase > 0.26) flash = 1;
    else if (this.lightningPhase > 0.18) flash = 0.08;
    else if (this.lightningPhase > 0.08) flash = 0.72;

    if (flash > 0) {
      sunLight.color.set(lightning.color);
      sunLight.intensity = THREE.MathUtils.lerp(
        environment.sunIntensity,
        3.2,
        flash
      );
      skyLight.color.set(lightning.color);
      skyLight.intensity = THREE.MathUtils.lerp(
        environment.ambientIntensity,
        1.65,
        flash
      );
      this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
        environment.exposure,
        environment.exposure * 1.45,
        flash
      );
      return;
    }

    sunLight.color.copy(environment.sunColor);
    sunLight.intensity = environment.sunIntensity;
    skyLight.color.copy(environment.skyLightColor);
    skyLight.intensity = environment.ambientIntensity;
    this.renderer.toneMappingExposure = environment.exposure;
  }

  private updateParticles(dt: number) {
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];

      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(1.0 + p.scaleSpeed * dt);

      if (p.mesh.material instanceof THREE.MeshBasicMaterial) {
        p.mesh.material.opacity = Math.max(0, p.life * 0.35);
      }

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        disposeMaterial(p.mesh.material);
        this.smokeParticles.splice(i, 1);
      }
    }

    for (let i = this.explosionBlobs.length - 1; i >= 0; i--) {
      const e = this.explosionBlobs[i];

      e.life -= dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.scale.subScalar(e.shrinkSpeed * dt);

      if (e.mesh.scale.x < 0.1 || e.life <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        disposeMaterial(e.mesh.material);
        this.explosionBlobs.splice(i, 1);
      }
    }
  }

  private updateCamera(pilots: Pilot[], playerPilotId: string, inputFrame: InputFrame | undefined, dt: number) {
    const playerPilot = pilots.find(p => p.id === playerPilotId);
    if (!playerPilot) return;

    const pGroup = this.aircraftGroupMap.get(playerPilotId);
    if (!pGroup) return;

    const aircraftDef = AIRCRAFT_DEFINITIONS.find(
      definition => definition.specs.id === playerPilot.aircraftId
    );
    const cameraDef = aircraftDef?.render.camera;
    const hiddenBlockIds = new Set(cameraDef?.hiddenBlockIds ?? ["canopy"]);

    const speedKmph =
      new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;

    const firstPersonBaseFov = cameraDef?.firstPersonFov ?? 74;
    const firstPersonSpeedFov = THREE.MathUtils.clamp(
      (speedKmph - 250) / 250 * 4,
      0,
      4
    );
    const targetFov = this.cameraMode === "first-person"
      ? THREE.MathUtils.clamp(firstPersonBaseFov + firstPersonSpeedFov, 68, 80)
      : this.cameraMode === "bombsight"
        ? 52
        : THREE.MathUtils.clamp(65 + speedKmph / 28, 62, 92);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.near = this.cameraMode === "third-person" ? 1 : 0.25;

    // Handle free look view angles from right/secondary mouse button drag
    const isFreeLookActive = !!(inputFrame && inputFrame.rightMouse);

    if (isFreeLookActive && inputFrame) {
      this.freeLookYaw += inputFrame.mouseDelta.x * 2.8;
      this.freeLookPitch -= inputFrame.mouseDelta.y * 2.1;
      // Clamp pitch to avoid inversion
      this.freeLookPitch = THREE.MathUtils.clamp(this.freeLookPitch, -Math.PI / 2.2, Math.PI / 2.2);
    } else {
      // Smoothly slide back to front-facing zero angles
      this.freeLookYaw += (0 - this.freeLookYaw) * dt * 8.0;
      this.freeLookPitch += (0 - this.freeLookPitch) * dt * 8.0;
    }

    if (this.cameraMode === "bombsight") {
      pGroup.visible = false;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      // Rigid belly-camera mount. A Three.js camera looks along local -Z.
      // This fixed mount maps camera -Z to aircraft -Y (belly) and camera +Y
      // to aircraft +Z (nose/top of sight). Multiplying it by the aircraft
      // quaternion guarantees that an inverted aircraft looks into the sky.
      const mountBasis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0)
      );
      const mountQuaternion = new THREE.Quaternion()
        .setFromRotationMatrix(mountBasis);
      const cameraPosition = pGroup.position.clone().add(
        new THREE.Vector3(0, -1.45, 0.65).applyQuaternion(pGroup.quaternion)
      );

      this.camera.position.copy(cameraPosition);
      this.camera.quaternion
        .copy(pGroup.quaternion)
        .multiply(mountQuaternion)
        .normalize();
    } else if (this.cameraMode === "first-person") {
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, true);

      const localCockpitEye = new THREE.Vector3(
        ...(cameraDef?.cockpitEye ?? [0, 1.15, 1.6])
      );
      const cockpitPosition = localCockpitEye
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);
      
      this.camera.position.copy(cockpitPosition);
      
      // Calculate looking vector with free look rotation applied on local aircraft coordinate frames
      const localRigidRot = pGroup.quaternion.clone();
      const freeLookRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.freeLookPitch, this.freeLookYaw, 0, "YXZ"));
      const combinedRot = localRigidRot.clone().multiply(freeLookRot);

      const lookDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedRot).normalize();
      const lookTarget = cockpitPosition.clone().addScaledVector(lookDir, 250);
      
      const rotatedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(combinedRot).normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(lookTarget);
    } else {
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      // Base offset backward and slightly elevated
      const defaultOffset = new THREE.Vector3(0, this.targetCameraOffset.y, -this.targetCameraOffset.z);

      // Rotate camera offset coordinates by the free-look angle
      const freeLookRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.freeLookPitch, this.freeLookYaw, 0, "YXZ"));
      const rotatedOffset = defaultOffset.clone().applyQuaternion(freeLookRot);

      // Strip roll from the external camera so the sky and horizon stay
      // level during barrel rolls — the aircraft mesh still rolls normally.
      const noRollEuler = new THREE.Euler().setFromQuaternion(pGroup.quaternion, 'YXZ');
      noRollEuler.z = 0;
      const rollFreeQuat = new THREE.Quaternion().setFromEuler(noRollEuler);

      const worldOffset = rotatedOffset.clone().applyQuaternion(rollFreeQuat);

      const targetCamPos = pGroup.position.clone().add(worldOffset);
      if (this.cameraModeTransitionPending) {
        this.camera.position.copy(targetCamPos);
      } else {
        this.camera.position.lerp(targetCamPos, Math.min(1, dt * 7.5));
      }

      // Rotated look vector for clean chasing orientation
      const defaultLookDir = new THREE.Vector3(0, 0, 1);
      const rotatedLookDir = defaultLookDir.clone().applyQuaternion(freeLookRot);
      const worldLookDir = rotatedLookDir.clone().applyQuaternion(rollFreeQuat).normalize();
      const lookTarget = pGroup.position.clone().addScaledVector(worldLookDir, 150);

      if (this.cameraModeTransitionPending) {
        this.cameraLookAtTarget.copy(lookTarget);
      } else {
        this.cameraLookAtTarget.lerp(lookTarget, Math.min(1, dt * 9.0));
      }

      const rotatedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(freeLookRot).applyQuaternion(rollFreeQuat).normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(this.cameraLookAtTarget);
    }

    this.cameraModeTransitionPending = false;

    // High-speed camera turbulence. Product of two sines at inharmonic frequencies
    // keeps the signal near zero most of the time with occasional sharp jolts —
    // feels like airframe buffeting rather than a constant mechanical buzz.
    // Kicks in above 450 km/h and peaks near VNE.
    this.cameraShakeTime += dt;
    const shakeKmph = new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;
    const shakeStrength = THREE.MathUtils.clamp((shakeKmph - 500) / 250, 0, 1) * 0.10;
    if (shakeStrength > 0) {
      const t = this.cameraShakeTime;
      this.camera.position.x += Math.sin(t * 18.7) * Math.sin(t * 6.3) * shakeStrength;
      this.camera.position.y += Math.sin(t * 24.1 + 0.9) * Math.sin(t * 4.9) * shakeStrength;
    }

    this.camera.updateProjectionMatrix();
    this.updateBombSightPrediction(playerPilot);
  }

  private updateBombSightPrediction(player: Pilot) {
    if (this.cameraMode !== "bombsight") {
      this.bombSightInfo = null;
      return;
    }

    const release = getProjectileReleaseState(player, WeaponType.BOMB);
    const position = release.position.clone();
    const velocity = release.velocity.clone();

    const step = 0.04;
    let time = 0;
    let valid = false;

    while (time < 7) {
      velocity.y -= 9.8 * step;
      position.addScaledVector(velocity, step);
      time += step;

      const terrainHeight = getTerrainHeight(
        position.x,
        position.z,
        this.mapDef.id
      ).height;
      if (position.y <= Math.max(12, terrainHeight)) {
        position.y = Math.max(12, terrainHeight);
        valid = true;
        break;
      }
    }

    const projected = position.clone().project(this.camera);
    this.bombSightInfo = {
      x: (projected.x * 0.5 + 0.5) * 100,
      y: (-projected.y * 0.5 + 0.5) * 100,
      timeToImpact: time,
      impactX: position.x,
      impactZ: position.z,
      valid:
        valid &&
        projected.z >= -1 &&
        projected.z <= 1 &&
        projected.x >= -1.25 &&
        projected.x <= 1.25 &&
        projected.y >= -1.25 &&
        projected.y <= 1.25
    };
  }

  private setFirstPersonBlockVisibility(
    group: THREE.Group,
    pilot: Pilot,
    hiddenBlockIds: Set<string>,
    isFirstPerson: boolean
  ) {
    group.traverse(child => {
      if (!hiddenBlockIds.has(child.userData.blockId)) return;

      if (isFirstPerson) {
        child.visible = false;
        return;
      }

      const damageComponent = child.userData.damageComponent as keyof Pilot["damage"] | undefined;
      const damageValue = damageComponent ? pilot.damage[damageComponent] : undefined;
      child.visible = typeof damageValue === "number" ? damageValue > 0.05 : true;
    });
  }

  private syncGroundEnemies(targets: GroundTarget[], dt: number) {
    const activeIds = new Set<string>();

    for (const t of targets) {
      if (t.isDead) continue;

      activeIds.add(t.id);

      let group = this.groundTargetMeshes.get(t.id);

      if (!group) {
        group = new THREE.Group();

        const armorMat = this.mat(t.team === 1 ? 0xef4444 : 0x3b82f6);
        const darkMat = this.mat(0x1e293b);

        if (t.type === "convoy") {
          const body = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 15), armorMat);
          body.position.y = 2.5;

          const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), darkMat);
          cabin.position.set(0, 5, 5);

          group.add(body, cabin);
        } else if (t.type === "anti-air") {
          const base = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), armorMat);
          base.position.y = 2.5;

          const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 10), darkMat);
          barrel.name = "barrel";
          barrel.position.set(0, 6, 3);
          barrel.rotation.x = -Math.PI / 5;

          group.add(base, barrel);
        } else if (t.type === "radar") {
          const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), armorMat);
          tower.position.y = 8;

          const grid = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 1), darkMat);
          grid.name = "satellite";
          grid.position.set(0, 18, 0);

          group.add(tower, grid);
        }

        group.position.set(t.x, t.y, t.z);
        this.scene.add(group);
        this.groundTargetMeshes.set(t.id, group);
      }

      group.position.set(t.x, t.y, t.z);

      const sat = group.getObjectByName("satellite");
      if (sat) sat.rotation.y += 1.5 * dt;

      const barrel = group.getObjectByName("barrel");
      if (barrel) barrel.rotation.z = Math.sin(Date.now() / 600) * 0.15;
    }

    for (const cachedId of Array.from(this.groundTargetMeshes.keys())) {
      if (!activeIds.has(cachedId)) {
        const group = this.groundTargetMeshes.get(cachedId);

        if (group) {
          this.triggerExplosion(group.position.x, group.position.y + 3, group.position.z, 2.5);
          this.scene.remove(group);
        }

        this.groundTargetMeshes.delete(cachedId);
      }
    }
  }

  private syncSkyZones(zones: SkyZone[]) {
    while (this.zoneAnchors.length < zones.length) {
      const ringG = new THREE.RingGeometry(180, 200, 12);
      ringG.rotateX(Math.PI / 2);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35
      });

      const ringMesh = new THREE.Group();
      const edge = new THREE.Mesh(ringG, ringMat);
      ringMesh.add(edge);

      const coreLightGeo = new THREE.BoxGeometry(90, 220, 90);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide
      });

      const lightColumn = new THREE.Mesh(coreLightGeo, coreMat);
      lightColumn.position.y = 80;
      ringMesh.add(lightColumn);

      this.scene.add(ringMesh);
      this.zoneAnchors.push(ringMesh);
    }

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const anchor = this.zoneAnchors[i];

      anchor.position.set(z.x, z.y + Math.sin(Date.now() / 1000 + i) * 8, z.z);

      let color = 0x94a3b8;
      if (z.owningTeam === 1) color = 0xef4444;
      if (z.owningTeam === 2) color = 0x3b82f6;

      anchor.traverse(mesh => {
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.color.setHex(color);
        }
      });
    }
  }

  private syncProjectiles(
    projectiles: Projectile[],
    playerPilotId: string,
    dt: number
  ) {
    const activeBullets = new Set<string>();

    for (const p of projectiles) {
      activeBullets.add(p.id);

      let pEntry = this.listProjectiles.find(e => e.bulletId === p.id);

      if (!pEntry) {
        let projectileObject: THREE.Object3D;

        let color: THREE.ColorRepresentation = 0xfffaed;

        if (String(p.belt) === "Tracer") color = 0xff3300;
        if (String(p.belt) === "Incendiary") color = 0xeab308;
        if (String(p.belt) === "Armor-Piercing") color = 0x22c55e;
        if (String(p.belt) === "Stealth") color = 0x111827;

        if (p.ownerId === playerPilotId) {
          color = 0xffd700;
        }

        if (p.type === WeaponType.BOMB) {
          const bomb = new THREE.Group();
          bomb.name = "bomb-projectile";

          const bodyMaterial = new THREE.MeshLambertMaterial({
            color: 0x3f3f32,
            flatShading: true
          });
          const bandMaterial = new THREE.MeshBasicMaterial({ color: 0xd6a11d });
          const finMaterial = new THREE.MeshLambertMaterial({
            color: 0x25251f,
            flatShading: true
          });

          const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.38, 0.38, 1.8, 8),
            bodyMaterial
          );
          body.rotation.x = Math.PI / 2;
          bomb.add(body);

          const nose = new THREE.Mesh(
            new THREE.ConeGeometry(0.38, 0.72, 8),
            bodyMaterial
          );
          nose.rotation.x = Math.PI / 2;
          nose.position.z = 1.22;
          bomb.add(nose);

          const band = new THREE.Mesh(
            new THREE.CylinderGeometry(0.41, 0.41, 0.14, 8),
            bandMaterial
          );
          band.rotation.x = Math.PI / 2;
          band.position.z = 0.35;
          bomb.add(band);

          for (const rotation of [0, Math.PI / 2]) {
            const fins = new THREE.Mesh(
              new THREE.BoxGeometry(1.05, 0.1, 0.62),
              finMaterial
            );
            fins.rotation.z = rotation;
            fins.position.z = -1.08;
            bomb.add(fins);
          }

          projectileObject = bomb;
        } else {
          const size = p.isRocket ? 3.0 : 1.2;
          const lineGeo = new THREE.BoxGeometry(
            0.22 * size,
            0.22 * size,
            14 * size
          );
          const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: String(p.belt) === "Stealth",
            opacity: String(p.belt) === "Stealth" ? 0.08 : 0.95
          });
          projectileObject = new THREE.Mesh(lineGeo, mat);
        }

        this.scene.add(projectileObject);

        pEntry = {
          bulletId: p.id,
          mesh: projectileObject,
          type: p.type,
          age: 0
        };
        this.listProjectiles.push(pEntry);
      }

      pEntry.mesh.position.set(p.x, p.y, p.z);
      pEntry.age += dt;

      const speedVec = new THREE.Vector3(p.vx, p.vy, p.vz);

      if (speedVec.lengthSq() > 0) {
        const norm = speedVec.normalize();

        const quat = new THREE.Quaternion().setFromUnitVectors(
          LOCAL_FORWARD.clone(),
          norm
        );

        pEntry.mesh.quaternion.copy(quat);
      }

      if (pEntry.type === WeaponType.BOMB) {
        pEntry.mesh.rotateOnAxis(LOCAL_FORWARD, pEntry.age * 4.2);
      }
    }

    for (let i = this.listProjectiles.length - 1; i >= 0; i--) {
      const entry = this.listProjectiles[i];

      if (!activeBullets.has(entry.bulletId)) {
        this.scene.remove(entry.mesh);
        entry.mesh.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          disposeMaterial(child.material);
        });
        this.listProjectiles.splice(i, 1);
      }
    }
  }
}

function disposeMaterial(m: THREE.Material | THREE.Material[]) {
  if (Array.isArray(m)) {
    m.forEach(x => x.dispose());
  } else if (m && typeof m.dispose === "function") {
    m.dispose();
  }
}
