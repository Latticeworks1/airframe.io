import type { Instrument, CockpitState } from "../types";
import { gaugeBase, tickRing, gaugeLabel, needle, stampBaked } from "../utils";

export const altimeter: Instrument = {
  id: "altimeter",
  label: "ALT ft",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as import("../utils").Ctx2D;
    gaugeBase(ctx, r, r, r);
    tickRing(ctx, r, r, r, 50, 0, Math.PI * 2, 5);
    gaugeLabel(ctx, r, r, r, "ALT ft");
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    stampBaked(ctx, cx, cy, r, baked);
    const altFt = state.alt01 * 14000;
    needle(ctx, cx, cy, r, ((altFt % 10000) / 10000) * Math.PI * 2, 0.56, "#c8c8c8", 3);
    needle(ctx, cx, cy, r, ((altFt % 1000)  / 1000)  * Math.PI * 2, 0.80, "#FAE5AD", 2);
  },
};
