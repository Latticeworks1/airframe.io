import type { MapDefinition } from "./mapTypes";
import { map as islandChain  } from "./island-chain";
import { map as desertCanyon } from "./desert-canyon";
import { map as alpineValley } from "./alpine-valley";
import { map as stormFront   } from "./storm-front";

export const MAP_REGISTRY: Record<string, MapDefinition> = {
  [islandChain.id]:  islandChain,
  [desertCanyon.id]: desertCanyon,
  [alpineValley.id]: alpineValley,
  [stormFront.id]:   stormFront,
};
