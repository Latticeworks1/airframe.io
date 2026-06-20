/**
 * Bake OSM geometry for each map into a lightweight JSON file.
 * Output: public/maps/{slug}.geom.json — loaded at runtime by mapGeometryRenderer.
 *
 * Data source: Overpass API (https://overpass-api.de), free for reasonable use.
 * Mirrors: overpass.kumi.systems, overpass.openstreetmap.ru
 *
 * Run once before shipping: npm run bake-maps
 * Delete a .geom.json to force re-bake for that map.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { MAP_REGISTRY } from "../src/game/content/maps/registry";
import type { BakedMapGeometry } from "../src/game/content/maps/mapTypes";

dotenv.config();

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OUT_DIR      = "public/maps";

// Degrees of latitude/longitude per meter at mid-latitudes (~0.00001 deg/m)
const DEG_PER_M = 1 / 111_000;

function calculateGoogleMapsZoom(lat: number, radius: number): number {
  const C = 40_075_016;
  const metersPerMap = radius * 2;
  const zoom = Math.log2((1280 * C * Math.cos(lat * Math.PI / 180)) / (256 * metersPerMap));
  return Math.max(0, Math.min(21, Math.round(zoom)));
}

async function fetchElevationsOpenMeteo(
  points: { lat: number; lon: number }[]
): Promise<Float32Array> {
  const elevations = new Float32Array(points.length);
  const batchSize = 100; // Open-Meteo supports up to 100 coordinates per request

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const lats = batch.map(p => p.lat.toFixed(6)).join(",");
    const lons = batch.map(p => p.lon.toFixed(6)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    let success = false;
    let retries = 5;
    while (!success && retries > 0) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          console.warn("  Open-Meteo Rate Limited (429). Aborting and falling back to procedural generation…");
          throw new Error("RATE_LIMITED");
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { elevation?: number[] };
        if (!data.elevation || data.elevation.length !== batch.length) {
          throw new Error(`Incomplete results: expected ${batch.length}, got ${data.elevation?.length ?? 0}`);
        }
        for (let j = 0; j < data.elevation.length; j++) {
          elevations[i + j] = data.elevation[j];
        }
        success = true;
      } catch (e: any) {
        if (e.message === "RATE_LIMITED") {
          throw e;
        }
        retries--;
        console.warn(`  Open-Meteo Batch failed: ${e.message}. Retrying (${retries} left)…`);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    if (!success) {
      throw new Error(`Failed to fetch elevations from Open-Meteo at batch starting from index ${i}`);
    }
    // Rate limit prevention: 1000ms delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return elevations;
}

async function fetchElevations(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  gridSize: number,
  apiKey?: string
): Promise<Float32Array> {
  const points: { lat: number; lon: number }[] = [];
  const stepLat = (maxLat - minLat) / (gridSize - 1);
  const stepLon = (maxLon - minLon) / (gridSize - 1);

  for (let r = 0; r < gridSize; r++) {
    const lat = maxLat - r * stepLat;
    for (let c = 0; c < gridSize; c++) {
      const lon = minLon + c * stepLon;
      points.push({ lat, lon });
    }
  }

  if (apiKey) {
    console.log("  Attempting to fetch elevations via Google Maps Elevation API…");
    try {
      const elevations = new Float32Array(gridSize * gridSize);
      const batchSize = 512;
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        const locString = batch.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join("|");
        const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(locString)}&key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { results?: { elevation: number }[], status: string, error_message?: string };
        if (data.status !== "OK") {
          throw new Error(`API error: ${data.status} ${data.error_message || ""}`);
        }
        for (let j = 0; j < data.results.length; j++) {
          elevations[i + j] = data.results[j].elevation;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return elevations;
    } catch (e: any) {
      console.warn(`  Google Elevation API failed: ${e.message}. Falling back to Open-Meteo API…`);
    }
  }

  console.log("  Fetching elevations via Open-Meteo Elevation API (Free, no key required)…");
  return fetchElevationsOpenMeteo(points);
}

// Ramer-Douglas-Peucker simplification on flat interleaved [x,y,...] array
function rdp(pts: number[], epsilon: number): number[] {
  if (pts.length < 6) return pts;
  const n = pts.length / 2;
  let maxDist = 0;
  let maxIdx  = 0;
  const ax = pts[0], ay = pts[1], bx = pts[n * 2 - 2], by = pts[n * 2 - 1];
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < n - 1; i++) {
    const px = pts[i * 2], py = pts[i * 2 + 1];
    let dist: number;
    if (lenSq === 0) {
      dist = Math.hypot(px - ax, py - ay);
    } else {
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      dist = Math.hypot(px - ax - t * dx, py - ay - t * dy);
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = rdp(pts.slice(0, (maxIdx + 1) * 2), epsilon);
    const right = rdp(pts.slice(maxIdx * 2), epsilon);
    return [...left.slice(0, -2), ...right];
  }
  return [ax, ay, bx, by];
}

interface OsmNode { id: number; lat: number; lon: number }
interface OsmWay  { id: number; nodes: number[]; tags: Record<string, string> }
interface OsmResponse { elements: (OsmNode | OsmWay)[] }

async function queryOverpass(ql: string): Promise<OsmResponse> {
  const body = `data=${encodeURIComponent(ql)}`;
  const res  = await fetch(OVERPASS_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "airframe-io-bake/1.0 (latticeworks225@gmail.com; offline game asset baking)"
    },
    body,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json() as Promise<OsmResponse>;
}

function buildNodeMap(elements: OsmResponse["elements"]): Map<number, OsmNode> {
  const m = new Map<number, OsmNode>();
  for (const el of elements) {
    if ("lat" in el) m.set(el.id, el as OsmNode);
  }
  return m;
}

function wayToNorm(
  way:     OsmWay,
  nodes:   Map<number, OsmNode>,
  minLat:  number,
  maxLat:  number,
  minLon:  number,
  maxLon:  number,
): number[] | null {
  const pts: number[] = [];
  const latRange = maxLat - minLat;
  const lonRange = maxLon - minLon;
  for (const nid of way.nodes) {
    const n = nodes.get(nid);
    if (!n) return null;
    pts.push(
      (n.lon - minLon) / lonRange,
      (n.lat - minLat) / latRange,
    );
  }
  return pts;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const mapDef of Object.values(MAP_REGISTRY)) {
  const { id, tileOrigin, world } = mapDef;
  const outFile = path.join(OUT_DIR, `${id}.geom.json`);

  const heightmapFile = path.join(OUT_DIR, `${id}.png`);
  const hasGeom = fs.existsSync(outFile);
  const hasHeightmap = fs.existsSync(heightmapFile);

  if (hasGeom && hasHeightmap) {
    console.log(`${id}: already baked, skipping (delete to re-bake)`);
    continue;
  }

  // Compute bounding box from world radius
  const halfDeg   = world.radius * DEG_PER_M;
  const minLat    = tileOrigin.lat - halfDeg;
  const maxLat    = tileOrigin.lat + halfDeg;
  const minLon    = tileOrigin.lon - halfDeg / Math.cos(tileOrigin.lat * Math.PI / 180);
  const maxLon    = tileOrigin.lon + halfDeg / Math.cos(tileOrigin.lat * Math.PI / 180);
  const bbox      = `${minLat},${minLon},${maxLat},${maxLon}`;

  if (!hasGeom) {
    const ql = `
[out:json][timeout:90];
(
  way["natural"~"^(water|coastline)$"](${bbox});
  relation["natural"="water"]["type"="multipolygon"](${bbox});
  way["landuse"~"^(forest|residential|commercial|industrial|farmland|scrub)$"](${bbox});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|track)$"](${bbox});
  way["aeroway"="runway"](${bbox});
  node["aeroway"~"^(aerodrome|helipad)$"](${bbox});
  node["harbour"="yes"](${bbox});
  node["amenity"="ferry_terminal"](${bbox});
);
out body;
>;
out skel qt;
    `.trim();

    console.log(`Baking ${id} geometry (bbox ${bbox})…`);
    let data: OsmResponse;
    try {
      data = await queryOverpass(ql);
      const nodes    = buildNodeMap(data.elements);
      const ways     = data.elements.filter((el): el is OsmWay => "nodes" in el);
      const epsilon  = 0.003; // simplification threshold in normalized space

      const geom: BakedMapGeometry = {
        version:    1,
        waterRings: [],
        landUse:    [],
        roads:      [],
        runways:    [],
        ports:      [],
      };

      for (const way of ways) {
        const pts = wayToNorm(way, nodes, minLat, maxLat, minLon, maxLon);
        if (!pts) continue;
        const tags = way.tags ?? {};

        if (tags["natural"] === "water" || tags["natural"] === "coastline") {
          const s = rdp(pts, epsilon);
          if (s.length >= 6) geom.waterRings.push(s);
          continue;
        }

        const landuse = tags["landuse"];
        if (landuse === "forest" || landuse === "scrub") {
          const s = rdp(pts, epsilon);
          if (s.length >= 6) geom.landUse.push({ kind: landuse === "scrub" ? "scrub" : "forest", ring: s });
          continue;
        }
        if (landuse === "residential" || landuse === "commercial" || landuse === "industrial") {
          const s = rdp(pts, epsilon);
          if (s.length >= 6) geom.landUse.push({ kind: "urban", ring: s });
          continue;
        }
        if (landuse === "farmland") {
          const s = rdp(pts, epsilon);
          if (s.length >= 6) geom.landUse.push({ kind: "farmland", ring: s });
          continue;
        }

        const hw = tags["highway"];
        if (hw === "motorway" || hw === "trunk") {
          const s = rdp(pts, epsilon * 0.5);
          if (s.length >= 4) geom.roads.push({ kind: "motorway", pts: s });
          continue;
        }
        if (hw === "primary") {
          const s = rdp(pts, epsilon);
          if (s.length >= 4) geom.roads.push({ kind: "primary", pts: s });
          continue;
        }
        if (hw === "secondary") {
          const s = rdp(pts, epsilon * 1.5);
          if (s.length >= 4) geom.roads.push({ kind: "secondary", pts: s });
          continue;
        }
        if (hw === "tertiary") {
          const s = rdp(pts, epsilon * 2);
          if (s.length >= 4) geom.roads.push({ kind: "tertiary", pts: s });
          continue;
        }
        if (hw === "track") {
          const s = rdp(pts, epsilon * 3);
          if (s.length >= 4) geom.roads.push({ kind: "track", pts: s });
          continue;
        }

        if (tags["aeroway"] === "runway") {
          if (pts.length < 4) continue;
          // Compute center and heading from first and last node
          const x0 = pts[0], y0 = pts[1];
          const xN = pts[pts.length - 2], yN = pts[pts.length - 1];
          const cx = (x0 + xN) / 2, cy = (y0 + yN) / 2;
          const heading = Math.atan2(xN - x0, yN - y0) * 180 / Math.PI;
          const length  = Math.hypot(xN - x0, yN - y0);
          geom.runways.push({ cx, cy, heading, length, width: length * 0.04 });
        }
      }

      // Harbour / ferry terminal nodes
      for (const el of data.elements) {
        if (!("lat" in el)) continue;
        const n = el as OsmNode & { tags?: Record<string, string> };
        if (!n.tags) continue;
        if (n.tags["harbour"] === "yes" || n.tags["amenity"] === "ferry_terminal") {
          const x = (n.lon - minLon) / (maxLon - minLon);
          const y = (n.lat - minLat) / (maxLat - minLat);
          geom.ports.push({ x, y });
        }
      }

      const json = JSON.stringify(geom);
      fs.writeFileSync(outFile, json);
      const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
      console.log(`  -> ${outFile} (${kb} KB, ${geom.waterRings.length} water rings, ${geom.roads.length} roads, ${geom.runways.length} runways)`);
    } catch (e: any) {
      console.error(`  Overpass failed for ${id}: ${e.message}`);
    }
  } else {
    console.log(`  [Info] ${id}.geom.json already exists, skipping Overpass query.`);
  }

  // Bake elevation heightmap (uses Google Maps Elevation API if key is available, falls back to Open-Meteo or procedural)
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  console.log(`  Baking elevation heightmap for ${id}…`);
  const gridSize = 32;
  let elevations: Float32Array;
  try {
    elevations = await fetchElevations(minLat, maxLat, minLon, maxLon, gridSize, GOOGLE_MAPS_API_KEY);
  } catch (e: any) {
    console.warn(`  Elevation API query failed for ${id}: ${e.message}. Generating high-quality procedural fallback heightmap instead…`);
    elevations = new Float32Array(gridSize * gridSize);
    
    // Seed-based procedural heightmap generator
    const seed = mapDef.seed || 1111;
    function random(x: number, y: number) {
      const sx = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
      return sx - Math.floor(sx);
    }
    const noise = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = random(ix, iy), b = random(ix + 1, iy), c = random(ix, iy + 1), d = random(ix + 1, iy + 1);
      const ux = fx * fx * (3.0 - 2.0 * fx), uy = fy * fy * (3.0 - 2.0 * fy);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    };
    
    // Smooth value noise helper
    const getNoiseValue = (r: number, c: number) => {
      const x = r * 0.125;
      const y = c * 0.125;
      return noise(x, y) * 0.5 + noise(x * 2, y * 2) * 0.25 + noise(x * 4, y * 4) * 0.125 + noise(x * 8, y * 8) * 0.125;
    };

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const idx = r * gridSize + c;
        const val = getNoiseValue(r, c);

        if (id.includes("alpine")) {
          // Sharp steep alpine ridges
          elevations[idx] = Math.pow(val, 2.5) * 1200;
        } else if (id.includes("desert") || id.includes("canyon")) {
          // Flat plateau canyon shapes
          const plateau = Math.max(0.15, Math.min(0.8, Math.abs(val - 0.5) * 2.0));
          elevations[idx] = plateau * 800;
        } else if (id.includes("storm") || id.includes("front")) {
          // Rolling stormy cliffs
          elevations[idx] = Math.max(0, val - 0.25) * 600;
        } else {
          // Rolling hills for islands/others
          elevations[idx] = Math.max(0, val - 0.3) * 400;
        }
      }
    }
  }

  // Save heightmap to PNG
  try {
    let maxH = 10;
    for (let i = 0; i < elevations.length; i++) {
      if (elevations[i] < 0) elevations[i] = 0;
      if (elevations[i] > maxH) maxH = elevations[i];
    }

    const pixels = new Uint8Array(gridSize * gridSize * 4);
    for (let i = 0; i < elevations.length; i++) {
      const val = Math.min(255, Math.max(0, Math.round((elevations[i] / maxH) * 255)));
      const idx = i * 4;
      pixels[idx]     = val; // R
      pixels[idx + 1] = val; // G
      pixels[idx + 2] = val; // B
      pixels[idx + 3] = 255; // A
    }

    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(pixels), {
      raw: {
        width: gridSize,
        height: gridSize,
        channels: 4
      }
    })
      .png()
      .toFile(heightmapFile + ".tmp");

    fs.renameSync(heightmapFile + ".tmp", heightmapFile);
    console.log(`  [Success] Saved elevation heightmap to ${heightmapFile} (max elevation: ${Math.round(maxH)}m)`);
  } catch (e: any) {
    console.error(`  Elevation query failed for ${id}: ${e.message}`);
  }

  // Be polite to the Overpass API
  await new Promise(r => setTimeout(r, 2000));
}

console.log("done.");
