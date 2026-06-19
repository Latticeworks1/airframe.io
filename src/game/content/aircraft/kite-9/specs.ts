import { AircraftSpecs, AircraftClass, WeaponType } from "../../../../types";

export const specs: AircraftSpecs = {
  id: "kite-9",
  name: "Kite-9",
  class: AircraftClass.Turnfighter,
  description:
    "Highly nimble canvas-and-alloy dogfighter. Out-turns any other aircraft in slow horizontal fights but burns energy rapidly and is fragile.",
  mass: 2500,
  maxThrust: 14000,
  cd0: 0.032,
  cl0: 0.20,
  clAlpha: 0.092,
  wingArea: 24.0,
  aspectRatio: 5.2,
  oswaldEfficiency: 0.82,
  energyRetention: 0.88,
  stallSpeedKmph: 118,
  structuralLimitSpeedKmph: 580,
  turnBleed: 0.22,
  climbRate: 18,
  maxFuelSeconds: 240,
  weapons: [WeaponType.MG_7_7, WeaponType.MG_7_7, WeaponType.MG_7_7],
  durability: 70,
  color: "#b91c1c",
  secondaryColor: "#ffffff",
  accentColor: "#f97316"
};
