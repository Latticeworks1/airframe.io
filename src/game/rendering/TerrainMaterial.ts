import * as THREE from 'three/webgpu';
import { color, mx_noise_vec3, positionLocal, mix, float, step, Fn, max, abs } from 'three/tsl';

/**
 * Creates a TSL node material for the procedural terrain.
 * Blends dirt, grass, tilled soil, and wetness based on noise and altitude.
 */
export function createTerrainMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.8,
    metalness: 0.0,
  });

  // TSL Function for Ridged Multifractal Noise
  const ridgedNoise = Fn(([p_input]: any[]) => {
    const p = p_input.mul(0.005).toVar();
    const sum = float(0.0).toVar();
    const amp = float(0.5).toVar();
    const freq = float(1.0).toVar();
    
    // 4 octaves of ridged noise
    for(let i = 0; i < 4; i++) {
      let n = mx_noise_vec3(p.mul(freq)).x;
      n = float(1.0).sub(abs(n));
      n = n.mul(n);
      sum.addAssign(n.mul(amp));
      amp.mulAssign(0.5);
      freq.mulAssign(2.0);
    }
    return sum;
  });

  // Position
  const pos = positionLocal;
  const worldY = pos.y;
  
  const noiseVal = ridgedNoise(pos);
  
  // Base colors
  const dirtColor = color("#5A4D41");
  const grassColor = color("#3B5E2B");
  const soilColor = color("#3D2817");
  const snowColor = color("#F0F4F8");

  // Blend grass and dirt/soil using noise
  const terrainColor = mix(
    mix(dirtColor, soilColor, noiseVal),
    grassColor,
    step(0.4, noiseVal)
  );

  // Wandering snow line capping high peaks
  const snowThreshold = float(150.0).add(noiseVal.mul(40.0));
  const isSnow = step(snowThreshold, worldY);

  const finalColor = mix(terrainColor, snowColor, isSnow);
  
  // Wetness mapping in valleys
  const wetness = max(0.0, float(1.0).sub(worldY.mul(0.02)));
  
  material.colorNode = finalColor;
  material.roughnessNode = mix(float(0.9), float(0.3), wetness);

  return material;
}
