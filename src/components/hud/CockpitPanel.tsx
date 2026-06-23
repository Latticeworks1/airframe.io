import React, { useRef, useEffect } from "react";
import { cockpitPanelState } from "../../game/cockpitPanelState";

// ─────────────────────────────────────────────────────────────────────────────
// Panel layout — adjust these to reposition gauges or add new ones.
// cx/cy are canvas pixel coordinates; r is the gauge face radius in pixels.
// ─────────────────────────────────────────────────────────────────────────────

const CW = 630;
const CH = 290;

const ROW1_Y = 82;
const ROW2_Y = 205;
const COL1_X = 97;
const COL2_X = 315;
const COL3_X = 533;
const GR = 62;   // outer gauges radius
const AR = 72;   // ADI radius (slightly larger)

// Indicator lights — bottom strip
const IND_Y     = CH - 26;
const IND_H     = 28;
const IND_W     = 84;
const INDICATORS: { cx: number; label: string; key: keyof typeof cockpitPanelState; color: string }[] = [
  { cx: COL1_X,         label: "GEAR",   key: "gearDown",      color: "#22c55e" },
  { cx: COL1_X + 160,   label: "FLAPS",  key: "flapsOut",      color: "#eab308" },
  { cx: COL3_X - 160,   label: "AIRBRK", key: "airbrakeOn",    color: "#ef4444" },
  { cx: COL3_X,         label: "ENG",    key: "engineDamaged", color: "#ef4444" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Drawing primitives
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function gaugeBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = "#07111f";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#3a4a5e";
  ctx.lineWidth = r * 0.16;
  ctx.stroke();
}

function needle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  angle: number,
  length = 0.78,
  color = "#FAE5AD",
  width = 2
) {
  const rad = angle - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * r * length, cy + Math.sin(rad) * r * length);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = "#8ebce6";
  ctx.fill();
}

function tickRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  count: number, startAngle: number, sweep: number, majorEvery: number
) {
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (i / count) * sweep - Math.PI / 2;
    const major = i % majorEvery === 0;
    const inner = major ? r * 0.70 : r * 0.80;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * r * 0.90, cy + Math.sin(a) * r * 0.90);
    ctx.strokeStyle = major ? "#6ba3db" : "#2e4a68";
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
  }
}

function gaugeLabel(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  text: string, yOff = 0.60
) {
  ctx.fillStyle = "#7a9ab8";
  ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + r * yOff);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gauge draw functions — each takes (ctx, cx, cy, r) plus its value(s).
// To add a new gauge: write a function here and add a call in drawPanel().
// ─────────────────────────────────────────────────────────────────────────────

function drawASI(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, speed01: number) {
  const start = (225 / 180) * Math.PI;
  const sweep = (270 / 180) * Math.PI;
  gaugeBase(ctx, cx, cy, r);
  const arcs: [number, number, string][] = [
    [0.10, 0.35, "#e0e0e0"],
    [0.35, 0.75, "#22c55e"],
    [0.75, 0.95, "#eab308"],
  ];
  for (const [t0, t1, color] of arcs) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.88, start + t0 * sweep - Math.PI / 2, start + t1 * sweep - Math.PI / 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.07;
    ctx.stroke();
  }
  tickRing(ctx, cx, cy, r, 27, start, sweep, 3);
  needle(ctx, cx, cy, r, start + speed01 * sweep);
  gaugeLabel(ctx, cx, cy, r, "KIAS");
}

function drawADI(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  pitch_rad: number, roll_rad: number
) {
  const pitchOffset = Math.sin(clamp(pitch_rad, -0.52, 0.52)) * r * 1.6;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#5c3314";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

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

  // Bank marks (fixed to instrument)
  ctx.translate(cx, cy);
  for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (deg / 180) * Math.PI - Math.PI / 2;
    const inner = deg % 30 === 0 ? r * 0.82 : r * 0.87;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.strokeStyle = "#c8d8e8";
    ctx.lineWidth = deg === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Bank pointer triangle
  ctx.save();
  ctx.rotate(roll_rad);
  ctx.beginPath();
  ctx.moveTo(0, -(r * 0.82));
  ctx.lineTo(-r * 0.05, -(r * 0.72));
  ctx.lineTo( r * 0.05, -(r * 0.72));
  ctx.closePath();
  ctx.fillStyle = "#e8e8e8";
  ctx.fill();
  ctx.restore();

  // Miniature aircraft wings
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.52, 0); ctx.lineTo(-r * 0.18, 0); ctx.lineTo(-r * 0.08, r * 0.12);
  ctx.moveTo( r * 0.52, 0); ctx.lineTo( r * 0.18, 0); ctx.lineTo( r * 0.08, r * 0.12);
  ctx.moveTo(-r * 0.08, 0); ctx.lineTo( r * 0.08, 0);
  ctx.stroke();

  ctx.restore();

  // Bezel on top (drawn after clip restore so it's not clipped)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#3a4a5e";
  ctx.lineWidth = r * 0.16;
  ctx.stroke();
}

