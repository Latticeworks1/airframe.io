import { MapDefinition, ProceduralTerrainDef, isProceduralTerrain } from "./content/maps/mapTypes";
import { MAP_REGISTRY } from "./content/maps/registry";
import { resolveCarriers } from "./content/structures/registry";

// --- Heightmap support ---

export interface HeightmapData {
  buffer: Float32Array;
  width: number;
  height: number;
  worldRadius: number;
  elevationScale: number;
}

const heightmapCache = new Map<string, HeightmapData>();

export async function loadHeightmap(
  pathStr: string,
  worldRadius: number,
  elevationScale: number
): Promise<HeightmapData> {
  if (heightmapCache.has(pathStr)) return heightmapCache.get(pathStr)!;

  if (typeof window === "undefined") {
    // Node environment
    try {
      const fs = await import(/* @vite-ignore */ "fs");
      const path = await import(/* @vite-ignore */ "path");
      const sharp = (await import(/* @vite-ignore */ "sharp") as any).default;

      const cleanPath = pathStr.startsWith("/") ? pathStr.slice(1) : pathStr;
      const fullPath = path.join(process.cwd(), "public", cleanPath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${fullPath}`);
      }

      const fileBuffer = fs.readFileSync(fullPath);
      const { data, info } = await sharp(fileBuffer).raw().toBuffer({ resolveWithObject: true });
      
      const channels = info.channels;
      const buf = new Float32Array(info.width * info.height);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = data[i * channels] / 255;
      }

      const heightmapData: HeightmapData = {
        buffer: buf,
        width: info.width,
        height: info.height,
        worldRadius,
        elevationScale
      };
      heightmapCache.set(pathStr, heightmapData);
      return heightmapData;
    } catch (err) {
      console.error(`Failed to load heightmap headlessly for ${pathStr}:`, err);
      throw err;
    }
  }

  // Browser environment
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const buf = new Float32Array(img.width * img.height);
      for (let i = 0; i < buf.length; i++) buf[i] = px[i * 4] / 255;
      const data: HeightmapData = { buffer: buf, width: img.width, height: img.height, worldRadius, elevationScale };
      heightmapCache.set(pathStr, data);
      resolve(data);
    };
    img.onerror = () => reject(new Error(`Failed to load heightmap: ${pathStr}`));
    const baseUrl = ((import.meta as any).env.BASE_URL || "/").replace(/\/$/, "");
    img.src = pathStr.startsWith("http") ? pathStr : `${baseUrl}${pathStr}`;
  });
}

export function sampleHeightmapAt(data: HeightmapData, x: number, z: number): number {
  const nx = (x / (data.worldRadius * 2) + 0.5) * (data.width - 1);
  const nz = (z / (data.worldRadius * 2) + 0.5) * (data.height - 1);
  const x0 = Math.max(0, Math.floor(nx)), x1 = Math.min(x0 + 1, data.width - 1);
  const z0 = Math.max(0, Math.floor(nz)), z1 = Math.min(z0 + 1, data.height - 1);
  const fx = nx - x0, fz = nz - z0;
  const w = data.width;
  const h = data.buffer[z0 * w + x0] * (1 - fx) * (1 - fz)
          + data.buffer[z0 * w + x1] * fx * (1 - fz)
          + data.buffer[z1 * w + x0] * (1 - fx) * fz
          + data.buffer[z1 * w + x1] * fx * fz;
  return h * data.elevationScale;
}

export function getHeightmapData(path: string): HeightmapData | undefined {
  return heightmapCache.get(path);
}

export function registerHeightmap(key: string, data: HeightmapData): void {
  heightmapCache.set(key, data);
}

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
  mapId: string;
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

const terrainCache = new Map<string, TerrainLayout>();

export function getTerrainLayout(map: MapDefinition): TerrainLayout {
  const cached = terrainCache.get(map.id);
  if (cached) return cached;
  const layout = generateTerrainLayout(map);
  terrainCache.set(map.id, layout);
  return layout;
}

function generateTerrainLayout(map: MapDefinition): TerrainLayout {
  if (!isProceduralTerrain(map.terrain)) {
    return {
      mapId: map.id,
      seed: map.seed,
      blocks: [],
      features: [],
      waterHeight: map.world.waterHeight,
      defaultGroundHeight: map.world.defaultGroundHeight
    };
  }

  const rand = mulberry32(map.seed);
  const blocks: TerrainBlock[] = [];
  const features: TerrainFeature[] = [];
  const terrain = map.terrain;

  for (let i = 0; i < terrain.blockCount; i++) {
    const r = lerp(terrain.radius.min, terrain.radius.max, rand());
    const theta = rand() * Math.PI * 2;
    const scale: [number, number, number] = [
      randomRange(rand, terrain.blockSize.x),
      randomRange(rand, terrain.blockSize.y),
      randomRange(rand, terrain.blockSize.z)
    ];

    const block: TerrainBlock = {
      id: `terrain-${i}`,
      position: [Math.cos(theta) * r, scale[1] / 2 - 10, Math.sin(theta) * r],
      rotationY: rand() * Math.PI,
      scale,
      material: pickTerrainMaterial(terrain.kind, rand),
      surface:
        terrain.kind === "alpine"
          ? "mountain"
          : terrain.kind === "canyons"
          ? "canyon"
          : "land"
    };
    blocks.push(block);

    if (i < terrain.airfieldCount) {
      features.push({
        id: `airfield-${i}`,
        type: "airfield",
        parentBlockId: block.id,
        position: [block.position[0], scale[1] + 4, block.position[2]],
        rotationY: block.rotationY,
        scale: [120, 12, 900]
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
  kind: ProceduralTerrainDef["kind"],
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

export function getTerrainHeight(x: number, z: number, mapId: string): { height: number; isAirfield: boolean } {
  const mapDef = MAP_REGISTRY[mapId];
  if (!mapDef) return { height: 10, isAirfield: false };

  for (const carrier of resolveCarriers(mapDef.layout.carriers)) {
    if (pointInsideRotatedBox2D(x, z, carrier.x, carrier.z, carrier.deckWidth, carrier.deckLength, carrier.rotationY)) {
      return { height: carrier.deckHeight, isAirfield: true };
    }
  }

  // Heightmap path: bilinear lookup if data is cached.
  // Clamp to waterHeight so ocean areas use the visual water surface, not the
  // sub-water floor value encoded in the heightmap (which would be near 0 and
  // disconnect physics ground from the rendered water plane at waterHeight+0.3).
  if (mapDef.terrain.kind === "heightmap") {
    const data = getHeightmapData(mapDef.terrain.path);
    if (data) {
      const raw = sampleHeightmapAt(data, x, z);
      const h = Math.max(raw, mapDef.world.waterHeight);
      return { height: h, isAirfield: false };
    }
    return { height: mapDef.world.defaultGroundHeight, isAirfield: false };
  }

  if (mapDef.terrain.kind === "glb") {
    const data = getHeightmapData(mapId);
    if (data) {
      const raw = sampleHeightmapAt(data, x, z);
      return { height: Math.max(raw, mapDef.world.waterHeight), isAirfield: false };
    }
    return { height: mapDef.world.defaultGroundHeight, isAirfield: false };
  }

  const layout = getTerrainLayout(mapDef);
  const sample = sampleTerrainHeight(x, z, layout);
  return {
    height: sample.height,
    isAirfield: sample.surface === "airfield"
  };
}
