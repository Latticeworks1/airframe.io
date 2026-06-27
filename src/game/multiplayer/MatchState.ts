import { Schema, MapSchema, type } from "@colyseus/schema";
import { FlightCommand } from "../../types";

export class NetworkPlayer extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("uint8") team: number = 1;
  @type("string") aircraftId: string = "";
  @type("string") skin: string = "default";
  @type("uint32") score: number = 0;
  @type("uint16") kills: number = 0;
  @type("uint16") deaths: number = 0;
  @type("boolean") isBot: boolean = false;
  @type("uint32") lastProcessedSeq: number = 0;
}

export class MatchState extends Schema {
  @type({ map: NetworkPlayer }) players = new MapSchema<NetworkPlayer>();
  @type("uint32") team1Score: number = 0;
  @type("uint32") team2Score: number = 0;
  @type("number") matchTimer: number = 360;
  @type("boolean") matchEnded: boolean = false;
}

// Compact client input packet tuple:
// [seq, pitch, roll, yaw, throttleDelta, boost, airbrake, primaryFire, secondaryFire, flaps, gearDeployed]
export type ClientInputTuple = [
  number, // seq
  number, // pitch
  number, // roll
  number, // yaw
  number, // throttleDelta
  number, // boost (0 or 1)
  number, // airbrake (0 or 1)
  number, // primaryFire (0 or 1)
  number, // secondaryFire (0 or 1)
  number, // flaps (0 = up, 1 = combat, 2 = landing)
  number  // gearDeployed (0 or 1)
];

export interface ClientInputState {
  seq: number;
  command: FlightCommand;
}

export interface HistoricalTransform {
  tick: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
}