function drawAltimeter(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alt01: number) {
  gaugeBase(ctx, cx, cy, r);
  tickRing(ctx, cx, cy, r, 50, 0, Math.PI * 2, 5);
  const altFt = alt01 * 14000;
  needle(ctx, cx, cy, r, ((altFt % 10000) / 10000) * Math.PI * 2, 0.56, "#c8c8c8", 3);
  needle(ctx, cx, cy, r, ((altFt % 1000)  / 1000)  * Math.PI * 2, 0.80, "#FAE5AD", 2);
  gaugeLabel(ctx, cx, cy, r, "ALT ft");
}

function drawTurnCoordinator(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, roll_rad: number) {
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
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(clamp(roll_rad, -0.6, 0.6) * 0.8);
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, r * 0.06); ctx.lineTo(-r * 0.18, r * 0.06); ctx.lineTo(-r * 0.08, r * 0.18);
  ctx.moveTo( r * 0.58, r * 0.06); ctx.lineTo( r * 0.18, r * 0.06); ctx.lineTo( r * 0.08, r * 0.18);
  ctx.moveTo(-r * 0.08, r * 0.06); ctx.lineTo( r * 0.08, r * 0.06);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.62, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = "#FAE5AD";
  ctx.fill();
  gaugeLabel(ctx, cx, cy, r, "COORD", 0.38);
}

function drawHeading(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, heading01: number) {
  gaugeBase(ctx, cx, cy, r);
  const cardinals = ["N", "E", "S", "W"];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-heading01 * Math.PI * 2);
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
      ctx.fillStyle = cardinals[idx] === "N" ? "#ef4444" : "#e8e8e8";
      ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cardinals[idx], Math.cos(a) * r * 0.54, Math.sin(a) * r * 0.54);
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.90);
  ctx.lineTo(cx, cy - r * 0.68);
  ctx.strokeStyle = "#FAE5AD";
  ctx.lineWidth = 3;
  ctx.stroke();
  gaugeLabel(ctx, cx, cy, r, "HDG");
}

function drawVSI(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, vsi01: number) {
  gaugeBase(ctx, cx, cy, r);
  tickRing(ctx, cx, cy, r, 16, -Math.PI / 2, Math.PI * 2, 4);
  const a = -Math.PI - vsi01 * (Math.PI * 0.75);
  needle(ctx, cx, cy, r, a + Math.PI / 2, 0.78);
  ctx.fillStyle = "#6ba3db";
  ctx.font = `bold ${Math.round(r * 0.24)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("0", cx - r * 0.54, cy);
  gaugeLabel(ctx, cx, cy, r, "VSI");
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel draw — called every animation frame
// ─────────────────────────────────────────────────────────────────────────────

function drawPanel(ctx: CanvasRenderingContext2D, s: typeof cockpitPanelState) {
  ctx.fillStyle = "#0d1520";
  ctx.fillRect(0, 0, CW, CH);

  drawASI(ctx, COL1_X, ROW1_Y, GR, s.speed01);
  drawADI(ctx, COL2_X, ROW1_Y, AR, s.pitch_rad, s.roll_rad);
  drawAltimeter(ctx, COL3_X, ROW1_Y, GR, s.alt01);
  drawTurnCoordinator(ctx, COL1_X, ROW2_Y, GR, s.roll_rad);
  drawHeading(ctx, COL2_X, ROW2_Y, GR, s.heading01);
  drawVSI(ctx, COL3_X, ROW2_Y, GR, s.vsi01);

  // Indicator light strip
  for (const ind of INDICATORS) {
    const lit = !!s[ind.key];
    ctx.fillStyle = lit ? ind.color : "#0d1825";
    ctx.fillRect(ind.cx - IND_W / 2, IND_Y - IND_H / 2, IND_W, IND_H);
    ctx.strokeStyle = lit ? ind.color : "#1e3048";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ind.cx - IND_W / 2 + 2, IND_Y - IND_H / 2 + 2, IND_W - 4, IND_H - 4);
    ctx.fillStyle = lit ? "#ffffff" : "#1e3048";
    ctx.font = `bold ${Math.round(IND_H * 0.48)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ind.label, ind.cx, IND_Y);
  }

  // Outer bevel
  ctx.strokeStyle = "#2d4a6e";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CW - 3, CH - 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const CockpitPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let rafId: number;

    function tick() {
      drawPanel(ctx, cockpitPanelState);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none select-none"
      style={{ width: "46vw", maxWidth: 700, minWidth: 380 }}
    >
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </div>
  );
};
