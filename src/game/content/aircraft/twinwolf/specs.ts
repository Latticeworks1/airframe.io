import { AircraftSpecs, AircraftClass, WeaponType } from "../../../../types";

export const specs: AircraftSpecs = {
  id: "twinwolf",
  name: "Twinwolf",
  class: AircraftClass.HeavyFighter,
  description:
    "Dual-engine, dual-hull long-range interceptor. Bristles with quad 20mm cannons. Devastating head-on performance, but turns sluggishly.",
  mass: 6500,
  maxThrust: 38000,
  cd0: 0.030,
  cl0: 0.12,
  clAlpha: 0.085,
  wingArea: 32.0,
  aspectRatio: 6.8,
  oswaldEfficiency: 0.76,
  energyRetention: 0.94,
  stallSpeedKmph: 169,
  structuralLimitSpeedKmph: 780,
  turnBleed: 0.14,
  climbRate: 14,
  maxFuelSeconds: 480,
  weapons: [WeaponType.CANNON_20, WeaponType.CANNON_20, WeaponType.HMG_12_7],
  durability: 160,
  color: "#312e81",
  secondaryColor: "#db2777",
  accentColor: "#e0f2fe"
};
