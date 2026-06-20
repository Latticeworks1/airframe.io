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

// Register a community map at runtime. Validates required fields before insertion.
export function registerMap(def: MapDefinition): void {
  if (!def.id || !def.name || !def.terrain) {
    throw new Error(`registerMap: invalid MapDefinition — id, name, and terrain are required`);
  }
  MAP_REGISTRY[def.id] = def;
}

// Load a community MapDefinition from a URL and register it.
// Returns the registered definition on success.
export async function loadRemoteMap(url: string): Promise<MapDefinition> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadRemoteMap: HTTP ${res.status} for ${url}`);
  const def = (await res.json()) as MapDefinition;
  registerMap(def);
  return def;
}
