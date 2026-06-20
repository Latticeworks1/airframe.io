import { AircraftDefinition } from "../types";
import { specs } from "./specs";
import { render } from "./render";
import { aero } from "./aero";
import { hardpoints } from "./hardpoints";
import { damage } from "./damage";

export const grizzlyA1: AircraftDefinition = {
  specs,
  render,
  aero,
  hardpoints,
  damage
};
