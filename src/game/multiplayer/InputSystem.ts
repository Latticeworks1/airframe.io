import { ClientInputTuple, ClientInputState } from "./MatchState";
import { FlightCommand } from "../../types";

export class InputSystem {
  // Input queues (sessionId -> ClientInputState[])
  private inputQueues = new Map<string, ClientInputState[]>();
  // Last processed commands for extrapolation
  private lastInputs = new Map<string, FlightCommand>();
  // Playback state to track jitter buffer initialization
  private playbackActive = new Map<string, boolean>();

  // Buffer size in ticks (e.g., 3 ticks = ~50ms buffer at 60Hz)
  private readonly JITTER_BUFFER_SIZE = 3;

  public enqueueInput(sessionId: string, tuple: ClientInputTuple) {
    if (!this.inputQueues.has(sessionId)) {
      this.inputQueues.set(sessionId, []);
    }
    const queue = this.inputQueues.get(sessionId)!;

    // Convert tuple back to FlightCommand
    const [
      seq, pitch, roll, yaw, throttleDelta,
      boost, airbrake, primaryFire, secondaryFire, flapsCode, gearDeployed
    ] = tuple;

    const flaps = flapsCode === 2 ? "landing" : flapsCode === 1 ? "combat" : "up";

    const command: FlightCommand = {
      pitch, roll, yaw, throttleDelta,
      boost: boost === 1,
      airbrake: airbrake === 1,
      primaryFire: primaryFire === 1,
      secondaryFire: secondaryFire === 1,
      flaps,
      gearDeployed: gearDeployed === 1
    };

    queue.push({ seq, command });
    
    // Sort queue by sequence number just in case packets arrived out of order
    queue.sort((a, b) => a.seq - b.seq);

    // If playback is not active, wait until the buffer fills up to start consuming
    if (!this.playbackActive.get(sessionId) && queue.length >= this.JITTER_BUFFER_SIZE) {
      this.playbackActive.set(sessionId, true);
    }

    // Limit queue size to avoid memory leakage and extreme rubber-banding
    if (queue.length > 60) {
      // Discard oldest
      queue.shift();
    }
  }

  public getNextInput(sessionId: string, neutralCommand: FlightCommand): { command: FlightCommand, seq?: number } {
    const queue = this.inputQueues.get(sessionId);
    if (!queue) {
      return { command: neutralCommand };
    }

    const isActive = this.playbackActive.get(sessionId);
    if (!isActive) {
      // Buffering phase - hold last input (or neutral) but drop weapons
      const last = this.lastInputs.get(sessionId);
      const cmd = last ? { ...last, primaryFire: false, secondaryFire: false } : neutralCommand;
      return { command: cmd };
    }

    const nextInput = queue.shift();
    if (nextInput) {
      this.lastInputs.set(sessionId, nextInput.command);
      return { command: nextInput.command, seq: nextInput.seq };
    } else {
      // Queue under-run: jitter buffer depleted
      // Disable playback so we buffer again
      this.playbackActive.set(sessionId, false);
      const last = this.lastInputs.get(sessionId);
      const cmd = last ? { ...last, primaryFire: false, secondaryFire: false } : neutralCommand;
      return { command: cmd };
    }
  }

  public getQueueLength(sessionId: string): number {
    return this.inputQueues.get(sessionId)?.length || 0;
  }

  public cleanupPlayer(sessionId: string) {
    this.inputQueues.delete(sessionId);
    this.lastInputs.delete(sessionId);
    this.playbackActive.delete(sessionId);
  }
}
