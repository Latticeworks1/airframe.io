import { Pilot, WeaponType } from "../../types";
import { WEAPON_SPECS_MAP } from "../aircraftData";
import { Vector3 } from "three";
import { spawnOrdnance, spawnGunProjectile } from "./ProjectileSpawner";

export class WeaponSystem {
  public handleWeaponFiring(
    pilot: Pilot,
    triggerPrimary: boolean,
    triggerSecondary: boolean,
    dt: number,
    clientSeq: number | undefined,
    inputQueueLength: number,
    playerHistory: any[],
    triggerSplashDamage: (pos: Vector3, ownerId: string, team: number, type: WeaponType) => void,
    projectiles: any[],
    mapId: string,
    broadcast: (type: string, payload: any) => void
  ) {
    if (!pilot.entity.components.has("weaponized")) return;
    const wep = pilot.entity.components.get("weaponized") as any;
    if (!wep.cooldowns) wep.cooldowns = {};

    pilot.specs.weapons.forEach(wType => {
      const spec = WEAPON_SPECS_MAP[wType];
      const ammo = wep.ammo[wType] ?? 0;
      if (ammo <= 0) return;

      const cooldown = wep.cooldowns[wType] ?? 0;
      if (cooldown > 0) return;

      const isSecondary = wType === WeaponType.ROCKET || wType === WeaponType.BOMB;

      if (isSecondary) {
        if (!triggerSecondary) return;
        broadcast("player_fired", { id: pilot.id, weaponType: wType });
        spawnOrdnance(pilot, wType, projectiles);
        wep.ammo[wType]--;
        wep.cooldowns[wType] = 1 / Math.max(0.01, spec.fireRate);
        return;
      }

      if (!triggerPrimary) return;

      const shotChance = spec.fireRate * dt * 0.9;
      if (Math.random() < shotChance) {
        broadcast("player_fired", { id: pilot.id, weaponType: wType });
        spawnGunProjectile(pilot, wType, clientSeq, inputQueueLength, playerHistory, triggerSplashDamage, projectiles, mapId);
        wep.ammo[wType]--;
        wep.cooldowns[wType] = 0.015;
      }
    });
  }
}
