/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Projectile, WeaponType } from "../../types";
import { LOCAL_FORWARD } from "../math";

function disposeMaterial(m: THREE.Material | THREE.Material[]) {
  if (Array.isArray(m)) {
    m.forEach(x => x.dispose());
  } else if (m && typeof m.dispose === "function") {
    m.dispose();
  }
}

export class ParticleEffectsManager {
  private scene: THREE.Scene;

  public smokeParticles: { mesh: THREE.Mesh; scaleSpeed: number; vel: THREE.Vector3; life: number }[] = [];
  public explosionBlobs: { mesh: THREE.Mesh; shrinkSpeed: number; vel: THREE.Vector3; life: number }[] = [];

  public listProjectiles: {
    bulletId: string;
    type: Projectile["type"];
    age: number;
    color: number;
    isRocket: boolean;
    bombMesh?: THREE.Group;
  }[] = [];

  public bulletInstMesh: THREE.InstancedMesh | null = null;
  public rocketInstMesh: THREE.InstancedMesh | null = null;
  private readonly _projDummy = new THREE.Object3D();
  private readonly _projColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public createSmokeTail(x: number, y: number, z: number, colorHex: number = 0x64748b, scale: number = 1.0) {
    const geo = new THREE.BoxGeometry(
      1.2 + Math.random() * 1.2,
      1.2 + Math.random() * 1.2,
      1.2 + Math.random() * 1.2
    );

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    this.smokeParticles.push({
      mesh,
      scaleSpeed: 1.4 * scale,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 6
      ),
      life: 1.0 + Math.random() * 1.5
    });
  }

  public triggerExplosion(x: number, y: number, z: number, sizeMultiplier: number = 1.0) {
    const shardCount = Math.floor(16 * sizeMultiplier);
    const colors = [0xef4444, 0xf97316, 0xeab308, 0x475569];

    for (let i = 0; i < shardCount; i++) {
      const geo = new THREE.BoxGeometry(
        1.0 + Math.random() * 2 * sizeMultiplier,
        1.0 + Math.random() * 2 * sizeMultiplier,
        1.0 + Math.random() * 2 * sizeMultiplier
      );

      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 0.9
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      this.explosionBlobs.push({
        mesh,
        shrinkSpeed: 0.8 / sizeMultiplier,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 50 * sizeMultiplier,
          (Math.random() - 0.3) * 40 * sizeMultiplier,
          (Math.random() - 0.5) * 50 * sizeMultiplier
        ),
        life: 0.6 + Math.random() * 0.9
      });
    }
  }

  public updateParticles(dt: number) {
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];

      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(1.0 + p.scaleSpeed * dt);

      if (p.mesh.material instanceof THREE.MeshBasicMaterial) {
        p.mesh.material.opacity = Math.max(0, p.life * 0.35);
      }

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        disposeMaterial(p.mesh.material);
        this.smokeParticles.splice(i, 1);
      }
    }

    for (let i = this.explosionBlobs.length - 1; i >= 0; i--) {
      const e = this.explosionBlobs[i];

      e.life -= dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.scale.subScalar(e.shrinkSpeed * dt);

      if (e.mesh.scale.x < 0.1 || e.life <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        disposeMaterial(e.mesh.material);
        this.explosionBlobs.splice(i, 1);
      }
    }
  }

  public syncProjectiles(projectiles: Projectile[], playerPilotId: string, camera: THREE.Camera, dt: number) {
    if (!this.bulletInstMesh) {
      const geo = new THREE.BoxGeometry(0.264, 0.264, 16.8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.bulletInstMesh = new THREE.InstancedMesh(geo, mat, 2000);
      this.bulletInstMesh.frustumCulled = false;
      this.scene.add(this.bulletInstMesh);
    }
    if (!this.rocketInstMesh) {
      const geo = new THREE.BoxGeometry(0.66, 0.66, 42);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.rocketInstMesh = new THREE.InstancedMesh(geo, mat, 200);
      this.rocketInstMesh.frustumCulled = false;
      this.scene.add(this.rocketInstMesh);
    }

    const activeBullets = new Set<string>();
    for (const p of projectiles) {
      activeBullets.add(p.id);
      let pEntry = this.listProjectiles.find(e => e.bulletId === p.id);
      if (!pEntry) {
        let color = 0xfffaed;
        if (String(p.belt) === "Tracer") color = 0xff3300;
        if (String(p.belt) === "Incendiary") color = 0xeab308;
        if (String(p.belt) === "Armor-Piercing") color = 0x22c55e;
        if (String(p.belt) === "Stealth") color = 0x111827;
        if (p.ownerId === playerPilotId) color = 0xffd700;

        let bombMesh: THREE.Group | undefined;
        if (p.type === WeaponType.BOMB) {
          bombMesh = new THREE.Group();
          bombMesh.name = "bomb-projectile";
          const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3f3f32, flatShading: true });
          const bandMat = new THREE.MeshBasicMaterial({ color: 0xd6a11d });
          const finMat = new THREE.MeshLambertMaterial({ color: 0x25251f, flatShading: true });
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.8, 8), bodyMat);
          body.rotation.x = Math.PI / 2;
          bombMesh.add(body);
          const nose = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.72, 8), bodyMat);
          nose.rotation.x = Math.PI / 2;
          nose.position.z = 1.22;
          bombMesh.add(nose);
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.14, 8), bandMat);
          band.rotation.x = Math.PI / 2;
          band.position.z = 0.35;
          bombMesh.add(band);
          for (const rz of [0, Math.PI / 2]) {
            const fin = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.62), finMat);
            fin.rotation.z = rz;
            fin.position.z = -1.08;
            bombMesh.add(fin);
          }
          this.scene.add(bombMesh);
        }

        pEntry = { bulletId: p.id, type: p.type, age: 0, color, isRocket: p.isRocket ?? false, bombMesh };
        this.listProjectiles.push(pEntry);
      }
      pEntry.age += dt;
    }

    for (let i = this.listProjectiles.length - 1; i >= 0; i--) {
      const entry = this.listProjectiles[i];
      if (!activeBullets.has(entry.bulletId)) {
        if (entry.bombMesh) {
          this.scene.remove(entry.bombMesh);
          entry.bombMesh.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            child.geometry.dispose();
            disposeMaterial(child.material);
          });
        }
        this.listProjectiles.splice(i, 1);
      }
    }

    let bi = 0,
      ri = 0;
    for (const p of projectiles) {
      const entry = this.listProjectiles.find(e => e.bulletId === p.id);
      if (!entry) continue;

      const speedVec = new THREE.Vector3(p.vx, p.vy, p.vz);
      const quat =
        speedVec.lengthSq() > 0
          ? new THREE.Quaternion().setFromUnitVectors(LOCAL_FORWARD.clone(), speedVec.normalize())
          : new THREE.Quaternion();

      if (entry.bombMesh) {
        entry.bombMesh.position.set(p.x, p.y, p.z);
        entry.bombMesh.quaternion.copy(quat);
        entry.bombMesh.rotateOnAxis(LOCAL_FORWARD, entry.age * 4.2);
        continue;
      }

      this._projDummy.position.set(p.x, p.y, p.z);
      this._projDummy.quaternion.copy(quat);
      this._projDummy.updateMatrix();
      this._projColor.setHex(entry.color);

      if (entry.isRocket && ri < 200) {
        this.rocketInstMesh.setMatrixAt(ri, this._projDummy.matrix);
        this.rocketInstMesh.setColorAt(ri, this._projColor);
        ri++;
      } else if (!entry.isRocket && bi < 2000) {
        this.bulletInstMesh.setMatrixAt(bi, this._projDummy.matrix);
        this.bulletInstMesh.setColorAt(bi, this._projColor);
        bi++;
      }
    }

    this.bulletInstMesh.count = bi;
    this.bulletInstMesh.instanceMatrix.needsUpdate = true;
    if (this.bulletInstMesh.instanceColor) this.bulletInstMesh.instanceColor.needsUpdate = true;

    this.rocketInstMesh.count = ri;
    this.rocketInstMesh.instanceMatrix.needsUpdate = true;
    if (this.rocketInstMesh.instanceColor) this.rocketInstMesh.instanceColor.needsUpdate = true;
  }

  public dispose() {
    for (const entry of this.listProjectiles) {
      if (entry.bombMesh) {
        this.scene.remove(entry.bombMesh);
        entry.bombMesh.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          disposeMaterial(child.material);
        });
      }
    }
    this.listProjectiles = [];

    if (this.bulletInstMesh) {
      this.scene.remove(this.bulletInstMesh);
      this.bulletInstMesh.geometry.dispose();
      (this.bulletInstMesh.material as THREE.Material).dispose();
      this.bulletInstMesh = null;
    }
    if (this.rocketInstMesh) {
      this.scene.remove(this.rocketInstMesh);
      this.rocketInstMesh.geometry.dispose();
      (this.rocketInstMesh.material as THREE.Material).dispose();
      this.rocketInstMesh = null;
    }

    for (const p of this.smokeParticles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      disposeMaterial(p.mesh.material);
    }
    this.smokeParticles = [];

    for (const e of this.explosionBlobs) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      disposeMaterial(e.mesh.material);
    }
    this.explosionBlobs = [];
  }
}
