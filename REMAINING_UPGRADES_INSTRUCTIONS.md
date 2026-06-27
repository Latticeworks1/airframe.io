# Remaining upgrades — implementation instructions

The terrain baking upgrade is in TERRAIN_UPGRADE_INSTRUCTIONS.md. This document covers the two remaining upgrades: the map coordinate frame class and the GLB terrain collision system. Do Upgrade A from the other file first, then do either of these in any order since they are independent of each other.

---

## Upgrade B — Geographic coordinate frame (MapFrame)

### What this does and why

Every map has a `tileOrigin: { lat, lon, zoom }` that anchors its center to a real-world location, but no code at runtime uses this anchor to convert between game coordinates and geographic coordinates. This upgrade adds a small class that provides `gameXZtoLatLon` and `latLonToGameXZ`, then uses it to display the aircraft's real-world latitude and longitude on the flight tape in `GameHUD.tsx` and in the info strip of `TacticalMapOverlay.tsx`.

The coordinate relationship is: game `+X` is East (longitude increases), game `-Z` is North (latitude increases), game `+Z` is South. One game unit is one meter. This matches how `sampleHeightmapAt` and `bake-maps.ts` already interpret the coordinate system.

### Files you will create

One file: `src/game/mapFrame.ts`

### Files you will modify

`src/components/GameHUD.tsx` — add lat/lon readout to the flight tape

`src/components/hud/TacticalMapOverlay.tsx` — add player position lat/lon to the info strip

### Files you must not touch

Everything else. Do not modify `terrainModel.ts`, `mapTypes.ts`, `registry.ts`, or any map definition file as part of this upgrade.

---

### Step B1 — Create `src/game/mapFrame.ts`

Create the file at exactly `src/game/mapFrame.ts`. Full contents:

```typescript
import type { TileOrigin } from "./content/maps/mapTypes";

export class MapFrame {
  private readonly originLat: number;
  private readonly originLon: number;
  private readonly metersPerDegreeLat: number;
  private readonly metersPerDegreeLon: number;

  constructor(tileOrigin: TileOrigin) {
    this.originLat = tileOrigin.lat;
    this.originLon = tileOrigin.lon;
    this.metersPerDegreeLat = 111320;
    this.metersPerDegreeLon = 111320 * Math.cos((tileOrigin.lat * Math.PI) / 180);
  }

  gameXZtoLatLon(x: number, z: number): { lat: number; lon: number } {
    return {
      lat: this.originLat - z / this.metersPerDegreeLat,
      lon: this.originLon + x / this.metersPerDegreeLon,
    };
  }

  latLonToGameXZ(lat: number, lon: number): { x: number; z: number } {
    return {
      x: (lon - this.originLon) * this.metersPerDegreeLon,
      z: -(lat - this.originLat) * this.metersPerDegreeLat,
    };
  }
}
```

---

### Step B2 — Add lat/lon readout to `GameHUD.tsx`

Open `src/components/GameHUD.tsx`. You will make two changes to this file: one import addition and one JSX addition.

**Change 1 — add imports.** Find the existing import at line 17 that reads:
```typescript
import { Zap, MapPin } from "lucide-react";
```
Add two new import lines directly after it:
```typescript
import { MAP_REGISTRY } from "../game/content/maps/registry";
import { MapFrame } from "../game/mapFrame";
```

**Change 2 — compute lat/lon.** Find the line inside the component body that reads:
```typescript
  const throttlePercent = Math.floor(playerPilot.throttle * 100);
```
Add these two lines directly after that line:
```typescript
  const mapDef = MAP_REGISTRY[mapId];
  const playerLatLon = mapDef ? new MapFrame(mapDef.tileOrigin).gameXZtoLatLon(playerPilot.x, playerPilot.z) : null;
```

**Change 3 — add the display block.** Find the JSX block in the left flight tape that starts with:
```tsx
        <div className="flex flex-col">
          <span className="text-[9.5px] text-amber-400 uppercase leading-none" style={textOutline(1)}>
            THR
          </span>
          <span className="text-xl font-black leading-none text-white mt-0.5" style={textOutline(1.5)}>
            {throttlePercent}% {playerPilot.throttle > 1.0 ? "WEP" : ""}
          </span>
        </div>
```
Add the following block directly after that entire `<div>` block (after its closing `</div>`):
```tsx
        {playerLatLon && (
          <div className="flex flex-col">
            <span className="text-[9.5px] text-amber-400 uppercase leading-none" style={textOutline(1)}>
              POS
            </span>
            <span className="text-[10px] font-black leading-none text-white mt-0.5 font-mono" style={textOutline(1)}>
              {Math.abs(playerLatLon.lat).toFixed(4)}{playerLatLon.lat >= 0 ? "N" : "S"}
            </span>
            <span className="text-[10px] font-black leading-none text-white font-mono" style={textOutline(1)}>
              {Math.abs(playerLatLon.lon).toFixed(4)}{playerLatLon.lon >= 0 ? "E" : "W"}
            </span>
          </div>
        )}
```

