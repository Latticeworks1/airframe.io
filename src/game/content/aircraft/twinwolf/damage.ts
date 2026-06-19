import { DamageZoneSpecs } from "../types";

export const damage: DamageZoneSpecs = {
  engineVolume: { min: [-5.2, -0.7, -1.0], max: [5.2, 0.7, 3.0] }, // covers pod volumes too
  cockpitVolume: { min: [-0.65, 0.55, -0.2], max: [0.65, 1.55, 2.05] },
  fuelTankVolume: { min: [-1.2, -0.7, -2.5], max: [1.2, 0.5, -0.5] }
};
