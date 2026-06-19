/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameMap, MapSpecs } from "../../../types";

export const MAPS: MapSpecs[] = [
  {
    id: GameMap.IslandChain,
    name: "Island Chain",
    description:
      "Tropical blue waters scattered with islands. Active aircraft carrier decks act as repair and rearm bays. High cloud density for fast cover.",
    hasCarriers: true,
    hasCanyons: false,
    cloudDensity: 0.65,
    antiAirCount: 10,
    groundTargetsCount: 15,
    skyColor: "#38bdf8",
    fogColor: "#e0f2fe",
    groundColor: "#0284c7",
    hasThunder: false
  },
  {
    id: GameMap.DesertCanyon,
    name: "Desert Canyons",
    description:
      "Carved sandstone valleys. Extreme canyon run pathways provide natural covers from heat-seekers or visual sight. Heavy AA batteries guard borders.",
    hasCarriers: false,
    hasCanyons: true,
    cloudDensity: 0.15,
    antiAirCount: 16,
    groundTargetsCount: 22,
    skyColor: "#fdba74",
    fogColor: "#ffedd5",
    groundColor: "#ca8a04",
    hasThunder: false
  },
  {
    id: GameMap.AlpineValley,
    name: "Alpine Valleys",
    description:
      "Ice valleys surrounding massive mountain spires. Tall, sharp geometry forces strategic altitude climbs or low valley defensive routing.",
    hasCarriers: false,
    hasCanyons: true,
    cloudDensity: 0.4,
    antiAirCount: 8,
    groundTargetsCount: 14,
    skyColor: "#7dd3fc",
    fogColor: "#f1f5f9",
    groundColor: "#475569",
    hasThunder: false
  },
  {
    id: GameMap.StormFront,
    name: "Storm Front",
    description:
      "Ominous lightning cells, dense fog layers, and heavy rain. Break radar line-of-sight instantly but beware of sudden lightning flash visual blurs.",
    hasCarriers: true,
    hasCanyons: false,
    cloudDensity: 0.9,
    antiAirCount: 12,
    groundTargetsCount: 12,
    skyColor: "#1e293b",
    fogColor: "#334155",
    groundColor: "#0f172a",
    hasThunder: true
  }
];