Do not change any other part of `GameHUD.tsx`.

---

### Step B3 — Add lat/lon to `TacticalMapOverlay.tsx`

Open `src/components/hud/TacticalMapOverlay.tsx`. You will make two changes.

**Change 1 — add import.** Find the existing import at line 4 that reads:
```typescript
import { MAP_REGISTRY } from "../../game/content/maps/registry";
```
Add one new import directly after it:
```typescript
import { MapFrame } from "../../game/mapFrame";
```

**Change 2 — add lat/lon to the info strip.** The info strip near the bottom of the component has several sections separated by `<div className="w-px h-8 bg-slate-800 shrink-0"/>` dividers. Find the last divider before the closing of the outer strip `<div>`. It reads:
```tsx
                  <div className="w-px h-8 bg-slate-800 shrink-0"/>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[7px] font-black tracking-widest text-slate-600 uppercase">Legend</span>
```
Add the following block directly before that last divider:
```tsx
                  {(() => {
                    const playerOnMap = pilots.find(p => p.id === "player");
                    if (!playerOnMap || !mapDef) return null;
                    const pos = new MapFrame(mapDef.tileOrigin).gameXZtoLatLon(playerOnMap.x, playerOnMap.z);
                    return (
                      <>
                        <div className="w-px h-8 bg-slate-800 shrink-0"/>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[7px] font-black tracking-widest text-slate-600 uppercase">Position</span>
                          <span className="text-slate-400 font-mono">{Math.abs(pos.lat).toFixed(4)}{pos.lat >= 0 ? "N" : "S"}</span>
                          <span className="text-slate-400 font-mono">{Math.abs(pos.lon).toFixed(4)}{pos.lon >= 0 ? "E" : "W"}</span>
                        </div>
                      </>
                    );
                  })()}
```

Note that `mapDef` is already defined at line 39 in TacticalMapOverlay.tsx as `const mapDef = MAP_REGISTRY[mapId];` — do not add it again.

Do not change any other part of `TacticalMapOverlay.tsx`.

---

### Verification for Upgrade B

Run `npm run dev`. Enter any map. The left flight tape should now show a POS readout below THR with two lines: latitude (N/S) and longitude (E/W). Open the tactical map with M — the info strip at the bottom should show a Position section with the same coordinates. Confirm the coordinates match the real-world location anchored by each map's tileOrigin: island-chain should show coordinates near 21°N 157°W (Hawaii), desert-canyon near 36°N 112°W (Grand Canyon), alpine-valley near 46°N 8°E (Swiss Alps), storm-front near 51°N 2°E (English Channel). If the coordinates are wildly wrong or the display is missing, check that the import paths are exactly as written and that you added the computation block after the correct existing line.

---

## Upgrade C — GLB terrain collision

### What this does and why

When a map uses `terrain: { kind: "glb", path: "..." }`, the visual mesh loads correctly but `getTerrainHeight` returns `defaultGroundHeight` (a flat constant) for all points because no collision data is derived from the GLB geometry. This upgrade wires up the loaded GLB mesh to produce a height grid that `getTerrainHeight` can query, using the same bilinear sampling path that heightmap terrain already uses. None of the four current production maps use GLB terrain, but the wiring should exist for when they do.

The mechanism: after the GLB finishes loading in `TerrainBuilder`, a new function in `terrainCollider.ts` sweeps a 128×128 grid of downward raycasts through the scene and stores the result as a `HeightmapData` in `heightmapCache` under the `mapId` key. `getTerrainHeight` then queries this cache for GLB maps, falling back to `defaultGroundHeight` if the collider has not finished building yet.

### Files you will create

One file: `src/game/terrainCollider.ts`

### Files you will modify

`src/game/terrainModel.ts` — add `registerHeightmap` export function and a GLB case inside `getTerrainHeight`

`src/game/renderer/TerrainBuilder.ts` — call `buildGlbCollider` after the GLB scene loads

### Files you must not touch

Everything else in the codebase. Do not change `mapTypes.ts`, any map definition files, `worldRenderer.ts`, or any other renderer file.

---

### Step C1 — Create `src/game/terrainCollider.ts`

Create the file at exactly `src/game/terrainCollider.ts`. Full contents:

