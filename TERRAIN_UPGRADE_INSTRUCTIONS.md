# Terrain heightmap upgrade — implementation instructions

## What this does and why

Every map in MAP_REGISTRY currently has `terrain: { kind: "heightmap", path: "/maps/{id}.png", elevationScale: N }`. The existing `bake-maps.ts` tool writes those PNGs at 32×32 pixel resolution using the Open-Meteo elevation API, which is far too coarse for a game with a world radius of 18–32 km. This upgrade replaces those PNGs with 512×512 heightmaps sourced from AWS Terrain Tiles (Terrarium format), which is a free, no-API-key raster elevation dataset. The rest of the codebase — `loadHeightmap`, `sampleHeightmapAt`, `getTerrainHeight`, `TerrainBuilder` — does not change at all. The only things that change are the PNG files and the `elevationScale` numbers in the four map definition files.

## Files you will create

One file: `tools/bake-terrain.ts`

## Files you will modify after running the tool

Four map definition files, one field each:
- `src/game/content/maps/island-chain/index.ts` — change `elevationScale`
- `src/game/content/maps/desert-canyon/index.ts` — change `elevationScale`
- `src/game/content/maps/alpine-valley/index.ts` — change `elevationScale`
- `src/game/content/maps/storm-front/index.ts` — change `elevationScale`

## Files you must not touch

`tools/bake-maps.ts`, `src/game/terrainModel.ts`, `src/game/mapGeometryRenderer.ts`, `src/game/renderer/TerrainBuilder.ts`, `package.json` dependencies section, `src/game/content/maps/registry.ts`, and everything under `src/game/content/maps/*/index.ts` except the `elevationScale` value. Do not add any new npm packages. Do not add Cesium as a dependency to this project. Do not rename any existing files.

---

## Step 1 — Create `tools/bake-terrain.ts`

Create a new file at the path `tools/bake-terrain.ts` (same directory as `bake-maps.ts`). The full content of the file is below. Copy it exactly. Do not add comments. Do not rename variables. Do not restructure the functions.

