import * as THREE from "three";
import { Pilot, InputFrame, CameraMode, BombSightInfo, WeaponType } from "../../types";
import { AIRCRAFT_DEFINITIONS } from "../content/aircraft/registry";
import { getTerrainHeight } from "../terrainModel";
import { getProjectileReleaseState } from "../projectileSystem";
import { MapDefinition } from "../content/maps/mapTypes";
import { cockpitPanelState } from "../cockpitPanelState";

export class CameraManager {
  public camera: THREE.PerspectiveCamera;
  public cockpitLight: THREE.PointLight | null;
  private mapDef: MapDefinition;

  public cameraMode: CameraMode = "third-person";
  public cameraModeTransitionPending = true;
  public freeLookYaw = 0;
  public freeLookPitch = 0;
  public cameraShakeTime = 0;
  public reticleTurbulenceX = 0;
  public reticleTurbulenceY = 0;
  public bombSightInfo: BombSightInfo | null = null;

  private targetCameraOffset = new THREE.Vector3(0, 5.5, 17);
  private cameraLookAtTarget = new THREE.Vector3();

  // Scratch objects reused every frame to avoid GC pressure.
  private _scratchV0 = new THREE.Vector3();
  private _scratchV1 = new THREE.Vector3();
  private _scratchV2 = new THREE.Vector3();
  private _scratchV3 = new THREE.Vector3();
  private _scratchQ0 = new THREE.Quaternion();
  private _scratchQ1 = new THREE.Quaternion();
  private _scratchE0 = new THREE.Euler();
  private _scratchM4 = new THREE.Matrix4();

  constructor(
    camera: THREE.PerspectiveCamera,
    cockpitLight: THREE.PointLight | null,
    mapDef: MapDefinition
  ) {
    this.camera = camera;
    this.cockpitLight = cockpitLight;
    this.mapDef = mapDef;
  }

