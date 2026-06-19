import { DamageZoneSpecs } from "../types";

export const damage: DamageZoneSpecs = {
  engineVolume: { min: [-0.65, -0.65, -5.5], max: [0.65, 0.65, -2.7] },
  cockpitVolume: { min: [-0.7, 0.55, -0.2], max: [0.7, 1.6, 2.2] },
  fuelTankVolume: { min: [-0.8, -0.7, -2.5], max: [0.8, 0.5, -0.5] }
};
