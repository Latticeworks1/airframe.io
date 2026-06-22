import type { CockpitDef } from "../../cockpitMesh";

const COCKPIT_DEFS = new Map<string, CockpitDef>([
  ["falcon-mk2", {
    aircraftId:  "falcon-mk2",
    eye:         [0, 1.50, 0.90],
    sightAnchor: [0, 1.60, 1.585],
    panelZ: 1.75, panelY: 1.11, panelW: 1.38, panelH: 0.68,
  }],
  ["grizzly-a1", {
    aircraftId:  "grizzly-a1",
    eye:         [0, 1.38, 0.95],
    sightAnchor: [0, 1.48, 1.635],
    panelZ: 1.80, panelY: 0.99, panelW: 1.38, panelH: 0.68,
  }],
  ["kite-9", {
    aircraftId:  "kite-9",
    eye:         [0, 1.22, 0.72],
    sightAnchor: [0, 1.32, 1.405],
    panelZ: 1.57, panelY: 0.83, panelW: 1.38, panelH: 0.68,
  }],
  ["vulcan-51", {
    aircraftId:  "vulcan-51",
    eye:         [0, 1.32, 0.88],
    sightAnchor: [0, 1.42, 1.565],
    panelZ: 1.73, panelY: 0.93, panelW: 1.38, panelH: 0.68,
  }],
  ["twinwolf", {
    aircraftId:  "twinwolf",
    eye:         [0, 1.30, 0.82],
    sightAnchor: [0, 1.40, 1.505],
    panelZ: 1.67, panelY: 0.91, panelW: 1.38, panelH: 0.68,
  }],
]);

export function getCockpitDef(aircraftId: string): CockpitDef | undefined {
  return COCKPIT_DEFS.get(aircraftId);
}
