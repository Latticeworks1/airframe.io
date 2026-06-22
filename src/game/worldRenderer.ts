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
import { getTerrainHeight } from "./terrainModel";
import { AIRCRAFT_DEFINITIONS } from "./content/aircraft/registry";
import { createAircraftMesh } from "./content/aircraft/aircraftBuilder";
import { CloudField } from "./cloudField";
import { getProjectileReleaseState } from "./projectileSystem";
import { getSightRayLocal } from "./weaponConvergence";
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

export class WorldRenderer {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: WebGPURenderer;
  private container!: HTMLDivElement;

  // Subsystems
  public terrainBuilder!: TerrainBuilder;
  public atmosphereManager!: AtmosphereManager;
  public particlesManager!: ParticleEffectsManager;

  private cockpitLight: THREE.PointLight | null = null;
  private aircraftGroupMap = new Map<string, THREE.Group>();
  private voxelStateMap = new Map<string, VoxelMeshState>();
  private cockpitStateMap = new Map<string, CockpitState>();
  private cloudField: CloudField | null = null;
  private groundTargetMeshes = new Map<string, THREE.Group>();
  private zoneAnchors: THREE.Group[] = [];

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
  private reticleTurbulenceX = 0;
  private reticleTurbulenceY = 0;
  private screenEffects: ScreenEffectsPass | null = null;
  private rendererReady = false;
  private lastPlayerDamageTotal: number | null = null;

  constructor(container: HTMLDivElement, mapDef: MapDefinition, onReady: () => void) {
    this.container = container;
    this.mapDef = mapDef;
    this.init().then(() => onReady());
  }

  public setCameraMode(mode: CameraMode, playerPilotId?: string) {
    if (this.cameraMode === mode) return;

    const wasFirstPerson = this.cameraMode === "first-person";
    const willBeFirstPerson = mode === "first-person";
    this.cameraMode = mode;
    this.reticleTurbulenceX = 0;
    this.reticleTurbulenceY = 0;
    this.cameraModeTransitionPending = true;

    // Preserve free-look direction, clamping to the limits of the new mode
    if (willBeFirstPerson) {
      this.freeLookYaw = THREE.MathUtils.clamp(this.freeLookYaw, -Math.PI * 0.72, Math.PI * 0.72);
    }
    this.freeLookPitch = THREE.MathUtils.clamp(this.freeLookPitch, -Math.PI / 2.2, Math.PI / 2.2);

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

    // Atmosphere manager setup
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

    // Terrain builder setup
    this.terrainBuilder = new TerrainBuilder(this.scene, this.mapDef);
    await this.terrainBuilder.buildTerrain();

    this.cloudField = new CloudField(this.mapDef);
    this.scene.add(this.cloudField.mesh);

    this.terrainBuilder.loadMapTiles();

    // Particles manager setup
    this.particlesManager = new ParticleEffectsManager(this.scene);

    // Initialize cockpit light in the scene permanently with intensity 0 to avoid shader recompilations on POV toggle
    this.cockpitLight = new THREE.PointLight(0xb8d4ff, 0, 4, 1.5);
    this.cockpitLight.castShadow = false;
    this.scene.add(this.cockpitLight);

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

  private mat(color: THREE.ColorRepresentation, emissive = false) {
    if (emissive) {
      return new THREE.MeshBasicMaterial({ color });
    }
    return new THREE.MeshLambertMaterial({
      color,
      flatShading: true
    });
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
        accent: accentHex || def.render.materials.accent
      }
    };

    return createAircraftMesh(renderDef);
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

          const ckDef = getCockpitDef(p.specs.id);
          if (ckDef) {
            const ckState = buildCockpitMesh(ckDef);
            group.add(ckState.group);
            this.cockpitStateMap.set(p.id, ckState);
          }
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

