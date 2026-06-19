import * as THREE from "three";
import { GameMap, MapSpecs } from "../types";
import { NodeMaterial } from "three/webgpu";
import {
  Fn, vec2, vec3, vec4, float,
  uniform, attribute,
  uv, positionWorld, cameraPosition,
  sin, mix, clamp, smoothstep,
  normalize, length, cross, dot,
  fract, floor, atan
} from "three/tsl";

type CloudVolume = {
  center: THREE.Vector3;
  radius: THREE.Vector3;
  density: number;
};

const cloudHashFn = Fn(([p]: [any]) =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123))
);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let v = state;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function getCloudColors(mapSpecs: MapSpecs) {
  if (mapSpecs.id === GameMap.StormFront)
    return { bright: new THREE.Color("#94a3b8"), shadow: new THREE.Color("#273449") };
  if (mapSpecs.id === GameMap.DesertCanyon)
    return { bright: new THREE.Color("#fff7ed"), shadow: new THREE.Color("#c9a982") };
  if (mapSpecs.id === GameMap.AlpineValley)
    return { bright: new THREE.Color("#ffffff"), shadow: new THREE.Color("#b9c9d8") };
  return { bright: new THREE.Color("#ffffff"), shadow: new THREE.Color("#a8c5d7") };
}

export class CloudField {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: NodeMaterial;
  private readonly volumes: CloudVolume[] = [];
  private readonly uTime = uniform(0);

  constructor(mapSpecs: MapSpecs) {
    const random = createRandom(hashString(mapSpecs.id));
    const colors = getCloudColors(mapSpecs);
    const clusterCount = Math.round(8 + mapSpecs.cloudDensity * 22);

    const puffs: Array<{
      position: THREE.Vector3;
      width: number;
      height: number;
      seed: number;
      opacity: number;
    }> = [];

    for (let ci = 0; ci < clusterCount; ci++) {
      const angle = random() * Math.PI * 2;
      const dist = 900 + Math.sqrt(random()) * 6100;
      const center = new THREE.Vector3(
        Math.cos(angle) * dist,
        420 + random() * 820,
        Math.sin(angle) * dist
      );
      const radius = new THREE.Vector3(
        360 + random() * 520,
        110 + random() * 190,
        320 + random() * 480
      );
      this.volumes.push({ center, radius, density: 0.55 + random() * 0.35 });

      const puffCount = 5 + Math.floor(random() * 5);
      for (let pi = 0; pi < puffCount; pi++) {
        const offset = new THREE.Vector3(
          (random() - 0.5) * radius.x * 1.35,
          (random() - 0.5) * radius.y * 0.9,
          (random() - 0.5) * radius.z * 1.35
        );
        puffs.push({
          position: center.clone().add(offset),
          width:   radius.x * (0.62 + random() * 0.72),
          height:  radius.y * (1.15 + random() * 1.15),
          seed:    random(),
          opacity: (0.55 + random() * 0.35) * (0.58 + random() * 0.27)
        });
      }
    }

    const count = puffs.length;
    const posArr     = new Float32Array(count * 3);
    const scaleArr   = new Float32Array(count * 2);
    const seedArr    = new Float32Array(count);
    const opacityArr = new Float32Array(count);

    puffs.forEach((p, i) => {
      posArr[i * 3]     = p.position.x;
      posArr[i * 3 + 1] = p.position.y;
      posArr[i * 3 + 2] = p.position.z;
      scaleArr[i * 2]     = p.width;
      scaleArr[i * 2 + 1] = p.height;
      seedArr[i]    = p.seed;
      opacityArr[i] = p.opacity;
    });

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("aPos",     new THREE.InstancedBufferAttribute(posArr,     3));
    geometry.setAttribute("aScale",   new THREE.InstancedBufferAttribute(scaleArr,   2));
    geometry.setAttribute("aSeed",    new THREE.InstancedBufferAttribute(seedArr,    1));
    geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(opacityArr, 1));

