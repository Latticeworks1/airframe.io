import type { CockpitDef } from "../../cockpitMesh";

const COCKPIT_DEFS = new Map<string, CockpitDef>([
  ["falcon-mk2", {
    eye:    [0, 1.46, 0.95],
    panelZ: 1.75,
    panelY: 1.08,
    panelW: 0.86,
    panelH: 0.52,
  }],
]);

export function getCockpitDef(aircraftId: string): CockpitDef | undefined {
  return COCKPIT_DEFS.get(aircraftId);
}
