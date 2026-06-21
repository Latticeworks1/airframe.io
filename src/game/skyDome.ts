import * as THREE from "three";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import {
  AtmosphereProfile,
  getAtmosphereSunDirection
} from "./content/maps/mapTypes";

export type SkyDomeMesh = SkyMesh;

export type SkyEnvironment = {
  profile: AtmosphereProfile;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyLightColor: THREE.Color;
  groundLightColor: THREE.Color;
  ambientIntensity: number;
  backgroundColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
  cloudVeilColor: THREE.Color;
};

type SkyRuntime = {
  profile: AtmosphereProfile;
  smoothedAltitude: number;
};

const skyRuntime = new WeakMap<SkyDomeMesh, SkyRuntime>();

export function getSkyEnvironment(profile: AtmosphereProfile): SkyEnvironment {
  return {
    profile,
    sunDirection: getAtmosphereSunDirection(profile),
    sunColor: new THREE.Color(profile.sunColor),
    sunIntensity: profile.sunIntensity,
    skyLightColor: new THREE.Color(profile.skyLightColor),
    groundLightColor: new THREE.Color(profile.groundLightColor),
    ambientIntensity: profile.ambientIntensity,
    backgroundColor: new THREE.Color(profile.backgroundColor),
    fogColor: new THREE.Color(profile.fogColor),
    fogNear: profile.fogNear,
    fogFar: profile.fogFar,
    exposure: profile.exposure,
    cloudVeilColor: new THREE.Color(profile.cloudVeilColor)
  };
}

export function createSkyDome(profile: AtmosphereProfile): SkyDomeMesh {
  const sky = new SkyMesh();

  sky.name = "atmospheric-sky";
  sky.scale.setScalar(450000);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;

  sky.turbidity.value = profile.turbidity;
  sky.rayleigh.value = profile.rayleigh;
  sky.mieCoefficient.value = profile.mieCoefficient;
  sky.mieDirectionalG.value = profile.mieDirectionalG;
  sky.sunPosition.value.copy(getAtmosphereSunDirection(profile));
  sky.cloudScale.value = profile.cloudLayer.scale;
  sky.cloudSpeed.value = profile.cloudLayer.speed;
  sky.cloudCoverage.value = profile.cloudLayer.coverage;
  sky.cloudDensity.value = profile.cloudLayer.density;
  sky.cloudElevation.value = profile.cloudLayer.elevation;
  sky.showSunDisc.value = profile.showSunDisc;

  skyRuntime.set(sky, {
    profile,
    smoothedAltitude: 0
  });

  return sky;
}

export function updateSkyDome(
  skyDome: SkyDomeMesh,
  camera: THREE.Camera,
  fog: THREE.Fog | null,
  dt: number,
  farPlaneScale = 1.0,
  maxFogFar = Infinity
) {
  skyDome.position.copy(camera.position);

  const runtime = skyRuntime.get(skyDome);
  if (!runtime) return;

  const targetAltitude = THREE.MathUtils.smoothstep(camera.position.y, 80, 3500);
  const blend = 1 - Math.exp(-THREE.MathUtils.clamp(dt, 0, 0.05) * 0.8);
  runtime.smoothedAltitude = THREE.MathUtils.lerp(
    runtime.smoothedAltitude,
    targetAltitude,
    blend
  );

  const altitude = runtime.smoothedAltitude;
  const { profile } = runtime;

  skyDome.turbidity.value = THREE.MathUtils.lerp(
    profile.turbidity,
    Math.max(2, profile.turbidity * 0.58),
    altitude
  );
  skyDome.rayleigh.value = THREE.MathUtils.lerp(
    profile.rayleigh,
    profile.rayleigh * 0.78,
    altitude
  );
  skyDome.mieCoefficient.value = THREE.MathUtils.lerp(
    profile.mieCoefficient,
    profile.mieCoefficient * 0.42,
    altitude
  );

  if (fog) {
    // Keep the fog close to its ground-level values at altitude so the world
    // boundary stays hidden even when flying high. Old 3× / 6× multipliers
    // ballooned fogFar to 210 km at 3 km AGL, leaving the 32 km edge visible.
    fog.near = THREE.MathUtils.lerp(profile.fogNear, profile.fogNear * 1.3, altitude);
    fog.far  = Math.min(
      THREE.MathUtils.lerp(profile.fogFar, profile.fogFar * 1.4, altitude),
      maxFogFar
    );
  }

  // Dynamic far plane: base 65 000 m keeps the 32 000-unit world radius fully
  // inside the frustum so fog can attenuate edges before the camera clips them.
  const cam = camera as THREE.PerspectiveCamera;
  if (cam.isPerspectiveCamera) {
    cam.far = THREE.MathUtils.lerp(65000, 130000, altitude * altitude) * farPlaneScale;
    cam.updateProjectionMatrix();
  }
}
