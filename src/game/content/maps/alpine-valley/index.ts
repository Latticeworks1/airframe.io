import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = {
  id: "alpine-valley",
  name: "Alpine Corridor",
  description: "Glacial valley corridors surrounding massive mountain ranges. Scaled to massive proportions with a realistic heightmap terrain.",
  seed: 3333,
  cloudDensity: 0.4,
  world:    { radius: 18000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 12000 },
  spawn:    { distMin: 12000, distMax: 15000, aglMin: 600,  aglMax: 1200, initialSpeedMs: 160, spreadZ: 800 },
  terrain:  { kind: "heightmap" as const, path: "/maps/alpine-valley.png", elevationScale: 4200 },
  layout:   { carriers: [], hasThunder: false, antiAirCount: 16, groundTargetsCount: 24 },
  visual:   { skyColor: "#7dd3fc", fogColor: "#f1f5f9", groundColor: "#475569" },
  palette:  { base: "#1e293b", colors: ["#f8fafc","#f1f5f9","#e2e8f0","#cbd5e1","#94a3b8","#64748b","#475569","#0f172a"], roadColor: "rgba(100, 116, 139, 0.3)" },
  tileOrigin: { lat: 46.49, lon: 8.09, zoom: 12 },
  atmosphere: {
    backgroundColor: "#4d8fcf", fogColor: "#dce8f1", fogNear: 6000, fogFar: 36000,
    exposure: 0.48, turbidity: 5, rayleigh: 3.2, mieCoefficient: 0.003, mieDirectionalG: 0.72,
    sunElevationDeg: 46, sunAzimuthDeg: 154, sunColor: "#fff5df", sunIntensity: 1.65, showSunDisc: 1,
    skyLightColor: "#dff4ff", groundLightColor: "#66788d", ambientIntensity: 0.9,
    cloudLayer:  { scale: 0.00018, speed: 0.00004,  coverage: 0.2,   density: 0.14, elevation: 0.58 },
    cloudField:  { brightColor: "#ffffff", shadowColor: "#b9c9d8", fogNear: 5000, fogFar: 28000, clusterBase: 7,  clusterDensityScale: 18, altitudeMin: 1200, altitudeMax: 2400 },
    cloudVeilColor: "#c9d6e0",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#0b1018", skyGradient: ["#0f172a","#3b82f6","#f1f5f9"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#38bdf8", fillLightIntensity: 0.45, starColor: "#d9f3ff", starOpacity: 0.14 }
  },
};
