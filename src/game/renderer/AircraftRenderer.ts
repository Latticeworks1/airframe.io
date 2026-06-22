/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Pilot, WeaponType, CameraMode } from "../../types";
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
} from "../voxelMesh";
import { getVoxelDef } from "../content/aircraft/voxelRegistry";
import { buildCockpitMesh, type CockpitState } from "../cockpitMesh";
import { getCockpitDef } from "../content/aircraft/cockpitRegistry";
import { generateProceduralAircraft } from "../content/aircraft/aircraftBuilder";

export class AircraftRenderer {
  private scene: THREE.Scene;
  public groupMap = new Map<string, THREE.Group>();
  public voxelStateMap = new Map<string, VoxelMeshState>();
  public cockpitStateMap = new Map<string, CockpitState>();
  private createSmokeTail: (x: number, y: number, z: number, colorHex?: number, scale?: number) => void;

  constructor(
    scene: THREE.Scene,
    createSmokeTail: (x: number, y: number, z: number, colorHex?: number, scale?: number) => void
  ) {
    this.scene = scene;
    this.createSmokeTail = createSmokeTail;
  }

  public updateFirstPersonState(playerPilotId: string, isFirstPerson: boolean) {
    const voxState = this.voxelStateMap.get(playerPilotId);
    const hasCanvas = this.cockpitStateMap.has(playerPilotId);
    if (voxState) {
      if (voxState.spinMesh) voxState.spinMesh.visible = !isFirstPerson;
      if (hasCanvas) {
        voxState.mesh.visible = true;
        setCockpitVisible(voxState, !isFirstPerson);
      } else {
        setFPVMaterial(voxState, isFirstPerson);
      }
    }
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

  public sync(
    pilots: Pilot[],
    playerPilotId: string,
    cameraMode: CameraMode,
    dt: number
  ) {
    const activePilotIds = new Set<string>();

    for (const p of pilots) {
      activePilotIds.add(p.id);

      let group = this.groupMap.get(p.id);

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
        this.groupMap.set(p.id, group);
      }

      group.position.set(p.x, p.y, p.z);
      group.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, "YXZ"));

      const voxState = this.voxelStateMap.get(p.id);
      if (voxState) {
        animateSpinCells(voxState, dt, p.throttle);
        if (p.id === playerPilotId) {
          const inFPV = cameraMode === "first-person";
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

      if (!voxState) {
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
      }

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

    for (const cachedId of Array.from(this.groupMap.keys())) {
      if (!activePilotIds.has(cachedId)) {
        const mesh = this.groupMap.get(cachedId);
        if (mesh) this.scene.remove(mesh);
        this.groupMap.delete(cachedId);
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
  }

  public dispose() {
    for (const cachedId of Array.from(this.groupMap.keys())) {
      const mesh = this.groupMap.get(cachedId);
      if (mesh) this.scene.remove(mesh);
      const voxState = this.voxelStateMap.get(cachedId);
      if (voxState) disposeVoxelMesh(voxState);
      const ckEntry = this.cockpitStateMap.get(cachedId);
      if (ckEntry) ckEntry.dispose();
    }
    this.groupMap.clear();
    this.voxelStateMap.clear();
    this.cockpitStateMap.clear();
  }
}
