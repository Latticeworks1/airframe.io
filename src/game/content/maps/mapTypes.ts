import * as THREE from "three";

export interface MapVisualTheme {
  skyColor: string;
  fogColor: string;
  groundColor: string;
}

export interface GroundPalette {
  base: string;
  colors: string[];
  roadColor: string;
}

export interface TileOrigin {
  lat: number;
  lon: number;
  zoom: number;
}

export interface AtmosphereProfile {
  backgroundColor: THREE.ColorRepresentation;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
  exposure: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  showSunDisc: number;
  skyLightColor: THREE.ColorRepresentation;
  groundLightColor: THREE.ColorRepresentation;
  ambientIntensity: number;
  cloudLayer: {
    scale: number;
    speed: number;
    coverage: number;
    density: number;
    elevation: number;
  };
  cloudField: {
    brightColor: THREE.ColorRepresentation;
    shadowColor: THREE.ColorRepresentation;
    fogNear: number;
    fogFar: number;
    clusterBase: number;
    clusterDensityScale: number;
    altitudeMin: number;
    altitudeMax: number;
  };
  cloudVeilColor: THREE.ColorRepresentation;
  lightning: {
    enabled: boolean;
    color: THREE.ColorRepresentation;
    minDelay: number;
    maxDelay: number;
  };
  preview: {
    backgroundColor: THREE.ColorRepresentation;
    skyGradient: [
      THREE.ColorRepresentation,
      THREE.ColorRepresentation,
      THREE.ColorRepresentation
    ];
    fogNear: number;
    fogFar: number;
    fillLightColor: THREE.ColorRepresentation;
    fillLightIntensity: number;
    starColor: THREE.ColorRepresentation;
    starOpacity: number;
  };
}

export function getAtmosphereSunDirection(
  profile: Pick<AtmosphereProfile, "sunElevationDeg" | "sunAzimuthDeg">
): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - profile.sunElevationDeg);
  const theta = THREE.MathUtils.degToRad(profile.sunAzimuthDeg);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

export interface MapLayoutDef {
  carriers: import("../structures/structureTypes").StructurePlacement[];
  hasThunder: boolean;
  antiAirCount: number;
  groundTargetsCount: number;
}

export interface SpawnConfig {
  distMin: number;
  distMax: number;
  aglMin: number;
  aglMax: number;
  initialSpeedMs: number;
  spreadZ: number;
}

export type ProceduralTerrainDef = {
  kind: "islands" | "canyons" | "alpine" | "storm-islands";
  blockCount: number;
  radius: { min: number; max: number };
  blockSize: { x: [number, number]; y: [number, number]; z: [number, number] };
  airfieldCount: number;
};

export type TerrainGenerationDef =
  | ProceduralTerrainDef
  | { kind: "heightmap"; path: string; elevationScale: number }
  | { kind: "glb"; path: string }
  | { kind: "tiled-glb"; tileDir: string; tileSize: number; tileGrid: number; loadRadius: number };

export function isProceduralTerrain(def: TerrainGenerationDef): def is ProceduralTerrainDef {
  return (
    def.kind === "islands" ||
    def.kind === "canyons" ||
    def.kind === "alpine" ||
    def.kind === "storm-islands"
  );
}

export interface MapDefinition {
  id: string;
  name: string;
  description: string;
  seed: number;
  world: {
    radius: number;
    waterHeight: number;
    defaultGroundHeight: number;
    maxAltitude: number;
  };
  visual: MapVisualTheme;
  palette: GroundPalette;
  tileOrigin: TileOrigin;
  atmosphere: AtmosphereProfile;
  terrain: TerrainGenerationDef;
  layout: MapLayoutDef;
  cloudDensity: number;
  spawn: SpawnConfig;
}

// Geometry baked from OSM Overpass data.
// All point coordinates are flat interleaved pairs [x0,y0, x1,y1, ...]
// in normalized map space: 0.0 = west/north edge, 1.0 = east/south edge.
// Rings are closed (last point == first point).
export interface BakedMapGeometry {
  version: 1;
  // Filled water/ocean polygons
  waterRings: number[][];
  // Land-use areas
  landUse: { kind: "forest" | "urban" | "farmland" | "scrub"; ring: number[] }[];
  // Road centerlines (not closed)
  roads: { kind: "motorway" | "primary" | "secondary" | "tertiary" | "track"; pts: number[] }[];
  // Runway rectangles: center cx,cy in map space, heading in degrees, length/width in map-space units
  runways: { cx: number; cy: number; heading: number; length: number; width: number }[];
  // Port / harbour anchor points
  ports: { x: number; y: number }[];
}

export const KnownMaps = {
  IslandChain:  "island-chain",
  DesertCanyon: "desert-canyon",
  AlpineValley: "alpine-valley",
  StormFront:   "storm-front",
} as const;

export type MapId = string;
