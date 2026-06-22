import * as THREE from "three";
import { AircraftRenderDef } from "./types";
import { BlockPrimitiveDef } from "../primitives/primitiveTypes";

export function createAircraftMesh(def: AircraftRenderDef): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  const materialCache = new Map<string, THREE.Material>();

  const getMaterial = (matId: string) => {
    const cached = materialCache.get(matId);
    if (cached) return cached;

    const colorHexStr = def.materials[matId] ?? "#ffffff";
    const color = new THREE.Color(colorHexStr);

    const material =
      matId === "canopy"
        ? new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.65
          })
        : new THREE.MeshLambertMaterial({
            color,
            flatShading: true
          });

    materialCache.set(matId, material);
    return material;
  };

  for (const block of def.blocks) {
    const mesh = buildBlockMesh(block, getMaterial(block.material));
    mesh.userData.blockId = block.id;
    mesh.userData.role = block.role;
    mesh.userData.tags = block.tags ?? [];
    mesh.userData.damageComponent = block.damageComponent;
    group.add(mesh);
  }

  return group;
}

// Shared unit geometries for memory and draw efficiency
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const unitSphere = new THREE.SphereGeometry(0.5, 8, 8);
const unitWedge = createWedgeGeometry(1, 1, 1);

function getSharedGeometry(kind: string): THREE.BufferGeometry {
  switch (kind) {
    case "box": return unitBox;
    case "cylinder": return unitCylinder;
    case "sphere": return unitSphere;
    case "wedge": return unitWedge;
    default: return unitBox;
  }
}

function buildBlockMesh(
  block: BlockPrimitiveDef,
  material: THREE.Material
): THREE.Mesh {
  const geometry = getSharedGeometry(block.kind);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = block.id;
  mesh.position.set(...block.position);
  mesh.scale.set(...block.scale);
  if (block.rotation) {
    mesh.rotation.set(...block.rotation);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createWedgeGeometry(width: number, height: number, depth: number) {
  const w = width / 2;
  const h = height / 2;
  const d = depth / 2;

  // Wedge pointing forward (along positive Z or looking like a nose wedge)
  const vertices = new Float32Array([
    // Bottom Face (box standard)
    -w, -h, -d,   w, -h, -d,   w, -h,  d,  -w, -h,  d,
    // Back vertical Face
    -w, -h, -d,   w, -h, -d,   0,  h, -d,
    // Front wedge seam (pointed downwards/forwards)
    -w, -h,  d,   w, -h,  d,   0,  h,  d,
    // Left side triangle
    -w, -h, -d,  -w, -h,  d,   0,  h,  d,   0,  h, -d,
    // Right side triangle
     w, -h, -d,   w, -h,  d,   0,  h,  d,   0,  h, -d
  ]);

  const indices = [
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6,          // back
    7, 9, 8,          // front sloped
    10, 11, 12, 10, 12, 13, // left
    14, 15, 16, 14, 16, 17  // right
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}
