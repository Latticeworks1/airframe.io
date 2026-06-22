import * as THREE from "three";
import { SkyZone } from "../../types";

export class SkyZoneRenderer {
  private scene: THREE.Scene;
  public zoneAnchors: THREE.Group[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public sync(zones: SkyZone[]) {
    while (this.zoneAnchors.length < zones.length) {
      const ringG = new THREE.RingGeometry(180, 200, 12);
      ringG.rotateX(Math.PI / 2);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35
      });

      const ringMesh = new THREE.Group();
      const edge = new THREE.Mesh(ringG, ringMat);
      ringMesh.add(edge);

      const coreLightGeo = new THREE.BoxGeometry(90, 220, 90);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide
      });

      const lightColumn = new THREE.Mesh(coreLightGeo, coreMat);
      lightColumn.position.y = 80;
      ringMesh.add(lightColumn);

      this.scene.add(ringMesh);
      this.zoneAnchors.push(ringMesh);
    }

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const anchor = this.zoneAnchors[i];

      anchor.position.set(z.x, z.y + Math.sin(Date.now() / 1000 + i) * 8, z.z);

      let color = 0x94a3b8;
      if (z.owningTeam === 1) color = 0xef4444;
      if (z.owningTeam === 2) color = 0x3b82f6;

      anchor.traverse((mesh) => {
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.color.setHex(color);
        }
      });
    }
  }

  public dispose() {
    for (const anchor of this.zoneAnchors) {
      this.scene.remove(anchor);
      anchor.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
    this.zoneAnchors = [];
  }
}
