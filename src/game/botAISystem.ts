/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3 } from "three";
import { Pilot, GroundTarget, SkyZone } from "../types";
import { physical, locomotive, destructible, control } from "../types/components";
import { getForwardVector } from "./math";

function pRepairTick(bot: Pilot, dt: number) {
  const dm = destructible(bot.entity).damageModel!;
  dm.engine = Math.min(1.0, dm.engine + dt * 0.25);
  dm.leftWing = Math.min(1.0, dm.leftWing + dt * 0.25);
  dm.rightWing = Math.min(1.0, dm.rightWing + dt * 0.25);
  dm.tail = Math.min(1.0, dm.tail + dt * 0.2);
  dm.cockpit = Math.min(1.0, dm.cockpit + dt * 0.15);
  dm.fuelTank = Math.min(1.0, dm.fuelTank + dt * 0.2);
  dm.fuselage = Math.min(1.0, dm.fuselage + dt * 0.1);
  dm.hasFire = false;
  dm.hasOilLeak = false;
}

export class BotAISystem {
  public static runAIConsensus(
    bot: Pilot,
    dt: number,
    pilots: Pilot[],
    groundTargets: GroundTarget[],
    skyZones: SkyZone[],
    handleWeaponFiring: (pilot: Pilot, triggerPrimary: boolean, triggerSecondary: boolean, dt: number) => void,
    mapRadius: number = 6000
  ) {
    const botPhys = physical(bot.entity);
    const botLoco = locomotive(bot.entity);
    const botCtrl = control(bot.entity);
    const botDm = destructible(bot.entity).damageModel!;
    const botAi = botCtrl.aiState;
    if (!botAi) return;

    botAi.timer -= dt;

    const botPos = new Vector3(botPhys.x, botPhys.y, botPhys.z);

    // Map Boundary turn-back logic for bots
    const distFromCenter = Math.sqrt(botPhys.x * botPhys.x + botPhys.z * botPhys.z);
    if (distFromCenter > mapRadius * 0.78) {
      botAi.behavior = "patrol";
      botAi.destinationX = -botPhys.x * 0.2;
      botAi.destinationY = 550;
      botAi.destinationZ = -botPhys.z * 0.2;
      botLoco.throttle = 1.0;
      return;
    }
    const opponentTeam = bot.team === 1 ? 2 : 1;
    const enemies = pilots.filter(
      p => p.team === opponentTeam && destructible(p.entity).damageModel!.fuselage > 0
    );

    if (botAi.timer <= 0) {
      botAi.timer = 1.5 + Math.random() * 2.0;

      const health = (botDm.leftWing + botDm.rightWing + botDm.engine) / 3;

      if (health < 0.45 && botAi.behavior !== "rtb") {
        botAi.behavior = "rtb";
        botAi.destinationX = bot.team === 1 ? -14000 : 14000;
        botAi.destinationY = 600;
        botAi.destinationZ = bot.team === 1 ? -8000 : 8000;
        return;
      }

      if (bot.specs.class === "Attacker") {
        const enemyGrounds = groundTargets.filter(
          t => !t.isDead && t.team !== bot.team
        );

        if (enemyGrounds.length > 0 && Math.random() < 0.7) {
          const tgt = enemyGrounds[Math.floor(Math.random() * enemyGrounds.length)];
          botAi.behavior = "bombing";
          botAi.destinationX = tgt.x;
          botAi.destinationY = tgt.y + 120;
          botAi.destinationZ = tgt.z;
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

        if (closest && minDist < 14000) {
          botAi.behavior = "dogfight";
          botAi.targetId = closest.id;
        } else {
          botAi.behavior = "patrol";
          botAi.targetId = null;
        }
      } else {
        botAi.behavior = "patrol";
      }
    }

    if (botAi.behavior === "dogfight" && botAi.targetId) {
      const target = pilots.find(p => p.id === botAi!.targetId);

      if (target && destructible(target.entity).damageModel!.fuselage > 0) {
        const tPhys = physical(target.entity);
        const tPos = new Vector3(tPhys.x, tPhys.y, tPhys.z);
        const tVel = new Vector3(tPhys.vx, tPhys.vy, tPhys.vz);
        const dist = botPos.distanceTo(tPos);
        const localForward = getForwardVector(bot);

        const toTarget = tPos.clone().sub(botPos).normalize();
        const targetOnTail = toTarget.dot(localForward) < -0.5 && dist < 800;

        if (targetOnTail) {
          const t = Date.now() / 1000;
          const juke = Math.sin(t * 3.7) * 600;
          botAi.destinationX = botPhys.x + localForward.z * juke;
          botAi.destinationY = Math.max(250, botPhys.y + 400);
          botAi.destinationZ = botPhys.z - localForward.x * juke;
          botLoco.throttle = Math.min(1.0, botLoco.throttle + dt * 0.8);
        } else {
          const bulletSpeed = 820;
          const timeToTgt = dist / bulletSpeed;
          const leadTargetPos = tPos.clone().addScaledVector(tVel, timeToTgt);

          const safeLeadY = Math.max(leadTargetPos.y, 180);
          botAi.destinationX = leadTargetPos.x;
          botAi.destinationY = botPhys.y < 150 ? Math.max(safeLeadY, botPhys.y + 200) : safeLeadY;
          botAi.destinationZ = leadTargetPos.z;

          const bearingAngle = leadTargetPos.clone().sub(botPos).normalize();
          const aimDot = bearingAngle.dot(localForward);

          if (dist > 1200) {
            botLoco.throttle = Math.min(1.0, botLoco.throttle + dt * 0.5);
          } else if (aimDot < 0.85) {
            botLoco.throttle = Math.max(0.65, botLoco.throttle - dt * 0.3);
          } else {
            botLoco.throttle = Math.min(1.0, botLoco.throttle + dt * 0.4);
          }

          if (aimDot > 0.93 && dist < 1200) {
            handleWeaponFiring(bot, true, false, dt);
          }
        }
      } else {
        botAi.behavior = "patrol";
      }

      return;
    }

    if (botAi.behavior === "patrol") {
      const seed = bot.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const angle = (seed % 8) * (Math.PI / 4);
      const patrolR = 4000 + (seed % 3) * 2000;
      const t = Date.now() / 8000;
      botAi.destinationX = Math.cos(angle + t) * patrolR;
      botAi.destinationY = 400 + (seed % 5) * 80;
      botAi.destinationZ = Math.sin(angle + t) * patrolR;
      botLoco.throttle = 0.75;

      return;
    }

    if (botAi.behavior === "bombing") {
      if (botPhys.y < 110) {
        botAi.destinationY = 350;
        botLoco.throttle = 1.0;
      }

      const dest = new Vector3(
        botAi.destinationX,
        botAi.destinationY,
        botAi.destinationZ
      );

      const d = botPos.distanceTo(dest);

      if (d < 500 && Math.random() < 0.12) {
        handleWeaponFiring(bot, false, true, dt);
      }

      return;
    }

    if (botAi.behavior === "rtb") {
      const dest = new Vector3(
        botAi.destinationX,
        botAi.destinationY,
        botAi.destinationZ
      );

      const d = botPos.distanceTo(dest);

      if (d < 50) {
        botPhys.vx = 0;
        botPhys.vy = 0;
        botPhys.vz = 0;

        pRepairTick(bot, dt);

        if (botDm.engine > 0.95 && botDm.leftWing > 0.95) {
          botAi.behavior = "patrol";
        }
      }
    }
  }
}
