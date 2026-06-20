import { HardpointSpecs } from "../types";

export const hardpoints: HardpointSpecs = {
  positions: [
    { x: 0, y: -0.65, z: 7.4 },       // 30mm auto-cannon
    { x: -5.0, y: -0.55, z: 1.55 },   // Left rocket pod
    { x: 5.0, y: -0.55, z: 1.55 }     // Right rocket pod
  ],
  rocketPositions: [
    { x: -5.0, y: -0.75, z: 1.55 },
    { x: 5.0, y: -0.75, z: 1.55 }
  ],
  bombPositions: [
    { x: -2.45, y: -0.95, z: 1.45 },
    { x: 2.45, y: -0.95, z: 1.45 },
    { x: -2.45, y: -0.95, z: -1.15 },
    { x: 2.45, y: -0.95, z: -1.15 }
  ]
};
