// Public API for the instrument system.
// Modders import registerInstrument and call it with their own Instrument object.
// Built-in instruments are registered here at module load time.

export type { Instrument, CockpitState } from "./types";
export { registerInstrument, getInstrument, getAllInstruments } from "./registry";
export { PANEL_LAYOUT, PANEL_W, PANEL_H } from "./panelLayout";
export { gaugeBase, needle, tickRing, gaugeLabel, stampBaked, clamp } from "./utils";

import { registerInstrument } from "./registry";
import { asi }              from "./builtin/asi";
import { adi }              from "./builtin/adi";
import { altimeter }        from "./builtin/altimeter";
import { turnCoordinator }  from "./builtin/turnCoordinator";
import { heading }          from "./builtin/heading";
import { vsi }              from "./builtin/vsi";

registerInstrument(asi);
registerInstrument(adi);
registerInstrument(altimeter);
registerInstrument(turnCoordinator);
registerInstrument(heading);
registerInstrument(vsi);
