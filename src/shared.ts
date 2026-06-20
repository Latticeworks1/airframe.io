export const PROTOCOL_VERSION = 1;

export const SERVER_HZ = 60;
export const SNAPSHOT_HZ = 24;
export const FIXED_DT = 1 / SERVER_HZ;
export const SNAPSHOT_INTERVAL_TICKS = Math.max(1, Math.round(SERVER_HZ / SNAPSHOT_HZ));

export const WORLD_MIN = -2200;
export const WORLD_MAX = 2200;
export const ALT_MIN = 30;
export const ALT_MAX = 1500;

export const PROJECTILE_SPEED = 760;
export const PROJECTILE_DAMAGE = 18;
export const PROJECTILE_RADIUS = 3.2;
export const PROJECTILE_TTL_TICKS = SERVER_HZ * 3;
export const FIRE_COOLDOWN_TICKS = 8;

export type PlayerId = string;
export type EntityId = string;
export type Tick = number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rot3 {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface FlightCommand {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  fire: boolean;
}

export type ClientPacket =
  | { type: "join"; queueKey: string; aircraftId: string; token?: string }
  | { type: "input"; seq: number; command: FlightCommand }
  | { type: "chat"; text: string }
  | { type: "ping"; clientTime: number };

export type ServerPacket =
  | { type: "hello"; protocol: number; serverHz: number; snapshotHz: number }
  | { type: "welcome"; playerId: PlayerId; reconnectToken: string; tick: Tick; snapshot: Snapshot }
  | { type: "snapshot"; tick: Tick; ack: number; entities: EntityState[] }
  | { type: "event"; tick: Tick; event: CombatEvent }
  | { type: "chat"; tick: Tick; playerId: PlayerId; name: string; text: string }
  | { type: "pong"; serverTime: number; clientTime: number }
  | { type: "error"; code: string; message: string };

export interface Snapshot {
  players: PlayerSnapshot[];
  entities: EntityState[];
  scores: Record<string, number>;
}

export interface PlayerSnapshot {
  playerId: PlayerId;
  entityId: EntityId;
  name: string;
  team: number;
  aircraftId: string;
}

export interface EntityState {
  id: EntityId;
  kind: "aircraft" | "projectile";
  ownerId?: PlayerId;
  team?: number;
  position: Vec3;
  velocity: Vec3;
  rotation: Rot3;
  hp: number;
  maxHp: number;
  throttle01: number;
  flags: number;
  ack?: number;
  ttl?: number;
}

export type CombatEvent =
  | { type: "shot"; shooterId: PlayerId; projectileId: EntityId; origin: Vec3; velocity: Vec3 }
  | { type: "hit"; shooterId: PlayerId; targetId: EntityId; damage: number; hp: number }
  | { type: "kill"; shooterId: PlayerId; victimId: PlayerId; entityId: EntityId }
  | { type: "despawn"; entityId: EntityId }
  | { type: "respawn"; playerId: PlayerId; entity: EntityState };

export interface AircraftState {
  id: EntityId;
  ownerId: PlayerId;
  team: number;
  aircraftId: string;
  position: Vec3;
  velocity: Vec3;
  rotation: Rot3;
  hp: number;
  maxHp: number;
  throttle01: number;
  flags: number;
  ack: number;
}

export interface ProjectileState {
  id: EntityId;
  ownerId: PlayerId;
  team: number;
  position: Vec3;
  previousPosition: Vec3;
  velocity: Vec3;
  damage: number;
  radius: number;
  ttlTicks: number;
}

export interface SequencedInput {
  seq: number;
  command: FlightCommand;
  receivedAtMs: number;
}

export function neutralCommand(): FlightCommand {
  return { throttle: 0, yaw: 0, pitch: 0, roll: 0, fire: false };
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function wrap(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  while (v < lo) v += span;
  while (v > hi) v -= span;
  return v;
}

export function length3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function distance3(a: Vec3, b: Vec3): number {
  return length3({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

export function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

export function lerpVec3(a: Vec3, b: Vec3, f: number): Vec3 {
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    z: lerp(a.z, b.z, f),
  };
}

export function forwardFromRotation(rotation: Rot3): Vec3 {
  const cp = Math.cos(rotation.pitch);
  return {
    x: Math.cos(rotation.yaw) * cp,
    y: Math.sin(rotation.pitch),
    z: Math.sin(rotation.yaw) * cp,
  };
}

export function stepAircraft(
  state: AircraftState,
  command: FlightCommand,
  dt: number,
): AircraftState {
  const next: AircraftState = structuredClone(state);

  next.throttle01 = clamp(next.throttle01 + command.throttle * dt * 0.85, 0, 1);

  next.rotation.yaw += command.yaw * 1.85 * dt;
  next.rotation.pitch = clamp(next.rotation.pitch + command.pitch * 1.15 * dt, -0.92, 0.92);
  next.rotation.roll += command.roll * 4.1 * dt;

  next.rotation.roll *= 0.94;
  next.rotation.pitch *= 0.995;

  const speed = 115 + next.throttle01 * 310;
  const fwd = forwardFromRotation(next.rotation);

  const targetVelocity: Vec3 = {
    x: fwd.x * speed,
    y: fwd.y * speed,
    z: fwd.z * speed,
  };

  const blend = 0.105;
  next.velocity.x += (targetVelocity.x - next.velocity.x) * blend;
  next.velocity.y += (targetVelocity.y - next.velocity.y) * blend;
  next.velocity.z += (targetVelocity.z - next.velocity.z) * blend;

  next.velocity.y -= 7 * dt;

  next.position.x += next.velocity.x * dt;
  next.position.y += next.velocity.y * dt;
  next.position.z += next.velocity.z * dt;

  next.position.x = wrap(next.position.x, WORLD_MIN, WORLD_MAX);
  next.position.z = wrap(next.position.z, WORLD_MIN, WORLD_MAX);

  if (next.position.y < ALT_MIN) {
    next.position.y = ALT_MIN;
    next.velocity.y = Math.max(0, next.velocity.y);
  }
  if (next.position.y > ALT_MAX) {
    next.position.y = ALT_MAX;
    next.velocity.y = Math.min(0, next.velocity.y);
  }

  return next;
}

export function stepProjectile(p: ProjectileState, dt: number): ProjectileState {
  const next: ProjectileState = structuredClone(p);

  next.previousPosition = { ...p.position };
  next.position.x += next.velocity.x * dt;
  next.position.y += next.velocity.y * dt;
  next.position.z += next.velocity.z * dt;
  next.ttlTicks--;

  if (
    next.position.x < WORLD_MIN || next.position.x > WORLD_MAX ||
    next.position.z < WORLD_MIN || next.position.z > WORLD_MAX ||
    next.position.y < ALT_MIN   || next.position.y > ALT_MAX
  ) {
    next.ttlTicks = 0;
  }

  return next;
}

export function spawnProjectile(tick: number, shooter: AircraftState): ProjectileState {
  const fwd = forwardFromRotation(shooter.rotation);
  const muzzle = 30;
  const origin: Vec3 = {
    x: shooter.position.x + fwd.x * muzzle,
    y: shooter.position.y + fwd.y * muzzle,
    z: shooter.position.z + fwd.z * muzzle,
  };
  return {
    id: `projectile:${tick}:${Math.random().toString(16).slice(2, 10)}`,
    ownerId: shooter.ownerId,
    team: shooter.team,
    position: origin,
    previousPosition: origin,
    velocity: {
      x: shooter.velocity.x + fwd.x * PROJECTILE_SPEED,
      y: shooter.velocity.y + fwd.y * PROJECTILE_SPEED,
      z: shooter.velocity.z + fwd.z * PROJECTILE_SPEED,
    },
    damage: PROJECTILE_DAMAGE,
    radius: PROJECTILE_RADIUS,
    ttlTicks: PROJECTILE_TTL_TICKS,
  };
}

export function sweptSphereHit(
  segmentA: Vec3,
  segmentB: Vec3,
  center: Vec3,
  radius: number,
): boolean {
  const ab = { x: segmentB.x - segmentA.x, y: segmentB.y - segmentA.y, z: segmentB.z - segmentA.z };
  const ac = { x: center.x - segmentA.x, y: center.y - segmentA.y, z: center.z - segmentA.z };
  const abLen2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (abLen2 <= 0.000001) return distance3(segmentA, center) <= radius;
  const t = clamp((ac.x * ab.x + ac.y * ab.y + ac.z * ab.z) / abLen2, 0, 1);
  const closest = { x: segmentA.x + ab.x * t, y: segmentA.y + ab.y * t, z: segmentA.z + ab.z * t };
  return distance3(closest, center) <= radius;
}

export function aircraftToEntityState(a: AircraftState): EntityState {
  return {
    id: a.id,
    kind: "aircraft",
    ownerId: a.ownerId,
    team: a.team,
    position: { ...a.position },
    velocity: { ...a.velocity },
    rotation: { ...a.rotation },
    hp: a.hp,
    maxHp: a.maxHp,
    throttle01: a.throttle01,
    flags: a.flags,
    ack: a.ack,
  };
}

export function entityStateToAircraft(e: EntityState): AircraftState {
  return {
    id: e.id,
    ownerId: e.ownerId || "",
    team: e.team || 0,
    aircraftId: "fighter",
    position: { ...e.position },
    velocity: { ...e.velocity },
    rotation: { ...e.rotation },
    hp: e.hp,
    maxHp: e.maxHp,
    throttle01: e.throttle01,
    flags: e.flags,
    ack: e.ack || 0,
  };
}

export function projectileToEntityState(p: ProjectileState): EntityState {
  return {
    id: p.id,
    kind: "projectile",
    ownerId: p.ownerId,
    team: p.team,
    position: { ...p.position },
    velocity: { ...p.velocity },
    rotation: { yaw: 0, pitch: 0, roll: 0 },
    hp: 1,
    maxHp: 1,
    throttle01: 1,
    flags: 0,
    ttl: p.ttlTicks,
  };
}

export function interpolateEntity(a: EntityState, b: EntityState, f: number): EntityState {
  return {
    ...b,
    position: lerpVec3(a.position, b.position, f),
    velocity: lerpVec3(a.velocity, b.velocity, f),
    rotation: {
      yaw: lerpAngle(a.rotation.yaw, b.rotation.yaw, f),
      pitch: lerp(a.rotation.pitch, b.rotation.pitch, f),
      roll: lerp(a.rotation.roll, b.rotation.roll, f),
    },
  };
}

export function extrapolateEntity(e: EntityState, seconds: number): EntityState {
  return {
    ...e,
    position: {
      x: e.position.x + e.velocity.x * seconds,
      y: e.position.y + e.velocity.y * seconds,
      z: e.position.z + e.velocity.z * seconds,
    },
  };
}

export function parseClientPacket(raw: unknown): ClientPacket | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  if (p.type === "join") {
    if (typeof p.queueKey !== "string") return null;
    if (typeof p.aircraftId !== "string") return null;
    return {
      type: "join",
      queueKey: p.queueKey.slice(0, 64),
      aircraftId: p.aircraftId.slice(0, 64),
      token: typeof p.token === "string" ? p.token.slice(0, 256) : undefined,
    };
  }

  if (p.type === "input") {
    if (!Number.isInteger(p.seq)) return null;
    if (!p.command || typeof p.command !== "object") return null;
    const c = p.command as Record<string, unknown>;
    if (!isNumber(c.throttle) || !isNumber(c.yaw) || !isNumber(c.pitch) || !isNumber(c.roll)) return null;
    return {
      type: "input",
      seq: p.seq as number,
      command: {
        throttle: clamp(c.throttle, -1, 1),
        yaw: clamp(c.yaw, -1, 1),
        pitch: clamp(c.pitch, -1, 1),
        roll: clamp(c.roll, -1, 1),
        fire: c.fire === true,
      },
    };
  }

  if (p.type === "chat") {
    if (typeof p.text !== "string") return null;
    return { type: "chat", text: p.text.slice(0, 240) };
  }

  if (p.type === "ping") {
    if (!isNumber(p.clientTime)) return null;
    return { type: "ping", clientTime: p.clientTime };
  }

  return null;
}
