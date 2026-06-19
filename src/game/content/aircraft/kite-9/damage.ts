import { DamageZoneSpecs } from "../types";

export const damage: DamageZoneSpecs = {
  engineVolume: { min: [-0.5, -0.5, -4.8], max: [0.5, 0.5, -2.3] },
  cockpitVolume: { min: [-0.6, 0.55, -0.2], max: [0.6, 1.5, 1.9] },
  fuelTankVolume: { min: [-0.7, -0.65, -2.0], max: [0.7, 0.45, -0.4] }
};
