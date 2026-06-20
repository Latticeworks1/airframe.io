import * as THREE from "three";
import type { BakedMapGeometry, GroundPalette } from "./content/maps/mapTypes";

const TEX_SIZE = 512;

// Lighten a hex color by mixing with white at ratio t (0=original, 1=white)
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 0xff), g = ((n >> 8) & 0xff), b = (n & 0xff);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function fillPolygon(ctx: CanvasRenderingContext2D, ring: number[], size: number) {
  if (ring.length < 6) return;
  ctx.beginPath();
  ctx.moveTo(ring[0] * size, (1 - ring[1]) * size);
  for (let i = 2; i < ring.length; i += 2) {
    ctx.lineTo(ring[i] * size, (1 - ring[i + 1]) * size);
  }
  ctx.closePath();
  ctx.fill();
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: number[], size: number) {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0] * size, (1 - pts[1]) * size);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(pts[i] * size, (1 - pts[i + 1]) * size);
  }
  ctx.stroke();
}

export function renderMapGeometry(
  geom:    BakedMapGeometry,
  palette: GroundPalette,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width  = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const s   = TEX_SIZE;

  // --- Land base ---
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, s, s);

  // --- Land use ---
  for (const lu of geom.landUse) {
    switch (lu.kind) {
      case "forest":
        ctx.fillStyle = lighten(palette.base, -0.15);
        break;
      case "scrub":
        ctx.fillStyle = lighten(palette.base, -0.08);
        break;
      case "urban":
        ctx.fillStyle = lighten(palette.base, 0.18);
        break;
      case "farmland":
        ctx.fillStyle = lighten(palette.base, 0.1);
        break;
    }
    fillPolygon(ctx, lu.ring, s);
  }

  // --- Water ---
  ctx.fillStyle = palette.colors[0] ?? "#0369a1";
  for (const ring of geom.waterRings) {
    fillPolygon(ctx, ring, s);
  }

  // --- Roads ---
  for (const road of geom.roads) {
    ctx.strokeStyle = palette.roadColor;
    switch (road.kind) {
      case "motorway": ctx.lineWidth = 2.5; break;
      case "primary":  ctx.lineWidth = 1.8; break;
      case "secondary":ctx.lineWidth = 1.2; break;
      case "tertiary": ctx.lineWidth = 0.8; break;
      case "track":    ctx.lineWidth = 0.5; ctx.setLineDash([3, 4]); break;
    }
    strokeLine(ctx, road.pts, s);
    ctx.setLineDash([]);
  }

  // --- Runways ---
  ctx.fillStyle = "#94a3b8";
  for (const rwy of geom.runways) {
    const cx = rwy.cx * s;
    const cy = (1 - rwy.cy) * s;
    const len = rwy.length * s;
    const wid = rwy.width * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rwy.heading * Math.PI / 180);
    ctx.fillRect(-len / 2, -wid / 2, len, wid);
    ctx.restore();
  }

  // --- Port markers ---
  ctx.fillStyle = "#e2e8f0";
  for (const port of geom.ports) {
    const px = port.x * s, py = (1 - port.y) * s;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// Fallback palette-only texture when no geometry is available
export function renderPaletteFallback(palette: GroundPalette): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, 256, 256);
  // Subtle noise-like variation using palette colors
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 8 + Math.random() * 24;
    ctx.globalAlpha = 0.06 + Math.random() * 0.06;
    ctx.fillStyle = palette.colors[Math.floor(Math.random() * palette.colors.length)] ?? palette.base;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
