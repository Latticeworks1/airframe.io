import { DamageZoneSpecs } from "../types";

export const damage: DamageZoneSpecs = {
  engineVolume: { min: [-0.75, -0.75, -6.0], max: [0.75, 0.75, -3.0] },
  cockpitVolume: { min: [-0.8, 0.55, -0.2], max: [0.8, 1.7, 2.5] },
  fuelTankVolume: { min: [-1.0, -0.8, -2.8], max: [1.0, 0.6, -0.5] }
};
