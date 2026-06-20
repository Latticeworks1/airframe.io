/**
 * Generates src/game/content/maps/{slug}/index.ts for each map.
 * Each file is a self-describing MapDefinition with atmosphere, palette, and tileOrigin inlined.
 * Run: node tools/generate-map-files.mjs
 */

import fs from "fs";
import path from "path";

const STANDARD_CARRIERS = `[
    { x: -4000, z: -3000, rotationY: Math.PI / 4,      deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
    { x:  4000, z:  3000, rotationY: -3 * Math.PI / 4, deckWidth: 76, deckLength: 395, deckHeight: 25.2 },
  ]`;

const NO_CARRIERS = `[]`;

const maps = [
  {
    slug: "island-chain",
    def: `{
  id: "island-chain",
  name: "Solomon Archipelago",
  description: "Tropical blue waters scattered with islands. Active aircraft carrier decks act as repair and rearm bays. High cloud density for fast cover.",
  seed: 1111,
  cloudDensity: 0.65,
  world:    { radius: 6000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 7500 },
  spawn:    { distMin: 3800, distMax: 4400, aglMin: 350,  aglMax: 650,  initialSpeedMs: 140, spreadZ: 600 },
  terrain:  { kind: "islands" as const, blockCount: 10, radius: { min: 1000, max: 5500 }, blockSize: { x: [400, 1200] as [number,number], y: [80, 380] as [number,number], z: [400, 1200] as [number,number] }, airfieldCount: 2 },
  layout:   { carriers: ${STANDARD_CARRIERS}, hasThunder: false, antiAirCount: 10, groundTargetsCount: 15 },
  visual:   { skyColor: "#38bdf8", fogColor: "#e0f2fe", groundColor: "#0284c7" },
  palette:  { base: "#14532d", colors: ["#1b5e20","#14532d","#2e7d32","#15803d","#22c55e","#4caf50","#4ade80","#854d0e","#a16207","#ca8a04"], roadColor: "rgba(241, 245, 249, 0.25)" },
  tileOrigin: { lat: 21.47, lon: -157.98, zoom: 12 },
  atmosphere: {
    backgroundColor: "#159dca", fogColor: "#bae6fd", fogNear: 3200, fogFar: 12500,
    exposure: 0.5, turbidity: 8, rayleigh: 2.8, mieCoefficient: 0.004, mieDirectionalG: 0.72,
    sunElevationDeg: 38, sunAzimuthDeg: 142, sunColor: "#fff2cf", sunIntensity: 1.6, showSunDisc: 1,
    skyLightColor: "#9adeff", groundLightColor: "#236f70", ambientIntensity: 0.86,
    cloudLayer:  { scale: 0.0002,  speed: 0.00006, coverage: 0.22,  density: 0.16, elevation: 0.5  },
    cloudField:  { brightColor: "#ffffff", shadowColor: "#a8c5d7", fogNear: 2800, fogFar: 11200, clusterBase: 8,  clusterDensityScale: 22, altitudeMin: 420, altitudeMax: 1240 },
    cloudVeilColor: "#aebfca",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#040e1d", skyGradient: ["#014e7a","#0ea5e9","#bae6fd"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#0ea5e9", fillLightIntensity: 0.35, starColor: "#e6f7ff", starOpacity: 0.12 }
  },
}`,
  },
  {
    slug: "desert-canyon",
    def: `{
  id: "desert-canyon",
  name: "Sinai Straits",
  description: "Carved sandstone valleys. Extreme canyon run pathways provide natural covers from heat-seekers or visual sight. Heavy AA batteries guard borders.",
  seed: 2222,
  cloudDensity: 0.15,
  world:    { radius: 6500, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 7500 },
  spawn:    { distMin: 4200, distMax: 5000, aglMin: 600,  aglMax: 1100, initialSpeedMs: 160, spreadZ: 400 },
  terrain:  { kind: "canyons" as const, blockCount: 18, radius: { min: 800, max: 5500 }, blockSize: { x: [400, 1100] as [number,number], y: [300, 1100] as [number,number], z: [400, 1100] as [number,number] }, airfieldCount: 0 },
  layout:   { carriers: ${NO_CARRIERS}, hasThunder: false, antiAirCount: 16, groundTargetsCount: 22 },
  visual:   { skyColor: "#fdba74", fogColor: "#ffedd5", groundColor: "#ca8a04" },
  palette:  { base: "#78350f", colors: ["#b45309","#d97706","#f59e0b","#ca8a04","#eab308","#facc15","#a16207","#854d0e"], roadColor: "rgba(254, 215, 170, 0.28)" },
  tileOrigin: { lat: 36.06, lon: -112.14, zoom: 12 },
  atmosphere: {
    backgroundColor: "#c96f24", fogColor: "#f5bb7b", fogNear: 2700, fogFar: 11200,
    exposure: 0.5, turbidity: 12, rayleigh: 2, mieCoefficient: 0.004, mieDirectionalG: 0.76,
    sunElevationDeg: 24, sunAzimuthDeg: 228, sunColor: "#ffb36b", sunIntensity: 1.55, showSunDisc: 1,
    skyLightColor: "#ffd7a1", groundLightColor: "#70401f", ambientIntensity: 0.82,
    cloudLayer:  { scale: 0.00016, speed: 0.000035, coverage: 0.08,  density: 0.08, elevation: 0.28 },
    cloudField:  { brightColor: "#fff7ed", shadowColor: "#c9a982", fogNear: 2600, fogFar: 10400, clusterBase: 5,  clusterDensityScale: 16, altitudeMin: 650, altitudeMax: 1450 },
    cloudVeilColor: "#c9b8a6",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#1a0f05", skyGradient: ["#2c1c0a","#ca6a14","#fed7aa"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#c2410c", fillLightIntensity: 0.45, starColor: "#ffd18a", starOpacity: 0.16 }
  },
}`,
  },
  {
    slug: "alpine-valley",
    def: `{
  id: "alpine-valley",
  name: "Alpine Corridor",
  description: "Ice valleys surrounding massive mountain spires. Tall, sharp geometry forces strategic altitude climbs or low valley defensive routing.",
  seed: 3333,
  cloudDensity: 0.4,
  world:    { radius: 6000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 7500 },
  spawn:    { distMin: 4000, distMax: 4600, aglMin: 400,  aglMax: 800,  initialSpeedMs: 150, spreadZ: 500 },
  terrain:  { kind: "alpine" as const, blockCount: 18, radius: { min: 800, max: 5500 }, blockSize: { x: [500, 1300] as [number,number], y: [600, 2000] as [number,number], z: [500, 1300] as [number,number] }, airfieldCount: 2 },
  layout:   { carriers: ${NO_CARRIERS}, hasThunder: false, antiAirCount: 8,  groundTargetsCount: 14 },
  visual:   { skyColor: "#7dd3fc", fogColor: "#f1f5f9", groundColor: "#475569" },
  palette:  { base: "#1e293b", colors: ["#f8fafc","#f1f5f9","#e2e8f0","#cbd5e1","#94a3b8","#64748b","#475569","#0f172a"], roadColor: "rgba(100, 116, 139, 0.3)" },
  tileOrigin: { lat: 46.49, lon: 8.09, zoom: 12 },
  atmosphere: {
    backgroundColor: "#4d8fcf", fogColor: "#dce8f1", fogNear: 3200, fogFar: 13200,
    exposure: 0.48, turbidity: 5, rayleigh: 3.2, mieCoefficient: 0.003, mieDirectionalG: 0.72,
    sunElevationDeg: 46, sunAzimuthDeg: 154, sunColor: "#fff5df", sunIntensity: 1.65, showSunDisc: 1,
    skyLightColor: "#dff4ff", groundLightColor: "#66788d", ambientIntensity: 0.9,
    cloudLayer:  { scale: 0.00021, speed: 0.00005,  coverage: 0.2,   density: 0.14, elevation: 0.58 },
    cloudField:  { brightColor: "#ffffff", shadowColor: "#b9c9d8", fogNear: 3000, fogFar: 11800, clusterBase: 7,  clusterDensityScale: 18, altitudeMin: 850, altitudeMax: 1750 },
    cloudVeilColor: "#c9d6e0",
    lightning: { enabled: false, color: "#ffffff", minDelay: 8, maxDelay: 16 },
    preview: { backgroundColor: "#0b1018", skyGradient: ["#0f172a","#3b82f6","#f1f5f9"] as [string,string,string], fogNear: 28, fogFar: 90, fillLightColor: "#38bdf8", fillLightIntensity: 0.45, starColor: "#d9f3ff", starOpacity: 0.14 }
  },
}`,
  },
  {
    slug: "storm-front",
    def: `{
  id: "storm-front",
  name: "North Atlantic Front",
  description: "Ominous lightning cells, dense fog layers, and heavy rain. Break radar line-of-sight instantly but beware of sudden lightning flash visual blurs.",
  seed: 4444,
  cloudDensity: 0.9,
  world:    { radius: 6000, waterHeight: 10, defaultGroundHeight: 10, maxAltitude: 7500 },
  spawn:    { distMin: 3200, distMax: 3800, aglMin: 200,  aglMax: 500,  initialSpeedMs: 130, spreadZ: 800 },
  terrain:  { kind: "storm-islands" as const, blockCount: 12, radius: { min: 1000, max: 5500 }, blockSize: { x: [400, 1200] as [number,number], y: [80, 420] as [number,number], z: [400, 1200] as [number,number] }, airfieldCount: 0 },
  layout:   { carriers: ${STANDARD_CARRIERS}, hasThunder: true,  antiAirCount: 12, groundTargetsCount: 12 },
  visual:   { skyColor: "#1e293b", fogColor: "#334155", groundColor: "#0f172a" },
  palette:  { base: "#14532d", colors: ["#1b5e20","#14532d","#2e7d32","#15803d","#22c55e","#4caf50","#4ade80","#854d0e","#a16207","#ca8a04"], roadColor: "rgba(241, 245, 249, 0.25)" },
  tileOrigin: { lat: 51.09, lon: 2.53, zoom: 12 },
  atmosphere: {
    backgroundColor: "#111827", fogColor: "#334155", fogNear: 1200, fogFar: 7600,
    exposure: 0.42, turbidity: 16, rayleigh: 0.65, mieCoefficient: 0.005, mieDirectionalG: 0.78,
    sunElevationDeg: 16, sunAzimuthDeg: 205, sunColor: "#b9c5d6", sunIntensity: 0.38, showSunDisc: 0,
    skyLightColor: "#536174", groundLightColor: "#111827", ambientIntensity: 0.58,
    cloudLayer:  { scale: 0.00028, speed: 0.00009,  coverage: 0.495, density: 0.3,  elevation: 0.72 },
    cloudField:  { brightColor: "#94a3b8", shadowColor: "#273449", fogNear: 1200, fogFar: 7000,  clusterBase: 10, clusterDensityScale: 24, altitudeMin: 320, altitudeMax: 1250 },
    cloudVeilColor: "#6e7c8c",
    lightning: { enabled: true, color: "#f1f5f9", minDelay: 4, maxDelay: 11 },
    preview: { backgroundColor: "#030509", skyGradient: ["#020617","#0f172a","#334155"] as [string,string,string], fogNear: 22, fogFar: 72, fillLightColor: "#0f172a", fillLightIntensity: 0.1, starColor: "#b8dcff", starOpacity: 0.28 }
  },
}`,
  },
];

for (const { slug, def } of maps) {
  const dir = `src/game/content/maps/${slug}`;
  fs.mkdirSync(dir, { recursive: true });

  const content = `import type { MapDefinition } from "../mapTypes";

export const map: MapDefinition = ${def};
`;
  fs.writeFileSync(path.join(dir, "index.ts"), content);
  console.log(`wrote ${dir}/index.ts`);
}

// registry.ts
const registryContent = `import type { MapDefinition } from "./mapTypes";
import { map as islandChain  } from "./island-chain";
import { map as desertCanyon } from "./desert-canyon";
import { map as alpineValley } from "./alpine-valley";
import { map as stormFront   } from "./storm-front";

export const MAP_REGISTRY: Record<string, MapDefinition> = {
  [islandChain.id]:  islandChain,
  [desertCanyon.id]: desertCanyon,
  [alpineValley.id]: alpineValley,
  [stormFront.id]:   stormFront,
};
`;
fs.writeFileSync("src/game/content/maps/registry.ts", registryContent);
console.log("wrote src/game/content/maps/registry.ts");

console.log("done.");
