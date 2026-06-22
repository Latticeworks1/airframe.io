import * as THREE from "three";
import { LeadIndicatorInfo, Pilot, WeaponType } from "../../types";
import { getCockpitDef } from "../content/aircraft/cockpitRegistry";
import { AIRCRAFT_DEFINITIONS } from "../content/aircraft/registry";
import { getSightRayLocal } from "../weaponConvergence";
import { WEAPON_SPECS_MAP } from "../content/weapons/weaponData";

export class HudSyncManager {
  private camera: THREE.Camera;
  public leadIndicator2D: LeadIndicatorInfo | null = null;
  private _leadEls: {
    target: HTMLElement;
    lead: HTMLElement;
    distance: HTMLElement;
    dot: HTMLElement | null;
  } | null = null;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  public syncLeadHud(
    pilots: Pilot[],
    playerPilotId: string,
    aircraftGroupMap: Map<string, THREE.Group>
  ) {
    const playerPilot = pilots.find((p) => p.id === playerPilotId);
    let lockedAdv: Pilot | null = null;
    let bestDot = 0.94;
    let lockedDist = 0;

    if (playerPilot) {
      const oppTeam = playerPilot.team === 1 ? 2 : 1;
      const adversaries = pilots.filter((p) => p.team === oppTeam && p.damage.fuselage > 0);
      const pGroup = aircraftGroupMap.get(playerPilotId);

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
