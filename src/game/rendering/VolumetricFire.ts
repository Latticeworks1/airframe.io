import * as THREE from 'three/webgpu';
import { 
  float, vec3, color, mix, positionLocal, 
  time, mx_noise_vec3
} from 'three/tsl';

export class VolumetricFire {
  public mesh: THREE.Mesh;

  constructor() {
    // Fire volume box
    const geometry = new THREE.BoxGeometry(10, 20, 10);
    
    // WebGPU Node Material
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      side: THREE.DoubleSide
    });

    const t = time;
    const pos = positionLocal;
    
    // Scale position for noise
    const uvw = pos.mul(0.1);
    
    // Upward flow of fire
    const flow = uvw.sub(vec3(0, t, 0));
    
    // 3D Noise for fire structure
    const noise = mx_noise_vec3(flow).x;
    
    // Density gradient (fades out at top and edges)
    const yFade = float(1.0).sub(pos.y.div(10.0).add(0.5)); 
    const xFade = float(1.0).sub(pos.x.abs().div(5.0));
    const zFade = float(1.0).sub(pos.z.abs().div(5.0));
    
    const density = noise.mul(yFade).mul(xFade).mul(zFade).max(0.0);
    
    // Fire color gradient (yellow core, orange/red edges, fading to smoke)
    const fireColor = mix(
      color(0xff0000), 
      color(0xffff00), 
      density.mul(2.0).clamp(0.0, 1.0)
    );
    
    material.colorNode = fireColor;
    material.opacityNode = density;
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = 10;
  }
}
