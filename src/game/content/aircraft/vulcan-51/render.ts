import { AircraftRenderDef } from "../types";

export const render: AircraftRenderDef = {
  id: "vulcan-51",
  materials: {
    primary: "#1E3A8A",
    secondary: "#3B82F6",
    accent: "#FBBF24",
    canopy: "#93C5FD",
    metal: "#64748B"
  },
  camera: {
    cockpitEye: [0, 1.32, 0.88],
    firstPersonFov: 74,
    hiddenBlockIds: ["canopy"]
  },
  blocks: [
    {
      id: "fuselage",
      kind: "box",
      role: "fuselage",
      position: [0, 0, 0],
      scale: [1.7, 1.6, 11.5],
      material: "primary",
      damageComponent: "fuselage"
    },
    {
      id: "nose",
      kind: "wedge",
      role: "nose",
      position: [0, 0, 6.4],
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
      scale: [16, 0.18, 2.8],
      material: "primary",
      damageComponent: "leftWing"
    },
    {
      id: "leftWingTip",
      kind: "box",
      role: "wing",
      position: [-7.25, 0.03, 0.4],
      scale: [1.5, 0.22, 2.52],
      material: "secondary",
      damageComponent: "leftWing"
    },
    {
      id: "rightWingTip",
      kind: "box",
      role: "wing",
      position: [7.25, 0.03, 0.4],
      scale: [1.5, 0.22, 2.52],
      material: "secondary",
      damageComponent: "rightWing"
    },
    {
      id: "tailFin",
      kind: "box",
      role: "tail",
      position: [0, 1.2, -4.85],
      scale: [0.22, 2.3, 1.45],
      material: "secondary",
      damageComponent: "tail"
    },
    {
      id: "elevators",
      kind: "box",
      role: "tail",
      position: [0, 0.15, -5.2],
      scale: [4.6, 0.16, 1.0],
      material: "primary",
      damageComponent: "tail"
    },
    {
      id: "propA",
      kind: "box",
      role: "propeller",
      position: [0, 0, 7.35],
      scale: [6.5, 0.25, 0.08],
      material: "metal",
      tags: ["spinZ"]
    },
    {
      id: "propB",
      kind: "box",
      role: "propeller",
      position: [0, 0, 7.35],
      rotation: [0, 0, Math.PI / 2],
      scale: [6.5, 0.25, 0.08],
      material: "metal",
      tags: ["spinZ"]
    },
    {
      id: "exhaust",
      kind: "box",
      role: "engine",
      position: [0, 0, -6.0],
      scale: [0.8, 0.8, 0.5],
      material: "accent",
      damageComponent: "fuelTank"
    }
  ]
};
