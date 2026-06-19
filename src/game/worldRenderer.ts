/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Pilot, Projectile, GroundTarget, GameMap, MapSpecs, SkyZone, LeadIndicatorInfo, InputFrame } from "../types";
import { getDeterministicIslands } from "./terrainModel";
import { AIRCRAFT_DEFINITIONS } from "./content/aircraft/registry";
import { createAircraftMesh } from "./content/aircraft/aircraftBuilder";
import { LOCAL_FORWARD } from "./math";
import { createSkyDome, SkyDomeMesh, updateSkyDome } from "./skyDome";
import { ScreenEffectsPass } from "./screenEffects";
import { CloudField } from "./cloudField";

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

const MAP_TILE_CONFIG: Partial<Record<GameMap, { lat: number; lon: number; zoom: number }>> = {
  [GameMap.IslandChain]:  { lat: 21.47, lon: -157.98, zoom: 12 },
  [GameMap.DesertCanyon]: { lat: 36.06, lon: -112.14, zoom: 12 },
  [GameMap.AlpineValley]: { lat: 46.49, lon:    8.09, zoom: 12 },
  [GameMap.StormFront]:   { lat: 51.09, lon:    2.53, zoom: 12 },
};

/**
 * Handles all 3D scene elements, camera dynamics, blocky geometry generation, and particle updates.
 */
export class WorldRenderer {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: WebGPURenderer;
  private container!: HTMLDivElement;

  private aircraftGroupMap = new Map<string, THREE.Group>();
  private cloudField: CloudField | null = null;
  private islands: THREE.Mesh[] = [];
  private carriers: THREE.Group[] = [];
  private groundTargetMeshes = new Map<string, THREE.Group>();
  private listProjectiles: { bulletId: string; mesh: THREE.Mesh }[] = [];
  private zoneAnchors: THREE.Group[] = [];

  private smokeParticles: { mesh: THREE.Mesh; scaleSpeed: number; vel: THREE.Vector3; life: number }[] = [];
  private explosionBlobs: { mesh: THREE.Mesh; shrinkSpeed: number; vel: THREE.Vector3; life: number }[] = [];

  public mapRadius = 8000;
  private mapSpecs!: MapSpecs;
  public cameraMode: "third-person" | "first-person" = "third-person";
  public leadIndicator2D: LeadIndicatorInfo | null = null;

  private targetCameraOffset = new THREE.Vector3(0, 5.5, 17);
  private cameraLookAtTarget = new THREE.Vector3();
  private freeLookYaw = 0;
  private freeLookPitch = 0;
  private cameraModeTransitionPending = true;
  private cameraShakeTime = 0;
  private groundMaterial: THREE.MeshLambertMaterial | null = null;
  private skyDome: SkyDomeMesh | null = null;
  private screenEffects: ScreenEffectsPass | null = null;
  private rendererReady = false;
  private lastPlayerDamageTotal: number | null = null;

  constructor(container: HTMLDivElement, mapSpecs: MapSpecs, onReady: () => void) {
    this.container = container;
    this.mapSpecs = mapSpecs;
    this.init().then(() => onReady());
  }

  public setCameraMode(mode: "third-person" | "first-person") {
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
    this.scene.background = new THREE.Color(this.mapSpecs.skyColor);
    this.scene.fog = new THREE.Fog(this.mapSpecs.fogColor, 3500, 12500);

    this.camera = new THREE.PerspectiveCamera(65, width / height, 1, 15000);
    this.camera.position.set(0, 200, 300);

    this.renderer = new WebGPURenderer({
      antialias: false,
      powerPreference: "high-performance"
    });

    await this.renderer.init();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.domElement.style.imageRendering = "pixelated";
    this.container.appendChild(this.renderer.domElement);
    this.screenEffects = new ScreenEffectsPass(this.renderer);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.0);
    dirLight.position.set(2000, 4000, 1000);
    this.scene.add(dirLight);

    this.skyDome = createSkyDome(this.mapSpecs);
    this.scene.add(this.skyDome);