```typescript
import fs from "fs";
import path from "path";
import https from "https";
import sharp from "sharp";
import { MAP_REGISTRY } from "../src/game/content/maps/registry";

const OUT_DIR = "public/maps";
const ZOOM = 12;
const OUT_SIZE = 512;

function latLonToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileTopLeftLatLon(tx: number, ty: number, z: number) {
  const n = 2 ** z;
  const lon = (tx / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  return { lat: (latRad * 180) / Math.PI, lon };
}

function fetchRaw(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const mapDef of Object.values(MAP_REGISTRY)) {
    const { id, tileOrigin, world } = mapDef;
    const outFile = path.join(OUT_DIR, `${id}.png`);

    console.log(`\nBaking terrain for ${id}  (lat=${tileOrigin.lat}, lon=${tileOrigin.lon}, radius=${world.radius}m)`);

    const METERS_PER_DEG_LAT = 111320;
    const latSpan = world.radius / METERS_PER_DEG_LAT;
    const lonSpan = world.radius / (METERS_PER_DEG_LAT * Math.cos((tileOrigin.lat * Math.PI) / 180));
    const minLat = tileOrigin.lat - latSpan;
    const maxLat = tileOrigin.lat + latSpan;
    const minLon = tileOrigin.lon - lonSpan;
    const maxLon = tileOrigin.lon + lonSpan;

    const nwTile = latLonToTile(maxLat, minLon, ZOOM);
    const seTile = latLonToTile(minLat, maxLon, ZOOM);
    const tileMinX = nwTile.x;
    const tileMaxX = seTile.x;
    const tileMinY = nwTile.y;
    const tileMaxY = seTile.y;
    const tilesW = tileMaxX - tileMinX + 1;
    const tilesH = tileMaxY - tileMinY + 1;
    const TILE_PX = 256;
    const compW = tilesW * TILE_PX;
    const compH = tilesH * TILE_PX;

    console.log(`  Fetching ${tilesW * tilesH} Terrarium tiles (${tilesW}x${tilesH})...`);

    const elev = new Float32Array(compW * compH);

    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      for (let tx = tileMinX; tx <= tileMaxX; tx++) {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
        let tileBuf: Buffer;
        try {
          tileBuf = await fetchRaw(url);
        } catch (err) {
          console.warn(`  Warning: failed to fetch ${ZOOM}/${tx}/${ty}, filling with 0`);
          continue;
        }
        const { data, info } = await sharp(tileBuf).raw().toBuffer({ resolveWithObject: true });
        const ch = info.channels;
        const sz = info.width;
        const offX = (tx - tileMinX) * TILE_PX;
        const offY = (ty - tileMinY) * TILE_PX;
        for (let py = 0; py < sz; py++) {
          for (let px = 0; px < sz; px++) {
            const i = py * sz + px;
            const h = data[i * ch] * 256 + data[i * ch + 1] + data[i * ch + 2] / 256 - 32768;
            elev[(offY + py) * compW + (offX + px)] = Math.max(0, h);
          }
        }
      }
    }

    let maxH = 1;
    for (let i = 0; i < elev.length; i++) if (elev[i] > maxH) maxH = elev[i];
    const elevationScale = Math.max(100, Math.ceil(maxH / 100) * 100);

    const compNW = tileTopLeftLatLon(tileMinX, tileMinY, ZOOM);
    const compSE = tileTopLeftLatLon(tileMaxX + 1, tileMaxY + 1, ZOOM);
    const compDLon = compSE.lon - compNW.lon;
    const compDLat = compNW.lat - compSE.lat;

    const bboxLeft   = ((minLon - compNW.lon) / compDLon) * compW;
    const bboxRight  = ((maxLon - compNW.lon) / compDLon) * compW;
    const bboxTop    = ((compNW.lat - maxLat) / compDLat) * compH;
    const bboxBottom = ((compNW.lat - minLat) / compDLat) * compH;

    const pixels = new Uint8Array(OUT_SIZE * OUT_SIZE * 4);
    for (let oy = 0; oy < OUT_SIZE; oy++) {
      for (let ox = 0; ox < OUT_SIZE; ox++) {
        const srcX = bboxLeft + (ox / (OUT_SIZE - 1)) * (bboxRight - bboxLeft);
        const srcY = bboxTop  + (oy / (OUT_SIZE - 1)) * (bboxBottom - bboxTop);
        const x0 = Math.max(0, Math.min(compW - 2, Math.floor(srcX)));
        const y0 = Math.max(0, Math.min(compH - 2, Math.floor(srcY)));
        const fx = srcX - x0;
        const fy = srcY - y0;
        const h =
          elev[y0       * compW + x0]     * (1 - fx) * (1 - fy) +
          elev[y0       * compW + x0 + 1] * fx       * (1 - fy) +
          elev[(y0 + 1) * compW + x0]     * (1 - fx) * fy       +
          elev[(y0 + 1) * compW + x0 + 1] * fx       * fy;
        const val = Math.round(Math.min(255, Math.max(0, (h / elevationScale) * 255)));
        const pi = (oy * OUT_SIZE + ox) * 4;
        pixels[pi]     = val;
        pixels[pi + 1] = val;
        pixels[pi + 2] = val;
        pixels[pi + 3] = 255;
      }
    }

    await sharp(Buffer.from(pixels), { raw: { width: OUT_SIZE, height: OUT_SIZE, channels: 4 } })
      .png()
      .toFile(outFile);

    console.log(`  Wrote ${outFile}  (${OUT_SIZE}x${OUT_SIZE}, elevationScale=${elevationScale}m, maxRealElevation=${Math.round(maxH)}m)`);
    console.log(`  UPDATE ${id}/index.ts: elevationScale: ${elevationScale}`);
  }

  console.log("\nAll done. Read the UPDATE lines above and apply them to each map definition.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

---

## Step 2 — Add the npm script

Open `package.json`. Inside the `"scripts"` object, add one entry. The existing `"bake-maps"` entry already shows you the pattern. Add this line after `"bake-maps"`:

```
"bake-terrain": "tsx tools/bake-terrain.ts",
```

Do not change any other line in package.json. Do not move any existing entries.

---

## Step 3 — Run the tools in the correct order

Order matters. `bake-maps.ts` will overwrite the heightmap PNG if it runs after `bake-terrain.ts` and the `.geom.json` file does not yet exist. To prevent that, run `bake-maps.ts` first so all four `.geom.json` files exist, then run `bake-terrain.ts` to produce the high-resolution heightmaps. After both have run, future runs of `bake-maps.ts` will detect both files exist and skip those maps entirely, leaving your heightmaps alone.

Run these two commands in sequence, waiting for each one to fully complete before running the next:

```
npm run bake-maps
npm run bake-terrain
```

`bake-maps.ts` will take several minutes because it contacts Overpass API and Open-Meteo for each map and sleeps between requests. `bake-terrain.ts` will fetch a small number of tiles per map from AWS S3 and will finish in under a minute. Both commands print progress to the terminal. Do not run them in parallel. Do not interrupt them while running.

---

## Step 4 — Apply the elevationScale values

After `npm run bake-terrain` finishes, the terminal output contains four lines that each begin with `UPDATE`. For example:

```
UPDATE island-chain/index.ts: elevationScale: 800
UPDATE desert-canyon/index.ts: elevationScale: 1700
UPDATE alpine-valley/index.ts: elevationScale: 3000
UPDATE storm-front/index.ts: elevationScale: 400
```

The numbers will differ because they come from actual terrain data. For each map, open the corresponding file and change only the `elevationScale` value on the `terrain:` line. Leave the `kind`, `path`, and everything else on that line unchanged. Leave the rest of the file unchanged entirely.

Example: if the current line in `island-chain/index.ts` is:

```typescript
terrain:  { kind: "heightmap" as const, path: "/maps/island-chain.png", elevationScale: 700 },
```

and the tool printed `UPDATE island-chain/index.ts: elevationScale: 800`, change it to:

```typescript
terrain:  { kind: "heightmap" as const, path: "/maps/island-chain.png", elevationScale: 800 },
```

Do this for all four maps. The path value `/maps/island-chain.png` does not change. The `as const` does not change. The trailing comma does not change. Only the number after `elevationScale:` changes.

---

## Step 5 — Verify

Run `npm run dev`. Load the game and enter each of the four maps. Look at the terrain from the air. The heightmaps should now show recognizable real-world topography: Hawaii's mountainous center for island-chain, the Grand Canyon for desert-canyon, the Swiss Alps for alpine-valley, and the flat coastal terrain of the English Channel coast for storm-front. If the terrain looks entirely flat or entirely black, the most likely cause is that the `elevationScale` value was not updated to match what the tool printed, so the heightmap values are being interpreted at the wrong scale.

---

## Things that will go wrong if you do not follow these instructions exactly

If you run `bake-terrain.ts` before `bake-maps.ts` has created the `.geom.json` files, then `bake-maps.ts` will overwrite your 512×512 heightmaps with its own 32×32 versions the next time it runs. Fix: run `bake-maps.ts` first as instructed.

If you update the `elevationScale` to a wrong value (e.g., copying from a different map, or keeping the old value), the terrain heights will be wrong in-game. Fix: re-read the terminal output from `bake-terrain.ts` and set the exact number it printed for each map.

If you change `path:` in any map definition, the game will look for a PNG at the wrong URL and fall back to the default ground height. Fix: leave all `path:` values exactly as they are.

If you add Cesium or any other new npm package to the project, you will break the build. This tool uses only `sharp` and Node's built-in `https` module, both of which are already available. Do not run `npm install` with any new package name.

If you create the file at the wrong path (e.g., inside `src/` instead of `tools/`), the `tsx tools/bake-terrain.ts` command will fail to find it. The file must be at `tools/bake-terrain.ts`.
