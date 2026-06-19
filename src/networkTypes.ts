// Wire-format types shared between server.ts and client code.
// No imports from 'three' or any browser-only module.

export interface WireDamageModel {
  engine: number;
  leftWing: number;
  rightWing: number;
  tail: number;
  cockpit: number;
  fuelTank: number;
  fuselage: number;
  hasFire: boolean;
  hasOilLeak: boolean;
}

export interface WirePilotState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  throttle: number;
  damage: WireDamageModel;
  ammo: Record<string, number>;
  score: number;
  kills: number;
  deaths: number;
}

export interface WireBotState {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  throttle: number;
  damage: WireDamageModel;
}

export interface WirePlayerInfo {
  id: string;
  name: string;
  team: 1 | 2;
  aircraftId: string;
  // specs is relayed opaquely by the server; client casts to AircraftSpecs
  specs: unknown;
  skin: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  throttle: number;
  damage: WireDamageModel;
  ammo: Record<string, number>;
  score: number;
  kills: number;
  deaths: number;
}
