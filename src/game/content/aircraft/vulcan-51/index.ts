import { AircraftDefinition } from "../types";
import { specs } from "./specs";
import { render } from "./render";
import { aero } from "./aero";
import { hardpoints } from "./hardpoints";
import { damage } from "./damage";

export const vulcan51: AircraftDefinition = {
  specs,
  render,
  aero,
  hardpoints,
  damage
};
