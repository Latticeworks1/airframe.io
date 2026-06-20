import { AircraftSpecs, AircraftClass, WeaponType } from "../../../../types";

export const specs: AircraftSpecs = {
  id: "vulcan-51",
  name: "Vulcan-51",
  class: AircraftClass.EnergyFighter,
  description:
    "Heavy mechanical powerhouse. Designed for Boom-and-Zoom vertical warfare. Holds immense dive speeds, retains kinetic energy, but rolls slower.",
  mass: 4100,
  maxThrust: 26000,
  cd0: 0.022,
  cl0: 0.08,
  clAlpha: 0.080,
  wingArea: 19.2,
  aspectRatio: 6.4,
  oswaldEfficiency: 0.8,
  energyRetention: 0.98,
  stallSpeedKmph: 176,
  structuralLimitSpeedKmph: 850,
  turnBleed: 0.09,
  climbRate: 22,
  maxFuelSeconds: 360,
  weapons: [WeaponType.HMG_12_7, WeaponType.HMG_12_7, WeaponType.CANNON_20],
  durability: 120,
  color: "#1e3a8a",
  secondaryColor: "#38bdf8",
  accentColor: "#10b981"
};