```typescript
import * as THREE from "three";
import { registerHeightmap } from "./terrainModel";
import type { HeightmapData } from "./terrainModel";

const GRID = 128;

export async function buildGlbCollider(
  glbScene: THREE.Object3D,
  mapId: string,
  worldRadius: number,
  maxAltitude: number
): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  glbScene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      meshes.push(child);
    }
  });

  if (meshes.length === 0) return;

  const raycaster = new THREE.Raycaster();
  raycaster.ray.direction.set(0, -1, 0);

  const heights = new Float32Array(GRID * GRID);
  let maxH = 0;

  const step = (worldRadius * 2) / (GRID - 1);
  const origin = new THREE.Vector3();

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = -worldRadius + col * step;
      const z = -worldRadius + row * step;
      origin.set(x, maxAltitude + 1000, z);
      raycaster.ray.origin.copy(origin);
      const hits = raycaster.intersectObjects(meshes, false);
      const h = hits.length > 0 ? Math.max(0, hits[0].point.y) : 0;
      heights[row * GRID + col] = h;
      if (h > maxH) maxH = h;
    }
  }

  const elevationScale = Math.max(100, Math.ceil(maxH / 100) * 100);
  const normalized = new Float32Array(GRID * GRID);
  for (let i = 0; i < heights.length; i++) {
    normalized[i] = heights[i] / elevationScale;
  }

  const data: HeightmapData = {
    buffer: normalized,
    width: GRID,
    height: GRID,
    worldRadius,
    elevationScale,
  };

  registerHeightmap(mapId, data);
}
```

---

### Step C2 — Modify `src/game/terrainModel.ts`

You will make two changes to this file.

**Change 1 — add `registerHeightmap` export.** Find the function that reads:
```typescript
export function getHeightmapData(path: string): HeightmapData | undefined {
  return heightmapCache.get(path);
}
```
Add the following new function directly after that function:
```typescript
export function registerHeightmap(key: string, data: HeightmapData): void {
  heightmapCache.set(key, data);
}
```

**Change 2 — add GLB case in `getTerrainHeight`.** Find the block inside `getTerrainHeight` that reads:
```typescript
  if (mapDef.terrain.kind === "heightmap") {
    const data = getHeightmapData(mapDef.terrain.path);
    if (data) {
      const raw = sampleHeightmapAt(data, x, z);
      const h = Math.max(raw, mapDef.world.waterHeight);
      return { height: h, isAirfield: false };
    }
    return { height: mapDef.world.defaultGroundHeight, isAirfield: false };
  }
```
Add the following block directly after that entire `if` block:
```typescript
  if (mapDef.terrain.kind === "glb") {
    const data = getHeightmapData(mapId);
    if (data) {
      const raw = sampleHeightmapAt(data, x, z);
      return { height: Math.max(raw, mapDef.world.waterHeight), isAirfield: false };
    }
    return { height: mapDef.world.defaultGroundHeight, isAirfield: false };
  }
```

Note that `getHeightmapData` takes a string key. For the heightmap case it uses `mapDef.terrain.path` (the PNG path). For the GLB case it uses `mapId` (the map's id string like `"island-chain"`). These never collide because all PNG paths start with `/` and all map IDs are plain slugs without a `/`.

Do not change any other part of `terrainModel.ts`.

---

### Step C3 — Modify `src/game/renderer/TerrainBuilder.ts`

You will make two changes to this file.

**Change 1 — add import.** Find the existing import block at the top of the file. After the last existing import line (which ends with `import { ScatterRenderer } from "../scatterRenderer";`), add:
```typescript
import { buildGlbCollider } from "../terrainCollider";
```

**Change 2 — call the collider builder.** Find the GLB loading block inside `buildTerrain` that reads:
```typescript
    } else if (def.kind === "glb") {
      const loader = new GLTFLoader();
      loader.load(def.path, (gltf) => {
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(gltf.scene);
        this.islands.push(...(gltf.scene.children as THREE.Mesh[]));
      });
    }
```
Replace only the `loader.load` callback contents — specifically, add one line after `this.islands.push(...)`. The block should become:
```typescript
    } else if (def.kind === "glb") {
      const loader = new GLTFLoader();
      loader.load(def.path, (gltf) => {
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(gltf.scene);
        this.islands.push(...(gltf.scene.children as THREE.Mesh[]));
        buildGlbCollider(gltf.scene, this.mapDef.id, this.mapDef.world.radius, this.mapDef.world.maxAltitude);
      });
    }
```

The only addition is the `buildGlbCollider(...)` call on its own line after the `this.islands.push` line. Do not change anything else in `TerrainBuilder.ts`.

---

### Verification for Upgrade C

Run `npm run lint` (`tsc --noEmit`). There should be no type errors. The four current production maps all use `kind: "heightmap"` so the new GLB path is not triggered at runtime; the lint pass is sufficient to confirm the wiring is correct. If TypeScript reports that `HeightmapData` is not exported from `terrainModel`, check that the import in `terrainCollider.ts` says `import type { HeightmapData } from "./terrainModel"` and that `HeightmapData` remains exported from `terrainModel.ts` (it already was at line 7 of that file; do not remove it).

---

## Order of operations across all three upgrades

Run `npm run bake-maps` then `npm run bake-terrain` before anything else (see TERRAIN_UPGRADE_INSTRUCTIONS.md). The code changes for Upgrade B and Upgrade C can be made in any order relative to each other and relative to the bake steps, because they touch independent files. Run `npm run lint` after making all code changes before starting the dev server, so TypeScript catches any import path typos before you try to load the game.