  public setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;

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
  }

  public update(
    pilots: Pilot[],
    playerPilotId: string,
    inputFrame: InputFrame | undefined,
    dt: number,
    aircraftGroupMap: Map<string, THREE.Group>,
    cockpitStateMap: Map<string, any>
  ) {
    const playerPilot = pilots.find((p) => p.id === playerPilotId);
    if (!playerPilot) return;

    const pGroup = aircraftGroupMap.get(playerPilotId);
    if (!pGroup) return;

    const aircraftDef = AIRCRAFT_DEFINITIONS.find((definition) => definition.specs.id === playerPilot.aircraftId);
    const cameraDef = aircraftDef?.render.camera;
    const hiddenBlockIds = new Set(cameraDef?.hiddenBlockIds ?? ["canopy"]);

    const speedKmph = this._scratchV0.set(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;

    const firstPersonBaseFov = cameraDef?.firstPersonFov ?? 74;
    const firstPersonSpeedFov = THREE.MathUtils.clamp(((speedKmph - 250) / 250) * 4, 0, 4);
    const targetFov =
      this.cameraMode === "first-person"
        ? THREE.MathUtils.clamp(firstPersonBaseFov + firstPersonSpeedFov, 68, 80)
        : this.cameraMode === "bombsight"
        ? 52
        : THREE.MathUtils.clamp(65 + speedKmph / 28, 62, 92);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-3 * dt));

    // Snap camera near plane instantly to avoid weird slicing/sweeping effects through cockpit geometry
    this.camera.near =
      this.cameraMode === "third-person" ? 1 : this.cameraMode === "first-person" ? 0.04 : 0.25;

    const isFreeLookActive = !!(inputFrame && inputFrame.rightMouse);

    if (isFreeLookActive && inputFrame) {
      this.freeLookYaw += inputFrame.mouseDelta.x * 2.8;
      this.freeLookPitch -= inputFrame.mouseDelta.y * 2.1;
      this.freeLookPitch = THREE.MathUtils.clamp(this.freeLookPitch, -Math.PI / 2.2, Math.PI / 2.2);
      if (this.cameraMode === "first-person") {
        this.freeLookYaw = THREE.MathUtils.clamp(this.freeLookYaw, -Math.PI * 0.72, Math.PI * 0.72);
      }
    } else {
      const freeLookDecay = 1 - Math.exp(-8 * dt);
      this.freeLookYaw += (0 - this.freeLookYaw) * freeLookDecay;
      this.freeLookPitch += (0 - this.freeLookPitch) * freeLookDecay;
    }

    if (this.cameraMode === "bombsight") {
      cockpitPanelState.active = false;
      if (this.cockpitLight) this.cockpitLight.intensity = 0;
      const ckEntry3 = cockpitStateMap.get(playerPilotId);
      if (ckEntry3) ckEntry3.group.visible = false;
      pGroup.visible = false;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      this._scratchM4.makeBasis(
        this._scratchV0.set(-1, 0, 0),
        this._scratchV1.set(0, 0, 1),
        this._scratchV2.set(0, 1, 0)
      );
      const mountQuaternion = this._scratchQ0.setFromRotationMatrix(this._scratchM4);
      const cameraPosition = this._scratchV3
        .set(0, -1.45, 0.65)
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);

      this.camera.position.copy(cameraPosition);
      this.camera.quaternion.copy(pGroup.quaternion).multiply(mountQuaternion).normalize();
    } else if (this.cameraMode === "first-person") {
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, true);

      if (this.cockpitLight) this.cockpitLight.intensity = 4.5;

      const ckEntry = cockpitStateMap.get(playerPilotId);
      const eyeSrc = ckEntry?.eyeLocal ?? (cameraDef?.cockpitEye ? this._scratchV0.set(...cameraDef.cockpitEye) : this._scratchV0.set(0, 1.15, 1.6));
      const cockpitPosition = this._scratchV1
        .copy(eyeSrc)
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);

      this.camera.position.copy(cockpitPosition);
      const lightPosition = this._scratchV2
        .copy(eyeSrc)
        .add(this._scratchV3.set(0, 0.12, 0.16))
        .applyQuaternion(pGroup.quaternion)
        .add(pGroup.position);
      this.cockpitLight.position.copy(lightPosition);

      if (ckEntry) {
        ckEntry.group.visible = true;
        const speed = Math.sqrt(playerPilot.vx ** 2 + playerPilot.vy ** 2 + playerPilot.vz ** 2);
        const alt01 = Math.min(playerPilot.y / 14000, 1.0);
        const euler = this._scratchE0.setFromQuaternion(pGroup.quaternion, "YXZ");
        const heading01 = (((euler.y / (Math.PI * 2)) % 1) + 1) % 1;
        const wasActive = cockpitPanelState.active;
        const prevAlt = wasActive ? cockpitPanelState.alt01 : alt01;
        cockpitPanelState.active        = true;
        cockpitPanelState.speed01       = Math.min(speed / 600, 1.0);
        cockpitPanelState.vsi01         = THREE.MathUtils.clamp((alt01 - prevAlt) * 8, -1, 1);
        cockpitPanelState.alt01         = alt01;
        cockpitPanelState.heading01     = heading01;
        cockpitPanelState.throttle01    = playerPilot.throttle;
        cockpitPanelState.pitch_rad     = -euler.x;
        cockpitPanelState.roll_rad      = euler.z;
        cockpitPanelState.gearDown      = playerPilot.gearDeployed;
        cockpitPanelState.flapsOut      = playerPilot.flaps !== "up";
        cockpitPanelState.airbrakeOn    = playerPilot.airbrakeDeployed;
        cockpitPanelState.engineDamaged = playerPilot.damage.engine < 0.5;
      }

      const freeLookRot = this._scratchQ0.setFromEuler(
        this._scratchE0.set(this.freeLookPitch, this.freeLookYaw, 0, "YXZ")
      );
      const combinedRot = this._scratchQ1.copy(pGroup.quaternion).multiply(freeLookRot);

      const lookDir = this._scratchV0.set(0, 0, 1).applyQuaternion(combinedRot).normalize();
      const lookTarget = this._scratchV2.copy(cockpitPosition).addScaledVector(lookDir, 250);

      const rotatedUp = this._scratchV3.set(0, 1, 0).applyQuaternion(combinedRot).normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(lookTarget);
    } else {
      cockpitPanelState.active = false;
      if (this.cockpitLight) this.cockpitLight.intensity = 0;
      const ckEntry2 = cockpitStateMap.get(playerPilotId);
      if (ckEntry2) ckEntry2.group.visible = false;
      pGroup.visible = true;
      this.setFirstPersonBlockVisibility(pGroup, playerPilot, hiddenBlockIds, false);

      const freeLookRot = this._scratchQ0.setFromEuler(
        this._scratchE0.set(this.freeLookPitch, this.freeLookYaw, 0, "YXZ")
      );
      const rotatedOffset = this._scratchV0
        .set(0, this.targetCameraOffset.y, -this.targetCameraOffset.z)
        .applyQuaternion(freeLookRot);

      // Stable roll-free quaternion: align forward with aircraft nose, keep X horizontal.
      const forwardVec = this._scratchV1.set(0, 0, 1).applyQuaternion(pGroup.quaternion).normalize();
      const rightVec = this._scratchV2.crossVectors(this._scratchV3.set(0, 1, 0), forwardVec).normalize();

      if (rightVec.lengthSq() < 1e-4) {
        rightVec.set(1, 0, 0).applyQuaternion(pGroup.quaternion);
        rightVec.y = 0;
        rightVec.normalize();
        if (rightVec.lengthSq() < 1e-4) rightVec.set(1, 0, 0);
      }

      const upVec = this._scratchV3.crossVectors(forwardVec, rightVec).normalize();
      const rollFreeQuat = this._scratchQ1.setFromRotationMatrix(
        this._scratchM4.makeBasis(rightVec, upVec, forwardVec)
      );

      const targetCamPos = this._scratchV3
        .copy(rotatedOffset)
        .applyQuaternion(rollFreeQuat)
        .add(pGroup.position);

      if (this.cameraModeTransitionPending) {
        this.camera.position.copy(targetCamPos);
      } else {
        this.camera.position.lerp(targetCamPos, 1 - Math.exp(-7.5 * dt));
      }

      const worldLookDir = this._scratchV0.set(0, 0, 1).applyQuaternion(freeLookRot).applyQuaternion(rollFreeQuat).normalize();
      const lookTarget = this._scratchV2.copy(pGroup.position).addScaledVector(worldLookDir, 150);

      if (this.cameraModeTransitionPending) {
        this.cameraLookAtTarget.copy(lookTarget);
      } else {
        this.cameraLookAtTarget.lerp(lookTarget, 1 - Math.exp(-9 * dt));
      }

      const rotatedUp = this._scratchV1.set(0, 1, 0)
        .applyQuaternion(freeLookRot)
        .applyQuaternion(rollFreeQuat)
        .normalize();
      this.camera.up.copy(rotatedUp);
      this.camera.lookAt(this.cameraLookAtTarget);
    }

    this.cameraModeTransitionPending = false;

    this.cameraShakeTime += dt;
    const shakeKmph = this._scratchV0.set(playerPilot.vx, playerPilot.vy, playerPilot.vz).length() * 3.6;
    const speedBuffet = THREE.MathUtils.clamp((shakeKmph - 500) / 250, 0, 1);
    const stallBuffet = THREE.MathUtils.clamp(playerPilot.stallSeverity ?? 0, 0, 1);
    const t = this.cameraShakeTime;
    const shakeX = Math.sin(t * 18.7) * Math.sin(t * 6.3);
    const shakeY = Math.sin(t * 24.1 + 0.9) * Math.sin(t * 4.9);

    if (this.cameraMode === "first-person") {
      // Reticle jitter is the sole expression of stall buffet in FPV — the cockpit interior
      // stays visually stable, matching the physical reality that you ride with the airframe.
      const sightBuffet = Math.min(1.0, speedBuffet * 0.35 + stallBuffet * 0.45);
      this.reticleTurbulenceX = shakeX * sightBuffet * 0.28;
      this.reticleTurbulenceY = shakeY * sightBuffet * 0.22;
    } else {
      this.reticleTurbulenceX = 0;
      this.reticleTurbulenceY = 0;
      const shakeStrength = speedBuffet * 0.1 + stallBuffet * 0.08;
      const dx = shakeX * shakeStrength;
      const dy = shakeY * shakeStrength;
      const shakeLocal = this._scratchV0.set(dx, dy, 0).applyQuaternion(pGroup.quaternion);
      this.camera.position.add(shakeLocal);
    }

    this.camera.updateProjectionMatrix();
    this.updateBombSightPrediction(playerPilot);
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
}

