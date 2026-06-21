import type { CockpitDef } from "../../cockpitMesh";

const COCKPIT_DEFS = new Map<string, CockpitDef>([
  ["falcon-mk2", {
    eye:    [0, 1.28, 0.80],
    panelZ: 1.75,
    panelY: 0.98,
    panelW: 0.72,
    panelH: 0.50,
  }],
]);

export function getCockpitDef(aircraftId: string): CockpitDef | undefined {
  return COCKPIT_DEFS.get(aircraftId);
}
