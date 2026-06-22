import * as THREE from "three";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import {
  Fn,
  acos,
  add,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fog as fogNode,
  max,
  mix,
  mul,
  normalize,
  positionWorld,
  pow,
  rangeFogFactor,
  smoothstep,
  sub,
  uniform,
  vec3
} from "three/tsl";
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

export type AtmosphericFog = {
  node: any;
  near: any;
  far: any;
  turbidity: any;
  rayleigh: any;
  mieCoefficient: any;
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
  sky.material.fog = false;

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

/**
 * Builds range fog whose terminal color is evaluated from the same clear-sky
 * scattering equations as Three.js SkyMesh. Constant fog colors create a
 * luminous shelf where distant terrain meets a direction-dependent sky.
 */
export function createAtmosphericFog(profile: AtmosphereProfile): AtmosphericFog {
  const near = uniform(profile.fogNear);
  const far = uniform(profile.fogFar);
  const turbidity = uniform(profile.turbidity);
  const rayleigh = uniform(profile.rayleigh);
  const mieCoefficient = uniform(profile.mieCoefficient);
  const mieDirectionalG = uniform(profile.mieDirectionalG);
  const sunDirection = uniform(getAtmosphereSunDirection(profile)) as any;
  const showSunDisc = uniform(profile.showSunDisc);

  const atmosphericColor = Fn(() => {
    const pi = float(Math.PI);
    const totalRayleigh = vec3(
      5.804542996261093e-6,
      1.3562911419845635e-5,
      3.0265902468824876e-5
    );
    const mieConst = vec3(
      1.8399918514433978e14,
      2.7798023919660528e14,
      4.0790479543861094e14
    );
    const normalizedSun = normalize(sunDirection);
    const sunAngle = dot(normalizedSun, vec3(0, 1, 0));
    const zenithAngleCos = clamp(sunAngle, -1, 1);
    const sunIntensity = float(1000).mul(
      max(
        0,
        float(1).sub(
          exp(
            float(1.6110731556870734)
              .sub(acos(zenithAngleCos))
              .div(1.5)
              .negate()
          )
        )
      )
    );

    const betaR = totalRayleigh.mul(rayleigh);
    const totalMie = float(0.434)
      .mul(float(0.2).mul(turbidity).mul(1e-17))
      .mul(mieConst);
    const betaM = totalMie.mul(mieCoefficient);
    const direction = normalize(positionWorld.sub(cameraPosition));
    const zenithAngle = acos(max(0, dot(vec3(0, 1, 0), direction)));
    const inverse = float(1).div(
      zenithAngle
        .cos()
        .add(
          float(0.15).mul(
            pow(
              float(93.885).sub(zenithAngle.mul(180).div(pi)),
              -1.253
            )
          )
        )
    );
    const sR = float(8400).mul(inverse);
    const sM = float(1250).mul(inverse);
    const extinction = exp(
      mul(betaR, sR).add(mul(betaM, sM)).negate() as any
    ) as any;
    const cosTheta = dot(direction, normalizedSun);
    const phaseInput = cosTheta.mul(0.5).add(0.5);
    const rayleighPhase = float(0.05968310365946075).mul(
      float(1).add(pow(phaseInput, 2))
    );
    const betaRTheta = betaR.mul(rayleighPhase);
    const g2 = pow(mieDirectionalG, 2);
    const miePhase = float(0.07957747154594767)
      .mul(float(1).sub(g2))
      .mul(
        float(1).div(
          pow(
            float(1)
              .sub(float(2).mul(mieDirectionalG).mul(cosTheta))
              .add(g2),
            1.5
          )
        )
      );
    const betaMTheta = betaM.mul(miePhase);
    const scattering = sunIntensity
      .mul(add(betaRTheta, betaMTheta).div(add(betaR, betaM)));
    const lin = pow(
      scattering.mul(sub(1, extinction)) as any,
      vec3(1.5) as any
    ).toVar();
    lin.mulAssign(
      mix(
        vec3(1),
        pow(scattering.mul(extinction) as any, vec3(0.5) as any),
        clamp(
          pow(sub(1, dot(vec3(0, 1, 0), normalizedSun)), 5),
          0,
          1
        )
      )
    );

    const nightSky = vec3(0.1).mul(extinction).toVar();
    const sunDisc = smoothstep(
      0.9999566769464484,
      0.9999766769464484,
      cosTheta
    ).mul(showSunDisc);
    nightSky.addAssign(
      sunIntensity.mul(19000).mul(extinction).mul(sunDisc)
    );

    return add(lin, nightSky)
      .mul(0.04)
      .add(vec3(0, 0.0003, 0.00075));
  })();

  return {
    node: fogNode(atmosphericColor, rangeFogFactor(near, far)),
    near,
    far,
    turbidity,
    rayleigh,
    mieCoefficient
  };
}

export function updateSkyDome(
  skyDome: SkyDomeMesh,
  camera: THREE.Camera,
  fog: THREE.Fog | null,
  atmosphericFog: AtmosphericFog | null,
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
  if (atmosphericFog) {
    atmosphericFog.turbidity.value = skyDome.turbidity.value;
    atmosphericFog.rayleigh.value = skyDome.rayleigh.value;
    atmosphericFog.mieCoefficient.value = skyDome.mieCoefficient.value;
  }

  if (fog) {
    // Keep the fog close to its ground-level values at altitude so the world
    // boundary stays hidden even when flying high. Old 3× / 6× multipliers
    // ballooned fogFar to 210 km at 3 km AGL, leaving the 32 km edge visible.
    fog.near = THREE.MathUtils.lerp(profile.fogNear, profile.fogNear * 1.3, altitude);
    fog.far  = Math.min(
      THREE.MathUtils.lerp(profile.fogFar, profile.fogFar * 1.4, altitude),
      maxFogFar
    );
    if (atmosphericFog) {
      atmosphericFog.near.value = fog.near;
      atmosphericFog.far.value = fog.far;
    }
  }

  // Nothing beyond the fog cutoff contributes to the final image. Keeping the
  // far plane at that cutoff avoids submitting fully obscured distant geometry.
  const cam = camera as THREE.PerspectiveCamera;
  if (cam.isPerspectiveCamera) {
    cam.far = (fog?.far ?? profile.fogFar) * farPlaneScale;
    cam.updateProjectionMatrix();
  }
}
