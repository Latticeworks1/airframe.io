import * as THREE from "three";
import { NodeMaterial } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  texture3D,
  uniform,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import {
  MapDefinition,
  getAtmosphereSunDirection
} from "./content/maps/mapTypes";

type CloudVolume = {
  center: THREE.Vector3;
  radius: THREE.Vector3;
  density: number;
};

const NOISE_SIZE = 64;
const RAY_STEPS = 42;

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
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function latticeHash(x: number, y: number, z: number, seed: number) {
  let value = Math.imul(x, 374761393);
  value = Math.imul(value ^ Math.imul(y, 668265263), 1274126177);
  value = Math.imul(value ^ Math.imul(z, 2246822519), 3266489917);
  value ^= seed;
  value ^= value >>> 15;
  value = Math.imul(value, 2246822519);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967295;
}

function fade(value: number) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function periodicValueNoise(
  x: number,
  y: number,
  z: number,
  period: number,
  seed: number
) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  const wrap = (value: number) => ((value % period) + period) % period;
  const sample = (dx: number, dy: number, dz: number) =>
    latticeHash(
      wrap(x0 + dx),
      wrap(y0 + dy),
      wrap(z0 + dz),
      seed
    );

  const x00 = lerp(sample(0, 0, 0), sample(1, 0, 0), tx);
  const x10 = lerp(sample(0, 1, 0), sample(1, 1, 0), tx);
  const x01 = lerp(sample(0, 0, 1), sample(1, 0, 1), tx);
  const x11 = lerp(sample(0, 1, 1), sample(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function fbm(
  nx: number,
  ny: number,
  nz: number,
  firstPeriod: number,
  octaves: number,
  seed: number
) {
  let value = 0;
  let amplitude = 0.56;
  let normalization = 0;
  let period = firstPeriod;

  for (let octave = 0; octave < octaves; octave++) {
    value += periodicValueNoise(
      nx * period,
      ny * period,
      nz * period,
      period,
      seed + octave * 1013
    ) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }

  return value / normalization;
}

function createCloudNoiseTexture(seed: number) {
  const data = new Uint8Array(NOISE_SIZE ** 3 * 4);
  let offset = 0;

  for (let z = 0; z < NOISE_SIZE; z++) {
    const nz = z / NOISE_SIZE;
    for (let y = 0; y < NOISE_SIZE; y++) {
      const ny = y / NOISE_SIZE;
      for (let x = 0; x < NOISE_SIZE; x++) {
        const nx = x / NOISE_SIZE;
        const base = fbm(nx, ny, nz, 4, 4, seed);
        const detail = fbm(nx, ny, nz, 12, 3, seed ^ 0x9e3779b9);

        data[offset] = Math.round(THREE.MathUtils.clamp(base, 0, 1) * 255);
        data[offset + 1] = Math.round(
          THREE.MathUtils.clamp(detail, 0, 1) * 255
        );
        data[offset + 2] = 0;
        data[offset + 3] = 255;
        offset += 4;
      }
    }
  }

  const texture = new THREE.Data3DTexture(
    data,
    NOISE_SIZE,
    NOISE_SIZE,
    NOISE_SIZE
  );
  texture.name = "cloud-density-noise";
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const hitUnitBox = Fn(([origin, direction]: [any, any]) => {
  const inverseDirection = direction.reciprocal();
  const tMinTemporary = vec3(-0.5).sub(origin).mul(inverseDirection);
  const tMaxTemporary = vec3(0.5).sub(origin).mul(inverseDirection);
  const tMin = min(tMinTemporary, tMaxTemporary);
  const tMax = max(tMinTemporary, tMaxTemporary);

  return vec2(
    max(tMin.x, max(tMin.y, tMin.z)),
    min(tMax.x, min(tMax.y, tMax.z))
  );
});

export class CloudField {
  public readonly mesh: THREE.InstancedMesh;
  private readonly material: NodeMaterial;
  private readonly noiseTexture: THREE.Data3DTexture;
  private readonly volumes: CloudVolume[] = [];
  private readonly uTime = uniform(0);

  constructor(def: MapDefinition) {
    const mapSeed = hashString(def.id);
    const random = createRandom(mapSeed);
    const atmosphere = def.atmosphere;
    const cloudProfile = atmosphere.cloudField;
    const clusterCount = Math.round(
      cloudProfile.clusterBase +
      def.cloudDensity * cloudProfile.clusterDensityScale
    );

    const centerArray = new Float32Array(clusterCount * 3);
    const sizeArray = new Float32Array(clusterCount * 3);
    const seedArray = new Float32Array(clusterCount);
    const densityArray = new Float32Array(clusterCount);

    const worldRadius = def.world.radius;
    for (let index = 0; index < clusterCount; index++) {
      const angle = random() * Math.PI * 2;
      // Distribute clusters across the full world radius so clouds aren't
      // all piled at the map centre when the radius is large (e.g. 32 000 m).
      const minDist = worldRadius * 0.04;
      const maxDist = worldRadius * 0.88;
      const distance = minDist + Math.sqrt(random()) * (maxDist - minDist);
      const center = new THREE.Vector3(
        Math.cos(angle) * distance,
        THREE.MathUtils.lerp(
          cloudProfile.altitudeMin,
          cloudProfile.altitudeMax,
          random()
        ),
        Math.sin(angle) * distance
      );
      const radius = new THREE.Vector3(
        440 + random() * 620,
        150 + random() * 220,
        400 + random() * 580
      );
      const density = 0.68 + random() * 0.28;

      this.volumes.push({ center, radius, density });

      center.toArray(centerArray, index * 3);
      radius.clone().multiplyScalar(2).toArray(sizeArray, index * 3);
      seedArray[index] = random();
      densityArray[index] = density;
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      "aCloudCenter",
      new THREE.InstancedBufferAttribute(centerArray, 3)
    );
    geometry.setAttribute(
      "aCloudSize",
      new THREE.InstancedBufferAttribute(sizeArray, 3)
    );
    geometry.setAttribute(
      "aCloudSeed",
      new THREE.InstancedBufferAttribute(seedArray, 1)
    );
    geometry.setAttribute(
      "aCloudDensity",
      new THREE.InstancedBufferAttribute(densityArray, 1)
    );

    const cloudCenter = attribute("aCloudCenter", "vec3") as any;
    const cloudSize = attribute("aCloudSize", "vec3") as any;
    const cloudSeed = attribute("aCloudSeed", "float") as any;
    const cloudDensity = attribute("aCloudDensity", "float") as any;
    const localVertex = attribute("position", "vec3") as any;

    this.noiseTexture = createCloudNoiseTexture(mapSeed);
    const noiseVolume = texture3D(this.noiseTexture, null, 0);

    const uBright = uniform(new THREE.Color(cloudProfile.brightColor)) as any;
    const uShadow = uniform(new THREE.Color(cloudProfile.shadowColor)) as any;
    const uFogColor = uniform(new THREE.Color(atmosphere.fogColor)) as any;
    const uFogNear = uniform(cloudProfile.fogNear);
    const uFogFar = uniform(cloudProfile.fogFar);
    const uCoverage = uniform(
      THREE.MathUtils.clamp(def.cloudDensity, 0, 1)
    );
    const uSunDirection = uniform(
      getAtmosphereSunDirection(atmosphere)
    ) as any;
    const uTime = this.uTime;

    const sampleDensity: any = Fn(([localPosition]: [any]) => {
      const uvw = localPosition.add(0.5).toVar();
      const horizontalEdge = min(
        min(uvw.x, float(1).sub(uvw.x)),
        min(uvw.z, float(1).sub(uvw.z))
      );
      const edgeEnvelope = smoothstep(0.0, 0.14, horizontalEdge);
      const baseEnvelope = smoothstep(0.0, 0.12, uvw.y);
      const topEnvelope = float(1).sub(smoothstep(0.62, 1.0, uvw.y));
      const heightEnvelope = baseEnvelope.mul(topEnvelope);

      const wind = vec3(
        uTime.mul(0.0018),
        float(0),
        uTime.mul(0.0007)
      );
      const seedOffset = vec3(
        cloudSeed.mul(0.173),
        cloudSeed.mul(0.317),
        cloudSeed.mul(0.271)
      );
      const baseSample = noiseVolume.sample(
        fract(uvw.mul(vec3(1.45, 1.08, 1.45)).add(seedOffset).add(wind))
      );
      const detailSample = noiseVolume.sample(
        fract(
          uvw
            .mul(vec3(3.4, 2.2, 3.4))
            .add(seedOffset.mul(2.7))
            .sub(wind.mul(1.8))
        )
      );
      const shapeNoise = baseSample.r
        .mul(0.78)
        .add(baseSample.g.mul(0.22));
      const erosion = detailSample.g.mul(0.17);
      const coverageBias = mix(-0.03, 0.14, uCoverage);
      const signal = shapeNoise
        .add(coverageBias)
        .sub(erosion)
        .sub(float(1).sub(edgeEnvelope.mul(heightEnvelope)).mul(0.72));

      return smoothstep(0.34, 0.56, signal).mul(cloudDensity);
    });

    const worldPosition = Fn(() =>
      cloudCenter.add(localVertex.mul(cloudSize))
    )();

    const fragmentNode = Fn(() => {
      const worldRayDirection = normalize(
        positionWorld.sub(cameraPosition)
      ).toVar("worldRayDirection");
      const localRayOrigin = cameraPosition
        .sub(cloudCenter)
        .div(cloudSize)
        .toVar("localRayOrigin");
      const localRayDirection = normalize(
        worldRayDirection.div(cloudSize)
      ).toVar("localRayDirection");
      const bounds = hitUnitBox(
        localRayOrigin,
        localRayDirection
      ).toVar("cloudBounds");

      bounds.x.greaterThan(bounds.y).discard();
      bounds.x.assign(max(bounds.x, 0));

      const inverseDirection = (localRayDirection as any)
        .abs()
        .reciprocal() as any;
      const stepLength = min(
        inverseDirection.x,
        min(inverseDirection.y, inverseDirection.z)
      ).div(RAY_STEPS);
      const localStep = localRayDirection.mul(stepLength);
      const worldStepLength = length(localStep.mul(cloudSize));
      const rayPosition = localRayOrigin
        .add(localRayDirection.mul(bounds.x))
        .toVar("cloudRayPosition");

      const jitter = fract(
        dot(localVertex.xz.add(cloudSeed), vec2(12.9898, 78.233))
          .sin()
          .mul(43758.5453)
      );
      rayPosition.addAssign(localStep.mul(jitter));

      const accumulated = vec4(0).toVar("cloudAccumulation");
      const localSunDirection = normalize(
        uSunDirection.div(cloudSize)
      );
      const viewSunCosine = dot(
        worldRayDirection.negate(),
        uSunDirection
      );
      const forwardScatter = pow(
        clamp(viewSunCosine.mul(0.5).add(0.5), 0, 1),
        6
      );

      Loop(
        {
          type: "float",
          start: bounds.x,
          end: bounds.y,
          update: stepLength
        },
        () => {
          const density = float(
            sampleDensity(rayPosition) as any
          ).toVar("sampleDensity");

          If(density.greaterThan(0.002), () => {
            const lightDensity = float(
              sampleDensity(
                rayPosition.add(localSunDirection.mul(0.055))
              ) as any
            )
              .mul(0.55)
              .add(
                float(
                  sampleDensity(
                    rayPosition.add(localSunDirection.mul(0.13))
                  ) as any
                ).mul(0.3)
              )
              .add(
                float(
                  sampleDensity(
                    rayPosition.add(localSunDirection.mul(0.25))
                  ) as any
                ).mul(0.15)
              );
            const lightTransmission = exp(lightDensity.mul(-2.35));
            const lightAmount = clamp(
              float(0.16)
                .add(lightTransmission.mul(0.72))
                .add(forwardScatter.mul(0.2)),
              0,
              1
            );
            const sampleColor = mix(uShadow, uBright, lightAmount);
            const sampleAlpha = float(1).sub(
              exp(density.mul(worldStepLength).mul(-0.0085))
            );
            const remaining = accumulated.a.oneMinus();

            accumulated.rgb.addAssign(
              sampleColor.mul(sampleAlpha).mul(remaining)
            );
            accumulated.a.addAssign(sampleAlpha.mul(remaining));
          });

          If(accumulated.a.greaterThanEqual(0.97), () => {
            Break();
          });

          rayPosition.addAssign(localStep);
        }
      );

      const entryPosition = cloudCenter.add(
        localRayOrigin
          .add(localRayDirection.mul(bounds.x))
          .mul(cloudSize)
      );
      const fogFactor = smoothstep(
        uFogNear,
        uFogFar,
        length(entryPosition.sub(cameraPosition))
      );
      accumulated.rgb.assign(
        mix(accumulated.rgb, uFogColor.mul(accumulated.a), fogFactor)
      );
      accumulated.a.mulAssign(float(1).sub(fogFactor.mul(0.7)));

      return accumulated;
    })();

    this.material = new NodeMaterial();
    this.material.positionNode = worldPosition;
    this.material.fragmentNode = fragmentNode;
    this.material.side = THREE.BackSide;
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = true;

    this.mesh = new THREE.InstancedMesh(
      geometry,
      this.material as unknown as THREE.Material,
      clusterCount
    );
    this.mesh.name = "raymarched-cloud-field";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;

    const identity = new THREE.Matrix4();
    for (let index = 0; index < clusterCount; index++) {
      this.mesh.setMatrixAt(index, identity);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public update(dt: number) {
    this.uTime.value += THREE.MathUtils.clamp(dt, 0, 0.05);
  }

  public sampleDensity(position: THREE.Vector3): number {
    let total = 0;

    for (const volume of this.volumes) {
      const dx = (position.x - volume.center.x) / volume.radius.x;
      const dy = (position.y - volume.center.y) / volume.radius.y;
      const dz = (position.z - volume.center.z) / volume.radius.z;
      const normalizedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (normalizedDistance < 1) {
        total = Math.max(
          total,
          (1 - THREE.MathUtils.smoothstep(normalizedDistance, 0.32, 1)) *
            volume.density
        );
      }
    }

    return THREE.MathUtils.clamp(total, 0, 1);
  }

  public dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.noiseTexture.dispose();
  }
}