    const aPosAttr     = attribute("aPos",     "vec3")  as any;
    const aScaleAttr   = attribute("aScale",   "vec2")  as any;
    const aSeedAttr    = attribute("aSeed",    "float") as any;
    const aOpacityAttr = attribute("aOpacity", "float") as any;
    const aRawPos      = attribute("position", "vec3")  as any;

    const uBright   = uniform(colors.bright)                   as any;
    const uShadow   = uniform(colors.shadow)                   as any;
    const uFogColor = uniform(new THREE.Color(mapSpecs.fogColor)) as any;
    const uFogNear  = uniform(2600);
    const uFogFar   = uniform(9200);
    const uTime     = this.uTime;

    // Spherical billboard: each puff independently faces the camera.
    const billboardPos = Fn(() => {
      const toCamera  = normalize(cameraPosition.sub(aPosAttr));
      const worldUp   = vec3(0, 1, 0);
      const camRight  = normalize(cross(worldUp, toCamera));
      const camUp     = normalize(cross(toCamera, camRight));
      return aPosAttr
        .add(camRight.mul(aRawPos.x).mul(aScaleAttr.x))
        .add(camUp.mul(aRawPos.y).mul(aScaleAttr.y));
    })();

    const fragmentFn = Fn(() => {
      const uvCoord = uv();
      const p = (uvCoord.mul(2.0).sub(1.0) as any);
      const angle   = atan(p.y, p.x);
      const wobble  = sin(angle.mul(5.0).add(aSeedAttr.mul(17.0)).add(uTime.mul(0.015))).mul(0.075)
        .add(sin(angle.mul(9.0).sub(aSeedAttr.mul(11.0))).mul(0.045));
      const edge    = float(0.82).add(wobble);
      const radial  = length(p.mul(vec2(0.94, 1.06))).toVar("radial");
      const detail  = cloudHashFn(floor(uvCoord.mul(18.0)).add(aSeedAttr.mul(31.0)));
      const alpha   = float(1.0).sub(smoothstep(edge.sub(0.24), edge, radial))
        .mul(float(0.9).add(detail.mul(0.1)))
        .mul(aOpacityAttr)
        .toVar("alpha");

      const edgeLight     = smoothstep(0.78, 0.28, radial);
      const verticalLight = smoothstep(0.0, 1.0, uvCoord.y);
      const color = mix(uShadow, uBright,
        verticalLight.mul(0.58).add(edgeLight.mul(0.42))
      ).toVar("color");

      const dist      = length(cameraPosition.sub(positionWorld));
      const fogFactor = smoothstep(uFogNear, uFogFar, dist);
      color.assign(mix(color, uFogColor, fogFactor));
      alpha.mulAssign(float(1.0).sub(fogFactor.mul(0.72)));

      return vec4(color, alpha);
    })();

    this.material = new NodeMaterial();
    this.material.positionNode = billboardPos;
    this.material.fragmentNode = fragmentFn;
    this.material.transparent  = true;
    this.material.depthWrite   = false;
    this.material.depthTest    = true;
    this.material.side         = THREE.DoubleSide;
    this.material.alphaTest    = 0.018;

    this.mesh = new THREE.InstancedMesh(
      geometry,
      this.material as unknown as THREE.Material,
      count
    );
    this.mesh.name = "instanced-cloud-field";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;

    // All instance matrices stay identity — position/scale come from instanced attributes.
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, identity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public update(dt: number) {
    this.uTime.value += THREE.MathUtils.clamp(dt, 0, 0.05);
  }

  public sampleDensity(position: THREE.Vector3): number {
    let total = 0;
    for (const v of this.volumes) {
      const dx = (position.x - v.center.x) / v.radius.x;
      const dy = (position.y - v.center.y) / v.radius.y;
      const dz = (position.z - v.center.z) / v.radius.z;
      const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1) total = Math.max(total, (1 - THREE.MathUtils.smoothstep(d, 0.38, 1)) * v.density);
    }
    return THREE.MathUtils.clamp(total, 0, 1);
  }

  public dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
