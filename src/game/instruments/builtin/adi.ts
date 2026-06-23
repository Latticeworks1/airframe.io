import type { Instrument, CockpitState } from "../types";
import { clamp, stampBaked, type Ctx2D } from "../utils";

// Bakes the fixed bank graduation arc marks (clipped to the instrument face) and nothing else.
// The bezel is drawn last inside draw() so it sits on top of all dynamic content.

const BANK_DEGS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

export const adi: Instrument = {
  id: "adi",
  label: "ADI",

  bake(r) {
    const oc = new OffscreenCanvas(Math.ceil(r * 2), Math.ceil(r * 2));
    const ctx = oc.getContext("2d") as Ctx2D;
    const cx = r, cy = r;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    for (const deg of BANK_DEGS) {
      const a = (deg / 180) * Math.PI - Math.PI / 2;
      const inner = deg % 30 === 0 ? r * 0.82 : r * 0.87;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.strokeStyle = "#c8d8e8";
      ctx.lineWidth = deg === 0 ? 2 : 1;
      ctx.stroke();
    }
    ctx.restore();
    return oc;
  },

  draw(ctx, cx, cy, r, state: CockpitState, baked) {
    const { pitch_rad, roll_rad } = state;
    const pitchOffset = Math.sin(clamp(pitch_rad, -0.52, 0.52)) * r * 1.6;

    // Clip the ball interior
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.clip();

    // Earth
    ctx.fillStyle = "#5c3314";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Sky + horizon + pitch ladder — rotate with aircraft roll
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll_rad);
    ctx.fillStyle = "#17457a";
    ctx.fillRect(-r * 3, -r * 3, r * 6, r * 3 + pitchOffset);
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.2, pitchOffset);
    ctx.lineTo( r * 1.2, pitchOffset);
    ctx.stroke();
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "#e8e8e8";
    ctx.font = `bold ${Math.round(r * 0.22)}px monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const deg of [-10, -5, 5, 10]) {
      const yOff = pitchOffset - Math.sin((deg / 180) * Math.PI) * r * 1.6;
      const half = Math.abs(deg) === 10 ? r * 0.42 : r * 0.26;
      ctx.beginPath();
      ctx.moveTo(-half, yOff);
      ctx.lineTo( half, yOff);
      ctx.stroke();
      if (Math.abs(deg) === 10) ctx.fillText(String(Math.abs(deg)), -half - r * 0.08, yOff);
    }
    ctx.restore();

    // Stamp baked bank marks on top of the pitch ball
    stampBaked(ctx, cx, cy, r, baked);

    // Bank pointer triangle (rotates with roll)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(roll_rad);
    ctx.beginPath();
    ctx.moveTo(0, -(r * 0.82));
    ctx.lineTo(-r * 0.05, -(r * 0.72));
    ctx.lineTo( r * 0.05, -(r * 0.72));
    ctx.closePath();
    ctx.fillStyle = "#e8e8e8";
    ctx.fill();
    ctx.restore();

    // Miniature aircraft wings (fixed)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#FAE5AD";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.52, 0); ctx.lineTo(-r * 0.18, 0); ctx.lineTo(-r * 0.08, r * 0.12);
    ctx.moveTo( r * 0.52, 0); ctx.lineTo( r * 0.18, 0); ctx.lineTo( r * 0.08, r * 0.12);
    ctx.moveTo(-r * 0.08, 0); ctx.lineTo( r * 0.08, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // release clip

    // Bezel drawn last so it covers the clipped edge cleanly
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#3a4a5e";
    ctx.lineWidth = r * 0.16;
    ctx.stroke();
  },
};
