import * as THREE from "three";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { GameMap, MapSpecs } from "../types";

export type SkyDomeMesh = SkyMesh;

type SkyPreset = {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  cloudScale: number;
  cloudSpeed: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudElevation: number;
  showSunDisc: number;
};

function getSkyPreset(mapSpecs: MapSpecs): SkyPreset {
  const baseCoverage = THREE.MathUtils.clamp(mapSpecs.cloudDensity, 0, 1);

  switch (mapSpecs.id) {
    case GameMap.DesertCanyon:
      return {
        turbidity: 12,
        rayleigh: 2.2,
        mieCoefficient: 0.003,
        mieDirectionalG: 0.94,
        sunElevationDeg: 24,
        sunAzimuthDeg: 228,
        cloudScale: 0.00016,
        cloudSpeed: 0.000035,
        cloudCoverage: Math.min(0.2, baseCoverage),
        cloudDensity: 0.28,
        cloudElevation: 0.28,
        showSunDisc: 1
      };

    case GameMap.AlpineValley:
      return {
        turbidity: 4.5,
        rayleigh: 3.2,
        mieCoefficient: 0.002,
        mieDirectionalG: 0.92,
        sunElevationDeg: 46,
        sunAzimuthDeg: 154,
        cloudScale: 0.00021,
        cloudSpeed: 0.00005,
        cloudCoverage: Math.max(0.3, baseCoverage * 0.82),
        cloudDensity: 0.48,
        cloudElevation: 0.58,
        showSunDisc: 1
      };

    case GameMap.StormFront:
      return {
        turbidity: 18,
        rayleigh: 0.42,
        mieCoefficient: 0.006,
        mieDirectionalG: 0.95,
        sunElevationDeg: 16,
        sunAzimuthDeg: 205,
        cloudScale: 0.00028,
        cloudSpeed: 0.00009,
        cloudCoverage: Math.max(0.86, baseCoverage),
        cloudDensity: 0.88,
        cloudElevation: 0.72,
        showSunDisc: 0
      };

    case GameMap.IslandChain:
    default:
      return {
        turbidity: 7,
        rayleigh: 2.5,
        mieCoefficient: 0.002,
        mieDirectionalG: 0.92,
        sunElevationDeg: 38,
        sunAzimuthDeg: 142,
        cloudScale: 0.0002,
        cloudSpeed: 0.00006,
        cloudCoverage: Math.max(0.48, baseCoverage * 0.88),
        cloudDensity: 0.58,
        cloudElevation: 0.5,
        showSunDisc: 1
      };
  }
}

export function createSkyDome(mapSpecs: MapSpecs): SkyDomeMesh {
  const preset = getSkyPreset(mapSpecs);
  const sky = new SkyMesh();
  const phi = THREE.MathUtils.degToRad(90 - preset.sunElevationDeg);
  const theta = THREE.MathUtils.degToRad(preset.sunAzimuthDeg);
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  sky.name = "atmospheric-sky";
  sky.scale.setScalar(14000);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;

  sky.turbidity.value = preset.turbidity;
  sky.rayleigh.value = preset.rayleigh;
  sky.mieCoefficient.value = preset.mieCoefficient;
  sky.mieDirectionalG.value = preset.mieDirectionalG;
  sky.sunPosition.value.copy(sunDirection);
  sky.cloudScale.value = preset.cloudScale;
  sky.cloudSpeed.value = preset.cloudSpeed;
  sky.cloudCoverage.value = preset.cloudCoverage;
  sky.cloudDensity.value = preset.cloudDensity;
  sky.cloudElevation.value = preset.cloudElevation;
  sky.showSunDisc.value = preset.showSunDisc;

  return sky;
}

export function updateSkyDome(
  skyDome: SkyDomeMesh,
  camera: THREE.Camera,
  _dt: number
) {
  skyDome.position.copy(camera.position);
}
