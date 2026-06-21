Phase 2 fixes the physics ceiling disconnect. flightModel.ts hardcodes

  maxAltitude = 12000 but every map defines 7500. The game engine already

  enforces the map boundary in enforceMapBoundary() — a parallel

  enforceAltitudeCeiling() using MAP_DEFINITIONS[id].world.maxAltitude replaces

  the constant in the physics file. The hardcoded value disappears.

  

  Phase 3 makes each map self-describing. AtmosphereProfile moves from being a

  switch-case return value in atmosphereProfiles.ts into an inline atmosphere

  field on MapDefinition. The switch function becomes a direct field read or

  disappears entirely. The ground palette (base color, color array, road color)

  moves into MapDefinition.visual as a palette field. tileOrigin (lat, lon, zoom

  for the bake script) also moves into MapDefinition.visual. After this,

  buildTerrain() in the renderer has no map-specific branching — it reads

  mapDef.visual.palette. bake-maps.mjs has no hardcoded list — it imports the

  registry and iterates visual.tileOrigin. atmosphereProfiles.ts either shrinks

  to a one-liner wrapper or disappears.

  

  Phase 4 restructures files. Each map moves to its own directory,

  src/game/content/maps/{slug}/index.ts, exporting a single MapDefinition. A

  registry.ts imports them all and exports MAP_REGISTRY. mapDefinitions.ts and

  mapData.ts are deleted. atmosphereProfiles.ts is deleted if Phase 3 eliminated

  all its content. mapTypes.ts stays because it holds the shared type

  definitions.

  

  Phase 5 opens the registry by killing the GameMap enum. It becomes a plain

  const KnownMaps object of string constants for the handful of places that

  reference specific maps by name (campaign missions, unit tests). MapId becomes

  string. MAP_REGISTRY becomes Record<string, MapDefinition>. WorldRenderer

  takes a MapDefinition directly instead of MapSpecs. App.tsx does one

  MAP_REGISTRY[mapId] lookup and passes the definition down. After this,

  MapSpecs is small enough to either delete or collapse into the UI-only layer

  that needs name and description for the map select screen. Adding a new map

  now requires one file and one import line in the registry.

  

  Phase 6 introduces heightmap terrain as a new kind in the terrain

  discriminated union. The definition carries { kind: "heightmap", path: string,

  elevationScale: number }. At initialization the terrain model loads the PNG

  into an offscreen canvas and stores the pixel buffer. sampleTerrainHeight

  dispatches on kind — the existing box path runs unchanged, the heightmap path

  does a bilinear pixel lookup at (x, z) normalized to the world radius. The

  renderer detects the heightmap kind and substitutes a subdivided

  THREE.PlaneGeometry with vertex Y values displaced from the same buffer

  instead of the flat ground plane. The procedural-boxes renderer path is

  untouched.

  

  Phase 7 adds GLB and tiled-glb terrain kinds. A single-GLB map carries { kind:

  "glb", path: string } and the renderer runs a GLTFLoader load at

  initialization. A tiled map carries { kind: "tiled-glb", tileDir: string, 

  tileSize: number, tileGrid: number, loadRadius: number }. The renderer

  maintains a set of loaded tile indices, computes which indices fall within

  loadRadius of the player each tick, queues loads for entering tiles and

  disposes exiting ones. Tile world position is (col - gridCenter) * tileSize, 

  0, (row - gridCenter) * tileSize — no per-tile data needed.

  

  Phase 8 adds the scatter field for procedural vegetation and environmental

  assets. Each entry names a GLB path, LOD variants with distance thresholds, a

  density value, and an optional slope mask. Placement positions are generated

  from the map seed using a noise function run once at initialization, filtered

  against the terrain sampler (slope, surface type), and rendered as

  THREE.InstancedMesh per asset type. LOD transitions swap instance buffers as

  the camera moves through distance thresholds. The whole scatter system lives

  in a new ScatterRenderer class the world renderer owns, keeping the geometry

  and scatter concerns separated.

  

  The total deletion across all phases removes mapData.ts, mapDefinitions.ts,

  atmosphereProfiles.ts, the GameMap enum, the MapSpecs interface, the

  getDeterministicIslands adapter, MAP_TILE_CONFIG in the renderer, the

  buildTerrain if/else, the atmosphereProfiles switch, and the maxAltitude

  constant in the physics file. What remains is a registry, per-map index files,

  a clean discriminated union for terrain kinds, and renderers that read data

  without branching on map identity.