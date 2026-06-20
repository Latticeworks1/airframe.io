/**
 * Bake satellite base map tiles for each game map into a single composited PNG.
 * Output lands in public/maps/{slug}.png and is served as a static asset.
 * Run once before shipping: npm run bake-maps
 *
 * Tile source: OpenStreetMap (https://www.openstreetmap.org/copyright).
 * For commercial use, switch OSM_TILE_URL to a licensed provider.
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { MAP_REGISTRY } from "../src/game/content/maps/registry";

const OSM_TILE_URL = "https://tile.openstreetmap.org";

const GRID    = 4;
const TILE_PX = 256;
const FULL_PX = TILE_PX * GRID;
const OUT_DIR  = "public/maps";
const RATE_MS  = 150;

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n      = 2 ** zoom;
  const x      = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y      = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

async function fetchTile(zoom: number, tx: number, ty: number): Promise<Buffer> {
  const url = `${OSM_TILE_URL}/${zoom}/${tx}/${ty}.png`;
  const res = await fetch(url, {
    headers: { "User-Agent": "airframe-io-bake/1.0 (latticeworks225@gmail.com; offline game asset baking)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const mapDef of Object.values(MAP_REGISTRY)) {
  const { id, tileOrigin } = mapDef;
  const outFile = path.join(OUT_DIR, `${id}.png`);
  if (fs.existsSync(outFile)) {
    console.log(`${id}: already baked, skipping (delete to re-bake)`);
    continue;
  }

  console.log(`Baking ${id}...`);
  const center = latLonToTile(tileOrigin.lat, tileOrigin.lon, tileOrigin.zoom);
  const half   = Math.floor(GRID / 2);
  const layers: { input: Buffer; left: number; top: number }[] = [];

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const tx = center.x - half + col;
      const ty = center.y - half + row;
      try {
        const buf = await fetchTile(tileOrigin.zoom, tx, ty);
        layers.push({ input: buf, left: col * TILE_PX, top: row * TILE_PX });
        process.stdout.write(".");
      } catch (e: any) {
        console.error(`\n  tile ${row},${col} failed: ${e.message} — leaving blank`);
      }
      await new Promise(r => setTimeout(r, RATE_MS));
    }
  }

  await sharp({
    create: { width: FULL_PX, height: FULL_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } }
  })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(outFile);

  console.log(`\n  -> ${outFile} (${FULL_PX}x${FULL_PX})`);
}

console.log("done.");
