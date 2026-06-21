export type GraphicsPreset = "low" | "medium" | "high" | "ultra";

export interface GraphicsSettings {
  preset: GraphicsPreset;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  pixelRatioLimit: number;
  scatterScale: number; // multiplier for tree and building density
  farPlaneScale: number; // multiplier for visual draw distances
}

export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: {
    preset: "low",
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    pixelRatioLimit: 1.0,
    scatterScale: 0.25,
    farPlaneScale: 0.7
  },
  medium: {
    preset: "medium",
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    pixelRatioLimit: 1.25,
    scatterScale: 0.6,
    farPlaneScale: 1.0
  },
  high: {
    preset: "high",
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    pixelRatioLimit: 1.5,
    scatterScale: 1.0,
    farPlaneScale: 1.2
  },
  ultra: {
    preset: "ultra",
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    pixelRatioLimit: 2.0, // native ratio limit
    scatterScale: 1.3,
    farPlaneScale: 1.6
  }
};

const GRAPHICS_STORAGE_KEY = "airframe_graphics_preset";

export function getStoredGraphicsPreset(): GraphicsPreset {
  if (typeof localStorage === "undefined") return "high";
  const stored = localStorage.getItem(GRAPHICS_STORAGE_KEY);
  if (stored === "low" || stored === "medium" || stored === "high" || stored === "ultra") {
    return stored;
  }
  // Default to high
  return "high";
}

export function setStoredGraphicsPreset(preset: GraphicsPreset): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, preset);
  }
}

export function getStoredGraphicsSettings(): GraphicsSettings {
  return GRAPHICS_PRESETS[getStoredGraphicsPreset()];
}
