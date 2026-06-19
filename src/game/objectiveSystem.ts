/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3 } from "three";
import { Pilot, SkyZone } from "../types";

export class ObjectiveSystem {
  public static updateCaptureZones(
    dt: number,
    skyZones: SkyZone[],
    pilots: Pilot[],
    onGainScore: (team: 1 | 2, amount: number) => void,
    isMultiplayer: boolean,
    isHost: boolean
  ) {
    if (isMultiplayer && !isHost) {
      return;
    }

    skyZones.forEach(z => {
      const zonePos = new Vector3(z.x, z.y, z.z);
      let t1Count = 0;
      let t2Count = 0;

      pilots.forEach(p => {
        if (p.damage.fuselage <= 0) return;

        const d = zonePos.distanceTo(new Vector3(p.x, p.y, p.z));

        if (d < z.radius) {
          if (p.team === 1) t1Count++;
          if (p.team === 2) t2Count++;
        }
      });

      const delta = t1Count - t2Count;

      if (delta > 0) {
        z.captureProgress = Math.min(100, z.captureProgress + dt * 15 * delta);

        if (z.captureProgress >= 100) {
          z.owningTeam = 1;
        }
      } else if (delta < 0) {
        z.captureProgress = Math.max(-100, z.captureProgress + dt * 15 * delta);

        if (z.captureProgress <= -100) {
          z.owningTeam = 2;
        }
      }

      if (z.owningTeam === 1) {
        onGainScore(1, 3 * dt);
      } else if (z.owningTeam === 2) {
        onGainScore(2, 3 * dt);
      }
    });
  }
}
