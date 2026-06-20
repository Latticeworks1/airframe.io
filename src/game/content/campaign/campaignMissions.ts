import {
  CampaignMissionDefinition,
  MatchMode
} from "../../../types";
import { KnownMaps } from "../maps/mapTypes";

export const CAMPAIGN_MISSIONS: CampaignMissionDefinition[] = [
  {
    id: "breakwater",
    order: 1,
    name: "Breakwater",
    operation: "Operation Breakwater",
    briefing:
      "Launch the Grizzly from the island chain and destroy three enemy ground installations before their fighter screen closes.",
    mapId: KnownMaps.IslandChain,
    mode: MatchMode.GroundStrike,
    aircraftId: "grizzly-a1",
    objectiveType: "destroy-ground",
    objectiveLabel: "Enemy installations destroyed",
    targetCount: 3,
    timeLimitSeconds: 300,
    xpReward: 800,
    startOnGround: false
  },
  {
    id: "canyon-hammer",
    order: 2,
    name: "Canyon Hammer",
    operation: "Operation Canyon Hammer",
    briefing:
      "Use the canyon walls to mask a low-level strike. Eliminate five hostile batteries and convoy elements.",
    mapId: KnownMaps.DesertCanyon,
    mode: MatchMode.GroundStrike,
    aircraftId: "grizzly-a1",
    objectiveType: "destroy-ground",
    objectiveLabel: "Strike targets destroyed",
    targetCount: 5,
    timeLimitSeconds: 360,
    xpReward: 1100,
    startOnGround: false
  },
  {
    id: "storm-lance",
    order: 3,
    name: "Storm Lance",
    operation: "Operation Storm Lance",
    briefing:
      "Enter the Atlantic storm front and clear four enemy fighters from the carrier approach corridor.",
    mapId: KnownMaps.StormFront,
    mode: MatchMode.Intercept,
    aircraftId: "falcon-mk2",
    objectiveType: "destroy-air",
    objectiveLabel: "Enemy aircraft destroyed",
    targetCount: 4,
    timeLimitSeconds: 330,
    xpReward: 1000,
    startOnGround: false
  }
];

export function getCampaignMission(
  missionId?: string | null
): CampaignMissionDefinition | null {
  if (!missionId) return null;
  return CAMPAIGN_MISSIONS.find(mission => mission.id === missionId) ?? null;
}
