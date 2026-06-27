import { Pilot, GroundTarget, SkyZone } from "../../types";
import { FlightPhysicsEngine } from "../flightModel";
import { destructible, control } from "../../types/components";
import { BotAISystem } from "../botAISystem";

import { FlightCommand } from "../../types";
import { MAP_REGISTRY } from "../content/maps/registry";

const FIXED_DT = 1 / 60;

export class SimulationSystem {
  public updateSimulation(
    accumulator: number,
    deltaMs: number,
    matchEnded: boolean,
    tickCallback: () => void
  ): number {
    if (matchEnded) return accumulator;

    let newAccumulator = accumulator + (deltaMs / 1000);
    if (newAccumulator > 0.1) newAccumulator = 0.1; // clamp death spiral

    while (newAccumulator >= FIXED_DT) {
      tickCallback();
      newAccumulator -= FIXED_DT;
    }

    return newAccumulator;
  }

  public tickPlayers(
    pilots: Map<string, Pilot>,
    statePlayers: any,
    getNextInput: (id: string, neutral: FlightCommand) => { command: FlightCommand, seq?: number },
    neutralCommand: () => FlightCommand,
    tickCooldowns: (p: Pilot, dt: number) => void,
    updateDeadPilot: (p: Pilot, dt: number) => void,
    enforceMapBoundary: (p: Pilot, dt: number) => void,
    handleWeaponFiring: (p: Pilot, pF: boolean, sF: boolean, dt: number, seq?: number) => void,
    syncRapierBody: (id: string, p: Pilot) => void,
    recordHistory: (id: string, p: Pilot) => void,
    mapId: string
  ) {
    for (const [sessionId, pilot] of pilots.entries()) {
      if (pilot.isBot) continue;

      const { command, seq } = getNextInput(sessionId, neutralCommand());

      const schemaPlayer = statePlayers.get(sessionId);
      if (schemaPlayer && seq !== undefined) {
        schemaPlayer.lastProcessedSeq = seq;
      }

      if (destructible(pilot.entity).damageModel!.fuselage <= 0) {
        updateDeadPilot(pilot, FIXED_DT);
      } else {
        tickCooldowns(pilot, FIXED_DT);
        FlightPhysicsEngine.update(pilot, command, FIXED_DT, mapId);
        enforceMapBoundary(pilot, FIXED_DT);
        handleWeaponFiring(pilot, command.primaryFire, command.secondaryFire, FIXED_DT, seq);
      }

      syncRapierBody(sessionId, pilot);
      recordHistory(sessionId, pilot);
    }
  }

  public tickBots(
    pilots: Map<string, Pilot>,
    groundTargets: GroundTarget[],
    skyZones: SkyZone[],
    tickCooldowns: (p: Pilot, dt: number) => void,
    updateDeadPilot: (p: Pilot, dt: number) => void,
    enforceMapBoundary: (p: Pilot, dt: number) => void,
    handleWeaponFiring: (p: Pilot, pF: boolean, sF: boolean, dt: number, seq?: number) => void,
    syncRapierBody: (id: string, p: Pilot) => void,
    recordHistory: (id: string, p: Pilot) => void,
    mapId: string,
    neutralCommand: () => FlightCommand
  ) {
    for (const [botId, pilot] of pilots.entries()) {
      if (!pilot.isBot) continue;

      if (destructible(pilot.entity).damageModel!.fuselage <= 0) {
        updateDeadPilot(pilot, FIXED_DT);
      } else {
        tickCooldowns(pilot, FIXED_DT);
        
        BotAISystem.runAIConsensus(
          pilot,
          FIXED_DT,
          Array.from(pilots.values()),
          groundTargets,
          skyZones,
          (p, prim, sec, d) => handleWeaponFiring(p, prim, sec, d),
          MAP_REGISTRY[mapId]?.world.radius ?? 6000
        );

        const botCtrl = control(pilot.entity);
        const cmd = botCtrl.lastCommand || neutralCommand();
        FlightPhysicsEngine.update(pilot, cmd, FIXED_DT, mapId);
        enforceMapBoundary(pilot, FIXED_DT);
      }

      syncRapierBody(botId, pilot);
      recordHistory(botId, pilot);
    }
  }
}
