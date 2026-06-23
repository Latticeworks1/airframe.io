import type { cockpitPanelState } from "../cockpitPanelState";

export type CockpitState = typeof cockpitPanelState;

export interface Instrument {
  id: string;
  label: string;
  // Called once at panel init. Draw the static face (bezel, ticks, labels, color arcs)
  // onto a 2r × 2r OffscreenCanvas centered at (r, r).
  bake(r: number): OffscreenCanvas;
  // Called every animation frame. Draw only moving parts. The baked canvas is passed
  // so the instrument can stamp it at whatever layer depth it needs.
  draw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    state: CockpitState,
    baked: OffscreenCanvas,
  ): void;
}
