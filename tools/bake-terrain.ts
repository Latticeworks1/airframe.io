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