    this.buildTerrain();
    this.cloudField = new CloudField(this.mapSpecs);
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

    this.screenEffects?.dispose();
    this.screenEffects = null;

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

  private buildTerrain() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Dynamic procedural textures based on theater map ID
    let landColors: string[] = [];
    let baseColor = "#271206"; // default dark moist soil base
    let roadColor = "rgba(226, 232, 240, 0.22)"; // Faint gravel country lanes

    if (this.mapSpecs.id === GameMap.DesertCanyon) {
      // Sandstone canyon fields & arid dunes
      baseColor = "#78350f";
      landColors = [
        "#b45309", // Warm amber
        "#d97706", // Burned orange
        "#f59e0b", // Warm clay
        "#ca8a04", // Sandstone base
        "#eab308", // Golden sand
        "#facc15", // Sun-bleached dust
        "#a16207", // Ochre hills
        "#854d0e"  // Raw sienna
      ];
      roadColor = "rgba(254, 215, 170, 0.28)"; // Arid dust trails
    } else if (this.mapSpecs.id === GameMap.AlpineValley) {
      // Snowy slopes and high-elevation slate ridges
      baseColor = "#1e293b";
      landColors = [
        "#f8fafc", // Fresh powder
        "#f1f5f9", // Crisp snow
        "#e2e8f0", // Ice drifts
        "#cbd5e1", // Glacial ice
        "#94a3b8", // Moraine gravels
        "#64748b", // Granite slabs
        "#475569", // Cold schist
        "#0f172a"  // Taiga forest clumps
      ];
      roadColor = "rgba(100, 116, 139, 0.3)"; // Gravel ridges
    } else {
      // Grass fields, woodlands, and crops for Island Chain / Storm Front
      baseColor = "#14532d";
      landColors = [
        "#1b5e20", // Deep forest canopy
        "#14532d", // Dense thicket
        "#2e7d32", // Pasture valley
        "#15803d", // Lush grass
        "#22c55e", // Active crops
        "#4caf50", // Harvest lawns
        "#4ade80", // Young growth
        "#854d0e", // Clay soil tracks
        "#a16207", // Dry tilled banks
        "#ca8a04"  // Mustard crop lines
      ];
      roadColor = "rgba(241, 245, 249, 0.25)"; // Country roads
    }

