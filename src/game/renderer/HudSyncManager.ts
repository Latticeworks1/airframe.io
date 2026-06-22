import * as THREE from "three";
import { LeadIndicatorInfo } from "../../types";
import { getCockpitDef } from "../content/aircraft/cockpitRegistry";
import { AIRCRAFT_DEFINITIONS } from "../content/aircraft/registry";
import { getSightRayLocal } from "../weaponConvergence";

export class HudSyncManager {
  private camera: THREE.Camera;
  private _leadEls: {
    target: HTMLElement;
    lead: HTMLElement;
    distance: HTMLElement;
    dot: HTMLElement | null;
  } | null = null;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  public syncLeadHud(leadIndicator2D: LeadIndicatorInfo | null) {
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
    const ind = leadIndicator2D;
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

  public syncCenterReticle(
    playerPilotId: string,
    aircraftId: string | undefined,
    cameraMode: string,
    reticleTurbulenceX: number,
    reticleTurbulenceY: number,
    aircraftGroupMap: Map<string, THREE.Group>,
    cockpitStateMap: Map<string, any>
  ) {
    const centerReticle = document.getElementById("center-reticle");
    if (!centerReticle) return;

    const pGroup = aircraftGroupMap.get(playerPilotId);
    if (!pGroup) {
      centerReticle.style.opacity = "0";
      return;
    }

    const cockpit = cockpitStateMap.get(playerPilotId);
    let reticleWorldPos: THREE.Vector3;
    if (cameraMode === "first-person" && cockpit) {
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
      const x = (projected.x * 0.5 + 0.5) * 100 + reticleTurbulenceX;
      const y = (-projected.y * 0.5 + 0.5) * 100 + reticleTurbulenceY;
      const cx = Math.max(-5, Math.min(105, x));
      const cy = Math.max(-5, Math.min(105, y));
      centerReticle.style.opacity = "0.9";
      centerReticle.style.transform = `translate3d(${cx}vw,${cy}vh,0) translate3d(-50%,-50%,0)`;
    } else {
      centerReticle.style.opacity = "0";
    }
  }
}
