import type { Instrument, CockpitState } from "../types";
import { gaugeBase, tickRing, gaugeLabel, needle, stampBaked, glassOverlay } from "../utils";

const START = (225 / 180) * Math.PI;
const SWEEP = (270 / 180) * Math.PI;
const ARCS: [number, number, string][] = [
  [0.10, 0.35, "#e0e0e0"],
  [0.35, 0.75, "#22c55e"],
  [0.75, 0.95, "#eab308"],
];

export const asi: Instrument = {
  id: "asi",
  label: "KIAS",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as import("../utils").Ctx2D;
    const cx = r, cy = r;
    gaugeBase(ctx, cx, cy, r);
    for (const [t0, t1, color] of ARCS) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.88, START + t0 * SWEEP - Math.PI / 2, START + t1 * SWEEP - Math.PI / 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.07;
      ctx.stroke();
    }
    tickRing(ctx, cx, cy, r, 27, START, SWEEP, 3);
    gaugeLabel(ctx, cx, cy, r, "KIAS");
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    stampBaked(ctx, cx, cy, r, baked);
    needle(ctx, cx, cy, r, START + state.speed01 * SWEEP);
    glassOverlay(ctx, cx, cy, r);
  },
};
