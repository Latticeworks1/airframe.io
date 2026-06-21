import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { NodeMaterial, RenderTarget } from "three/webgpu";
import {
  Fn, vec2, vec3, vec4, float,
  uniform,
  texture as sampleTex,
  screenUV,
  sin, mix, clamp, smoothstep,
  dot, normalize, length,
  fract, floor
} from "three/tsl";

const hashFn = Fn(([p]: [any]) =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123))
);

const noiseFn = Fn(([p]: [any]) => {
  const i = floor(p) as any;
  const f = fract(p) as any;
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))) as any;
  return mix(
    mix(hashFn(i), hashFn(i.add(vec2(1.0, 0.0))), u.x),
    mix(hashFn(i.add(vec2(0.0, 1.0))), hashFn(i.add(vec2(1.0, 1.0))), u.x),
    u.y
  );
});

const ellipseFn = Fn(([uvPos, center, radius]: [any, any, any]) =>
  float(1.0).sub(smoothstep(0.62, 1.0, length(uvPos.sub(center).div(radius))))
);

export class ScreenEffectsPass {
  private readonly renderTarget: RenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: NodeMaterial;
  private readonly quad: THREE.Mesh;

  private readonly uTime = uniform(0);
  private readonly uDamage = uniform(0);
  private readonly uOil = uniform(0);
  private readonly uCloud = uniform(0);
  private readonly uCloudColor = uniform(new THREE.Color());
  private readonly uResolution = uniform(new THREE.Vector2(1, 1));

  private damageStrength = 0;
  private oilStrength = 0;
  private cloudStrength = 0;

  constructor(
    renderer: WebGPURenderer,
    cloudVeilColor: THREE.ColorRepresentation
  ) {
    this.uCloudColor.value.set(cloudVeilColor);
    this.renderTarget = new RenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4
    });
    this.renderTarget.texture.name = "world-screen-effects-source";

    const rt = this.renderTarget;
    const {
      uTime,
      uDamage,
      uOil,
      uCloud,
      uCloudColor,
      uResolution
    } = this;

    const fragmentNode = Fn(() => {
      const uvCoord = screenUV.toVar("uv");
      const centered = uvCoord.sub(0.5).toVar("centered");
      const aspect = uResolution.x.div(uResolution.y.max(1.0));
      const radial = normalize(centered.add(vec2(0.0001, 0.0001))).toVar("radial");

      const oilNoise = noiseFn(
        uvCoord.mul(vec2(7.0, 11.0)).add(vec2(uTime.mul(0.025), float(0.0)))
      ).toVar("oilNoise");

      const oilMask = clamp(
        ellipseFn(uvCoord, vec2(0.30, 0.70), vec2(0.19, 0.13)).mul(0.92)
          .add(ellipseFn(uvCoord, vec2(0.56, 0.58), vec2(0.14, 0.20)).mul(0.72))
          .add(ellipseFn(uvCoord, vec2(0.76, 0.34), vec2(0.16, 0.11)).mul(0.82))
          .mul(float(0.72).add(oilNoise.mul(0.42))),
        0.0, 1.0
      ).mul(uOil).toVar("oilMask");

      const oilWarpX = noiseFn(uvCoord.mul(12.0).add(uTime.mul(0.02))).sub(0.5);
      const oilWarpY = noiseFn(uvCoord.yx.mul(13.0).sub(uTime.mul(0.015))).sub(0.5);
      const distortedUv = clamp(
        uvCoord.add(vec2(oilWarpX, oilWarpY).mul(oilMask).mul(0.018)),
        0.001, 0.999
      ).toVar("distortedUv");

      const radialDistance = length(vec2(centered.x.mul(aspect), centered.y));
      const vignette = smoothstep(0.28, 0.82, radialDistance).toVar("vignette");
      const chromaOffset = radial.mul(uDamage).mul(vignette).mul(0.0045).toVar("chroma");

      const red   = sampleTex(rt.texture, clamp(distortedUv.add(chromaOffset), 0.001, 0.999) as any).r;
      const green = sampleTex(rt.texture, distortedUv).g;
      const blue  = sampleTex(rt.texture, clamp(distortedUv.sub(chromaOffset), 0.001, 0.999) as any).b;
      const color = vec3(red, green, blue).toVar("color");

      const damagePulse = uDamage.mul(float(0.72).add(sin(uTime.mul(34.0)).mul(0.28))).toVar("damagePulse");
      color.assign(mix(color, vec3(0.42, 0.018, 0.012), vignette.mul(damagePulse).mul(0.68)));
      color.mulAssign(float(1.0).sub(vignette.mul(damagePulse).mul(0.28)));

      color.assign(mix(color, vec3(0.006, 0.008, 0.006), oilMask.mul(0.78)));
      color.addAssign(
        vec3(0.08, 0.07, 0.045).mul(oilMask).mul(smoothstep(0.72, 0.92, oilNoise)).mul(0.24)
      );

      const cloudNoise = noiseFn(
        uvCoord.mul(vec2(5.0, 8.0)).add(vec2(uTime.mul(0.035), uTime.mul(-0.018)))
      ).toVar("cloudNoise");
      const cloudVeil = uCloud.mul(float(0.58).add(cloudNoise.mul(0.42)));
      color.assign(mix(color, uCloudColor, cloudVeil.mul(0.52)));
      color.addAssign(cloudNoise.mul(uCloud).mul(0.018));

      return vec4(color, 1.0);
    })();

    this.material = new NodeMaterial();
    this.material.fragmentNode = fragmentNode;
    this.material.depthTest = false;
    this.material.depthWrite = false;

    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.material as unknown as THREE.Material
    );
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.resize(renderer);
  }

  public triggerDamage(intensity = 1) {
    this.damageStrength = Math.max(
      this.damageStrength,
      THREE.MathUtils.clamp(intensity, 0, 1)
    );
  }

  public resize(renderer: WebGPURenderer) {
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));

    this.renderTarget.setSize(width, height);
    this.uResolution.value.set(width, height);
  }

  public render(
    renderer: WebGPURenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.Camera,
    dt: number,
    oilActive: boolean,
    cloudDensity: number
  ) {
    const frameDt = THREE.MathUtils.clamp(dt, 0, 0.05);
    this.damageStrength = Math.max(0, this.damageStrength - frameDt * 2.85);

    const oilTarget = oilActive ? 1 : 0;
    const oilBlend = 1 - Math.exp(-frameDt * (oilActive ? 2.4 : 4.5));
    this.oilStrength = THREE.MathUtils.lerp(this.oilStrength, oilTarget, oilBlend);

    // The cloud field already renders opaque nearby puffs. This pass should add
    // moisture and reduced contrast, not replace the whole frame with white.
    const cloudTarget = Math.min(
      0.72,
      THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp(cloudDensity, 0, 1),
        0.12,
        0.9
      )
    );
    const cloudBlend = 1 - Math.exp(-frameDt * (cloudTarget > this.cloudStrength ? 4.8 : 2.6));
    this.cloudStrength = THREE.MathUtils.lerp(this.cloudStrength, cloudTarget, cloudBlend);

    this.uTime.value += frameDt;
    this.uDamage.value = this.damageStrength;
    this.uOil.value = this.oilStrength;
    this.uCloud.value = this.cloudStrength;

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(worldScene, worldCamera);

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.renderTarget.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
