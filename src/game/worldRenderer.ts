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
  InputFrame,
  CameraMode
} from "../types";
import { CloudField } from "./cloudField";
import { MapDefinition } from "./content/maps/mapTypes";
import { ScreenEffectsPass } from "./screenEffects";

// Sub-renderers/Managers
import { TerrainBuilder } from "./renderer/TerrainBuilder";
import { AtmosphereManager } from "./renderer/AtmosphereManager";
import { ParticleEffectsManager } from "./renderer/ParticleEffectsManager";
import { CameraManager } from "./renderer/CameraManager";
import { GroundTargetRenderer } from "./renderer/GroundTargetRenderer";
import { SkyZoneRenderer } from "./renderer/SkyZoneRenderer";
import { HudSyncManager } from "./renderer/HudSyncManager";
import { AircraftRenderer } from "./renderer/AircraftRenderer";
import { cockpitPanelState } from "./cockpitPanelState";

export class WorldRenderer {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: WebGPURenderer;
  private container!: HTMLDivElement;

  // Subsystems
  public terrainBuilder!: TerrainBuilder;
  public atmosphereManager!: AtmosphereManager;
  public particlesManager!: ParticleEffectsManager;
  public cameraManager!: CameraManager;
  public groundTargetRenderer!: GroundTargetRenderer;
  public skyZoneRenderer!: SkyZoneRenderer;
  public hudSyncManager!: HudSyncManager;

  private cockpitLight: THREE.PointLight | null = null;
  public aircraftRenderer!: AircraftRenderer;
  private cloudField: CloudField | null = null;

  private mapDef!: MapDefinition;
  private screenEffects: ScreenEffectsPass | null = null;
  private rendererReady = false;
  private lastPlayerDamageTotal: number | null = null;
  private _cameraMode: CameraMode = "third-person";

  constructor(container: HTMLDivElement, mapDef: MapDefinition, onReady: () => void) {
    this.container = container;
    this.mapDef = mapDef;
    this.init().then(() => onReady());
  }

  public get cameraMode(): CameraMode {
    return this.cameraManager ? this.cameraManager.cameraMode : this._cameraMode;
  }

  public get bombSightInfo() {
    return this.cameraManager ? this.cameraManager.bombSightInfo : null;
  }

  public setCameraMode(mode: CameraMode, playerPilotId?: string) {
    const wasFirstPerson = this.cameraMode === "first-person";
    const willBeFirstPerson = mode === "first-person";
    
    this._cameraMode = mode;
    if (this.cameraManager) {
      this.cameraManager.setCameraMode(mode);
    }

    if (wasFirstPerson !== willBeFirstPerson && playerPilotId) {
      this.aircraftRenderer.updateFirstPersonState(playerPilotId, willBeFirstPerson);
    }
  }

  public getRenderStats() {
    const info = (this.renderer as any).info;
    return {
      drawCalls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0
    };
  }

  private async init() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();

    this.atmosphereManager = new AtmosphereManager(this.scene, this.mapDef);
    this.atmosphereManager.init();

    const skyEnvironment = this.atmosphereManager.skyEnvironment!;
    this.scene.background = skyEnvironment.backgroundColor.clone();
    this.scene.fog = new THREE.Fog(
      skyEnvironment.fogColor,
      skyEnvironment.fogNear,
      skyEnvironment.fogFar
    );

    this.camera = new THREE.PerspectiveCamera(65, width / height, 1, skyEnvironment.fogFar);
    this.camera.position.set(0, 200, 300);

