import { AircraftRenderDef } from "../types";

export const render: AircraftRenderDef = {
  id: "grizzly-a1",
  materials: {
    primary: "#4B5563",
    secondary: "#DC2626",
    accent: "#FBBF24",
    canopy: "#0EA5E9",
    metal: "#64748B",
    bomb: "#3F3F32",
    bombBand: "#D6A11D"
  },
  camera: {
    cockpitEye: [0, 1.38, 0.95],
    firstPersonFov: 72,
    hiddenBlockIds: ["canopy"]
  },
  blocks: [
    {
      id: "fuselage",
      kind: "box",
      role: "fuselage",
      position: [0, 0, 0],
      scale: [1.7, 1.6, 12],
      material: "primary",
      damageComponent: "fuselage"
    },
    {
      id: "nose",
      kind: "wedge",
      role: "nose",
      position: [0, 0, 6.65],
      scale: [1.35, 1.25, 1.6],
      material: "secondary",
      damageComponent: "engine"
    },
    {
      id: "canopy",
      kind: "box",
      role: "canopy",
      position: [0, 1.05, 0.9],
      scale: [1.3, 1.0, 2.3],
      material: "canopy",
      damageComponent: "cockpit"
    },
    {
      id: "mainWing",
      kind: "box",
      role: "wing",
      position: [0, -0.1, 0.4],
      scale: [18, 0.18, 3.8],
      material: "primary",
      damageComponent: "leftWing"
    },
    {
      id: "leftWingTip",
      kind: "box",
      role: "wing",
      position: [-8.25, 0.03, 0.4],
      scale: [1.5, 0.22, 3.42],
      material: "secondary",
      damageComponent: "leftWing"
    },
    {
      id: "rightWingTip",
      kind: "box",
      role: "wing",
      position: [8.25, 0.03, 0.4],
      scale: [1.5, 0.22, 3.42],
      material: "secondary",
      damageComponent: "rightWing"
    },
    {
      id: "tailFin",
      kind: "box",
      role: "tail",
      position: [0, 1.2, -5.1],
      scale: [0.22, 2.3, 1.45],
      material: "secondary",
      damageComponent: "tail"
    },
    {
      id: "elevators",
      kind: "box",
      role: "tail",
      position: [0, 0.15, -5.45],
      scale: [4.6, 0.16, 1.0],
      material: "primary",
      damageComponent: "tail"
    },
    {
      id: "propA",
      kind: "box",
      role: "propeller",
      position: [0, 0, 7.6],
      scale: [6.5, 0.25, 0.08],
      material: "metal",
      tags: ["spinZ"]
    },
    {
      id: "propB",
      kind: "box",
      role: "propeller",
      position: [0, 0, 7.6],
      rotation: [0, 0, Math.PI / 2],
      scale: [6.5, 0.25, 0.08],
      material: "metal",
      tags: ["spinZ"]
    },
    {
      id: "exhaust",
      kind: "box",
      role: "engine",
      position: [0, 0, -6.25],
      scale: [0.8, 0.8, 0.5],
      material: "accent",
      damageComponent: "fuelTank"
    },
    // Grizzly specialized cannon barrel
    {
      id: "grizzlyCannon",
      kind: "box",
      role: "weapon",
      position: [0, -0.65, 7.4],
      scale: [0.35, 0.35, 2.5],
      material: "metal"
    },
    // Grizzly weapon pods
    {
      id: "leftGrizzlyPod",
      kind: "box",
      role: "weapon",
      position: [-5.0, -0.55, 0.3],
      scale: [1.0, 0.65, 2.5],
      material: "secondary"
    },
    {
      id: "rightGrizzlyPod",
      kind: "box",
      role: "weapon",
      position: [5.0, -0.55, 0.3],
      scale: [1.0, 0.65, 2.5],
      material: "secondary"
    },
    ...[
      [-2.45, -0.95, 1.45],
      [2.45, -0.95, 1.45],
      [-2.45, -0.95, -1.15],
      [2.45, -0.95, -1.15]
    ].flatMap((position, index) => [
      {
        id: `bombBody${index}`,
        kind: "cylinder" as const,
        role: "weapon" as const,
        position: position as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        scale: [0.58, 1.8, 0.58] as [number, number, number],
        material: "bomb",
        tags: [`ordnance:bomb:${index}`]
      },
      {
        id: `bombNose${index}`,
        kind: "wedge" as const,
        role: "weapon" as const,
        position: [position[0], position[1], position[2] + 1.02] as [number, number, number],
        rotation: [Math.PI, 0, 0] as [number, number, number],
        scale: [0.58, 0.58, 0.55] as [number, number, number],
        material: "bomb",
        tags: [`ordnance:bomb:${index}`]
      },
      {
        id: `bombBand${index}`,
        kind: "cylinder" as const,
        role: "weapon" as const,
        position: [position[0], position[1], position[2] + 0.3] as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        scale: [0.64, 0.16, 0.64] as [number, number, number],
        material: "bombBand",
        tags: [`ordnance:bomb:${index}`]
      }
    ])
  ]
};
