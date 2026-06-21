import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = {
  id: "island-chain",
  name: "Solomon Archipelago",
  description: "Tropical islands scattered across massive blue waters. Carrier deck bases spawn far apart to divide strategic airfields. Scaled to massive proportions with a realistic heightmap terrain.",
  seed: 1111,
  cloudDensity: 0.65,
  world:    { radius: 32000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 14000 },
  spawn:    { distMin: 20000, distMax: 26000, aglMin: 500, aglMax: 1200, initialSpeedMs: 145, spreadZ: 6000 },
  terrain:  { kind: "heightmap" as const, path: "/maps/island-chain.png", elevationScale: 700 },
  layout:   { carriers: [
    { x: -20000, z: -14000, rotationY: Math.PI / 4,      deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
    { x:  20000, z:  14000, rotationY: -3 * Math.PI / 4, deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
  ], hasThunder: false, antiAirCount: 20, groundTargetsCount: 32 },
  visual:   { skyColor: "#38bdf8", fogColor: "#e0f2fe", groundColor: "#0284c7" },
  palette:  { base: "#14532d", colors: ["#1b5e20","#14532d","#2e7d32","#15803d","#22c55e","#4caf50","#4ade80","#854d0e","#a16207","#ca8a04"], roadColor: "rgba(241, 245, 249, 0.25)" },
  tileOrigin: { lat: 21.47, lon: -157.98, zoom: 12 },
  atmosphere: {
    backgroundColor: "#b85830", fogColor: "#c97a48", fogNear: 10000, fogFar: 35000,
    exposure: 0.62, turbidity: 10, rayleigh: 1.6, mieCoefficient: 0.008, mieDirectionalG: 0.88,
    sunElevationDeg: 8, sunAzimuthDeg: 262, sunColor: "#ff8c35", sunIntensity: 1.35, showSunDisc: 1,
    skyLightColor: "#ffbe80", groundLightColor: "#6b3520", ambientIntensity: 0.78,
    cloudLayer:  { scale: 0.00018, speed: 0.00005, coverage: 0.30, density: 0.22, elevation: 0.55 },
    cloudField:  { brightColor: "#ffd5a0", shadowColor: "#8a5a3f", fogNear: 18000, fogFar: 42000, clusterBase: 8, clusterDensityScale: 22, altitudeMin: 800, altitudeMax: 2200 },
    cloudVeilColor: "#b07050",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#1a0a05", skyGradient: ["#7a2e10","#c44a20","#e8834a"] as [string,string,string], fogNear: 20, fogFar: 80, fillLightColor: "#ff8c35", fillLightIntensity: 0.45, starColor: "#ffe0c0", starOpacity: 0.18 }
  },
};