    const hasWebGPU = typeof navigator !== "undefined" && !!(navigator as any).gpu;
    try {
      this.renderer = new WebGPURenderer({
        antialias: true,
        powerPreference: "high-performance",
        forceWebGL: !hasWebGPU,
        reversedDepthBuffer: true
      });
      await this.renderer.init();
      if (!this.renderer.reversedDepthBuffer) {
        throw new Error("Reverse-Z depth buffering is required but unavailable.");
      }
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (err) {
      this.renderer?.dispose();
      console.error("Required reverse-Z renderer initialization failed:", err);
      const errDiv = document.createElement("div");
      errDiv.style.color = "#ef4444";
      errDiv.style.padding = "20px";
      errDiv.style.textAlign = "center";
      errDiv.style.background = "#1e293b";
      errDiv.style.borderRadius = "8px";
      errDiv.style.margin = "20px";
      errDiv.innerText =
        "Fatal: this browser or graphics driver does not support the required reverse-Z depth buffer.";
      this.container.appendChild(errDiv);
      throw err;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = skyEnvironment.exposure;
    this.renderer.domElement.style.imageRendering = "auto";
    this.container.appendChild(this.renderer.domElement);

    this.screenEffects = new ScreenEffectsPass(this.renderer, skyEnvironment.cloudVeilColor);

    this.terrainBuilder = new TerrainBuilder(this.scene, this.mapDef);
    await this.terrainBuilder.buildTerrain();

    this.cloudField = new CloudField(this.mapDef);
    this.scene.add(this.cloudField.mesh);

    this.terrainBuilder.loadMapTiles();

    this.particlesManager = new ParticleEffectsManager(this.scene);

    this.cockpitLight = new THREE.PointLight(0xb8d4ff, 0, 4, 1.5);
    this.cockpitLight.castShadow = false;
    this.scene.add(this.cockpitLight);

    // Sub-renderer setups
    this.cameraManager = new CameraManager(this.camera, this.cockpitLight, this.mapDef);
    this.cameraManager.setCameraMode(this._cameraMode);
    this.groundTargetRenderer = new GroundTargetRenderer(this.scene, (x, y, z, mult) =>
      this.triggerExplosion(x, y, z, mult)
    );
    this.skyZoneRenderer = new SkyZoneRenderer(this.scene);
    this.hudSyncManager = new HudSyncManager(this.camera);
    this.aircraftRenderer = new AircraftRenderer(this.scene, (x, y, z, colorHex, scale) =>
      this.createSmokeTail(x, y, z, colorHex, scale)
    );

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

    this.atmosphereManager.dispose();
    this.terrainBuilder.dispose();
    this.particlesManager.dispose();
    this.groundTargetRenderer.dispose();
    this.skyZoneRenderer.dispose();
    this.aircraftRenderer.dispose();

    this.screenEffects?.dispose();
    this.screenEffects = null;

    if (this.cloudField) {
      this.scene.remove(this.cloudField.mesh);
      this.cloudField.dispose();
      this.cloudField = null;
    }

    if (this.cockpitLight) {
      this.scene.remove(this.cockpitLight);
      this.cockpitLight.dispose();
      this.cockpitLight = null;
    }

    if (this.renderer?.domElement) {
      this.renderer.domElement.remove();
    }

    this.renderer?.dispose();
  }

  public deformAircraft(pilotId: string, localOffsetMeters: THREE.Vector3, blastMeters: number) {
    this.aircraftRenderer.deformAircraft(pilotId, localOffsetMeters, blastMeters);
  }

  public resetVoxelState(pilotId: string) {
    this.aircraftRenderer.resetVoxelState(pilotId);
  }

  public findVoxelImpact(
    pilotId: string,
    segStartLocal: THREE.Vector3,
    segEndLocal: THREE.Vector3
  ): THREE.Vector3 | null | undefined {
    return this.aircraftRenderer.findVoxelImpact(pilotId, segStartLocal, segEndLocal);
  }

  public createSmokeTail(x: number, y: number, z: number, colorHex: number = 0x64748b, scale: number = 1.0) {
    this.particlesManager.createSmokeTail(x, y, z, colorHex, scale);
  }

  public triggerExplosion(x: number, y: number, z: number, sizeMultiplier: number = 1.0) {
    this.particlesManager.triggerExplosion(x, y, z, sizeMultiplier);
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
      this.atmosphereManager.update(dt, player.x, player.y, player.z, this.camera, this.renderer);
    } else {
      this.atmosphereManager.update(dt, 0, 0, 0, this.camera, this.renderer);
    }

    this.groundTargetRenderer.sync(groundTargets, dt);
    this.skyZoneRenderer.sync(skyZones);

    this.aircraftRenderer.sync(pilots, playerPilotId, this.cameraManager.cameraMode, dt);

    this.particlesManager.syncProjectiles(projectiles, playerPilotId, this.camera, dt);
    this.particlesManager.updateParticles(dt);
    this.cameraManager.update(
      pilots,
      playerPilotId,
      inputFrame,
      dt,
      this.aircraftRenderer.groupMap,
      this.aircraftRenderer.cockpitStateMap
    );

    if (cockpitPanelState.active) {
      this.aircraftRenderer.cockpitStateMap.get(playerPilotId)?.tickPanel();
    }

    const playerPilot = pilots.find((p) => p.id === playerPilotId);
    if (playerPilot) this.terrainBuilder.updateTiles(playerPilot.x, playerPilot.z);
    this.cloudField?.update(dt);
    if (this.cloudField && this.scene.fog instanceof THREE.Fog) {
      this.cloudField.updateFog(this.scene.fog.near, this.scene.fog.far);
    }
    this.terrainBuilder.updateWater(dt);

    this.hudSyncManager.syncLeadHud(pilots, playerPilotId, this.aircraftRenderer.groupMap);
    this.hudSyncManager.syncCenterReticle(
      playerPilotId,
      playerPilot?.aircraftId,
      this.cameraManager.cameraMode,
      this.cameraManager.reticleTurbulenceX,
      this.cameraManager.reticleTurbulenceY,
      this.aircraftRenderer.groupMap,
      this.aircraftRenderer.cockpitStateMap
    );

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
      const cloudDensity =
        playerPilot && this.cloudField
          ? this.cloudField.sampleDensity(new THREE.Vector3(playerPilot.x, playerPilot.y, playerPilot.z))
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
}
