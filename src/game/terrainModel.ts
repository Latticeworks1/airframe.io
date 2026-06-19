/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameMap } from "../types";
import { MapDefinition } from "./content/maps/mapTypes";
import { MAP_DEFINITIONS } from "./content/maps/mapDefinitions";

export interface TerrainBlock {
  id: string;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  material: string;
  surface: "land" | "mountain" | "canyon";
}

export interface TerrainFeature {
  id: string;
  type: "airfield";
  parentBlockId: string;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
}

export interface TerrainLayout {
  mapId: GameMap;
  seed: number;
  blocks: TerrainBlock[];
  features: TerrainFeature[];
  waterHeight: number;
  defaultGroundHeight: number;
}

export interface TerrainSample {
  height: number;
  surface: "ground" | "terrain" | "airfield" | "water";
  featureId?: string;
}

const terrainCache = new Map<GameMap, TerrainLayout>();

export function getTerrainLayout(map: MapDefinition): TerrainLayout {
  const cached = terrainCache.get(map.id);
  if (cached) return cached;
  const layout = generateTerrainLayout(map);
  terrainCache.set(map.id, layout);
  return layout;
}

function generateTerrainLayout(map: MapDefinition): TerrainLayout {
  const rand = mulberry32(map.seed);
  const blocks: TerrainBlock[] = [];
  const features: TerrainFeature[] = [];

  for (let i = 0; i < map.terrain.blockCount; i++) {
    const r = lerp(map.terrain.radius.min, map.terrain.radius.max, rand());
    const theta = rand() * Math.PI * 2;
    const scale: [number, number, number] = [
      randomRange(rand, map.terrain.blockSize.x),
      randomRange(rand, map.terrain.blockSize.y),
      randomRange(rand, map.terrain.blockSize.z)
    ];

    const block: TerrainBlock = {
      id: `terrain-${i}`,
      position: [Math.cos(theta) * r, scale[1] / 2 - 10, Math.sin(theta) * r],
      rotationY: rand() * Math.PI,
      scale,
      material: pickTerrainMaterial(map.terrain.kind, rand),
      surface:
        map.terrain.kind === "alpine"
          ? "mountain"
          : map.terrain.kind === "canyons"
          ? "canyon"
          : "land"
    };
    blocks.push(block);

    if (i < map.terrain.airfieldCount) {
      features.push({
        id: `airfield-${i}`,
        type: "airfield",
        parentBlockId: block.id,
        position: [block.position[0], scale[1] + 4, block.position[2]],
        rotationY: block.rotationY,
        scale: [120, 12, 900] // Polished runways scaled for takeoff
      });
    }
  }

  return {
    mapId: map.id,
    seed: map.seed,
    blocks,
    features,
    waterHeight: map.world.waterHeight,
    defaultGroundHeight: map.world.defaultGroundHeight
  };
}

export function sampleTerrainHeight(
  x: number,
  z: number,
  layout: TerrainLayout
): TerrainSample {
  let height = layout.defaultGroundHeight;
  let surface: TerrainSample["surface"] = "ground";
  let featureId: string | undefined;

  for (const block of layout.blocks) {
    const [bx, by, bz] = block.position;
    const [sx, sy, sz] = block.scale;
    if (pointInsideRotatedBox2D(x, z, bx, bz, sx, sz, block.rotationY)) {
      const top = by + sy / 2;
      if (top > height) {
        height = top;
        surface = "terrain";
        featureId = block.id;
      }
    }
  }

  for (const feature of layout.features) {
    const [fx, fy, fz] = feature.position;
    const [sx, sy, sz] = feature.scale;
    if (pointInsideRotatedBox2D(x, z, fx, fz, sx, sz, feature.rotationY)) {
      const top = fy + sy / 2;
      if (top > height) {
        height = top;
        surface = "airfield";
        featureId = feature.id;
      }
    }
  }

  return { height, surface, featureId };
}

function pointInsideRotatedBox2D(
  x: number,
  z: number,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationY: number
): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;
  return Math.abs(lx) <= width / 2 && Math.abs(lz) <= depth / 2;
}

function randomRange(rand: () => number, range: [number, number]) {
  return lerp(range[0], range[1], rand());
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pickTerrainMaterial(
  kind: MapDefinition["terrain"]["kind"],
  rand: () => number
): string {
  if (kind === "canyons") return rand() < 0.5 ? "clay" : "rockDark";
  if (kind === "alpine") return rand() < 0.5 ? "snow" : "rock";
  return rand() < 0.5 ? "landMid" : "landDark";
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Legacy adapters for zero-breaking changes across existing modules:
export function getDeterministicIslands(mapId: GameMap): any[] {
  const mapDef = MAP_DEFINITIONS[mapId];
  if (!mapDef) return [];
  const layout = getTerrainLayout(mapDef);
  return layout.blocks.map(block => {
    const hasAirfield = layout.features.some(f => f.parentBlockId === block.id);
    return {
      x: block.position[0],
      z: block.position[2],
      scaleX: block.scale[0],
      scaleY: block.scale[1],
      scaleZ: block.scale[2],
      rotationY: block.rotationY,
      isAirfield: hasAirfield
    };
  });
}

export function getTerrainHeight(x: number, z: number, mapId: GameMap): { height: number; isAirfield: boolean } {
  const mapDef = MAP_DEFINITIONS[mapId];
  if (!mapDef) return { height: 10, isAirfield: false };

  // If map has carrier battle groups, intercept collision to support carrier takeoff & deck landings
  if (mapDef.layout.hasCarriers) {
    // Team 1 Carrier deck range (76 width, 395 length, rotated 45deg)
    if (pointInsideRotatedBox2D(x, z, -4000, -3000, 76, 395, Math.PI / 4)) {
      return { height: 25.2, isAirfield: true };
    }
    // Team 2 Carrier deck range (76 width, 395 length, rotated -135deg)
    if (pointInsideRotatedBox2D(x, z, 4000, 3000, 76, 395, -3 * Math.PI / 4)) {
      return { height: 25.2, isAirfield: true };
    }
  }

  const layout = getTerrainLayout(mapDef);
  const sample = sampleTerrainHeight(x, z, layout);
  return {
    height: sample.height,
    isAirfield: sample.surface === "airfield"
  };
}
