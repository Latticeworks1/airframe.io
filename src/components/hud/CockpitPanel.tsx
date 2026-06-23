import React, { useRef, useEffect } from "react";
import { cockpitPanelState } from "../../game/cockpitPanelState";
import "../../game/instruments/index"; // registers all built-in instruments
import { getInstrument, PANEL_LAYOUT, PANEL_W, PANEL_H } from "../../game/instruments";

// ─────────────────────────────────────────────────────────────────────────────
// Indicator lights
// ─────────────────────────────────────────────────────────────────────────────

const IND_Y = PANEL_H - 26;
const IND_H = 28;
const IND_W = 84;

const COL1_X = 97;
const COL3_X = 533;

const INDICATORS: { cx: number; label: string; key: keyof typeof cockpitPanelState; color: string }[] = [
  { cx: COL1_X,         label: "GEAR",   key: "gearDown",      color: "#22c55e" },
  { cx: COL1_X + 160,   label: "FLAPS",  key: "flapsOut",      color: "#eab308" },
  { cx: COL3_X - 160,   label: "AIRBRK", key: "airbrakeOn",    color: "#ef4444" },
  { cx: COL3_X,         label: "ENG",    key: "engineDamaged", color: "#ef4444" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

export const CockpitPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    // Bake each slot's static face once
    const bakedMap = new Map<string, OffscreenCanvas>();
    for (const slot of PANEL_LAYOUT) {
      const inst = getInstrument(slot.id);
      if (inst) bakedMap.set(slot.id, inst.bake(slot.r));
    }

    let rafId: number;

    function tick() {
      const s = cockpitPanelState;

      ctx.fillStyle = "#0d1520";
      ctx.fillRect(0, 0, PANEL_W, PANEL_H);

      for (const slot of PANEL_LAYOUT) {
        const inst = getInstrument(slot.id);
        const baked = bakedMap.get(slot.id);
        if (inst && baked) inst.draw(ctx, slot.cx, slot.cy, slot.r, s, baked);
      }

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
      ctx.strokeRect(1.5, 1.5, PANEL_W - 3, PANEL_H - 3);

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
        width={PANEL_W}
        height={PANEL_H}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </div>
  );
};