    if (ctx) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, 512, 512);

      const cols = 20;
      const rows = 20;
      const size = 512 / cols;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const color = landColors[Math.floor(Math.random() * landColors.length)];
          ctx.fillStyle = color;
          ctx.fillRect(c * size + 0.5, r * size + 0.5, size - 1, size - 1);

          // Render alignment lines simulating agricultural plow furrows
          if (Math.random() < 0.5) {
            ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            const horizontalPlow = Math.random() < 0.5;
            for (let offset = 4; offset < size; offset += 4) {
              if (horizontalPlow) {
                ctx.moveTo(c * size + 1, r * size + offset);
                ctx.lineTo(c * size + size - 1, r * size + offset);
              } else {
                ctx.moveTo(c * size + offset, r * size + 1);
                ctx.lineTo(c * size + offset, r * size + size - 1);
              }
            }
            ctx.stroke();
          }
        }
      }

      // Weave country roads across the agricultural land
      ctx.strokeStyle = roadColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let index = 0; index < 4; index++) {
        const yCoord = Math.random() * 512;
        ctx.moveTo(0, yCoord);
        ctx.bezierCurveTo(128, yCoord + (Math.random() - 0.5) * 120, 384, yCoord + (Math.random() - 0.5) * 120, 512, yCoord);
      }
      for (let index = 0; index < 4; index++) {
        const xCoord = Math.random() * 512;
        ctx.moveTo(xCoord, 0);
        ctx.bezierCurveTo(xCoord + (Math.random() - 0.5) * 120, 128, xCoord + (Math.random() - 0.5) * 120, 384, xCoord, 512);
      }
      ctx.stroke();
    }

    const groundTex = new THREE.CanvasTexture(canvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(120, 120); // Scale the tile pattern across the 30km terrain

    const landGeo = new THREE.BoxGeometry(30000, 12, 30000);
    const landMat = new THREE.MeshLambertMaterial({
      map: groundTex,
      flatShading: true
    });
    this.groundMaterial = landMat;
    const landPlane = new THREE.Mesh(landGeo, landMat);
    landPlane.position.y = -8;
    this.scene.add(landPlane);

    const deterministicIslands = getDeterministicIslands(this.mapSpecs.id);

    deterministicIslands.forEach((isl) => {
      if (isl.isAirfield) {
        const stripGeo = new THREE.BoxGeometry(55, 12, 650);
        const strip = new THREE.Mesh(stripGeo, this.mat(0x334155));
        strip.position.set(isl.x, 4, isl.z);
        this.scene.add(strip);
      }
    });

    if (this.mapSpecs.hasCarriers) {
      for (const team of [1, 2] as const) {
        const carrier = new THREE.Group();

        const hull = new THREE.Mesh(
          new THREE.BoxGeometry(80, 26, 400),
          this.mat(0x475569)
        );
        hull.position.y = 8;
        carrier.add(hull);

        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(74, 4, 390),
          this.mat(0x1e293b)
        );
        deck.position.y = 23;
        carrier.add(deck);

        const tower = new THREE.Mesh(
          new THREE.BoxGeometry(18, 46, 42),
          this.mat(0x334155)
        );
        tower.position.set(31, 48, -38);
        carrier.add(tower);

        const runwayLine = new THREE.Mesh(
          new THREE.BoxGeometry(4, 1, 320),
          this.mat(0xf8fafc, true)
        );
        runwayLine.position.y = 26;
        carrier.add(runwayLine);

        const cx = team === 1 ? -4000 : 4000;
        const cz = team === 1 ? -3000 : 3000;
        carrier.position.set(cx, 0, cz);
        carrier.rotation.y = team === 1 ? Math.PI / 4 : -3 * Math.PI / 4;

        this.scene.add(carrier);
        this.carriers.push(carrier);
      }
    }
  }

  private async loadMapTiles() {
    const config = MAP_TILE_CONFIG[this.mapSpecs.id];
    if (!config || !this.groundMaterial) return;

    const { lat, lon, zoom } = config;
    const GRID = 4;
    const center = latLonToTile(lat, lon, zoom);
    const half = Math.floor(GRID / 2);

    const TILE_PX = 256;
    const canvas = document.createElement("canvas");
    canvas.width = TILE_PX * GRID;
    canvas.height = TILE_PX * GRID;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const loads: Promise<void>[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const tx = center.x - half + col;
        const ty = center.y - half + row;
        loads.push(
          new Promise<void>(resolve => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              ctx.drawImage(img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
          })
        );
      }
    }

    await Promise.all(loads);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    this.groundMaterial.map = tex;
    this.groundMaterial.needsUpdate = true;
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

    this.syncGroundEnemies(groundTargets, dt);
    this.syncSkyZones(skyZones);

    const activePilotIds = new Set<string>();

    for (const p of pilots) {
      activePilotIds.add(p.id);

      let group = this.aircraftGroupMap.get(p.id);

      if (!group) {
        group = this.generateProceduralAircraft(
          p.specs.id,
          p.specs.color,
          p.specs.secondaryColor,
          p.specs.accentColor
        );
        this.scene.add(group);
        this.aircraftGroupMap.set(p.id, group);
      }

      group.position.set(p.x, p.y, p.z);
      group.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, "YXZ"));

      // Animate any block with the "spinZ" tag
      group.traverse(child => {
        if (child.userData.tags && child.userData.tags.includes("spinZ")) {
          child.rotation.z += (15 + p.throttle * 40) * dt;
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
      }
    }

    this.syncProjectiles(projectiles, playerPilotId);
    this.updateParticles(dt);
    this.updateCamera(pilots, playerPilotId, inputFrame, dt);

    this.cloudField?.update(dt);

    // Project Lead Indicator for Targeting HUD Overlay
    const playerPilot = pilots.find(p => p.id === playerPilotId);
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
          
          if (dist > 50 && dist < 2200) {
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

    if (lockedAdv) {
      const muzzleSpeed = 850;
      const t = lockedDist / muzzleSpeed;

      const futureX = (lockedAdv as Pilot).x + (lockedAdv as Pilot).vx * t;
      const futureY = (lockedAdv as Pilot).y + (lockedAdv as Pilot).vy * t;
      const futureZ = (lockedAdv as Pilot).z + (lockedAdv as Pilot).vz * t;

      const pTarget = new THREE.Vector3((lockedAdv as Pilot).x, (lockedAdv as Pilot).y, (lockedAdv as Pilot).z).project(this.camera);
      const pLead = new THREE.Vector3(futureX, futureY, futureZ).project(this.camera);

      if (pTarget.z <= 1.0 && pLead.z <= 1.0) {
        this.leadIndicator2D = {
          x: (pTarget.x * 0.5 + 0.5) * 100,
          y: (-pTarget.y * 0.5 + 0.5) * 100,
          sX: (pLead.x * 0.5 + 0.5) * 100,
          sY: (-pLead.y * 0.5 + 0.5) * 100,
          name: (lockedAdv as Pilot).name,
          distance: Math.round(lockedDist)
        };
      } else {
        this.leadIndicator2D = null;
      }
    } else {
      this.leadIndicator2D = null;
    }

    if (this.skyDome) {
      updateSkyDome(this.skyDome, this.camera, dt);
    }

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
      : THREE.MathUtils.clamp(65 + speedKmph / 28, 62, 92);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.near = this.cameraMode === "first-person" ? 0.25 : 1;

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

    if (this.cameraMode === "first-person") {
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
    const shakeStrength = THREE.MathUtils.clamp((shakeKmph - 450) / 200, 0, 1) * 0.28;
    if (shakeStrength > 0) {
      const t = this.cameraShakeTime;
      this.camera.position.x += Math.sin(t * 18.7) * Math.sin(t * 6.3) * shakeStrength;
      this.camera.position.y += Math.sin(t * 24.1 + 0.9) * Math.sin(t * 4.9) * shakeStrength;
    }

    this.camera.updateProjectionMatrix();
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

  private syncProjectiles(projectiles: Projectile[], playerPilotId: string) {
    const activeBullets = new Set<string>();

    for (const p of projectiles) {
      activeBullets.add(p.id);

      let pEntry = this.listProjectiles.find(e => e.bulletId === p.id);

      if (!pEntry) {
        const size = p.isRocket ? 3.0 : 1.2;
        const lineGeo = new THREE.BoxGeometry(0.22 * size, 0.22 * size, 14 * size);

        let color: THREE.ColorRepresentation = 0xfffaed;

        if (String(p.belt) === "Tracer") color = 0xff3300;
        if (String(p.belt) === "Incendiary") color = 0xeab308;
        if (String(p.belt) === "Armor-Piercing") color = 0x22c55e;
        if (String(p.belt) === "Stealth") color = 0x111827;

        if (p.ownerId === playerPilotId) {
          color = 0xffd700;
        }

        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: String(p.belt) === "Stealth",
          opacity: String(p.belt) === "Stealth" ? 0.08 : 0.95
        });

        const mesh = new THREE.Mesh(lineGeo, mat);
        this.scene.add(mesh);

        pEntry = { bulletId: p.id, mesh };
        this.listProjectiles.push(pEntry);
      }

      pEntry.mesh.position.set(p.x, p.y, p.z);

      const speedVec = new THREE.Vector3(p.vx, p.vy, p.vz);

      if (speedVec.lengthSq() > 0) {
        const norm = speedVec.normalize();

        const quat = new THREE.Quaternion().setFromUnitVectors(
          LOCAL_FORWARD.clone(),
          norm
        );

        pEntry.mesh.quaternion.copy(quat);
      }
    }

    for (let i = this.listProjectiles.length - 1; i >= 0; i--) {
      const entry = this.listProjectiles[i];

      if (!activeBullets.has(entry.bulletId)) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        disposeMaterial(entry.mesh.material);
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
