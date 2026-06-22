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

export interface SmokeParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  baseScale: THREE.Vector3;
  currentScale: number;
  scaleSpeed: number;
  color: number;
  life: number;
  maxLife: number;
}

export interface ExplosionBlob {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  baseScale: THREE.Vector3;
  shrinkSpeed: number;
  color: number;
  life: number;
}

export class ParticleEffectsManager {
  private scene: THREE.Scene;

  public smokeParticles: SmokeParticle[] = [];
  public explosionBlobs: ExplosionBlob[] = [];

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
  public smokeInstMesh: THREE.InstancedMesh | null = null;
  public explosionInstMesh: THREE.InstancedMesh | null = null;

  private readonly MAX_SMOKE = 2000;
  private readonly MAX_EXPLOSION = 1000;

  private readonly _projDummy = new THREE.Object3D();
  private readonly _projColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initInstancedMeshes();
  }

  private initInstancedMeshes() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    
    // Smoke instanced mesh
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45
    });
    this.smokeInstMesh = new THREE.InstancedMesh(geo, smokeMat, this.MAX_SMOKE);
    this.smokeInstMesh.count = 0;
    this.scene.add(this.smokeInstMesh);

    // Explosion instanced mesh
    const expMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });
    this.explosionInstMesh = new THREE.InstancedMesh(geo.clone(), expMat, this.MAX_EXPLOSION);
    this.explosionInstMesh.count = 0;
    this.scene.add(this.explosionInstMesh);
  }

  public createSmokeTail(x: number, y: number, z: number, colorHex: number = 0x64748b, scale: number = 1.0) {
    const rx = 1.2 + Math.random() * 1.2;
    const ry = 1.2 + Math.random() * 1.2;
    const rz = 1.2 + Math.random() * 1.2;
    const baseScale = new THREE.Vector3(rx * scale, ry * scale, rz * scale);

    if (this.smokeParticles.length >= this.MAX_SMOKE) {
      this.smokeParticles.shift(); // Remove oldest
    }

    const life = 1.0 + Math.random() * 1.5;
    this.smokeParticles.push({
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 6
      ),
      baseScale,
      currentScale: 1.0,
      scaleSpeed: 1.4 * scale,
      color: colorHex,
      life,
      maxLife: life
    });
  }

  public triggerExplosion(x: number, y: number, z: number, sizeMultiplier: number = 1.0) {
    const shardCount = Math.floor(16 * sizeMultiplier);
    const colors = [0xef4444, 0xf97316, 0xeab308, 0x475569];

    for (let i = 0; i < shardCount; i++) {
      const rx = 1.0 + Math.random() * 2 * sizeMultiplier;
      const ry = 1.0 + Math.random() * 2 * sizeMultiplier;
      const rz = 1.0 + Math.random() * 2 * sizeMultiplier;
      const baseScale = new THREE.Vector3(rx, ry, rz);

      if (this.explosionBlobs.length >= this.MAX_EXPLOSION) {
        this.explosionBlobs.shift(); // Remove oldest
      }

      this.explosionBlobs.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 50 * sizeMultiplier,
          (Math.random() - 0.3) * 40 * sizeMultiplier,
          (Math.random() - 0.5) * 50 * sizeMultiplier
        ),
        baseScale,
        shrinkSpeed: 0.8 / sizeMultiplier,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0.6 + Math.random() * 0.9
      });
    }
  }

  public updateParticles(dt: number) {
    // 1. Update smoke particles
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.smokeParticles.splice(i, 1);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
    }

    // 2. Update explosion blobs
    for (let i = this.explosionBlobs.length - 1; i >= 0; i--) {
      const e = this.explosionBlobs[i];
      e.life -= dt;
      e.pos.addScaledVector(e.vel, dt);

      const shrink = e.shrinkSpeed * dt;
      e.baseScale.x = Math.max(0, e.baseScale.x - shrink);
      e.baseScale.y = Math.max(0, e.baseScale.y - shrink);
      e.baseScale.z = Math.max(0, e.baseScale.z - shrink);

      if (e.baseScale.x <= 0.05 || e.life <= 0) {
        this.explosionBlobs.splice(i, 1);
      }
    }

    // 3. Sync matrices and colors for smokeInstMesh
    if (this.smokeInstMesh) {
      let count = 0;
      for (let i = 0; i < this.smokeParticles.length; i++) {
        if (count >= this.MAX_SMOKE) break;
        const p = this.smokeParticles[i];

        // Grow, then shrink/fade in the last 30% of life
        const ageNorm = 1.0 - (p.life / p.maxLife);
        let scaleFactor = 1.0;
        if (ageNorm < 0.7) {
          p.currentScale += p.scaleSpeed * dt;
          scaleFactor = p.currentScale;
        } else {
          const shrinkFactor = (1.0 - ageNorm) / 0.3;
          scaleFactor = p.currentScale * Math.max(0, shrinkFactor);
        }

        this._projDummy.position.copy(p.pos);
        this._projDummy.quaternion.set(0, 0, 0, 1); // Identity rotation
        this._projDummy.scale.copy(p.baseScale).multiplyScalar(scaleFactor);
        this._projDummy.updateMatrix();

        this.smokeInstMesh.setMatrixAt(count, this._projDummy.matrix);
        this._projColor.setHex(p.color);
        this.smokeInstMesh.setColorAt(count, this._projColor);
        count++;
      }
      this.smokeInstMesh.count = count;
      this.smokeInstMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeInstMesh.instanceColor) this.smokeInstMesh.instanceColor.needsUpdate = true;
    }

    // 4. Sync matrices and colors for explosionInstMesh
    if (this.explosionInstMesh) {
      let count = 0;
      for (let i = 0; i < this.explosionBlobs.length; i++) {
        if (count >= this.MAX_EXPLOSION) break;
        const e = this.explosionBlobs[i];

        this._projDummy.position.copy(e.pos);
        this._projDummy.quaternion.set(0, 0, 0, 1); // Identity rotation
        this._projDummy.scale.copy(e.baseScale);
        this._projDummy.updateMatrix();

        this.explosionInstMesh.setMatrixAt(count, this._projDummy.matrix);
        this._projColor.setHex(e.color);
        this.explosionInstMesh.setColorAt(count, this._projColor);
        count++;
      }
      this.explosionInstMesh.count = count;
      this.explosionInstMesh.instanceMatrix.needsUpdate = true;
      if (this.explosionInstMesh.instanceColor) this.explosionInstMesh.instanceColor.needsUpdate = true;
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
    if (this.smokeInstMesh) {
      this.scene.remove(this.smokeInstMesh);
      this.smokeInstMesh.geometry.dispose();
      (this.smokeInstMesh.material as THREE.Material).dispose();
      this.smokeInstMesh = null;
    }
    if (this.explosionInstMesh) {
      this.scene.remove(this.explosionInstMesh);
      this.explosionInstMesh.geometry.dispose();
      (this.explosionInstMesh.material as THREE.Material).dispose();
      this.explosionInstMesh = null;
    }

    this.smokeParticles = [];
    this.explosionBlobs = [];
  }
}
