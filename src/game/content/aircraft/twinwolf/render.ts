import { AircraftRenderDef } from "../types";

export const render: AircraftRenderDef = {
  id: "twinwolf",
  materials: {
    primary: "#581C87",
    secondary: "#A855F7",
    accent: "#FBBF24",
    canopy: "#D8B4FE",
    metal: "#64748B"
  },
  camera: {
    cockpitEye: [0, 1.3, 0.82],
    firstPersonFov: 72,
    hiddenBlockIds: ["canopy"]
  },
  blocks: [
    {
      id: "fuselage",
      kind: "box",
      role: "fuselage",
      position: [0, 0, 0],
      scale: [1.7, 1.6, 13],
      material: "primary",
      damageComponent: "fuselage"
    },
    {
      id: "nose",
      kind: "wedge",
      role: "nose",
      position: [0, 0, 7.15],
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
      scale: [22, 0.18, 2.1],
      material: "primary",
      damageComponent: "leftWing"
    },
    {
      id: "leftWingTip",
      kind: "box",
      role: "wing",
      position: [-10.25, 0.03, 0.4],
      scale: [1.5, 0.22, 1.89],
      material: "secondary",
      damageComponent: "leftWing"
    },
    {
      id: "rightWingTip",
      kind: "box",
      role: "wing",
      position: [10.25, 0.03, 0.4],
      scale: [1.5, 0.22, 1.89],
      material: "secondary",
      damageComponent: "rightWing"
    },
    {
      id: "tailFin",
      kind: "box",
      role: "tail",
      position: [0, 1.2, -5.6],
      scale: [0.22, 2.3, 1.45],
      material: "secondary",
      damageComponent: "tail"
    },
    {
      id: "elevators",
      kind: "box",
      role: "tail",
      position: [0, 0.15, -5.95],
      scale: [4.6, 0.16, 1.0],
      material: "primary",
      damageComponent: "tail"
    },
    {
      id: "exhaust",
      kind: "box",
      role: "engine",
      position: [0, 0, -6.75],
      scale: [0.8, 0.8, 0.5],
      material: "accent",
      damageComponent: "fuelTank"
    },
    // Left heavy engine pod
    {
      id: "leftPod",
      kind: "box",
      role: "engine",
      position: [-4.5, -0.1, 0.2],
      scale: [1.4, 1.25, 5.5],
      material: "primary",
      damageComponent: "engine"
    },
    // Left propeller blade A
    {
      id: "leftPropA",
      kind: "box",
      role: "propeller",
      position: [-4.5, -0.1, 3.3],
      scale: [5.1, 0.2, 0.06],
      material: "metal",
      tags: ["spinZ"]
    },
    // Left propeller blade B
    {
      id: "leftPropB",
      kind: "box",
      role: "propeller",
      position: [-4.5, -0.1, 3.3],
      rotation: [0, 0, Math.PI / 2],
      scale: [5.1, 0.2, 0.06],
      material: "metal",
      tags: ["spinZ"]
    },
    // Right heavy engine pod
    {
      id: "rightPod",
      kind: "box",
      role: "engine",
      position: [4.5, -0.1, 0.2],
      scale: [1.4, 1.25, 5.5],
      material: "primary",
      damageComponent: "engine"
    },
    // Right propeller blade A
    {
      id: "rightPropA",
      kind: "box",
      role: "propeller",
      position: [4.5, -0.1, 3.3],
      scale: [5.1, 0.2, 0.06],
      material: "metal",
      tags: ["spinZ"]
    },
    // Right propeller blade B
    {
      id: "rightPropB",
      kind: "box",
      role: "propeller",
      position: [4.5, -0.1, 3.3],
      rotation: [0, 0, Math.PI / 2],
      scale: [5.1, 0.2, 0.06],
      material: "metal",
      tags: ["spinZ"]
    }
  ]
};
