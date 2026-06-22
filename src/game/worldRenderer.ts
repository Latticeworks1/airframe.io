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
  WeaponType
} from "../types";
import { CloudField } from "./cloudField";
import { MapDefinition } from "./content/maps/mapTypes";
import { WEAPON_SPECS_MAP } from "./content/weapons/weaponData";
import { ScreenEffectsPass } from "./screenEffects";
import {
  buildVoxelMesh,
  deformAtImpact,
  disposeVoxelMesh,
  findVoxelImpact,
  animateSpinCells,
  setCockpitVisible,
  setFPVMaterial,
  resetVoxelMesh,
  VoxelMeshState
} from "./voxelMesh";
import { getVoxelDef } from "./content/aircraft/voxelRegistry";
import { buildCockpitMesh, type CockpitState } from "./cockpitMesh";
import { getCockpitDef } from "./content/aircraft/cockpitRegistry";

// Sub-renderers/Managers
import { TerrainBuilder } from "./renderer/TerrainBuilder";
import { AtmosphereManager } from "./renderer/AtmosphereManager";
import { ParticleEffectsManager } from "./renderer/ParticleEffectsManager";
import { CameraManager } from "./renderer/CameraManager";
import { GroundTargetRenderer } from "./renderer/GroundTargetRenderer";
import { SkyZoneRenderer } from "./renderer/SkyZoneRenderer";
import { HudSyncManager } from "./renderer/HudSyncManager";
import { generateProceduralAircraft } from "./content/aircraft/aircraftBuilder";

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
  private aircraftGroupMap = new Map<string, THREE.Group>();
  private voxelStateMap = new Map<string, VoxelMeshState>();
  private cockpitStateMap = new Map<string, CockpitState>();
  private cloudField: CloudField | null = null;

  private mapDef!: MapDefinition;
  public leadIndicator2D: LeadIndicatorInfo | null = null;
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
      const voxState = this.voxelStateMap.get(playerPilotId);
      const hasCanvas = this.cockpitStateMap.has(playerPilotId);
      if (voxState) {
        if (voxState.spinMesh) voxState.spinMesh.visible = !willBeFirstPerson;
        if (hasCanvas) {
          voxState.mesh.visible = true;
          setCockpitVisible(voxState, !willBeFirstPerson);
        } else {
          setFPVMaterial(voxState, willBeFirstPerson);
        }
      }
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
    const state = this.voxelStateMap.get(pilotId);
    if (state) deformAtImpact(state, localOffsetMeters, blastMeters);
  }

  public resetVoxelState(pilotId: string) {
    const state = this.voxelStateMap.get(pilotId);
    if (state) resetVoxelMesh(state);
  }

  public findVoxelImpact(
    pilotId: string,
    segStartLocal: THREE.Vector3,
    segEndLocal: THREE.Vector3
  ): THREE.Vector3 | null | undefined {
    const state = this.voxelStateMap.get(pilotId);
    if (!state) return undefined;
    return findVoxelImpact(state, segStartLocal, segEndLocal);
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

          const ckDef = getCockpitDef(p.specs.id);
          if (ckDef) {
            const ckState = buildCockpitMesh(ckDef);
            group.add(ckState.group);
            this.cockpitStateMap.set(p.id, ckState);
          }
        } else {
          group = generateProceduralAircraft(
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

      const voxState = this.voxelStateMap.get(p.id);
      if (voxState) {
        animateSpinCells(voxState, dt, p.throttle);
        if (p.id === playerPilotId) {
          const inFPV = this.cameraManager.cameraMode === "first-person";
          const hasCanvasCockpit = this.cockpitStateMap.has(p.id);
          voxState.mesh.visible = true;
          if (voxState.spinMesh) voxState.spinMesh.visible = !inFPV;
          if (inFPV && hasCanvasCockpit) {
            setCockpitVisible(voxState, false);
          } else {
            setCockpitVisible(voxState, !inFPV);
          }
        }
      }

      if (!voxState)
        group.traverse((child) => {
          if (child.userData.tags && child.userData.tags.includes("spinZ")) {
            child.rotation.z += (15 + p.throttle * 40) * dt;
          }

          const bombTag = (child.userData.tags as string[] | undefined)?.find((tag) =>
            tag.startsWith("ordnance:bomb:")
          );
          if (bombTag) {
            const bombIndex = Number(bombTag.split(":")[2]);
            const bombsRemaining = p.ammo[WeaponType.BOMB] ?? 0;
            child.visible = Number.isFinite(bombIndex) && bombIndex < bombsRemaining;
          }

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
        const ckEntry = this.cockpitStateMap.get(cachedId);
        if (ckEntry) {
          ckEntry.dispose();
          this.cockpitStateMap.delete(cachedId);
        }
      }
    }

    this.particlesManager.syncProjectiles(projectiles, playerPilotId, this.camera, dt);
    this.particlesManager.updateParticles(dt);
    this.cameraManager.update(
      pilots,
      playerPilotId,
      inputFrame,
      dt,
      this.aircraftGroupMap,
      this.cockpitStateMap
    );

    const playerPilot = pilots.find((p) => p.id === playerPilotId);
    if (playerPilot) this.terrainBuilder.updateTiles(playerPilot.x, playerPilot.z);
    this.cloudField?.update(dt);
    this.terrainBuilder.updateWater(dt);

    let lockedAdv: Pilot | null = null;
    let bestDot = 0.94;
    let lockedDist = 0;

    if (playerPilot) {
      const oppTeam = playerPilot.team === 1 ? 2 : 1;
      const adversaries = pilots.filter((p) => p.team === oppTeam && p.damage.fuselage > 0);
      const pGroup = this.aircraftGroupMap.get(playerPilotId);

      if (pGroup) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pGroup.quaternion).normalize();

        adversaries.forEach((p) => {
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
        (w) => w !== WeaponType.ROCKET && w !== WeaponType.BOMB && (playerPilot.ammo[w] ?? 0) > 0
      );
      const muzzleVelocity = primaryWeapon ? WEAPON_SPECS_MAP[primaryWeapon].muzzleVelocity : 820;

      const tdx = adv.x - playerPilot.x;
      const tdy = adv.y - playerPilot.y;
      const tdz = adv.z - playerPilot.z;
      const toTarget = new THREE.Vector3(tdx, tdy, tdz).normalize();
      const closingSpeed = toTarget.dot(new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz));
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
          distance: Math.round(lockedDist),
          isBot: adv.isBot ?? true
        };
      } else {
        this.leadIndicator2D = null;
      }
    } else {
      this.leadIndicator2D = null;
    }

    this.hudSyncManager.syncLeadHud(this.leadIndicator2D);
    this.hudSyncManager.syncCenterReticle(
      playerPilotId,
      playerPilot?.aircraftId,
      this.cameraManager.cameraMode,
      this.cameraManager.reticleTurbulenceX,
      this.cameraManager.reticleTurbulenceY,
      this.aircraftGroupMap,
      this.cockpitStateMap
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
