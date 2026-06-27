import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, positionWorld, time, sin, vec3 } from 'three/tsl';

export class InstancedFoliage {
  public mesh: THREE.InstancedMesh;

  constructor(count: number, positions: THREE.Vector3[]) {
    // A simple blade of grass geometry
    const geometry = new THREE.ConeGeometry(0.5, 4, 3);
    geometry.translate(0, 2, 0); // Origin at bottom

    // Create a TSL material
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    // Wind Sway Logic using TSL
    const t = time;
    
    // Use positionWorld for wind phase so each blade of grass differs
    const windPhase = positionWorld.x.mul(0.1).add(positionWorld.z.mul(0.1)).add(t);
    const windStrength = sin(windPhase).mul(0.5).add(0.5); // 0 to 1
    
    // Base sway only affects the top of the grass blade
    // positionLocal.y goes from 0 to 4
    const heightFactor = positionLocal.y.div(4.0);
    const swayX = sin(t.add(positionWorld.x)).mul(heightFactor).mul(windStrength);
    const swayZ = sin(t.mul(1.3).add(positionWorld.z)).mul(heightFactor).mul(windStrength);
    
    material.positionNode = positionLocal.add(vec3(swayX, 0.0, swayZ));
    
    // Color gradient from root to tip
    const rootColor = color("#1E3F11");
    const tipColor = color("#4A7A25");
    material.colorNode = mix(rootColor, tipColor, heightFactor);

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      if (i < positions.length) {
        dummy.position.copy(positions[i]);
        // Random rotation around Y
        dummy.rotation.y = Math.random() * Math.PI * 2;
        // Random scale variation
        const scale = 0.8 + Math.random() * 0.6;
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
