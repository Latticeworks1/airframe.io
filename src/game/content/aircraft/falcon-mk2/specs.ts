import { AircraftSpecs, AircraftClass, WeaponType } from "../../../../types";

export const specs: AircraftSpecs = {
  id: "falcon-mk2",
  name: "Falcon Mk II",
  class: AircraftClass.Balanced,
  description:
    "Standard multi-role fighter. Excellent baseline balance of turning ability, speed, and durability. Ideal starting aircraft.",
  mass: 3200,
  maxThrust: 18000,
  cd0: 0.028,
  cl0: 0.15,
  clAlpha: 0.088,
  wingArea: 21.5,
  aspectRatio: 5.9,
  oswaldEfficiency: 0.78,
  energyRetention: 0.95,
  stallSpeedKmph: 143,
  structuralLimitSpeedKmph: 720,
  turnBleed: 0.15,
  climbRate: 15,
  maxFuelSeconds: 300,
  weapons: [WeaponType.MG_7_7, WeaponType.HMG_12_7],
  durability: 100,
  color: "#6b7280",
  secondaryColor: "#eab308",
  accentColor: "#ef4444"
};
