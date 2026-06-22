/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import {
  AtmosphericFog,
  createAtmosphericFog,
  createSkyDome,
  getSkyEnvironment,
  updateSkyDome,
  SkyEnvironment,
  SkyDomeMesh
} from "../skyDome";
import { MapDefinition } from "../content/maps/mapTypes";

export class AtmosphereManager {
  private scene: THREE.Scene;
  private mapDef: MapDefinition;

  public skyDome: SkyDomeMesh | null = null;
  public sunLight: THREE.DirectionalLight | null = null;
  public skyLight: THREE.HemisphereLight | null = null;
  public skyEnvironment: SkyEnvironment | null = null;
  public atmosphericFog: AtmosphericFog | null = null;
  private lightningDelay = 0;
  private lightningPhase = 0;

  constructor(scene: THREE.Scene, mapDef: MapDefinition) {
    this.scene = scene;
    this.mapDef = mapDef;
  }

  public init() {
    const skyEnvironment = getSkyEnvironment(this.mapDef.atmosphere);
    this.skyEnvironment = skyEnvironment;

    this.skyLight = new THREE.HemisphereLight(
      skyEnvironment.skyLightColor,
      skyEnvironment.groundLightColor,
      skyEnvironment.ambientIntensity
    );
    this.scene.add(this.skyLight);

    this.sunLight = new THREE.DirectionalLight(
      skyEnvironment.sunColor,
      skyEnvironment.sunIntensity
    );
    this.sunLight.position.copy(skyEnvironment.sunDirection).multiplyScalar(3000);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 10000;
    const sd = 800;
    this.sunLight.shadow.camera.left = -sd;
    this.sunLight.shadow.camera.right = sd;
    this.sunLight.shadow.camera.top = sd;
    this.sunLight.shadow.camera.bottom = -sd;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.06;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.lightningDelay = THREE.MathUtils.lerp(
      skyEnvironment.profile.lightning.minDelay,
      skyEnvironment.profile.lightning.maxDelay,
      Math.random()
    );

    this.skyDome = createSkyDome(this.mapDef.atmosphere);
    this.scene.add(this.skyDome);

    this.atmosphericFog = createAtmosphericFog(this.mapDef.atmosphere);
    (this.scene as THREE.Scene & { fogNode: unknown }).fogNode =
      this.atmosphericFog.node;
  }

  public update(
    dt: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    camera: THREE.Camera,
    renderer: any
  ) {
    if (this.sunLight && this.skyEnvironment) {
      this.sunLight.position.set(
        playerX + this.skyEnvironment.sunDirection.x * 2000,
        playerY + this.skyEnvironment.sunDirection.y * 2000,
        playerZ + this.skyEnvironment.sunDirection.z * 2000
      );
      this.sunLight.target.position.set(playerX, playerY, playerZ);
      this.sunLight.target.updateMatrixWorld();
    }

    if (this.skyDome) {
      const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : null;
      updateSkyDome(
        this.skyDome,
        camera,
        fog,
        this.atmosphericFog,
        dt,
        1.25,
        this.mapDef.world.radius * 0.84
      );
    }

    this.updateLightning(dt, renderer);
  }

  private updateLightning(dt: number, renderer: any) {
    const environment = this.skyEnvironment;
    const sunLight = this.sunLight;
    const skyLight = this.skyLight;

    if (!environment || !sunLight || !skyLight) return;

    const lightning = environment.profile.lightning;
    if (!lightning.enabled) return;

    if (this.lightningPhase <= 0) {
      this.lightningDelay -= dt;
      if (this.lightningDelay <= 0) {
        this.lightningPhase = 0.34;
        this.lightningDelay = THREE.MathUtils.lerp(
          lightning.minDelay,
          lightning.maxDelay,
          Math.random()
        );
      }
    } else {
      this.lightningPhase = Math.max(0, this.lightningPhase - dt);
    }

    let flash = 0;
    if (this.lightningPhase > 0.26) flash = 1;
    else if (this.lightningPhase > 0.18) flash = 0.08;
    else if (this.lightningPhase > 0.08) flash = 0.72;

    if (flash > 0) {
      sunLight.color.set(lightning.color);
      sunLight.intensity = THREE.MathUtils.lerp(environment.sunIntensity, 3.2, flash);
      skyLight.color.set(lightning.color);
      skyLight.intensity = THREE.MathUtils.lerp(environment.ambientIntensity, 1.65, flash);
      renderer.toneMappingExposure = THREE.MathUtils.lerp(
        environment.exposure,
        environment.exposure * 1.45,
        flash
      );
      return;
    }

    sunLight.color.copy(environment.sunColor);
    sunLight.intensity = environment.sunIntensity;
    skyLight.color.copy(environment.skyLightColor);
    skyLight.intensity = environment.ambientIntensity;
    renderer.toneMappingExposure = environment.exposure;
  }

  public dispose() {
    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      this.skyDome.material.dispose();
      this.skyDome = null;
    }

    if (this.sunLight) {
      this.scene.remove(this.sunLight);
      this.sunLight.dispose();
      this.sunLight = null;
    }

    if (this.skyLight) {
      this.scene.remove(this.skyLight);
      this.skyLight.dispose();
      this.skyLight = null;
    }

    (this.scene as THREE.Scene & { fogNode: unknown }).fogNode = null;
    this.atmosphericFog = null;
  }
}
