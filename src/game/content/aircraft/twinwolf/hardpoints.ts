import { HardpointSpecs } from "../types";

export const hardpoints: HardpointSpecs = {
  gunConvergenceM: 350,
  positions: [
    { x: -4.5, y: -0.1, z: 3.3 },   // Left pod cannon
    { x: 4.5, y: -0.1, z: 3.3 },    // Right pod cannon
    { x: 0, y: -0.25, z: 2.5 }      // Center body ammo mount
  ]
};
