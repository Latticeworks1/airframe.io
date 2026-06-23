import type { Instrument, CockpitState } from "../types";
import { gaugeBase, gaugeLabel, stampBaked, clamp, glassOverlay } from "../utils";

export const turnCoordinator: Instrument = {
  id: "turn-coordinator",
  label: "COORD",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as import("../utils").Ctx2D;
    const cx = r, cy = r;
    gaugeBase(ctx, cx, cy, r);
    for (const side of [-1, 1]) {
      const a = (side * 25 / 180) * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
      ctx.lineTo(cx + Math.cos(a) * r * 0.90, cy + Math.sin(a) * r * 0.90);
      ctx.strokeStyle = "#6ba3db";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#6ba3db";
      ctx.font = `bold ${Math.round(r * 0.28)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(side < 0 ? "L" : "R", cx + side * r * 0.56, cy - r * 0.18);
    }
    gaugeLabel(ctx, cx, cy, r, "COORD", 0.38);
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    stampBaked(ctx, cx, cy, r, baked);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(clamp(state.roll_rad, -0.6, 0.6) * 0.8);
    ctx.strokeStyle = "#FAE5AD";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.58, r * 0.06); ctx.lineTo(-r * 0.18, r * 0.06); ctx.lineTo(-r * 0.08, r * 0.18);
    ctx.moveTo( r * 0.58, r * 0.06); ctx.lineTo( r * 0.18, r * 0.06); ctx.lineTo( r * 0.08, r * 0.18);
    ctx.moveTo(-r * 0.08, r * 0.06); ctx.lineTo( r * 0.08, r * 0.06);
    ctx.stroke();
    ctx.restore();
    // Slip ball (inclinometer)
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.62, r * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = "#FAE5AD";
    ctx.fill();
    glassOverlay(ctx, cx, cy, r);
  },
};
