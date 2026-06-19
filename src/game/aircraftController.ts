/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { Pilot, InputFrame, FlightCommand, ControlMode } from "../types";

export class AircraftController {
  public flaps: "up" | "combat" | "landing" = "up";
  public gearDeployed = false;
  private initialized = false;

  // Blending factors for smooth per-axis recovery back to mouse instructor [0.0 to 1.0]
  private pitchBlend = 0;
  private rollBlend = 0;
  private yawBlend = 0;

  // Rate of decay back to instructor control (e.g. 2.8 per second => fully recovered in ~0.35s)
  private readonly blendDecayRate = 2.8;

  public update(
    pilot: Pilot,
    inputFrame: InputFrame,
    mouseTarget: Vector3 | null,
    dt: number = 0.016
  ): FlightCommand {
    // 1. Initialize from pilot state fields if not initialized
    if (!this.initialized) {
      if (pilot.flaps) this.flaps = pilot.flaps;
      if (pilot.gearDeployed !== undefined) this.gearDeployed = pilot.gearDeployed;
      this.initialized = true;
    }

    // 2. Clear out-of-band updates (keep inside pilot-state boundaries matched under multiplayer/respawn transitions safely)
    if (pilot.flaps && pilot.flaps !== this.flaps && !inputFrame.edges.flapsPressed) {
      this.flaps = pilot.flaps;
    }
    if (pilot.gearDeployed !== undefined && pilot.gearDeployed !== this.gearDeployed && !inputFrame.edges.gearPressed) {
      this.gearDeployed = pilot.gearDeployed;
    }

    // 3. Evaluate key-edges for toggles
    if (inputFrame.edges.flapsPressed) {
      this.flaps =
        this.flaps === "up" ? "combat" :
        this.flaps === "combat" ? "landing" :
        "up";
    }
    if (inputFrame.edges.gearPressed) {
      this.gearDeployed = !this.gearDeployed;
    }

    // 4. Translate manual keyboard axes
    // Keyboard direct inputs: W/S for pitch, A/D for roll, Q/E and Arrow keys for yaw/throttle
    const manualPitch = (inputFrame.held.w ? 1 : 0) - (inputFrame.held.s ? 1 : 0);
    const manualRoll = (inputFrame.held.d ? 1 : 0) - (inputFrame.held.a ? 1 : 0);

    const manualYaw =
      (inputFrame.held.arrowRight ? 1 : 0) -
      (inputFrame.held.arrowLeft ? 1 : 0) +
      (inputFrame.held.e ? 0.65 : 0) -
      (inputFrame.held.q ? 0.65 : 0);

    const throttleDelta =
      (inputFrame.held.arrowUp ? 1 : 0) -
      (inputFrame.held.arrowDown ? 1 : 0) +
      (inputFrame.held.shift ? 1 : 0) -
      (inputFrame.held.control ? 1 : 0);

    const overridePitch = manualPitch !== 0;
    const overrideRoll = manualRoll !== 0;
    const overrideYaw = manualYaw !== 0;

    // Get current mode (default to MouseAim)
    const mode = pilot.controlMode || ControlMode.MouseAim;

    let pitch = 0;
    let roll = 0;
    let yaw = 0;

    if (mode === ControlMode.MouseAim) {
      // 5. Compute Instructor / Flight Assist Commands via the Authority Mixer
      let instructorPitch = 0;
      let instructorYaw = 0;
      let instructorRoll = 0;

      if (mouseTarget) {
        const pos = new Vector3(pilot.x, pilot.y, pilot.z);

        const qCurrent = new Quaternion().setFromEuler(new Euler(pilot.pitch, pilot.yaw, pilot.roll, "YXZ"));
        const forward = new Vector3(0, 0, 1).applyQuaternion(qCurrent).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(qCurrent).normalize();
        const right = new Vector3(1, 0, 0).applyQuaternion(qCurrent).normalize();

        const toTarget = mouseTarget.clone().sub(pos);
        const targetDist = toTarget.length();

        if (targetDist > 1) {
          const desired = toTarget.normalize();

          const targetInRight = desired.dot(right);
          const targetInUp = desired.dot(up);
          const targetInForward = desired.dot(forward);

          // Standard War-Thunder behavior: behind penalty to avoid spinning too violently on backward targets
          const behindPenalty = targetInForward < 0 ? 0.35 : 1.0;

          instructorPitch = MathUtils.clamp(
            targetInUp * 1.8 * behindPenalty,
            -1,
            1
          );

          // Yaw / rudder is secondary / weaker inside Mouse Aim, mostly for fine tracking and alignment
          instructorYaw = MathUtils.clamp(
            targetInRight * 0.35 * behindPenalty,
            -0.4,
            0.4
          );

          // Max realistic manual roll controls: The autopilot/instructor is disabled for the roll axis.
          // It will never fight your custom bank angle or force the aircraft back to center.
          instructorRoll = 0;
        }
      }

      // Smooth per-axis fading mixer
      if (overridePitch) {
        this.pitchBlend = 1.0;
      } else {
        this.pitchBlend = Math.max(0, this.pitchBlend - dt * this.blendDecayRate);
      }

      if (overrideRoll) {
        this.rollBlend = 1.0;
      } else {
        this.rollBlend = Math.max(0, this.rollBlend - dt * this.blendDecayRate);
      }

      if (overrideYaw) {
        this.yawBlend = 1.0;
      } else {
        this.yawBlend = Math.max(0, this.yawBlend - dt * this.blendDecayRate);
      }

      // Authorities blend smoothly
      pitch = MathUtils.lerp(instructorPitch, manualPitch, this.pitchBlend);
      roll = MathUtils.lerp(instructorRoll, manualRoll, this.rollBlend);
      yaw = MathUtils.lerp(instructorYaw, manualYaw, this.yawBlend);

    } else if (mode === ControlMode.MouseJoystick) {
      // Mouse Y is our Pitch Stick; Mouse X is our Roll Stick
      // Handle standard and Aerospace Aerospace-Inverted Y-axis mappings
      const invertY = pilot.invertMouseY ? -1 : 1;
      const invertX = pilot.invertMouseX ? -1 : 1;
      const mouseJoystickPitch = -inputFrame.mousePos.y * invertY;
      const mouseJoystickRoll = inputFrame.mousePos.x * invertX;

      // Keyboard overrides virtual stick when active
      pitch = overridePitch ? manualPitch : MathUtils.clamp(mouseJoystickPitch, -1, 1);
      roll = overrideRoll ? manualRoll : MathUtils.clamp(mouseJoystickRoll, -1, 1);
      yaw = manualYaw; // Direct rudder control

    } else { // ControlMode.KeyboardDirect
      // Pure manual keyboard flight inputs entirely
      pitch = manualPitch;
      roll = manualRoll;
      yaw = manualYaw;
    }

    return {
      pitch,
      roll,
      yaw,
      throttleDelta,
      boost: !!inputFrame.held.shift,
      airbrake: !!inputFrame.held.b,
      primaryFire: !!inputFrame.held.space,
      secondaryFire: !!inputFrame.held.r,
      flaps: this.flaps,
      gearDeployed: this.gearDeployed
    };
  }
}
