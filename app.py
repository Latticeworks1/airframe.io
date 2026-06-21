import asyncio
import hashlib
import json
import math
import os
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse


PROTOCOL_VERSION = 3

SERVER_HZ = 60
NET_HZ = 24
DT = 1.0 / SERVER_HZ
NET_INTERVAL_TICKS = max(1, round(SERVER_HZ / NET_HZ))

MAX_PLAYERS_PER_ROOM = 16
MAX_PACKET_BYTES = 8192
INPUT_STALE_MS = 250
EMPTY_ROOM_TTL_MS = 30_000
CHAT_MAX_CHARS = 240

WORLD_MIN = -2200.0
WORLD_MAX = 2200.0
ALT_MIN = 30.0
ALT_MAX = 1500.0

PROJECTILE_TTL_TICKS = SERVER_HZ * 3
PROJECTILE_SPEED = 720.0
PROJECTILE_DAMAGE = 18
FIRE_COOLDOWN_TICKS = 8

ROOM_SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"

rooms: dict[str, "Room"] = {}


@dataclass
class InputState:
    seq: int = 0
    throttle: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    fire: int = 0
    time_ms: int = 0


@dataclass
class Entity:
    id: str
    kind: str
    owner_id: str | None
    x: float
    y: float
    z: float
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 145.0
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    throttle: float = 0.50
    hp: float = 100.0
    max_hp: float = 100.0
    flags: int = 0
    ack: int = 0
    ttl: int = 0
    radius: float = 10.0
    damage: float = 0.0


@dataclass
class Player:
    id: str
    name: str
    color: str
    entity_id: str
    joined_ms: int = 0
    last_seen_ms: int = 0
    last_fire_tick: int = -9999


@dataclass
class Room:
    id: str
    sockets: set[WebSocket] = field(default_factory=set)
    socket_players: dict[WebSocket, str] = field(default_factory=dict)
    players: dict[str, Player] = field(default_factory=dict)
    entities: dict[str, Entity] = field(default_factory=dict)
    inputs: dict[str, InputState] = field(default_factory=dict)
    tick: int = 0
    created_ms: int = 0
    last_active_ms: int = 0
    last_net_tick: int = 0


def now_ms() -> int:
    return int(time.time() * 1000)


