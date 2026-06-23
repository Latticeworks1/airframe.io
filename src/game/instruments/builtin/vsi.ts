import type { Instrument, CockpitState } from "../types";
import { gaugeBase, tickRing, gaugeLabel, needle, stampBaked, glassOverlay } from "../utils";

export const vsi: Instrument = {
  id: "vsi",
  label: "VSI",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as import("../utils").Ctx2D;
    const cx = r, cy = r;
    gaugeBase(ctx, cx, cy, r);
    tickRing(ctx, cx, cy, r, 16, -Math.PI / 2, Math.PI * 2, 4);
    ctx.fillStyle = "#6ba3db";
    ctx.font = `bold ${Math.round(r * 0.24)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("0", cx - r * 0.54, cy);
    gaugeLabel(ctx, cx, cy, r, "VSI");
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    stampBaked(ctx, cx, cy, r, baked);
    const a = -Math.PI - state.vsi01 * (Math.PI * 0.75);
    needle(ctx, cx, cy, r, a + Math.PI / 2, 0.78);
    glassOverlay(ctx, cx, cy, r);
  },
};
