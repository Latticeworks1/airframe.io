/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3 } from "three";
import { Pilot, GroundTarget, SkyZone } from "../types";
import { getForwardVector } from "./math";

function pRepairTick(bot: Pilot, dt: number) {
  bot.damage.engine = Math.min(1.0, bot.damage.engine + dt * 0.25);
  bot.damage.leftWing = Math.min(1.0, bot.damage.leftWing + dt * 0.25);
  bot.damage.rightWing = Math.min(1.0, bot.damage.rightWing + dt * 0.25);
  bot.damage.tail = Math.min(1.0, bot.damage.tail + dt * 0.2);
  bot.damage.cockpit = Math.min(1.0, bot.damage.cockpit + dt * 0.15);
  bot.damage.fuelTank = Math.min(1.0, bot.damage.fuelTank + dt * 0.2);
  bot.damage.fuselage = Math.min(1.0, bot.damage.fuselage + dt * 0.1);
  bot.damage.hasFire = false;
  bot.damage.hasOilLeak = false;
}

export class BotAISystem {
  public static runAIConsensus(
    bot: Pilot,
    dt: number,
    pilots: Pilot[],
    groundTargets: GroundTarget[],
    skyZones: SkyZone[],
    handleWeaponFiring: (pilot: Pilot, triggerPrimary: boolean, triggerSecondary: boolean, dt: number) => void
  ) {
    if (!bot.aiState) return;

    bot.aiState.timer -= dt;

    const botPos = new Vector3(bot.x, bot.y, bot.z);
    const opponentTeam = bot.team === 1 ? 2 : 1;
    const enemies = pilots.filter(
      p => p.team === opponentTeam && p.damage.fuselage > 0
    );

    if (bot.aiState.timer <= 0) {
      bot.aiState.timer = 1.5 + Math.random() * 2.0;

      const health =
        (bot.damage.leftWing + bot.damage.rightWing + bot.damage.engine) / 3;

      if (health < 0.45 && bot.aiState.behavior !== "rtb") {
        bot.aiState.behavior = "rtb";
        bot.aiState.destinationX = bot.team === 1 ? -4000 : 4000;
        bot.aiState.destinationY = 280;
        bot.aiState.destinationZ = bot.team === 1 ? -3000 : 3000;
        return;
      }

      if (bot.specs.class === "Attacker") {
        const enemyGrounds = groundTargets.filter(
          t => !t.isDead && t.team !== bot.team
        );

        if (enemyGrounds.length > 0 && Math.random() < 0.7) {
          const tgt = enemyGrounds[Math.floor(Math.random() * enemyGrounds.length)];
          bot.aiState.behavior = "bombing";
          bot.aiState.destinationX = tgt.x;
          bot.aiState.destinationY = tgt.y + 120;
          bot.aiState.destinationZ = tgt.z;
          return;
        }
      }

      if (enemies.length > 0) {
        let closest: Pilot | null = null;
        let minDist = Infinity;

        enemies.forEach(e => {
          const d = botPos.distanceTo(new Vector3(e.x, e.y, e.z));

          if (d < minDist) {
            minDist = d;
            closest = e;
          }
        });

        if (closest && minDist < 8000) {
          bot.aiState.behavior = "dogfight";
          bot.aiState.targetId = closest.id;
        } else {
          bot.aiState.behavior = "patrol";
          bot.aiState.targetId = null;
        }
      } else {
        bot.aiState.behavior = "patrol";
      }
    }

    if (bot.aiState.behavior === "dogfight" && bot.aiState.targetId) {
      const target = pilots.find(p => p.id === bot.aiState!.targetId);

      if (target && target.damage.fuselage > 0) {
        const tPos = new Vector3(target.x, target.y, target.z);
        const tVel = new Vector3(target.vx, target.vy, target.vz);
        const dist = botPos.distanceTo(tPos);

        const bulletSpeed = 800;
        const timeToTgt = dist / bulletSpeed;
        const leadTargetPos = tPos.clone().addScaledVector(tVel, timeToTgt);

        // Enforce a terrain floor — bots must not dive into the ground chasing.
        const safeLeadY = Math.max(leadTargetPos.y, 180);
        bot.aiState.destinationX = leadTargetPos.x;
        bot.aiState.destinationY = bot.y < 150 ? Math.max(safeLeadY, bot.y + 200) : safeLeadY;
        bot.aiState.destinationZ = leadTargetPos.z;

        const bearingAngle = leadTargetPos.clone().sub(botPos).normalize();
        const localForward = getForwardVector(bot);
        const aimDot = bearingAngle.dot(localForward);

        // Keep speed high enough to pursue across large map distances.
        // Only bleed throttle when very close and already lined up.
        if (dist > 1200) {
          bot.throttle = Math.min(1.0, bot.throttle + dt * 0.5);
        } else if (aimDot < 0.85) {
          bot.throttle = Math.max(0.65, bot.throttle - dt * 0.3);
        } else {
          bot.throttle = Math.min(1.0, bot.throttle + dt * 0.4);
        }

        if (aimDot > 0.93 && dist < 1200) {
          handleWeaponFiring(bot, true, false, dt);
        }
      } else {
        bot.aiState.behavior = "patrol";
      }

      return;
    }

    if (bot.aiState.behavior === "patrol") {
      if (skyZones.length > 0) {
        const activeZone = skyZones[0];
        bot.aiState.destinationX = activeZone.x + Math.sin(Date.now() / 1500) * 150;
        bot.aiState.destinationY = activeZone.y + 80;
        bot.aiState.destinationZ = activeZone.z + Math.cos(Date.now() / 1500) * 150;
        bot.throttle = 0.8;
      } else {
        bot.aiState.destinationX = 0;
        bot.aiState.destinationY = 500;
        bot.aiState.destinationZ = 0;
      }

      return;
    }

    if (bot.aiState.behavior === "bombing") {
      if (bot.y < 110) {
        bot.aiState.destinationY = 350;
        bot.throttle = 1.0;
      }

      const dest = new Vector3(
        bot.aiState.destinationX,
        bot.aiState.destinationY,
        bot.aiState.destinationZ
      );

      const d = botPos.distanceTo(dest);

      if (d < 500 && Math.random() < 0.12) {
        handleWeaponFiring(bot, false, true, dt);
      }

      return;
    }

    if (bot.aiState.behavior === "rtb") {
      const dest = new Vector3(
        bot.aiState.destinationX,
        bot.aiState.destinationY,
        bot.aiState.destinationZ
      );

      const d = botPos.distanceTo(dest);

      if (d < 50) {
        bot.vx = 0;
        bot.vy = 0;
        bot.vz = 0;

        pRepairTick(bot, dt);

        if (bot.damage.engine > 0.95 && bot.damage.leftWing > 0.95) {
          bot.aiState.behavior = "patrol";
        }
      }
    }
  }
}
