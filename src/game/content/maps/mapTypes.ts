import { GameMap } from "../../../types";

export interface MapVisualTheme {
  skyColor: string;
  fogColor: string;
  groundColor: string;
  terrainMaterials: Record<string, string>;
}

export interface TerrainGenerationDef {
  kind: "islands" | "canyons" | "alpine" | "storm-islands";
  blockCount: number;
  radius: {
    min: number;
    max: number;
  };
  blockSize: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
  airfieldCount: number;
}

export interface MapLayoutDef {
  hasCarriers: boolean;
  hasThunder: boolean;
  antiAirCount: number;
  groundTargetsCount: number;
}

export interface SpawnConfig {
  distMin: number;          // minimum distance from center each team spawns at
  distMax: number;          // maximum distance from center
  aglMin: number;           // altitude above local terrain at spawn point (min)
  aglMax: number;           // altitude above local terrain at spawn point (max)
  initialSpeedMs: number;   // starting forward velocity (m/s)
  spreadZ: number;          // lateral spread in Z (half-width, meters)
}

export interface MapDefinition {
  id: GameMap;
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
  terrain: TerrainGenerationDef;
  layout: MapLayoutDef;
  cloudDensity: number;
  spawn: SpawnConfig;
}
