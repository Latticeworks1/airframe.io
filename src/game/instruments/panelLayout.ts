// Panel canvas dimensions and slot positions.
// To reposition a gauge or swap in a mod instrument, change the id or coordinates here.

export const PANEL_W = 630;
export const PANEL_H = 290;

const ROW1_Y = 82;
const ROW2_Y = 205;
const COL1_X = 97;
const COL2_X = 315;
const COL3_X = 533;
const GR = 62;
const AR = 72;

export interface SlotConfig {
  id: string;
  cx: number;
  cy: number;
  r: number;
}

export const PANEL_LAYOUT: SlotConfig[] = [
  { id: "asi",              cx: COL1_X, cy: ROW1_Y, r: GR },
  { id: "adi",              cx: COL2_X, cy: ROW1_Y, r: AR },
  { id: "altimeter",        cx: COL3_X, cy: ROW1_Y, r: GR },
  { id: "turn-coordinator", cx: COL1_X, cy: ROW2_Y, r: GR },
  { id: "heading",          cx: COL2_X, cy: ROW2_Y, r: GR },
  { id: "vsi",              cx: COL3_X, cy: ROW2_Y, r: GR },
];
