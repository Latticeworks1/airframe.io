import { DamageZoneSpecs } from "../types";

export const damage: DamageZoneSpecs = {
  engineVolume: { min: [-0.6, -0.6, -5.0], max: [0.6, 0.6, -2.5] },
  cockpitVolume: { min: [-0.65, 0.55, -0.25], max: [0.65, 1.55, 2.05] },
  fuelTankVolume: { min: [-0.75, -0.7, -2.2], max: [0.75, 0.5, -0.5] }
};
