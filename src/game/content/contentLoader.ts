import { AircraftClass, WeaponType } from '../../types';
import type { AircraftSpecs, WeaponSpecs, Modification, ModificationSlot } from '../../types';
import type { AircraftDefinition } from './aircraft/types';
import type { AeroSpecs, DamageZoneSpecs, HardpointSpecs } from './aircraft/types';
import type { AircraftRenderDef } from './aircraft/types';
import type { CockpitDef } from '../cockpitMesh';
import type { VoxelAircraftDef } from '../voxelTypes';
import type { MapDefinition } from './maps/mapTypes';
import type { AircraftJSON, MapJSON, WeaponSpecJSON, ModificationJSON } from './schema';
import { interpretVoxelCommands } from './voxelInterpreter';

// Vite eager glob — synchronous at load time; add new content/ files without changing this file.
const aircraftRaw = import.meta.glob<AircraftJSON>(
  '../../../content/aircraft/*.json',
  { eager: true, import: 'default' }
);

const mapsRaw = import.meta.glob<MapJSON>(
  '../../../content/maps/*.json',
  { eager: true, import: 'default' }
);

import weaponsRaw from '../../../content/weapons.json';
import modificationsRaw from '../../../content/modifications.json';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toVec3(v: { x: number; y: number; z: number }) {
  return { x: v.x, y: v.y, z: v.z };
}

function toAircraftClass(s: string): AircraftClass {
  const found = Object.values(AircraftClass).find(v => v === s);
  if (!found) throw new Error(`Unknown aircraft class: ${s}`);
  return found as AircraftClass;
}

function toWeaponType(s: string): WeaponType {
  const found = Object.values(WeaponType).find(v => v === s);
  if (!found) throw new Error(`Unknown weapon type: ${s}`);
  return found as WeaponType;
}

// ── Aircraft ─────────────────────────────────────────────────────────────────

function buildAircraftDef(j: AircraftJSON): AircraftDefinition {
  const specs: AircraftSpecs = {
    id: j.id, name: j.name,
    class: toAircraftClass(j.class),
    description: j.description,
    mass: j.mass, maxThrust: j.maxThrust,
    cd0: j.cd0, cl0: j.cl0, clAlpha: j.clAlpha,
    wingArea: j.wingArea, aspectRatio: j.aspectRatio, oswaldEfficiency: j.oswaldEfficiency,
    energyRetention: j.energyRetention,
    stallSpeedKmph: j.stallSpeedKmph, structuralLimitSpeedKmph: j.structuralLimitSpeedKmph,
    turnBleed: j.turnBleed, climbRate: j.climbRate, maxFuelSeconds: j.maxFuelSeconds,
    weapons: j.weapons.map(toWeaponType),
    durability: j.durability,
    color: j.color, secondaryColor: j.secondaryColor, accentColor: j.accentColor,
    ...(j.aileronBoost !== undefined && { aileronBoost: j.aileronBoost }),
    ...(j.pitchRateDegPerSec !== undefined && { pitchRateDegPerSec: j.pitchRateDegPerSec }),
    ...(j.rollRateDegPerSec !== undefined && { rollRateDegPerSec: j.rollRateDegPerSec }),
    ...(j.yawRateDegPerSec !== undefined && { yawRateDegPerSec: j.yawRateDegPerSec }),
    ...(j.radarRange !== undefined && { radarRange: j.radarRange }),
  };

  const aero: AeroSpecs = {
    leftWingPos:    toVec3(j.aero.leftWingPos),
    rightWingPos:   toVec3(j.aero.rightWingPos),
    leftAileronPos: toVec3(j.aero.leftAileronPos),
    rightAileronPos:toVec3(j.aero.rightAileronPos),
    elevatorPos:    toVec3(j.aero.elevatorPos),
    rudderPos:      toVec3(j.aero.rudderPos),
  };

  const damage: DamageZoneSpecs = {
    engineVolume:   { min: j.damage.engineVolume.min,   max: j.damage.engineVolume.max },
    cockpitVolume:  { min: j.damage.cockpitVolume.min,  max: j.damage.cockpitVolume.max },
    fuelTankVolume: { min: j.damage.fuelTankVolume.min, max: j.damage.fuelTankVolume.max },
  };

  const hardpoints: HardpointSpecs = {
    positions: j.hardpoints.positions.map(toVec3),
    ...(j.hardpoints.gunConvergenceM !== undefined && { gunConvergenceM: j.hardpoints.gunConvergenceM }),
    ...(j.hardpoints.rocketPositions && { rocketPositions: j.hardpoints.rocketPositions.map(toVec3) }),
    ...(j.hardpoints.bombPositions && { bombPositions: j.hardpoints.bombPositions.map(toVec3) }),
  };

  const render: AircraftRenderDef = {
    id: j.id,
    materials: j.render.materials,
    camera: j.render.camera,
    blocks: j.render.blocks as AircraftRenderDef['blocks'],
  };

  return { specs, aero, damage, hardpoints, render };
}

function buildVoxelDef(j: AircraftJSON): VoxelAircraftDef {
  return {
    id: j.id,
    voxelSize: j.voxels.voxelSize,
    cells: interpretVoxelCommands(j.voxels.commands, j.voxels.palette),
  };
}

function buildCockpitDef(j: AircraftJSON): CockpitDef {
  return {
    aircraftId: j.id,
    eye: j.cockpit.eye,
    sightAnchor: j.cockpit.sightAnchor,
    panelZ: j.cockpit.panelZ,
    panelY: j.cockpit.panelY,
    panelW: j.cockpit.panelW,
    panelH: j.cockpit.panelH,
  };
}

// ── Maps ─────────────────────────────────────────────────────────────────────

function buildMapDef(j: MapJSON): MapDefinition {
  return j as unknown as MapDefinition;
}

// ── Weapons ──────────────────────────────────────────────────────────────────

function buildWeaponSpecs(raw: Record<string, WeaponSpecJSON>): Record<WeaponType, WeaponSpecs> {
  const result = {} as Record<WeaponType, WeaponSpecs>;
  for (const [key, spec] of Object.entries(raw)) {
    const wt = toWeaponType(key);
    result[wt] = { type: wt, ...spec };
  }
  return result;
}

// ── Modifications ────────────────────────────────────────────────────────────

function buildModifications(raw: ModificationJSON[]): Modification[] {
  return raw.map(m => ({
    id: m.id, name: m.name, description: m.description,
    slot: m.slot as unknown as ModificationSlot,
    effects: m.effects,
  }));
}

// ── Assembled exports ────────────────────────────────────────────────────────

const aircraftJSONList: AircraftJSON[] = Object.values(aircraftRaw);

export const AIRCRAFT_DEFINITIONS: AircraftDefinition[] = aircraftJSONList.map(buildAircraftDef);

export const VOXEL_DEFS: VoxelAircraftDef[] = aircraftJSONList.map(buildVoxelDef);

export const COCKPIT_DEFS: CockpitDef[] = aircraftJSONList.map(buildCockpitDef);

export const MAP_REGISTRY: Record<string, MapDefinition> = Object.fromEntries(
  Object.values(mapsRaw).map(j => [j.id, buildMapDef(j)])
);

export const WEAPON_SPECS_MAP: Record<WeaponType, WeaponSpecs> =
  buildWeaponSpecs(weaponsRaw as Record<string, WeaponSpecJSON>);

export const MODIFICATIONS: Modification[] =
  buildModifications(modificationsRaw as ModificationJSON[]);
