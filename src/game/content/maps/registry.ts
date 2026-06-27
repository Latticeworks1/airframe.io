import type { MapDefinition } from "./mapTypes";
import type { Environment } from "../../../types/core";
import type { TerrainComponent, AtmosphereComponent } from "../../../types/components";
import { map as islandChain  } from "./island-chain";
import { map as desertCanyon } from "./desert-canyon";
import { map as alpineValley } from "./alpine-valley";
import { map as stormFront   } from "./storm-front";
import { map as earth3d      } from "./earth-3d";

export const MAP_REGISTRY: Record<string, MapDefinition> = {
  [islandChain.id]:  islandChain,
  [desertCanyon.id]: desertCanyon,
  [alpineValley.id]: alpineValley,
  [stormFront.id]:   stormFront,
  [earth3d.id]:      earth3d,
};

export function mapToEnvironment(def: MapDefinition): Environment {
  const terrainComp: TerrainComponent = {
    type: "terrain",
    mapId: def.id,
    worldRadius: def.world.radius,
    maxAltitude: def.world.maxAltitude,
    hasWater: def.world.waterHeight > 0,
  };
  const atmosphereComp: AtmosphereComponent = {
    type: "atmosphere",
    fogNear: def.atmosphere.fogNear,
    fogFar: def.atmosphere.fogFar,
    fogColor: def.atmosphere.fogColor,
    cloudDensity: def.cloudDensity,
    sunElevationDeg: def.atmosphere.sunElevationDeg ?? 45,
  };
  const components = new Map<string, import("../../../types/core").Component>();
  components.set("terrain", terrainComp);
  components.set("atmosphere", atmosphereComp);
  return { id: def.id, components };
}
