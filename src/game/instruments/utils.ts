export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function gaugeBase(ctx: Ctx2D, cx: number, cy: number, r: number) {
  // Outer black rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#060809";
  ctx.fill();

  // Bevel highlight (top-left)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.96, Math.PI * 1.05, Math.PI * 1.95);
  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = r * 0.055;
  ctx.stroke();

  // Bevel shadow (bottom-right)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.96, Math.PI * 0.05, Math.PI * 0.95);
  ctx.strokeStyle = "#0d1014";
  ctx.lineWidth = r * 0.055;
  ctx.stroke();

  // Bezel body
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.strokeStyle = "#1a2230";
  ctx.lineWidth = r * 0.07;
  ctx.stroke();

  // Face — radial gradient
  const faceR = r * 0.88;
  const grad = ctx.createRadialGradient(cx, cy - faceR * 0.2, faceR * 0.05, cx, cy, faceR);
  grad.addColorStop(0, "#0e1c2e");
  grad.addColorStop(0.65, "#07101c");
  grad.addColorStop(1, "#030810");
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.strokeStyle = "#1a2d45";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function needle(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  angle: number,
  length = 0.78,
  color = "#FAE5AD",
  _width = 2,
) {
  const rad = angle - Math.PI / 2;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const px = -sinA;
  const py = cosA;

  const tipX = cx + cosA * r * length;
  const tipY = cy + sinA * r * length;
  const hw = r * 0.042;

  // Counterbalance
  const tailX = cx - cosA * r * 0.17;
  const tailY = cy - sinA * r * 0.17;
  ctx.beginPath();
  ctx.moveTo(cx + px * hw,        cy + py * hw);
  ctx.lineTo(tailX + px * hw * 1.3, tailY + py * hw * 1.3);
  ctx.lineTo(tailX - px * hw * 1.3, tailY - py * hw * 1.3);
  ctx.lineTo(cx - px * hw,        cy - py * hw);
  ctx.closePath();
  ctx.fillStyle = "#505a6a";
  ctx.fill();

  // Tapered needle body
  ctx.beginPath();
  ctx.moveTo(cx + px * hw, cy + py * hw);
  ctx.lineTo(tipX + px * 0.7, tipY + py * 0.7);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - px * 0.7, tipY - py * 0.7);
  ctx.lineTo(cx - px * hw, cy - py * hw);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Specular stripe
  ctx.beginPath();
  ctx.moveTo(cx + px * hw * 0.25, cy + py * hw * 0.25);
  ctx.lineTo(tipX + px * 0.35, tipY + py * 0.35);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fill();

  // Center bushing
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.068, 0, Math.PI * 2);
  ctx.fillStyle = "#111c2a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.040, 0, Math.PI * 2);
  ctx.fillStyle = "#7aaad4";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.018, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0e14";
  ctx.fill();
}

export function glassOverlay(ctx: Ctx2D, cx: number, cy: number, r: number) {
  const faceR = r * 0.88;
  const edgeGrad = ctx.createRadialGradient(cx, cy, faceR * 0.72, cx, cy, faceR);
  edgeGrad.addColorStop(0, "rgba(255,255,255,0)");
  edgeGrad.addColorStop(1, "rgba(255,255,255,0.07)");
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fillStyle = edgeGrad;
  ctx.fill();

  // Top arc glare
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.clip();
  const glareGrad = ctx.createLinearGradient(cx, cy - faceR, cx, cy - faceR * 0.3);
  glareGrad.addColorStop(0, "rgba(255,255,255,0.07)");
  glareGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glareGrad;
  ctx.fillRect(cx - faceR, cy - faceR, faceR * 2, faceR * 0.7);
  ctx.restore();
}

export function tickRing(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  count: number, startAngle: number, sweep: number, majorEvery: number,
) {
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (i / count) * sweep - Math.PI / 2;
    const major = i % majorEvery === 0;
    const inner = major ? r * 0.67 : r * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * r * 0.87, cy + Math.sin(a) * r * 0.87);
    ctx.strokeStyle = major ? "#c8d8e8" : "#2e4560";
    ctx.lineWidth = major ? 2.5 : 1;
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

export function gaugeLabel(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  text: string, yOff = 0.58,
) {
  ctx.fillStyle = "#7aaccf";
  ctx.font = `bold ${Math.round(r * 0.27)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + r * yOff);
}

export function stampBaked(
  ctx: Ctx2D,
  cx: number, cy: number, r: number,
  baked: OffscreenCanvas,
) {
  ctx.drawImage(baked, cx - r, cy - r, r * 2, r * 2);
}
