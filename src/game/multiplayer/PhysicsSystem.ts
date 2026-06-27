import RAPIER from "@dimforge/rapier3d-compat";
import { Pilot } from "../../types";

export class PhysicsSystem {
  public world!: RAPIER.World;
  public rigidBodies = new Map<string, RAPIER.RigidBody>();
  public colliders = new Map<string, RAPIER.Collider>();

  public async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  public dispose() {
    if (this.world) this.world.free();
  }

  public addPhysicsBody(id: string, pilot: Pilot, radius: number = 15) {
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pilot.x, pilot.y, pilot.z)
      .setUserData({ playerId: id });
    const body = this.world.createRigidBody(desc);
    const colliderDesc = RAPIER.ColliderDesc.ball(radius);
    const collider = this.world.createCollider(colliderDesc, body);
    this.rigidBodies.set(id, body);
    this.colliders.set(id, collider);
  }

  public removePhysicsBody(id: string) {
    const body = this.rigidBodies.get(id);
    if (body) {
      this.world.removeRigidBody(body);
      this.rigidBodies.delete(id);
      this.colliders.delete(id);
    }
  }
}
