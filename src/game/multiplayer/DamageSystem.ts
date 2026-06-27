import { Pilot, WeaponType } from "../../types";
import { WEAPON_SPECS_MAP } from "../aircraftData";
import { destructible } from "../../types/components";
import { applyComponentDamage } from "../flightModel";
import { Vector3 } from "three";

export class DamageSystem {
  public registerKill(
    killerId: string, 
    victimId: string, 
    weapon: string,
    pilots: Map<string, Pilot>,
    statePlayers: any,
    addTeamScore: (team: number, points: number) => void,
    broadcast: (type: string, msg: any) => void,
    scheduleRespawn: (id: string) => void
  ) {
    const killer = pilots.get(killerId);
    const victim = pilots.get(victimId);
    if (!victim) return;

    victim.deaths++;
    const vState = statePlayers.get(victimId);
    if (vState) vState.deaths++;

    let killerName = "System";
    if (killer) {
      killer.kills++;
      killer.score += 300;
      
      const kState = statePlayers.get(killerId);
      if (kState) {
        kState.kills++;
        kState.score += 300;
      }
      killerName = killer.name;
      addTeamScore(killer.team, 100);
    }

    broadcast("kill_confirmed", {
      killerId,
      victimId,
      killerName,
      victimName: victim.name,
      weapon
    });

    scheduleRespawn(victimId);
  }

  public applyDamage(
    pilot: Pilot,
    amount: number,
    hitZone: string,
    weapon: string,
    ownerId: string,
    registerKillFn: (k: string, v: string, w: string) => void
  ) {
    const spec = WEAPON_SPECS_MAP[weapon as WeaponType];
    const baseDamage = spec?.damage ?? 10;
    const finalDamage = baseDamage * amount;

    applyComponentDamage(pilot, finalDamage, weapon, hitZone);

    if (destructible(pilot.entity).damageModel!.fuselage <= 0 && !destructible(pilot.entity).isDead) {
      destructible(pilot.entity).isDead = true;
      registerKillFn(ownerId, pilot.id, weapon);
    }
  }

  public triggerSplashDamage(
    pos: Vector3,
    ownerId: string,
    team: number,
    type: WeaponType,
    pilots: Map<string, Pilot>,
    registerKillFn: (k: string, v: string, w: string) => void
  ) {
    const spec = WEAPON_SPECS_MAP[type];
    if (!spec || !spec.splashRadius) return;
    const radius = spec.splashRadius;
    const baseSplash = spec.damage * 0.8; 

    for (const pilot of pilots.values()) {
      if (pilot.team === team) continue;
      if (destructible(pilot.entity).isDead) continue;
      if (pilot.invulnerableTimer && pilot.invulnerableTimer > 0) continue;

      const dist = pos.distanceTo(new Vector3(pilot.x, pilot.y, pilot.z));
      if (dist <= radius) {
        const falloff = 1.0 - (dist / radius);
        const relativeOffset = new Vector3(0, -0.5, 0); 
        applyComponentDamage(pilot, baseSplash * falloff, String(type), relativeOffset);

        if (destructible(pilot.entity).damageModel!.fuselage <= 0) {
          destructible(pilot.entity).isDead = true;
          registerKillFn(ownerId, pilot.id, String(type));
        }
      }
    }
  }
}
