import type { MapDefinition } from "../mapTypes";

// Requires a valid Google Maps API Key to load Photorealistic 3D Tiles.
const GOOGLE_API_KEY = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || "YOUR_API_KEY";

export const map: MapDefinition = {
  id: "earth-3d",
  name: "Google Earth 3D Tiles",
  description: "Photorealistic 3D tiles streamed directly from Google Earth. Features highly detailed terrain and cityscapes across the globe, complemented by volumetric clouds.",
  seed: 9999,
  cloudDensity: 0.8,
  world:    { radius: 64000, waterHeight: 0, defaultGroundHeight: 0, maxAltitude: 20000 },
  spawn:    { distMin: 5000, distMax: 8000, aglMin: 1500, aglMax: 3000, initialSpeedMs: 145, spreadZ: 2000 },
  terrain:  { 
    kind: "3d-tiles" as const, 
    url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
    displayActiveTiles: true,
    errorTarget: 12.0 // Relaxed error target to improve streaming performance at flight speeds
  },
  layout:   { carriers: [], hasThunder: true, antiAirCount: 0, groundTargetsCount: 0 },
  visual:   { skyColor: "#3b82f6", fogColor: "#93c5fd", groundColor: "#1e3a8a" },
  palette:  { base: "#1e293b", colors: ["#0f172a", "#1e293b", "#334155"], roadColor: "rgba(255, 255, 255, 0.1)" },
  tileOrigin: { lat: 36.1627, lon: -115.1398, zoom: 15 }, // Las Vegas
  atmosphere: {
    backgroundColor: "#c25038", fogColor: "#c8706a", fogNear: 15000, fogFar: 40000,
    exposure: 0.58, turbidity: 3.2, rayleigh: 2.4, mieCoefficient: 0.004, mieDirectionalG: 0.97,
    sunElevationDeg: 25, sunAzimuthDeg: 120, sunColor: "#ffaa33", sunIntensity: 1.0, showSunDisc: 1,
    skyLightColor: "#e8b0b8", groundLightColor: "#6b3020", ambientIntensity: 0.68,
    cloudLayer:  { scale: 0.00018, speed: 0.00005, coverage: 0.45, density: 0.35, elevation: 0.52 },
    cloudField:  { brightColor: "#ffc898", shadowColor: "#7a5868", fogNear: 18000, fogFar: 42000, clusterBase: 8, clusterDensityScale: 22, altitudeMin: 800, altitudeMax: 2200 },
    cloudVeilColor: "#c06858",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#1a0a05", skyGradient: ["#7a2e10","#c44a20","#e8834a"] as [string,string,string], fogNear: 20, fogFar: 80, fillLightColor: "#ffaa33", fillLightIntensity: 0.42, starColor: "#ffe0c0", starOpacity: 0.18 }
  },
};
