import { GameMap } from "../../../types";
import { MapDefinition } from "./mapTypes";

export const MAP_DEFINITIONS: Record<GameMap, MapDefinition> = {
  [GameMap.IslandChain]: {
    id: GameMap.IslandChain,
    name: "Solomon Archipelago",
    description: "Tropical blue waters scattered with islands. Active aircraft carrier decks act as repair and rearm bays. High cloud density for fast cover.",
    seed: 1111,
    cloudDensity: 0.65,
    world: {
      radius: 6000,
      waterHeight: 10,
      defaultGroundHeight: 10,
      maxAltitude: 7500
    },
    spawn: {
      distMin: 3800,
      distMax: 4400,
      aglMin: 350,
      aglMax: 650,
      initialSpeedMs: 140,
      spreadZ: 600
    },
    visual: {
      skyColor: "#38bdf8",
      fogColor: "#e0f2fe",
      groundColor: "#0284c7",
      terrainMaterials: {
        landMid: "#10b981",
        landDark: "#047857",
        runway: "#1e293b"
      }
    },
    terrain: {
      kind: "islands",
      blockCount: 10,
      radius: { min: 1000, max: 5500 },
      blockSize: {
        x: [400, 1200],
        y: [80, 380],
        z: [400, 1200]
      },
      airfieldCount: 2
    },
    layout: {
      hasCarriers: true,
      hasThunder: false,
      antiAirCount: 10,
      groundTargetsCount: 15
    }
  },
  [GameMap.DesertCanyon]: {
    id: GameMap.DesertCanyon,
    name: "Sinai Straits",
    description: "Carved sandstone valleys. Extreme canyon run pathways provide natural covers from heat-seekers or visual sight. Heavy AA batteries guard borders.",
    seed: 2222,
    cloudDensity: 0.15,
    world: {
      radius: 6500,
      waterHeight: 10,
      defaultGroundHeight: 10,
      maxAltitude: 7500
    },
    spawn: {
      distMin: 4200,
      distMax: 5000,
      aglMin: 600,
      aglMax: 1100,
      initialSpeedMs: 160,
      spreadZ: 400
    },
    visual: {
      skyColor: "#fdba74",
      fogColor: "#ffedd5",
      groundColor: "#ca8a04",
      terrainMaterials: {
        clay: "#ca8a04",
        rockDark: "#854d0e",
        runway: "#1e293b"
      }
    },
    terrain: {
      kind: "canyons",
      blockCount: 18,
      radius: { min: 800, max: 5500 },
      blockSize: {
        x: [400, 1100],
        y: [300, 1100],
        z: [400, 1100]
      },
      airfieldCount: 0
    },
    layout: {
      hasCarriers: false,
      hasThunder: false,
      antiAirCount: 16,
      groundTargetsCount: 22
    }
  },
  [GameMap.AlpineValley]: {
    id: GameMap.AlpineValley,
    name: "Alpine Corridor",
    description: "Ice valleys surrounding massive mountain spires. Tall, sharp geometry forces strategic altitude climbs or low valley defensive routing.",
    seed: 3333,
    cloudDensity: 0.4,
    world: {
      radius: 6000,
      waterHeight: 10,
      defaultGroundHeight: 10,
      maxAltitude: 7500
    },
    spawn: {
      distMin: 4000,
      distMax: 4600,
      aglMin: 400,
      aglMax: 800,
      initialSpeedMs: 150,
      spreadZ: 500
    },
    visual: {
      skyColor: "#7dd3fc",
      fogColor: "#f1f5f9",
      groundColor: "#475569",
      terrainMaterials: {
        snow: "#f8fafc",
        rock: "#475569",
        runway: "#1e293b"
      }
    },
    terrain: {
      kind: "alpine",
      blockCount: 18,
      radius: { min: 800, max: 5500 },
      blockSize: {
        x: [500, 1300],
        y: [600, 2000],
        z: [500, 1300]
      },
      airfieldCount: 2
    },
    layout: {
      hasCarriers: false,
      hasThunder: false,
      antiAirCount: 8,
      groundTargetsCount: 14
    }
  },
  [GameMap.StormFront]: {
    id: GameMap.StormFront,
    name: "North Atlantic Front",
    description: "Ominous lightning cells, dense fog layers, and heavy rain. Break radar line-of-sight instantly but beware of sudden lightning flash visual blurs.",
    seed: 4444,
    cloudDensity: 0.9,
    world: {
      radius: 6000,
      waterHeight: 10,
      defaultGroundHeight: 10,
      maxAltitude: 7500
    },
    spawn: {
      distMin: 3200,
      distMax: 3800,
      aglMin: 200,
      aglMax: 500,
      initialSpeedMs: 130,
      spreadZ: 800
    },
    visual: {
      skyColor: "#1e293b",
      fogColor: "#334155",
      groundColor: "#0f172a",
      terrainMaterials: {
        landMid: "#1e293b",
        landDark: "#0f172a",
        runway: "#020617"
      }
    },
    terrain: {
      kind: "storm-islands",
      blockCount: 12,
      radius: { min: 1000, max: 5500 },
      blockSize: {
        x: [400, 1200],
        y: [80, 420],
        z: [400, 1200]
      },
      airfieldCount: 0
    },
    layout: {
      hasCarriers: true,
      hasThunder: true,
      antiAirCount: 12,
      groundTargetsCount: 12
    }
  }
};
