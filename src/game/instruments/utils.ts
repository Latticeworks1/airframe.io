// Shared Canvas 2D drawing utilities for instruments.
// All functions use canvas coordinates: cx/cy are the instrument center in pixels,
// r is the outer radius. Safe to call on both the main canvas and OffscreenCanvas contexts.

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function gaugeBase(ctx: Ctx2D, cx: number, cy: number, r: number) {
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

export function needle(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  angle: number,
  length = 0.78,
  color = "#FAE5AD",
  width = 2,
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

export function tickRing(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  count: number, startAngle: number, sweep: number, majorEvery: number,
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

export function gaugeLabel(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  text: string, yOff = 0.60,
) {
  ctx.fillStyle = "#7a9ab8";
  ctx.font = `bold ${Math.round(r * 0.30)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + r * yOff);
}

// Stamp a baked OffscreenCanvas (2r × 2r, centered at r,r) onto the main canvas.
export function stampBaked(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  baked: OffscreenCanvas,
) {
  ctx.drawImage(baked, cx - r, cy - r, r * 2, r * 2);
}
