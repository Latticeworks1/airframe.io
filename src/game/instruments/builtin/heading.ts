import type { Instrument, CockpitState } from "../types";
import { gaugeBase, gaugeLabel, stampBaked, glassOverlay } from "../utils";

const CARDINALS = ["N", "E", "S", "W"];

export const heading: Instrument = {
  id: "heading",
  label: "HDG",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as import("../utils").Ctx2D;
    gaugeBase(ctx, r, r, r);
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    stampBaked(ctx, cx, cy, r, baked);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.heading01 * Math.PI * 2);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
      const major = i % 9 === 0;
      const semi  = i % 3 === 0 && !major;
      const inner = major ? r * 0.60 : semi ? r * 0.70 : r * 0.80;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * r * 0.90, Math.sin(a) * r * 0.90);
      ctx.strokeStyle = major ? "#e8e8e8" : semi ? "#6ba3db" : "#2e4a68";
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
      if (major) {
        const idx = i / 9;
        ctx.fillStyle = CARDINALS[idx] === "N" ? "#ef4444" : "#e8e8e8";
        ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(CARDINALS[idx], Math.cos(a) * r * 0.54, Math.sin(a) * r * 0.54);
      }
    }
    ctx.restore();
    // Fixed lubber line at top
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.90);
    ctx.lineTo(cx, cy - r * 0.68);
    ctx.strokeStyle = "#FAE5AD";
    ctx.lineWidth = 3;
    ctx.stroke();
    gaugeLabel(ctx, cx, cy, r, "HDG");
    glassOverlay(ctx, cx, cy, r);
  },
};