      const voxState = this.voxelStateMap.get(p.id);
      if (voxState) {
        animateSpinCells(voxState, dt, p.throttle);
        if (p.id === playerPilotId) {
          const inFPV = this.cameraMode === "first-person";
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
    this.updateCamera(pilots, playerPilotId, inputFrame, dt);

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

    this.syncLeadHud();
    this.syncCenterReticle(playerPilotId, playerPilot?.aircraftId);

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

  private updateCamera(pilots: Pilot[], playerPilotId: string, inputFrame: InputFrame | undefined, dt: number) {
    const playerPilot = pilots.find((p) => p.id === playerPilotId);
    if (!playerPilot) return;

    const pGroup = this.aircraftGroupMap.get(playerPilotId);
    if (!pGroup) return;

    const aircraftDef = AIRCRAFT_DEFINITIONS.find((definition) => definition.specs.id === playerPilot.aircraftId);
    const cameraDef = aircraftDef?.render.camera;
    const hiddenBlockIds = new Set(cameraDef?.hiddenBlockIds ?? ["canopy"]);

    const speedKmph = new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;

    const firstPersonBaseFov = cameraDef?.firstPersonFov ?? 74;
    const firstPersonSpeedFov = THREE.MathUtils.clamp(((speedKmph - 250) / 250) * 4, 0, 4);
    const targetFov =
      this.cameraMode === "first-person"
        ? THREE.MathUtils.clamp(firstPersonBaseFov + firstPersonSpeedFov, 68, 80)
        : this.cameraMode === "bombsight"
        ? 52
        : THREE.MathUtils.clamp(65 + speedKmph / 28, 62, 92);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    
    // Snap camera near plane instantly to avoid weird slicing/sweeping effects through cockpit geometry
    this.camera.near =
      this.cameraMode === "third-person" ? 1 : this.cameraMode === "first-person" ? 0.04 : 0.25;

    // Smoothly transition cockpit light intensity to avoid lighting snaps
    const targetLightIntensity = this.cameraMode === "first-person" ? 4.5 : 0;
    if (this.cockpitLight) {
      this.cockpitLight.intensity += (targetLightIntensity - this.cockpitLight.intensity) * Math.min(1, dt * 15);
    }

    const isFreeLookActive = !!(inputFrame && inputFrame.rightMouse);

    if (isFreeLookActive && inputFrame) {
      this.freeLookYaw += inputFrame.mouseDelta.x * 2.8;
      this.freeLookPitch -= inputFrame.mouseDelta.y * 2.1;
      this.freeLookPitch = THREE.MathUtils.clamp(this.freeLookPitch, -Math.PI / 2.2, Math.PI / 2.2);
      if (this.cameraMode === "first-person") {
        this.freeLookYaw = THREE.MathUtils.clamp(this.freeLookYaw, -Math.PI * 0.72, Math.PI * 0.72);
      }
    } else {
      this.freeLookYaw += (0 - this.freeLookYaw) * dt * 8.0;
      this.freeLookPitch += (0 - this.freeLookPitch) * dt * 8.0;
    }

    if (this.cameraMode === "bombsight") {
      const ckEntry3 = this.cockpitStateMap.get(playerPilotId);
      if (ckEntry3) ckEntry3.group.visible = false;
      pGroup.visible = false;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      const mountBasis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0)
      );
      const mountQuaternion = new THREE.Quaternion().setFromRotationMatrix(mountBasis);
      const cameraPosition = pGroup.position
        .clone()
        .add(new THREE.Vector3(0, -1.45, 0.65).applyQuaternion(pGroup.quaternion));

      this.camera.position.copy(cameraPosition);
      this.camera.quaternion.copy(pGroup.quaternion).multiply(mountQuaternion).normalize();
    } else if (this.cameraMode === "first-person") {
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, true);

      const ckEntry = this.cockpitStateMap.get(playerPilotId);
      const localCockpitEye = ckEntry?.eyeLocal.clone()
        ?? new THREE.Vector3(...(cameraDef?.cockpitEye ?? [0, 1.15, 1.6]));
      const cockpitPosition = localCockpitEye
        .clone()
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);

