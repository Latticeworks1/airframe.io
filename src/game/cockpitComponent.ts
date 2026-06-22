import * as THREE from "three";
import { ObjectLoader } from "three";

export function parseComponent(json: unknown): THREE.Group {
  return new ObjectLoader().parse(json) as THREE.Group;
}

/**
 * Extracts BufferGeometry instances from an Object3D hierarchy with world
 * transforms baked in.  Strips uv/uv2 and injects a vertex-color attribute
 * derived from the base color modulated by the surface normal, matching the
 * shading convention used by coloredBoxGeo in cockpitMesh.ts so that all
 * geometries passed to mergeGeometries share position + normal + color.
 */
export function extractGeometries(
  object: THREE.Object3D,
  color: THREE.Color
): THREE.BufferGeometry[] {
  object.updateWorldMatrix(true, true);
  const geos: THREE.BufferGeometry[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = (child.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(child.matrixWorld);
    geo.deleteAttribute("uv");
    geo.deleteAttribute("uv2");

    const pos    = geo.attributes.position;
    const normal = geo.attributes.normal;
    const count  = pos.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let shade = 0.94;
      if (normal) {
        const ny = normal.getY(i);
        const nz = normal.getZ(i);
        if (ny > 0.5)       shade = 1.08;
        else if (ny < -0.5) shade = 0.76;
        else if (nz < -0.5) shade = 0.88;
      }
      colors[i * 3]     = Math.min(1, color.r * shade);
      colors[i * 3 + 1] = Math.min(1, color.g * shade);
      colors[i * 3 + 2] = Math.min(1, color.b * shade);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geos.push(geo);
  });
  return geos;
}

export function componentGeometries(
  json: unknown,
  position: THREE.Vector3,
  color: THREE.Color,
  rotation?: THREE.Euler
): THREE.BufferGeometry[] {
  const obj = parseComponent(json);
  obj.position.copy(position);
  if (rotation) obj.rotation.copy(rotation);
  return extractGeometries(obj, color);
}
