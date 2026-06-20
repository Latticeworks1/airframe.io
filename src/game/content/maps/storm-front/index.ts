import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = {
  id: "storm-front",
  name: "North Atlantic Front",
  description: "Dense cloud banks, active lightning strikes, and rain. Scaled to massive proportions with a realistic heightmap terrain.",
  seed: 4444,
  cloudDensity: 0.9,
  world:    { radius: 18000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 12000 },
  spawn:    { distMin: 10000, distMax: 13000, aglMin: 400,  aglMax: 900,  initialSpeedMs: 135, spreadZ: 1000 },
  terrain:  { kind: "heightmap" as const, path: "/maps/storm-front.png", elevationScale: 700 },
  layout:   { carriers: [
    { x: -12000, z: -9000, rotationY: Math.PI / 4,      deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
    { x:  12000, z:  9000, rotationY: -3 * Math.PI / 4, deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
  ], hasThunder: true,  antiAirCount: 16, groundTargetsCount: 20 },
  visual:   { skyColor: "#1e293b", fogColor: "#334155", groundColor: "#0f172a" },
  palette:  { base: "#14532d", colors: ["#1b5e20","#14532d","#2e7d32","#15803d","#22c55e","#4caf50","#4ade80","#854d0e","#a16207","#ca8a04"], roadColor: "rgba(241, 245, 249, 0.25)" },
  tileOrigin: { lat: 51.09, lon: 2.53, zoom: 12 },
  atmosphere: {
    backgroundColor: "#111827", fogColor: "#334155", fogNear: 3000, fogFar: 20000,
    exposure: 0.42, turbidity: 16, rayleigh: 0.65, mieCoefficient: 0.005, mieDirectionalG: 0.78,
    sunElevationDeg: 16, sunAzimuthDeg: 205, sunColor: "#b9c5d6", sunIntensity: 0.38, showSunDisc: 0,
    skyLightColor: "#536174", groundLightColor: "#111827", ambientIntensity: 0.58,
    cloudLayer:  { scale: 0.00022, speed: 0.00007,  coverage: 0.495, density: 0.3,  elevation: 0.72 },
    cloudField:  { brightColor: "#94a3b8", shadowColor: "#273449", fogNear: 2500, fogFar: 18000,  clusterBase: 10, clusterDensityScale: 24, altitudeMin: 600, altitudeMax: 1800 },
    cloudVeilColor: "#6e7c8c",
    lightning: { enabled: true, color: "#f1f5f9", minDelay: 4, maxDelay: 11 },
    preview: { backgroundColor: "#030509", skyGradient: ["#020617","#0f172a","#334155"] as [string,string,string], fogNear: 22, fogFar: 72, fillLightColor: "#0f172a", fillLightIntensity: 0.1, starColor: "#b8dcff", starOpacity: 0.28 }
  },
};
