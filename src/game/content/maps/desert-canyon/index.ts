import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = {
  id: "desert-canyon",
  name: "Sinai Straits",
  description: "Winding sandstone canyons and open desert plates. Scaled to massive proportions with a realistic heightmap terrain.",
  seed: 2222,
  cloudDensity: 0.15,
  world:    { radius: 18000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 12000 },
  spawn:    { distMin: 12000, distMax: 15000, aglMin: 800,  aglMax: 1500, initialSpeedMs: 160, spreadZ: 600 },
  terrain:  { kind: "heightmap" as const, path: "/maps/desert-canyon.png", elevationScale: 2700 },
  layout:   { carriers: [], hasThunder: false, antiAirCount: 24, groundTargetsCount: 30 },
  visual:   { skyColor: "#fdba74", fogColor: "#ffedd5", groundColor: "#ca8a04" },
  palette:  { base: "#78350f", colors: ["#b45309","#d97706","#f59e0b","#ca8a04","#eab308","#facc15","#a16207","#854d0e"], roadColor: "rgba(254, 215, 170, 0.28)" },
  tileOrigin: { lat: 36.06, lon: -112.14, zoom: 12 },
  atmosphere: {
    backgroundColor: "#c96f24", fogColor: "#f5bb7b", fogNear: 5000, fogFar: 32000,
    exposure: 0.5, turbidity: 12, rayleigh: 2, mieCoefficient: 0.004, mieDirectionalG: 0.76,
    sunElevationDeg: 24, sunAzimuthDeg: 228, sunColor: "#ffb36b", sunIntensity: 1.55, showSunDisc: 1,
    skyLightColor: "#ffd7a1", groundLightColor: "#70401f", ambientIntensity: 0.82,
    cloudLayer:  { scale: 0.00015, speed: 0.00003, coverage: 0.08,  density: 0.08, elevation: 0.28 },
    cloudField:  { brightColor: "#fff7ed", shadowColor: "#c9a982", fogNear: 4500, fogFar: 24000, clusterBase: 5,  clusterDensityScale: 16, altitudeMin: 1000, altitudeMax: 2000 },
    cloudVeilColor: "#c9b8a6",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#1a0f05", skyGradient: ["#2c1c0a","#ca6a14","#fed7aa"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#c2410c", fillLightIntensity: 0.45, starColor: "#ffd18a", starOpacity: 0.16 }
  },
};