      this.camera.position.copy(cockpitPosition);
      const lightPosition = localCockpitEye
        .clone()
        .add(new THREE.Vector3(0, 0.12, 0.16))
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);
      this.cockpitLight.position.copy(lightPosition);

      if (ckEntry) {
        ckEntry.group.visible = true;
        const speed = Math.sqrt(playerPilot.vx ** 2 + playerPilot.vy ** 2 + playerPilot.vz ** 2);
        const speedNorm = Math.min(speed / 600, 1.0);
        const altNorm = Math.min(playerPilot.y / 14000, 1.0);
        const euler = new THREE.Euler().setFromQuaternion(pGroup.quaternion, "YXZ");
        const headingNorm = (((euler.y / (Math.PI * 2)) % 1) + 1) % 1;
        ckEntry.updateLive(
          speedNorm, altNorm, headingNorm, playerPilot.throttle, euler.x, euler.z,
          playerPilot.gearDeployed,
          playerPilot.flaps !== "up",
          playerPilot.airbrakeDeployed,
          playerPilot.damage.engine < 0.5
        );
      }

      const localRigidRot = pGroup.quaternion.clone();
      const freeLookRot = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.freeLookPitch, this.freeLookYaw, 0, "YXZ")
      );
      const combinedRot = localRigidRot.clone().multiply(freeLookRot);

      const lookDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedRot).normalize();
      const lookTarget = cockpitPosition.clone().addScaledVector(lookDir, 250);

      const rotatedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(combinedRot).normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(lookTarget);
    } else {
      const ckEntry2 = this.cockpitStateMap.get(playerPilotId);
      if (ckEntry2) ckEntry2.group.visible = false;
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      const defaultOffset = new THREE.Vector3(0, this.targetCameraOffset.y, -this.targetCameraOffset.z);

      const freeLookRot = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.freeLookPitch, this.freeLookYaw, 0, "YXZ")
      );
      const rotatedOffset = defaultOffset.clone().applyQuaternion(freeLookRot);

      // Stable roll-free quaternion construction using vector math to avoid gimbal lock.
      // We align the local Z-axis (forward) with the aircraft's forward direction,
      // and force the local X-axis (right/wings) to be horizontal/perpendicular to world up.
      const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(pGroup.quaternion).normalize();
      const rightVec = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forwardVec).normalize();
      
      // Handle the vertical climb/dive singularity
      if (rightVec.lengthSq() < 1e-4) {
        // Fallback: project aircraft's local right onto the horizontal plane
        rightVec.copy(new THREE.Vector3(1, 0, 0).applyQuaternion(pGroup.quaternion));
        rightVec.y = 0;
        rightVec.normalize();
        if (rightVec.lengthSq() < 1e-4) {
          rightVec.set(1, 0, 0); // Absolute fallback
        }
      }
      
      const upVec = new THREE.Vector3().crossVectors(forwardVec, rightVec).normalize();
      const rollFreeMatrix = new THREE.Matrix4().makeBasis(rightVec, upVec, forwardVec);
      const rollFreeQuat = new THREE.Quaternion().setFromRotationMatrix(rollFreeMatrix);

      const worldOffset = rotatedOffset.clone().applyQuaternion(rollFreeQuat);

      const targetCamPos = pGroup.position.clone().add(worldOffset);
      if (this.cameraModeTransitionPending) {
        this.camera.position.copy(targetCamPos);
      } else {
        this.camera.position.lerp(targetCamPos, Math.min(1, dt * 7.5));
      }

      const defaultLookDir = new THREE.Vector3(0, 0, 1);
      const rotatedLookDir = defaultLookDir.clone().applyQuaternion(freeLookRot);
      const worldLookDir = rotatedLookDir.clone().applyQuaternion(rollFreeQuat).normalize();
      const lookTarget = pGroup.position.clone().addScaledVector(worldLookDir, 150);

      if (this.cameraModeTransitionPending) {
        this.cameraLookAtTarget.copy(lookTarget);
      } else {
        this.cameraLookAtTarget.lerp(lookTarget, Math.min(1, dt * 9.0));
      }

      const rotatedUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(freeLookRot)
        .applyQuaternion(rollFreeQuat)
        .normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(this.cameraLookAtTarget);
    }

    this.cameraModeTransitionPending = false;

    this.cameraShakeTime += dt;
    const shakeKmph = new THREE.Vector3(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;
    const speedBuffet = THREE.MathUtils.clamp((shakeKmph - 500) / 250, 0, 1);
    const stallBuffet = THREE.MathUtils.clamp(playerPilot.stallSeverity ?? 0, 0, 1);
    const t = this.cameraShakeTime;
    const shakeX = Math.sin(t * 18.7) * Math.sin(t * 6.3);
    const shakeY = Math.sin(t * 24.1 + 0.9) * Math.sin(t * 4.9);

    if (this.cameraMode === "first-person") {
      // The pilot, camera, and cockpit are one rigid aircraft-relative frame.
      // Turbulence therefore disturbs the outside reference/reflector sight,
      // not the nearby tub and panel geometry around the pilot.
      const sightBuffet = Math.min(1.5, speedBuffet * 0.65 + stallBuffet);
      this.reticleTurbulenceX = shakeX * sightBuffet * 1.15;
      this.reticleTurbulenceY = shakeY * sightBuffet * 0.90;
    } else {
      this.reticleTurbulenceX = 0;
      this.reticleTurbulenceY = 0;
      const shakeStrength = speedBuffet * 0.1;
      const dx = shakeX * shakeStrength;
      const dy = shakeY * shakeStrength;
      const shakeLocal = new THREE.Vector3(dx, dy, 0).applyQuaternion(pGroup.quaternion);
      this.camera.position.add(shakeLocal);
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

      const terrainHeight = getTerrainHeight(position.x, position.z, this.mapDef.id).height;
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
    group.traverse((child) => {
      const isPropeller = child.userData.role === "propeller" || (child.userData.tags && child.userData.tags.includes("spinZ"));
      const isHidden = hiddenBlockIds.has(child.userData.blockId) || isPropeller;
      if (!isHidden) return;

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

      anchor.traverse((mesh) => {
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.color.setHex(color);
        }
      });
    }
  }

  private _leadEls: {
    target: HTMLElement;
    lead: HTMLElement;
    distance: HTMLElement;
    dot: HTMLElement | null;
  } | null = null;

  private syncLeadHud() {
    if (!this._leadEls) {
      const target = document.getElementById("target-marker-box");
      const lead = document.getElementById("target-lead-dot-indicator");
      const distance = document.getElementById("target-lead-distance");
      if (target && lead && distance) {
        this._leadEls = {
          target,
          lead,
          distance,
          dot: document.getElementById("target-lead-center-dot")
        };
      }
    }
    if (!this._leadEls) return;
    const { target, lead, distance, dot } = this._leadEls;
    const ind = this.leadIndicator2D;
    if (!ind) {
      target.style.opacity = "0";
      lead.style.opacity = "0";
      return;
    }
    const tx = Math.max(0, Math.min(100, ind.x));
    const ty = Math.max(0, Math.min(100, ind.y));
    const lx = Math.max(0, Math.min(100, ind.sX));
    const ly = Math.max(0, Math.min(100, ind.sY));
    const scale = Math.max(0.5, Math.min(1.5, 650 / (ind.distance + 250)));
    target.style.opacity = "1";
    lead.style.opacity = "1";
    target.style.transform = `translate3d(${tx}vw,${ty}vh,0) translate3d(-50%,-50%,0)`;
    lead.style.transform = `translate3d(${lx}vw,${ly}vh,0) translate3d(-50%,-50%,0) scale(${scale})`;
    distance.textContent =
      ind.distance >= 1000
        ? `${(ind.distance / 1000).toFixed(1)}KM`
        : `${Math.floor(ind.distance)}M`;
    if (dot) dot.style.backgroundColor = ind.isBot ? "#94a3b8" : "#ef4444";
  }

  private syncCenterReticle(playerPilotId: string, aircraftId?: string) {
    const centerReticle = document.getElementById("center-reticle");
    if (!centerReticle) return;

    const pGroup = this.aircraftGroupMap.get(playerPilotId);
    if (!pGroup) {
      centerReticle.style.opacity = "0";
      return;
    }

    const cockpit = this.cockpitStateMap.get(playerPilotId);
    let reticleWorldPos: THREE.Vector3;
    if (this.cameraMode === "first-person" && cockpit) {
      reticleWorldPos = cockpit.sightAnchorLocal
        .clone()
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);
    } else {
      const ckDef = aircraftId ? getCockpitDef(aircraftId) : undefined;
      const acDef = aircraftId
        ? AIRCRAFT_DEFINITIONS.find(d => d.specs.id === aircraftId)
        : undefined;
      const convergenceM = acDef?.hardpoints.gunConvergenceM;
      if (ckDef && convergenceM !== undefined) {
        const targetLocal = new THREE.Vector3(...ckDef.eye)
          .addScaledVector(getSightRayLocal(ckDef), convergenceM);
        reticleWorldPos = targetLocal
          .applyQuaternion(pGroup.quaternion)
          .add(pGroup.position);
      } else {
        const forward = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(pGroup.quaternion)
          .normalize();
        reticleWorldPos = pGroup.position.clone().addScaledVector(forward, 250);
      }
    }
    const projected = reticleWorldPos.project(this.camera);

    if (projected.z <= 1.0) {
      const x = (projected.x * 0.5 + 0.5) * 100 + this.reticleTurbulenceX;
      const y = (-projected.y * 0.5 + 0.5) * 100 + this.reticleTurbulenceY;
      const cx = Math.max(-5, Math.min(105, x));
      const cy = Math.max(-5, Math.min(105, y));
      centerReticle.style.opacity = "0.9";
      centerReticle.style.transform = `translate3d(${cx}vw,${cy}vh,0) translate3d(-50%,-50%,0)`;
    } else {
      centerReticle.style.opacity = "0";
    }
  }
}