def stable_hash(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def clean_str(value: Any, n: int) -> str:
    return str(value).strip()[:n]


def clean_room(room_id: str) -> str:
    room_id = "".join(ch for ch in room_id if ch in ROOM_SAFE)[:32]
    return room_id or "main"


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def wrap(v: float, lo: float, hi: float) -> float:
    span = hi - lo
    while v < lo:
        v += span
    while v > hi:
        v -= span
    return v


def r2(v: float) -> float:
    return round(float(v), 2)


def r3(v: float) -> float:
    return round(float(v), 3)


def r4(v: float) -> float:
    return round(float(v), 4)


def get_or_create_room(room_id: str) -> Room:
    room_id = clean_room(room_id)
    room = rooms.get(room_id)
    if room:
        return room

    t = now_ms()
    room = Room(id=room_id, created_ms=t, last_active_ms=t)
    rooms[room_id] = room
    return room


def cleanup_empty_rooms():
    t = now_ms()

    for room_id, room in list(rooms.items()):
        if room.sockets:
            continue

        if t - room.last_active_ms >= EMPTY_ROOM_TTL_MS:
            rooms.pop(room_id, None)


def make_aircraft(player_id: str) -> Entity:
    h = stable_hash(player_id)
    x = float((h % 1200) - 600)
    z = float(((h // 1200) % 1200) - 600)
    yaw = ((h % 6283) / 1000.0) - math.pi

    return Entity(
        id=f"aircraft:{player_id}",
        kind="aircraft",
        owner_id=player_id,
        x=x,
        y=220.0,
        z=z,
        vx=math.cos(yaw) * 160.0,
        vy=0.0,
        vz=math.sin(yaw) * 160.0,
        yaw=yaw,
        pitch=0.0,
        roll=0.0,
        throttle=0.55,
        hp=100.0,
        max_hp=100.0,
        radius=18.0,
    )


def neutral_input(seq: int = 0) -> InputState:
    return InputState(seq=seq, time_ms=now_ms())


def forward_from_angles(yaw: float, pitch: float) -> tuple[float, float, float]:
    cp = math.cos(pitch)
    return math.cos(yaw) * cp, math.sin(pitch), math.sin(yaw) * cp


def step_aircraft(e: Entity, inp: InputState, dt: float):
    e.ack = inp.seq

    e.throttle = clamp(e.throttle + inp.throttle * dt * 0.85, 0.0, 1.0)

    yaw_rate = 1.85
    pitch_rate = 1.15
    roll_rate = 4.1

    e.yaw += inp.yaw * yaw_rate * dt
    e.pitch = clamp(e.pitch + inp.pitch * pitch_rate * dt, -0.92, 0.92)
    e.roll += inp.roll * roll_rate * dt

    e.roll *= 0.94
    e.pitch *= 0.995

    speed = 115.0 + e.throttle * 310.0

    fx, fy, fz = forward_from_angles(e.yaw, e.pitch)

    target_vx = fx * speed
    target_vy = fy * speed
    target_vz = fz * speed

    blend = 0.105
    e.vx += (target_vx - e.vx) * blend
    e.vy += (target_vy - e.vy) * blend
    e.vz += (target_vz - e.vz) * blend

    e.vy -= 7.0 * dt

    e.x += e.vx * dt
    e.y += e.vy * dt
    e.z += e.vz * dt

    e.x = wrap(e.x, WORLD_MIN, WORLD_MAX)
    e.z = wrap(e.z, WORLD_MIN, WORLD_MAX)

    if e.y < ALT_MIN:
        e.y = ALT_MIN
        e.vy = max(0.0, e.vy)

    if e.y > ALT_MAX:
        e.y = ALT_MAX
        e.vy = min(0.0, e.vy)


def make_projectile(room: Room, shooter: Player, aircraft: Entity) -> Entity:
    fx, fy, fz = forward_from_angles(aircraft.yaw, aircraft.pitch)

    pid = f"proj:{room.tick}:{uuid.uuid4().hex[:8]}"
    muzzle = 28.0

    return Entity(
        id=pid,
        kind="projectile",
        owner_id=shooter.id,
        x=aircraft.x + fx * muzzle,
        y=aircraft.y + fy * muzzle,
        z=aircraft.z + fz * muzzle,
        vx=aircraft.vx + fx * PROJECTILE_SPEED,
        vy=aircraft.vy + fy * PROJECTILE_SPEED,
        vz=aircraft.vz + fz * PROJECTILE_SPEED,
        yaw=aircraft.yaw,
        pitch=aircraft.pitch,
        roll=aircraft.roll,
        throttle=1.0,
        hp=1.0,
        max_hp=1.0,
        flags=0,
        ttl=PROJECTILE_TTL_TICKS,
        radius=3.0,
        damage=PROJECTILE_DAMAGE,
    )


def step_projectile(e: Entity, dt: float):
    e.x += e.vx * dt
    e.y += e.vy * dt
    e.z += e.vz * dt
    e.ttl -= 1

    if e.x < WORLD_MIN or e.x > WORLD_MAX or e.z < WORLD_MIN or e.z > WORLD_MAX:
        e.ttl = 0

    if e.y < ALT_MIN or e.y > ALT_MAX:
        e.ttl = 0


def dist3(a: Entity, b: Entity) -> float:
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def handle_projectile_hits(room: Room):
    removed: set[str] = set()

    projectiles = [e for e in room.entities.values() if e.kind == "projectile"]
    aircraft = [e for e in room.entities.values() if e.kind == "aircraft" and e.hp > 0]

    for p in projectiles:
        if p.ttl <= 0:
            removed.add(p.id)
            continue

        for target in aircraft:
            if target.owner_id == p.owner_id:
                continue

            if dist3(p, target) <= target.radius + p.radius:
                target.hp = max(0.0, target.hp - p.damage)
                removed.add(p.id)

                asyncio.create_task(broadcast(room, [
                    "ev",
                    room.tick,
                    "hit",
                    [p.owner_id, target.owner_id, target.id, r2(p.damage), r2(target.hp)],
                ]))

                if target.hp <= 0:
                    asyncio.create_task(broadcast(room, [
                        "ev",
                        room.tick,
                        "kill",
                        [p.owner_id, target.owner_id, target.id],
                    ]))

                    respawn_aircraft(target)

                break

    for eid in removed:
        if eid in room.entities:
            asyncio.create_task(broadcast(room, ["ev", room.tick, "despawn", eid]))
            room.entities.pop(eid, None)


def respawn_aircraft(e: Entity):
    new = make_aircraft(e.owner_id or e.id)
    e.x = new.x
    e.y = new.y
    e.z = new.z
    e.vx = new.vx
    e.vy = new.vy
    e.vz = new.vz
    e.yaw = new.yaw
    e.pitch = 0.0
    e.roll = 0.0
    e.throttle = 0.55
    e.hp = e.max_hp
    e.flags = 0


def pack_player(p: Player) -> list[Any]:
    return [p.id, p.name, p.color, p.entity_id]


def pack_entity(e: Entity) -> list[Any]:
    return [
        e.id,
        e.kind,
        e.owner_id,
        r2(e.x),
        r2(e.y),
        r2(e.z),
        r2(e.vx),
        r2(e.vy),
        r2(e.vz),
        r4(e.yaw),
        r4(e.pitch),
        r4(e.roll),
        r3(e.throttle),
        r2(e.hp),
        r2(e.max_hp),
        int(e.flags),
        int(e.ack),
        int(e.ttl),
    ]


def pack_delta(e: Entity) -> list[Any]:
    return [
        e.id,
        int(e.ack),
        r2(e.x),
        r2(e.y),
        r2(e.z),
        r2(e.vx),
        r2(e.vy),
        r2(e.vz),
        r4(e.yaw),
        r4(e.pitch),
        r4(e.roll),
        r3(e.throttle),
        r2(e.hp),
        int(e.flags),
        int(e.ttl),
    ]


async def send(ws: WebSocket, packet: Any):
    await ws.send_text(json.dumps(packet, separators=(",", ":")))


async def broadcast(room: Room, packet: Any, exclude: WebSocket | None = None):
    payload = json.dumps(packet, separators=(",", ":"))
    dead: list[WebSocket] = []

    for peer in list(room.sockets):
        if peer is exclude:
            continue

        try:
            await peer.send_text(payload)
        except Exception:
            dead.append(peer)

    for peer in dead:
        room.sockets.discard(peer)
        room.socket_players.pop(peer, None)


async def send_to_player(room: Room, player_id: str, packet: Any):
    payload = json.dumps(packet, separators=(",", ":"))

    for ws, pid in list(room.socket_players.items()):
        if pid != player_id:
            continue

        try:
            await ws.send_text(payload)
        except Exception:
            room.sockets.discard(ws)
            room.socket_players.pop(ws, None)
        return


async def sim_loop():
    while True:
        await asyncio.sleep(DT)
        cleanup_empty_rooms()
        t = now_ms()

        for room in list(rooms.values()):
            if not room.sockets:
                continue

            room.tick += 1
            room.last_active_ms = t

            for player in list(room.players.values()):
                aircraft = room.entities.get(player.entity_id)
                if not aircraft:
                    continue

                inp = room.inputs.get(player.id, neutral_input(aircraft.ack))

                if t - inp.time_ms > INPUT_STALE_MS:
                    inp = neutral_input(inp.seq)
                    room.inputs[player.id] = inp

                step_aircraft(aircraft, inp, DT)

                if inp.fire and room.tick - player.last_fire_tick >= FIRE_COOLDOWN_TICKS:
                    player.last_fire_tick = room.tick
                    projectile = make_projectile(room, player, aircraft)
                    room.entities[projectile.id] = projectile
                    await broadcast(room, ["ev", room.tick, "shot", [player.id, aircraft.id, pack_entity(projectile)]])

            for e in list(room.entities.values()):
                if e.kind == "projectile":
                    step_projectile(e, DT)

            handle_projectile_hits(room)

            if room.tick - room.last_net_tick >= NET_INTERVAL_TICKS:
                room.last_net_tick = room.tick
                deltas = [pack_delta(e) for e in room.entities.values()]
                await broadcast(room, ["u", room.tick, deltas])


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(sim_loop())
    yield
    task.cancel()


app = FastAPI(title="airframe.io p2p combat stress", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


for name in ["METERED_DOMAIN", "METERED_SECRET_KEY"]:
    if not os.getenv(name):
        raise RuntimeError(f"Missing required Hugging Face Space secret: {name}")

METERED_DOMAIN = os.environ["METERED_DOMAIN"]
METERED_SECRET_KEY = os.environ["METERED_SECRET_KEY"]
TURN_TTL_SECONDS = int(os.getenv("TURN_TTL_SECONDS", "3600"))


@app.get("/", response_class=HTMLResponse)
def index():
    return INDEX_HTML


@app.get("/health")
def health():
    return {
        "ok": True,
        "protocol": PROTOCOL_VERSION,
        "serverHz": SERVER_HZ,
        "netHz": NET_HZ,
        "rooms": len(rooms),
        "players": sum(len(r.players) for r in rooms.values()),
        "entities": sum(len(r.entities) for r in rooms.values()),
        "meteredDomain": METERED_DOMAIN,
    }


@app.get("/ice")
async def ice():
    label = f"airframe-{int(time.time())}-{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        created = await client.post(
            f"https://{METERED_DOMAIN}/api/v1/turn/credential",
            params={"secretKey": METERED_SECRET_KEY},
            json={"label": label, "expiryInSeconds": TURN_TTL_SECONDS},
        )

        if created.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail={
                    "error": "Metered credential creation failed",
                    "status": created.status_code,
                    "body": created.text,
                },
            )

        credential = created.json()
        api_key = credential.get("apiKey")

        if not api_key:
            raise HTTPException(
                status_code=502,
                detail={"error": "Metered response missing apiKey", "response": credential},
            )

        fetched = await client.get(
            f"https://{METERED_DOMAIN}/api/v1/turn/credentials",
            params={"apiKey": api_key},
        )

        if fetched.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail={
                    "error": "Metered ICE fetch failed",
                    "status": fetched.status_code,
                    "body": fetched.text,
                },
            )

        ice_servers = fetched.json()

    if not isinstance(ice_servers, list) or not ice_servers:
        raise HTTPException(
            status_code=502,
            detail={"error": "Metered returned invalid ICE server list", "response": ice_servers},
        )

    return {"iceServers": ice_servers, "ttlSeconds": TURN_TTL_SECONDS, "label": label}


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    room_id = clean_room(room_id)
    await ws.accept()

    room = get_or_create_room(room_id)
    room.sockets.add(ws)
    room.last_active_ms = now_ms()

    player_id: str | None = None

    await send(ws, ["h", PROTOCOL_VERSION, SERVER_HZ, NET_HZ])

    try:
        while True:
            raw = await ws.receive_text()

            if len(raw) > MAX_PACKET_BYTES:
                await send(ws, ["e", "packet_too_large", str(len(raw))])
                continue

            try:
                packet = json.loads(raw)
            except json.JSONDecodeError:
                await send(ws, ["e", "invalid_json", raw[:120]])
                continue

            if not isinstance(packet, list) or not packet:
                await send(ws, ["e", "bad_packet", "packet must be non-empty array"])
                continue

            kind = packet[0]

            if kind == "h":
                await send(ws, ["h", PROTOCOL_VERSION, SERVER_HZ, NET_HZ])
                continue

            if kind == "j":
                if len(packet) < 5:
                    await send(ws, ["e", "bad_join", "requires ['j', room, id, name, color]"])
                    continue

                requested_room = clean_room(packet[1])
                if requested_room != room_id:
                    await send(ws, ["e", "room_mismatch", requested_room])
                    continue

                pid = clean_str(packet[2], 80)
                name = clean_str(packet[3], 24) or pid[:8]
                color = clean_str(packet[4], 32) or "#e8dcc0"

                if not pid:
                    await send(ws, ["e", "bad_player_id", "empty"])
                    continue

                if len(room.players) >= MAX_PLAYERS_PER_ROOM and pid not in room.players:
                    await send(ws, ["e", "room_full", str(MAX_PLAYERS_PER_ROOM)])
                    continue

                player_id = pid

                aircraft = make_aircraft(pid)
                player = Player(
                    id=pid,
                    name=name,
                    color=color,
                    entity_id=aircraft.id,
                    joined_ms=now_ms(),
                    last_seen_ms=now_ms(),
                )

                room.players[pid] = player
                room.entities[aircraft.id] = aircraft
                room.inputs[pid] = neutral_input(0)
                room.socket_players[ws] = pid

                await send(ws, [
                    "i",
                    room.id,
                    room.tick,
                    pid,
                    [pack_player(p) for p in room.players.values()],
                    [pack_entity(e) for e in room.entities.values()],
                ])

                await broadcast(room, ["ev", room.tick, "join", [pack_player(player), pack_entity(aircraft)]], exclude=ws)
                continue

            if kind == "in":
                if len(packet) < 8:
                    await send(ws, ["e", "bad_input", "requires ['in', id, seq, throttle, yaw, pitch, roll, fire]"])
                    continue

                pid = clean_str(packet[1], 80)

                if pid != player_id:
                    await send(ws, ["e", "input_owner_mismatch", pid])
                    continue

                if pid not in room.players:
                    await send(ws, ["e", "unknown_player", pid])
                    continue

                seq = int(packet[2])
                old_seq = room.inputs.get(pid, neutral_input()).seq

                if seq < old_seq:
                    continue

                room.inputs[pid] = InputState(
                    seq=seq,
                    throttle=clamp(float(packet[3]), -1.0, 1.0),
                    yaw=clamp(float(packet[4]), -1.0, 1.0),
                    pitch=clamp(float(packet[5]), -1.0, 1.0),
                    roll=clamp(float(packet[6]), -1.0, 1.0),
                    fire=1 if packet[7] else 0,
                    time_ms=now_ms(),
                )

                room.players[pid].last_seen_ms = now_ms()
                continue

            if kind == "chat":
                if len(packet) < 2:
                    await send(ws, ["e", "bad_chat", "requires ['chat', text]"])
                    continue

                if not player_id or player_id not in room.players:
                    await send(ws, ["e", "chat_not_joined", "join before chat"])
                    continue

                text = clean_str(packet[1], CHAT_MAX_CHARS)
                if not text:
                    continue

                player = room.players[player_id]

                await broadcast(room, [
                    "chat",
                    room.tick,
                    player.id,
                    player.name,
                    text,
                    now_ms(),
                ])
                continue

            if kind == "sig":
                if len(packet) < 3:
                    await send(ws, ["e", "bad_signal", "requires ['sig', toPlayerId, payload]"])
                    continue

                if not player_id:
                    await send(ws, ["e", "signal_not_joined", "join before signaling"])
                    continue

                to_player_id = clean_str(packet[1], 80)
                payload = packet[2]

                if to_player_id not in room.players:
                    await send(ws, ["e", "signal_target_missing", to_player_id])
                    continue

                await send_to_player(room, to_player_id, ["sig", player_id, payload])
                continue

            await send(ws, ["e", "unknown_packet", str(kind)])

    except WebSocketDisconnect:
        pass

    except Exception as exc:
        await broadcast(room, ["e", "server_exception", str(exc)], exclude=ws)

    finally:
        room.sockets.discard(ws)

        pid = player_id or room.socket_players.pop(ws, None)

        if pid:
            player = room.players.pop(pid, None)
            room.inputs.pop(pid, None)

            if player:
                room.entities.pop(player.entity_id, None)
                await broadcast(room, ["l", pid, player.entity_id])

        room.socket_players.pop(ws, None)
        room.last_active_ms = now_ms()


INDEX_HTML = """
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>airframe.io P2P combat stress</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #080d14;
      color: #e8dcc0;
      font-family: system-ui, sans-serif;
      touch-action: none;
      user-select: none;
    }

    canvas {
      display: block;
    }

    #hud {
      position: fixed;
      left: 12px;
      top: 10px;
      background: rgba(5, 7, 11, 0.80);
      border: 1px solid #2f3b52;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.45;
      min-width: 350px;
      z-index: 10;
    }

    #hud input {
      width: 110px;
      background: #111722;
      color: #e8dcc0;
      border: 1px solid #2f3b52;
      padding: 3px 5px;
    }

    #chat {
      position: fixed;
      left: 12px;
      bottom: 12px;
      width: min(430px, calc(100vw - 24px));
      background: rgba(5, 7, 11, 0.80);
      border: 1px solid #2f3b52;
      padding: 9px;
      font-size: 12px;
      z-index: 10;
      box-sizing: border-box;
    }

    #chatlog {
      height: 100px;
      overflow: auto;
      white-space: pre-wrap;
      margin-bottom: 7px;
    }

    #chatinput {
      width: 100%;
      box-sizing: border-box;
      background: #111722;
      color: #e8dcc0;
      border: 1px solid #2f3b52;
      padding: 7px 8px;
    }

    #mobile {
      position: fixed;
      right: 12px;
      bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 12;
    }

    button {
      background: #263349;
      color: #e8dcc0;
      border: 1px solid #52617d;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 14px;
    }

    #stick {
      position: fixed;
      left: 22px;
      bottom: 152px;
      width: 120px;
      height: 120px;
      border-radius: 999px;
      border: 1px solid #52617d;
      background: rgba(5, 7, 11, 0.42);
      z-index: 11;
      display: none;
    }

    #knob {
      position: absolute;
      left: 43px;
      top: 43px;
      width: 34px;
      height: 34px;
      border-radius: 999px;
      background: rgba(232, 220, 192, 0.78);
    }

    @media (max-width: 800px) {
      #hud {
        min-width: 250px;
        font-size: 11px;
      }

      #chat {
        height: 136px;
      }

      #chatlog {
        height: 74px;
      }

      #stick {
        display: block;
      }
    }
  </style>
</head>
<body>
  <div id="hud">
    <div><b>airframe.io P2P combat stress</b></div>
    <div>Room: <input id="room" value="main"></div>
    <div>Player: <span id="player"></span></div>
    <div>Status: <span id="status">idle</span></div>
    <div>Players: <span id="count">0</span></div>
    <div>HP: <span id="hp">100</span></div>
    <div>Tick: <span id="tick">0</span></div>
    <div>TX/RX: <span id="tx">0</span>/<span id="rx">0</span></div>
    <div>Pending: <span id="pending">0</span></div>
    <div>Correction: <span id="error">0</span></div>
    <div>DataChannels: <span id="dc">0</span></div>
    <div>W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle, Space fire</div>
  </div>

  <div id="chat">
    <div id="chatlog"></div>
    <input id="chatinput" placeholder="chat..." maxlength="240">
  </div>

  <div id="stick"><div id="knob"></div></div>

  <div id="mobile">
    <button id="firebtn">FIRE</button>
    <button id="boostbtn">BOOST</button>
  </div>

<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const PROTOCOL_VERSION = 3;
const CLIENT_HZ = 60;
const FIXED_DT = 1 / CLIENT_HZ;
const INTERP_DELAY = 125;

const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playerEl = document.getElementById("player");
const roomInput = document.getElementById("room");
const tickEl = document.getElementById("tick");
const hpEl = document.getElementById("hp");
const txEl = document.getElementById("tx");
const rxEl = document.getElementById("rx");
const pendingEl = document.getElementById("pending");
const errorEl = document.getElementById("error");
const dcEl = document.getElementById("dc");
const chatLogEl = document.getElementById("chatlog");
const chatInputEl = document.getElementById("chatinput");
const fireBtn = document.getElementById("firebtn");
const boostBtn = document.getElementById("boostbtn");
const stick = document.getElementById("stick");
const knob = document.getElementById("knob");

let ws = null;
let keys = new Set();

let players = new Map();
let entities = new Map();
let meshes = new Map();
let histories = new Map();

let peerConnections = new Map();
let dataChannels = new Map();
let knownPeerIds = new Set();
let iceConfig = null;

let txPackets = 0;
let rxPackets = 0;
let inputSeq = 0;
let lastInputSend = 0;
let pendingInputs = [];

let serverTick = 0;
let correctionError = 0;

let touchStick = { active: false, x: 0, y: 0 };
let touchFire = false;
let touchBoost = false;

let me = {
  id: localStorage.getItem("airframePlayerId"),
  name: "",
  color: "",
  entityId: "",
  x: 0,
  y: 220,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 145,
  yaw: 0,
  pitch: 0,
  roll: 0,
  throttleLevel: 0.55,
  hp: 100,
  maxHp: 100,
  flags: 0,
  ack: 0
};

if (!me.id) {
  me.id = crypto.randomUUID();
  localStorage.setItem("airframePlayerId", me.id);
}

me.name = "P-" + me.id.slice(0, 6);
me.color = colorFromId(me.id);
me.entityId = "aircraft:" + me.id;

playerEl.textContent = me.name + " / " + me.id.slice(0, 8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080d14);
scene.fog = new THREE.Fog(0x080d14, 1600, 4200);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 8000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x7d8ba6, 0.9));

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(240, 800, 360);
scene.add(sun);

const grid = new THREE.GridHelper(4400, 88, 0x3c4a66, 0x1d2738);
scene.add(grid);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(4400, 4400),
  new THREE.MeshStandardMaterial({ color: 0x0f1722, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.5;
scene.add(floor);

window.addEventListener("resize", resize);
resize();

window.addEventListener("keydown", e => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

roomInput.addEventListener("change", connect);

chatInputEl.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  const text = chatInputEl.value.trim();
  if (!text) return;
  send(["chat", text]);
  chatInputEl.value = "";
});

fireBtn.addEventListener("pointerdown", () => touchFire = true);
fireBtn.addEventListener("pointerup", () => touchFire = false);
fireBtn.addEventListener("pointercancel", () => touchFire = false);

boostBtn.addEventListener("pointerdown", () => touchBoost = true);
boostBtn.addEventListener("pointerup", () => touchBoost = false);
boostBtn.addEventListener("pointercancel", () => touchBoost = false);

stick.addEventListener("pointerdown", onStick);
stick.addEventListener("pointermove", onStick);
stick.addEventListener("pointerup", offStick);
stick.addEventListener("pointercancel", offStick);

function onStick(e) {
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  const max = rect.width * 0.38;

  touchStick.x = clamp(dx / max, -1, 1);
  touchStick.y = clamp(dy / max, -1, 1);
  touchStick.active = true;

  knob.style.left = `${43 + touchStick.x * 38}px`;
  knob.style.top = `${43 + touchStick.y * 38}px`;

  stick.setPointerCapture(e.pointerId);
}

function offStick() {
  touchStick.active = false;
  touchStick.x = 0;
  touchStick.y = 0;
  knob.style.left = "43px";
  knob.style.top = "43px";
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 65%)`;
}

function log(msg) {
  chatLogEl.textContent += `system: ${msg}\\n`;
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function chat(name, text) {
  chatLogEl.textContent += `${name}: ${text}\\n`;
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function connect() {
  if (ws) ws.close();

  for (const pid of [...peerConnections.keys()]) closePeer(pid);

  players.clear();
  entities.clear();
  histories.clear();
  knownPeerIds.clear();

  meshes.forEach(m => scene.remove(m));
  meshes.clear();

  inputSeq = 0;
  pendingInputs = [];

  const room = roomInput.value.trim() || "main";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/ws/${encodeURIComponent(room)}`;

  statusEl.textContent = "connecting";

  ws = new WebSocket(url);

  ws.onopen = () => {
    statusEl.textContent = "connected";
    send(["h", PROTOCOL_VERSION, "web"]);
    send(["j", room, me.id, me.name, me.color]);
  };

  ws.onmessage = event => {
    rxPackets++;
    rxEl.textContent = String(rxPackets);

    let packet;

    try {
      packet = JSON.parse(event.data);
    } catch {
      return;
    }

    applyPacket(packet);
  };

  ws.onclose = event => statusEl.textContent = "closed " + event.code;
  ws.onerror = () => statusEl.textContent = "error";
}

function send(packet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(packet));
  txPackets++;
  txEl.textContent = String(txPackets);
}

function applyPacket(packet) {
  if (!Array.isArray(packet) || !packet.length) return;

  const type = packet[0];

  if (type === "h") return;

  if (type === "i") {
    serverTick = packet[2] || 0;
    tickEl.textContent = String(serverTick);

    for (const pRaw of packet[4] || []) {
      const p = unpackPlayer(pRaw);
      players.set(p.id, p);
      if (p.id !== me.id) considerPeer(p.id);
    }

    for (const eRaw of packet[5] || []) {
      const e = unpackEntity(eRaw);
      entities.set(e.id, e);
      ensureMesh(e);
      pushHistory(e.id, e);

      if (e.id === me.entityId) copyEntityToMe(e);
    }

    countEl.textContent = String(players.size);
    return;
  }

  if (type === "u") {
    serverTick = packet[1];
    tickEl.textContent = String(serverTick);

    for (const dRaw of packet[2] || []) {
      const d = unpackDelta(dRaw);
      let e = entities.get(d.id);

      if (!e) {
        e = makePlaceholderEntity(d.id);
        entities.set(e.id, e);
        ensureMesh(e);
      }

      Object.assign(e, d);
      pushHistory(e.id, e);

      if (e.id === me.entityId) reconcile(e);
    }

    hpEl.textContent = String(Math.round(me.hp));
    return;
  }

  if (type === "ev") {
    const kind = packet[2];
    const payload = packet[3];

    if (kind === "join") {
      const p = unpackPlayer(payload[0]);
      const e = unpackEntity(payload[1]);
      players.set(p.id, p);
      entities.set(e.id, e);
      ensureMesh(e);
      pushHistory(e.id, e);
      if (p.id !== me.id) considerPeer(p.id);
      countEl.textContent = String(players.size);
      log(p.name + " joined");
      return;
    }

    if (kind === "shot") {
      const proj = unpackEntity(payload[2]);
      entities.set(proj.id, proj);
      ensureMesh(proj);
      return;
    }

    if (kind === "hit") {
      log("hit " + payload[1] + " -" + payload[3]);
      return;
    }

    if (kind === "kill") {
      log("kill " + payload[1]);
      return;
    }

    if (kind === "despawn") {
      removeEntity(payload);
      return;
    }
  }

  if (type === "chat") {
    chat(packet[3] || packet[2], packet[4] || "");
    return;
  }

  if (type === "sig") {
    handleSignal(packet[1], packet[2]).catch(err => log("signal failed " + err.message));
    return;
  }

  if (type === "l") {
    const pid = packet[1];
    const eid = packet[2];
    players.delete(pid);
    removeEntity(eid);
    closePeer(pid);
    countEl.textContent = String(players.size);
    log(pid.slice(0, 8) + " left");
    return;
  }

  if (type === "e") {
    log(packet[1] + " " + (packet[2] || ""));
  }
}

function unpackPlayer(a) {
  return { id: a[0], name: a[1], color: a[2], entityId: a[3] };
}

function unpackEntity(a) {
  return {
    id: a[0],
    kind: a[1],
    ownerId: a[2],
    x: a[3],
    y: a[4],
    z: a[5],
    vx: a[6],
    vy: a[7],
    vz: a[8],
    yaw: a[9],
    pitch: a[10],
    roll: a[11],
    throttleLevel: a[12],
    hp: a[13],
    maxHp: a[14],
    flags: a[15],
    ack: a[16],
    ttl: a[17],
    color: entityColor(a[1], a[2], a[0])
  };
}

function unpackDelta(a) {
  const existing = entities.get(a[0]);
  const kind = existing?.kind || (String(a[0]).startsWith("proj:") ? "projectile" : "aircraft");
  const ownerId = existing?.ownerId || ownerFromEntity(a[0]);

  return {
    id: a[0],
    kind,
    ownerId,
    ack: a[1],
    x: a[2],
    y: a[3],
    z: a[4],
    vx: a[5],
    vy: a[6],
    vz: a[7],
    yaw: a[8],
    pitch: a[9],
    roll: a[10],
    throttleLevel: a[11],
    hp: a[12],
    flags: a[13],
    ttl: a[14],
    color: existing?.color || entityColor(kind, ownerId, a[0])
  };
}

function ownerFromEntity(id) {
  if (typeof id === "string" && id.startsWith("aircraft:")) return id.slice("aircraft:".length);
  return null;
}

function entityColor(kind, ownerId, id) {
  if (kind === "projectile") return "#ffcc66";
  if (ownerId && players.has(ownerId)) return players.get(ownerId).color;
  return colorFromId(ownerId || id);
}

function makePlaceholderEntity(id) {
  const kind = String(id).startsWith("proj:") ? "projectile" : "aircraft";
  return {
    id,
    kind,
    ownerId: ownerFromEntity(id),
    x: 0,
    y: 200,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    throttleLevel: 0.5,
    hp: 100,
    maxHp: 100,
    flags: 0,
    ack: 0,
    ttl: 0,
    color: entityColor(kind, ownerFromEntity(id), id)
  };
}

function copyEntityToMe(e) {
  me.x = e.x;
  me.y = e.y;
  me.z = e.z;
  me.vx = e.vx;
  me.vy = e.vy;
  me.vz = e.vz;
  me.yaw = e.yaw;
  me.pitch = e.pitch;
  me.roll = e.roll;
  me.throttleLevel = e.throttleLevel;
  me.hp = e.hp;
  me.maxHp = e.maxHp;
  me.flags = e.flags;
  me.ack = e.ack;
  entities.set(me.entityId, meEntity());
}

function meEntity() {
  return {
    id: me.entityId,
    kind: "aircraft",
    ownerId: me.id,
    x: me.x,
    y: me.y,
    z: me.z,
    vx: me.vx,
    vy: me.vy,
    vz: me.vz,
    yaw: me.yaw,
    pitch: me.pitch,
    roll: me.roll,
    throttleLevel: me.throttleLevel,
    hp: me.hp,
    maxHp: me.maxHp,
    flags: me.flags,
    ack: me.ack,
    ttl: 0,
    color: me.color
  };
}

function removeEntity(id) {
  entities.delete(id);
  histories.delete(id);
  const mesh = meshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    meshes.delete(id);
  }
}

function pushHistory(id, e) {
  if (id === me.entityId) return;

  const h = histories.get(id) || [];
  h.push({
    t: performance.now(),
    x: e.x,
    y: e.y,
    z: e.z,
    yaw: e.yaw,
    pitch: e.pitch,
    roll: e.roll
  });

  while (h.length > 18) h.shift();
  histories.set(id, h);
}

function sampleRemote(id) {
  const e = entities.get(id);
  const h = histories.get(id);

  if (!e || !h || h.length < 2) return e;

  const target = performance.now() - INTERP_DELAY;

  let a = h[0];
  let b = h[h.length - 1];

  for (let i = 0; i < h.length - 1; i++) {
    if (h[i].t <= target && h[i + 1].t >= target) {
      a = h[i];
      b = h[i + 1];
      break;
    }
  }

  const span = Math.max(1, b.t - a.t);
  const f = clamp((target - a.t) / span, 0, 1);

  const lead = e.kind === "aircraft" ? 0.035 : 0.015;

  return {
    ...e,
    x: lerp(a.x, b.x, f) + e.vx * lead,
    y: lerp(a.y, b.y, f) + e.vy * lead,
    z: lerp(a.z, b.z, f) + e.vz * lead,
    yaw: lerpAngle(a.yaw, b.yaw, f),
    pitch: lerp(a.pitch, b.pitch, f),
    roll: lerp(a.roll, b.roll, f)
  };
}

function getInput() {
  let throttle = 0;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let fire = false;

  if (keys.has("shift") || touchBoost) throttle += 1;
  if (keys.has("control")) throttle -= 1;

  if (keys.has("a") || keys.has("arrowleft")) yaw += 1;
  if (keys.has("d") || keys.has("arrowright")) yaw -= 1;

  if (keys.has("w") || keys.has("arrowup")) pitch += 1;
  if (keys.has("s") || keys.has("arrowdown")) pitch -= 1;

  if (keys.has("q")) roll += 1;
  if (keys.has("e")) roll -= 1;

  if (touchStick.active) {
    yaw += -touchStick.x;
    pitch += -touchStick.y;
  }

  fire = keys.has(" ") || touchFire;

  return {
    seq: ++inputSeq,
    throttle: clamp(throttle, -1, 1),
    yaw: clamp(yaw, -1, 1),
    pitch: clamp(pitch, -1, 1),
    roll: clamp(roll, -1, 1),
    fire
  };
}

function reconcile(serverEntity) {
  const beforeX = me.x;
  const beforeY = me.y;
  const beforeZ = me.z;

  pendingInputs = pendingInputs.filter(input => input.seq > serverEntity.ack);

  copyEntityToMe(serverEntity);

  for (const input of pendingInputs) {
    simulate(me, input, FIXED_DT);
  }

  correctionError = Math.hypot(me.x - beforeX, me.y - beforeY, me.z - beforeZ);
  errorEl.textContent = correctionError.toFixed(2);
  pendingEl.textContent = String(pendingInputs.length);

  entities.set(me.entityId, meEntity());
}

function simulate(p, input, dt) {
  p.throttleLevel = clamp((p.throttleLevel ?? 0.55) + input.throttle * dt * 0.85, 0, 1);

  p.yaw += input.yaw * 1.85 * dt;
  p.pitch = clamp(p.pitch + input.pitch * 1.15 * dt, -0.92, 0.92);
  p.roll += input.roll * 4.1 * dt;
  p.roll *= 0.94;
  p.pitch *= 0.995;

  const speed = 115 + p.throttleLevel * 310;

  const cp = Math.cos(p.pitch);
  const fx = Math.cos(p.yaw) * cp;
  const fy = Math.sin(p.pitch);
  const fz = Math.sin(p.yaw) * cp;

  const targetVx = fx * speed;
  const targetVy = fy * speed;
  const targetVz = fz * speed;

  const blend = 0.105;

  p.vx += (targetVx - p.vx) * blend;
  p.vy += (targetVy - p.vy) * blend;
  p.vz += (targetVz - p.vz) * blend;

  p.vy -= 7 * dt;

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  p.x = wrap(p.x, -2200, 2200);
  p.z = wrap(p.z, -2200, 2200);

  if (p.y < 30) {
    p.y = 30;
    p.vy = Math.max(0, p.vy);
  }

  if (p.y > 1500) {
    p.y = 1500;
    p.vy = Math.min(0, p.vy);
  }
}

function ensureMesh(e) {
  if (meshes.has(e.id)) return meshes.get(e.id);

  let group;

  if (e.kind === "projectile") {
    group = new THREE.Mesh(
      new THREE.SphereGeometry(3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc66 })
    );
  } else {
    group = new THREE.Group();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(e.color || "#e8dcc0"),
      roughness: 0.72,
      metalness: 0.12
    });

    const body = new THREE.Mesh(new THREE.ConeGeometry(9, 42, 4), material);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(54, 2, 10), material);
    wing.position.z = -3;
    group.add(wing);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(18, 2, 8), material);
    tail.position.z = -18;
    group.add(tail);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(3, 13, 7), material);
    fin.position.z = -18;
    fin.position.y = 6;
    group.add(fin);
  }

  meshes.set(e.id, group);
  scene.add(group);

  return group;
}

function updateMeshes() {
  entities.set(me.entityId, meEntity());

  for (const [id, e] of entities.entries()) {
    const draw = id === me.entityId ? meEntity() : sampleRemote(id);
    if (!draw) continue;

    const mesh = ensureMesh(draw);

    mesh.position.set(draw.x, draw.y, draw.z);

    if (draw.kind !== "projectile") {
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = -draw.yaw + Math.PI / 2;
      mesh.rotation.x = draw.pitch;
      mesh.rotation.z = draw.roll;
    }
  }
}

function updateCamera() {
  const back = 225;
  const up = 92;

  const fx = Math.cos(me.yaw) * Math.cos(me.pitch);
  const fz = Math.sin(me.yaw) * Math.cos(me.pitch);

  camera.position.x = me.x - fx * back;
  camera.position.y = me.y + up;
  camera.position.z = me.z - fz * back;

  camera.lookAt(me.x, me.y + 25, me.z);
}

async function getIceConfig() {
  if (iceConfig) return iceConfig;

  const res = await fetch("/ice");
  const data = await res.json();

  if (!res.ok) throw new Error(JSON.stringify(data));
  iceConfig = data;
  return iceConfig;
}

function updateDcCount() {
  let open = 0;
  for (const dc of dataChannels.values()) {
    if (dc.readyState === "open") open++;
  }
  dcEl.textContent = String(open);
}

function shouldOfferTo(peerId) {
  return me.id < peerId;
}

async function ensurePeerConnection(peerId) {
  if (peerId === me.id) return null;

  let pc = peerConnections.get(peerId);
  if (pc) return pc;

  const cfg = await getIceConfig();

  pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  peerConnections.set(peerId, pc);

  pc.onicecandidate = event => {
    if (!event.candidate) return;
    send(["sig", peerId, { type: "candidate", candidate: event.candidate }]);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(peerId);
  };

  pc.ondatachannel = event => bindDataChannel(peerId, event.channel);

  return pc;
}

function bindDataChannel(peerId, dc) {
  const old = dataChannels.get(peerId);
  if (old && old !== dc) old.close();

  dc.binaryType = "arraybuffer";

  dc.onopen = () => {
    dataChannels.set(peerId, dc);
    updateDcCount();
    log("dc open " + peerId.slice(0, 8));
  };

  dc.onmessage = event => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.t === "telemetry") {
      return;
    }
  };

  dc.onclose = () => {
    if (dataChannels.get(peerId) === dc) dataChannels.delete(peerId);
    updateDcCount();
  };
}

async function openDataChannelTo(peerId) {
  const pc = await ensurePeerConnection(peerId);
  if (!pc) return;

  const dc = pc.createDataChannel("game-telemetry", {
    ordered: false,
    maxRetransmits: 0
  });

  bindDataChannel(peerId, dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(["sig", peerId, { type: "offer", sdp: offer }]);
}

async function handleSignal(fromPeerId, payload) {
  const pc = await ensurePeerConnection(fromPeerId);
  if (!pc) return;

  if (payload.type === "offer") {
    await pc.setRemoteDescription(payload.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send(["sig", fromPeerId, { type: "answer", sdp: answer }]);
    return;
  }

  if (payload.type === "answer") {
    await pc.setRemoteDescription(payload.sdp);
    return;
  }

  if (payload.type === "candidate") {
    await pc.addIceCandidate(payload.candidate);
  }
}

function closePeer(peerId) {
  const dc = dataChannels.get(peerId);
  if (dc) dc.close();

  const pc = peerConnections.get(peerId);
  if (pc) pc.close();

  dataChannels.delete(peerId);
  peerConnections.delete(peerId);
  knownPeerIds.delete(peerId);
  updateDcCount();
}

async function considerPeer(peerId) {
  if (!peerId || peerId === me.id) return;
  if (knownPeerIds.has(peerId)) return;

  knownPeerIds.add(peerId);

  await ensurePeerConnection(peerId);

  if (shouldOfferTo(peerId)) {
    await openDataChannelTo(peerId);
  }
}

function broadcastTelemetryOverDc() {
  const payload = JSON.stringify({
    t: "telemetry",
    id: me.id,
    eid: me.entityId,
    seq: inputSeq,
    x: me.x,
    y: me.y,
    z: me.z,
    vx: me.vx,
    vy: me.vy,
    vz: me.vz,
    yaw: me.yaw,
    pitch: me.pitch,
    roll: me.roll,
    at: performance.now()
  });

  for (const dc of dataChannels.values()) {
    if (dc.readyState !== "open") continue;
    if (dc.bufferedAmount > 262144) continue;
    dc.send(payload);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrap(v, lo, hi) {
  const span = hi - lo;
  while (v < lo) v += span;
  while (v > hi) v -= span;
  return v;
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

let lastFrame = performance.now();

function frame(now) {
  lastFrame = now;

  if (now - lastInputSend > 1000 / CLIENT_HZ) {
    lastInputSend = now;

    const input = getInput();

    pendingInputs.push(input);
    if (pendingInputs.length > 140) pendingInputs.shift();

    simulate(me, input, FIXED_DT);
    entities.set(me.entityId, meEntity());

    send([
      "in",
      me.id,
      input.seq,
      input.throttle,
      input.yaw,
      input.pitch,
      input.roll,
      input.fire ? 1 : 0
    ]);

    broadcastTelemetryOverDc();
  }

  updateMeshes();
  updateCamera();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

connect();
requestAnimationFrame(frame);
</script>
</body>
</html>
"""