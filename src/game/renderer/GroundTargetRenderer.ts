import * as THREE from "three";
import { GroundTarget } from "../../types";

export class GroundTargetRenderer {
  private scene: THREE.Scene;
  public groundTargetMeshes = new Map<string, THREE.Group>();
  private triggerExplosion: (x: number, y: number, z: number, sizeMultiplier: number) => void;

  constructor(
    scene: THREE.Scene,
    triggerExplosion: (x: number, y: number, z: number, sizeMultiplier: number) => void
  ) {
    this.scene = scene;
    this.triggerExplosion = triggerExplosion;
  }

  private createLambertMaterial(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({
      color,
      flatShading: true
    });
  }

  public sync(targets: GroundTarget[], dt: number) {
    const activeIds = new Set<string>();

    for (const t of targets) {
      if (t.isDead) continue;

      activeIds.add(t.id);

      let group = this.groundTargetMeshes.get(t.id);

      if (!group) {
        group = new THREE.Group();

        const armorMat = this.createLambertMaterial(t.team === 1 ? 0xef4444 : 0x3b82f6);
        const darkMat = this.createLambertMaterial(0x1e293b);

        if (t.type === "convoy") {
          const body = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 15), armorMat);
          body.position.y = 2.5;

          const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), darkMat);
          cabin.position.set(0, 5, 5);

          group.add(body, cabin);
        } else if (t.type === "anti-air") {
          const base = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), armorMat);
          base.position.y = 2.5;

          const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 10), darkMat);
          barrel.name = "barrel";
          barrel.position.set(0, 6, 3);
          barrel.rotation.x = -Math.PI / 5;

          group.add(base, barrel);
        } else if (t.type === "radar") {
          const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), armorMat);
          tower.position.y = 8;

          const grid = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 1), darkMat);
          grid.name = "satellite";
          grid.position.set(0, 18, 0);

          group.add(tower, grid);
        }

        group.position.set(t.x, t.y, t.z);
        this.scene.add(group);
        this.groundTargetMeshes.set(t.id, group);
      }

      group.position.set(t.x, t.y, t.z);

      const sat = group.getObjectByName("satellite");
      if (sat) sat.rotation.y += 1.5 * dt;

      const barrel = group.getObjectByName("barrel");
      if (barrel) barrel.rotation.z = Math.sin(Date.now() / 600) * 0.15;
    }

    for (const cachedId of Array.from(this.groundTargetMeshes.keys())) {
      if (!activeIds.has(cachedId)) {
        const group = this.groundTargetMeshes.get(cachedId);

        if (group) {
          this.triggerExplosion(group.position.x, group.position.y + 3, group.position.z, 2.5);
          this.scene.remove(group);
        }

        this.groundTargetMeshes.delete(cachedId);
      }
    }
  }

  public dispose() {
    for (const group of this.groundTargetMeshes.values()) {
      this.scene.remove(group);
      group.traverse((child) => {
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
    this.groundTargetMeshes.clear();
  }
}
