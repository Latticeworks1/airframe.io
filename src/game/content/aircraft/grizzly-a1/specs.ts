import { AircraftSpecs, AircraftClass, WeaponType } from "../../../../types";

export const specs: AircraftSpecs = {
  id: "grizzly-a1",
  name: "Grizzly A1",
  class: AircraftClass.Attacker,
  description:
    "Heavy armored fortress. Features a 30mm auto-cannon, high rocket count, and bombs in standard payloads. Excels at erasing ground structures.",
  mass: 5900,
  maxThrust: 34000,
  cd0: 0.038,
  cl0: 0.22,
  clAlpha: 0.082,
  wingArea: 30.5,
  aspectRatio: 5.6,
  oswaldEfficiency: 0.74,
  energyRetention: 0.92,
  stallSpeedKmph: 160,
  structuralLimitSpeedKmph: 680,
  turnBleed: 0.18,
  climbRate: 10,
  maxFuelSeconds: 420,
  weapons: [WeaponType.CANNON_30, WeaponType.ROCKET, WeaponType.BOMB],
  durability: 200,
  color: "#15803d",
  secondaryColor: "#eab308",
  accentColor: "#4b5563"
};
