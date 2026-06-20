import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = {
  id: "island-chain",
  name: "Solomon Archipelago",
  description: "Tropical islands scattered across massive blue waters. Carrier deck bases spawn far apart to divide strategic airfields. Scaled to massive proportions with a realistic heightmap terrain.",
  seed: 1111,
  cloudDensity: 0.65,
  world:    { radius: 18000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 12000 },
  spawn:    { distMin: 11000, distMax: 14000, aglMin: 500,  aglMax: 1000, initialSpeedMs: 145, spreadZ: 800 },
  terrain:  { kind: "heightmap" as const, path: "/maps/island-chain.png", elevationScale: 600 },
  layout:   { carriers: [
    { x: -12000, z: -9000, rotationY: Math.PI / 4,      deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
    { x:  12000, z:  9000, rotationY: -3 * Math.PI / 4, deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
  ], hasThunder: false, antiAirCount: 16, groundTargetsCount: 24 },
  visual:   { skyColor: "#38bdf8", fogColor: "#e0f2fe", groundColor: "#0284c7" },
  palette:  { base: "#14532d", colors: ["#1b5e20","#14532d","#2e7d32","#15803d","#22c55e","#4caf50","#4ade80","#854d0e","#a16207","#ca8a04"], roadColor: "rgba(241, 245, 249, 0.25)" },
  tileOrigin: { lat: 21.47, lon: -157.98, zoom: 12 },
  atmosphere: {
    backgroundColor: "#159dca", fogColor: "#bae6fd", fogNear: 6000, fogFar: 36000,
    exposure: 0.5, turbidity: 8, rayleigh: 2.8, mieCoefficient: 0.004, mieDirectionalG: 0.72,
    sunElevationDeg: 38, sunAzimuthDeg: 142, sunColor: "#fff2cf", sunIntensity: 1.6, showSunDisc: 1,
    skyLightColor: "#9adeff", groundLightColor: "#236f70", ambientIntensity: 0.86,
    cloudLayer:  { scale: 0.00018,  speed: 0.00005, coverage: 0.22,  density: 0.16, elevation: 0.5  },
    cloudField:  { brightColor: "#ffffff", shadowColor: "#a8c5d7", fogNear: 5000, fogFar: 28000, clusterBase: 8,  clusterDensityScale: 22, altitudeMin: 800, altitudeMax: 2000 },
    cloudVeilColor: "#aebfca",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#040e1d", skyGradient: ["#014e7a","#0ea5e9","#bae6fd"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#0ea5e9", fillLightIntensity: 0.35, starColor: "#e6f7ff", starOpacity: 0.12 }
  },
};
