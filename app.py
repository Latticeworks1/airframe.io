import asyncio
import hashlib
import json
import math
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse


PROTOCOL_VERSION = 1

SERVER_HZ = 20
NET_HZ = 10
DT = 1.0 / SERVER_HZ
NET_INTERVAL_TICKS = max(1, round(SERVER_HZ / NET_HZ))

MAX_PLAYERS_PER_ROOM = 32
MAX_PACKET_BYTES = 4096
EMPTY_ROOM_TTL_MS = 30_000
CHAT_MAX_CHARS = 240

WORLD_MIN = -120.0
WORLD_MAX = 120.0

ROOM_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


@dataclass
class Player:
    id: str
    name: str
    color: str
    entity_id: str
    inventory: dict[str, int] = field(default_factory=dict)
    joined_ms: int = 0
    last_seen_ms: int = 0


@dataclass
class Entity:
    id: str
    kind: str
    owner_id: str | None
    name: str
    x: float
    y: float
    z: float
    target_x: float
    target_z: float
    speed: float = 7.5
    hp: int = 100
    max_hp: int = 100
    resource: str = ""
    amount: int = 0
    respawn_ms: int = 0
    state: str = "idle"
    flags: int = 0


@dataclass
class Room:
    id: str
    sockets: set[WebSocket] = field(default_factory=set)
    socket_players: dict[WebSocket, str] = field(default_factory=dict)
    players: dict[str, Player] = field(default_factory=dict)
    entities: dict[str, Entity] = field(default_factory=dict)
    tick: int = 0
    created_ms: int = 0
    last_active_ms: int = 0
    last_net_tick: int = 0


rooms: dict[str, Room] = {}


def now_ms() -> int:
    return int(time.time() * 1000)


def stable_hash(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def clean_str(value: Any, n: int) -> str:
    return str(value).strip()[:n]


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def r2(v: float) -> float:
    return round(float(v), 2)


def get_or_create_room(room_id: str) -> Room:
    room = rooms.get(room_id)
    if room:
        return room

    t = now_ms()
    room = Room(id=room_id, created_ms=t, last_active_ms=t)
    seed_room(room)
    rooms[room_id] = room
    return room


def seed_room(room: Room):
    nodes = [
        ("node:salt:1", "salt_node", "Salt Patch", -42, 0, -24, "salt", 25),
        ("node:salt:2", "salt_node", "Salt Patch", 28, 0, -42, "salt", 25),
        ("node:ore:1", "ore_node", "Scrap Ore", -12, 0, 46, "ore", 20),
        ("node:ore:2", "ore_node", "Scrap Ore", 58, 0, 26, "ore", 20),
        ("node:radio:1", "radio_tower", "Dead Radio", 0, 0, -68, "signal_parts", 10),
        ("npc:trader:1", "npc", "Junk Trader", 38, 0, 10, "", 0),
        ("enemy:drone:1", "enemy", "Rust Drone", -55, 0, 44, "", 0),
    ]

    for eid, kind, name, x, y, z, resource, amount in nodes:
        hp = 35 if kind == "enemy" else 1
        room.entities[eid] = Entity(
            id=eid,
            kind=kind,
            owner_id=None,
            name=name,
            x=float(x),
            y=float(y),
            z=float(z),
            target_x=float(x),
            target_z=float(z),
            speed=3.0 if kind == "enemy" else 0.0,
            hp=hp,
            max_hp=hp,
            resource=resource,
            amount=amount,
            state="idle",
        )


def cleanup_empty_rooms():
    t = now_ms()

    for room_id, room in list(rooms.items()):
        if room.sockets:
            continue

        if t - room.last_active_ms >= EMPTY_ROOM_TTL_MS:
            rooms.pop(room_id, None)


def make_player_entity(player_id: str, name: str) -> Entity:
    h = stable_hash(player_id)
    x = float((h % 60) - 30)
    z = float(((h // 60) % 60) - 30)

    return Entity(
        id=f"player:{player_id}",
        kind="player",
        owner_id=player_id,
        name=name,
        x=x,
        y=0.0,
        z=z,
        target_x=x,
        target_z=z,
        speed=8.0,
        hp=100,
        max_hp=100,
        state="idle",
    )


def step_entity(e: Entity, dt: float):
    if e.kind not in {"player", "enemy"}:
        return

    dx = e.target_x - e.x
    dz = e.target_z - e.z
    dist = math.hypot(dx, dz)

    if dist < 0.05:
        e.x = e.target_x
        e.z = e.target_z
        if e.state == "moving":
            e.state = "idle"
        return

    step = min(dist, e.speed * dt)
    e.x += (dx / dist) * step
    e.z += (dz / dist) * step
    e.state = "moving"

    e.x = clamp(e.x, WORLD_MIN, WORLD_MAX)
    e.z = clamp(e.z, WORLD_MIN, WORLD_MAX)


def distance(a: Entity, b: Entity) -> float:
    return math.hypot(a.x - b.x, a.z - b.z)


def pack_player(p: Player) -> list[Any]:
    return [p.id, p.name, p.color, p.entity_id, p.inventory]


def pack_entity(e: Entity) -> list[Any]:
    return [
        e.id,
        e.kind,
        e.owner_id,
        e.name,
        r2(e.x),
        r2(e.y),
        r2(e.z),
        r2(e.target_x),
        r2(e.target_z),
        e.hp,
        e.max_hp,
        e.resource,
        e.amount,
        e.state,
        e.flags,
    ]


def pack_delta(e: Entity) -> list[Any]:
    return [
        e.id,
        r2(e.x),
        r2(e.y),
        r2(e.z),
        r2(e.target_x),
        r2(e.target_z),
        e.hp,
        e.amount,
        e.state,
        e.flags,
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

            for e in list(room.entities.values()):
                step_entity(e, DT)

                if e.amount <= 0 and e.respawn_ms and t >= e.respawn_ms:
                    if e.resource == "salt":
                        e.amount = 25
                    elif e.resource == "ore":
                        e.amount = 20
                    elif e.resource == "signal_parts":
                        e.amount = 10
                    e.respawn_ms = 0
                    e.state = "idle"

            if room.tick - room.last_net_tick >= NET_INTERVAL_TICKS:
                room.last_net_tick = room.tick
                await broadcast(room, ["u", room.tick, [pack_delta(e) for e in room.entities.values()]])


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(sim_loop())
    yield
    task.cancel()


app = FastAPI(title="Rune Eye MMO-lite", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


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
    }


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    if not ROOM_RE.match(room_id):
        await ws.close(code=1008)
        return

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

                requested_room = clean_str(packet[1], 32)
                if requested_room != room_id:
                    await send(ws, ["e", "room_mismatch", requested_room])
                    continue

                pid = clean_str(packet[2], 80)
                if not pid:
                    await send(ws, ["e", "bad_player_id", "empty"])
                    continue

                if len(room.players) >= MAX_PLAYERS_PER_ROOM and pid not in room.players:
                    await send(ws, ["e", "room_full", str(MAX_PLAYERS_PER_ROOM)])
                    continue

                name = clean_str(packet[3], 24) or pid[:8]
                color = clean_str(packet[4], 32) or "#e8dcc0"

                player_id = pid

                entity = make_player_entity(pid, name)
                player = Player(
                    id=pid,
                    name=name,
                    color=color,
                    entity_id=entity.id,
                    inventory={"salt": 0, "ore": 0, "signal_parts": 0},
                    joined_ms=now_ms(),
                    last_seen_ms=now_ms(),
                )

                room.players[pid] = player
                room.entities[entity.id] = entity
                room.socket_players[ws] = pid

                await send(ws, [
                    "i",
                    room.id,
                    room.tick,
                    pid,
                    [pack_player(p) for p in room.players.values()],
                    [pack_entity(e) for e in room.entities.values()],
                ])

                await broadcast(room, ["ev", room.tick, "join", [pack_player(player), pack_entity(entity)]], exclude=ws)
                continue

            if kind == "move":
                if len(packet) < 4:
                    await send(ws, ["e", "bad_move", "requires ['move', seq, x, z]"])
                    continue

                if not player_id or player_id not in room.players:
                    await send(ws, ["e", "not_joined", "join first"])
                    continue

                player = room.players[player_id]
                entity = room.entities.get(player.entity_id)
                if not entity:
                    continue

                entity.target_x = clamp(float(packet[2]), WORLD_MIN, WORLD_MAX)
                entity.target_z = clamp(float(packet[3]), WORLD_MIN, WORLD_MAX)
                entity.state = "moving"
                player.last_seen_ms = now_ms()
                continue

            if kind == "act":
                if len(packet) < 3:
                    await send(ws, ["e", "bad_act", "requires ['act', seq, targetId]"])
                    continue

                if not player_id or player_id not in room.players:
                    await send(ws, ["e", "not_joined", "join first"])
                    continue

                player = room.players[player_id]
                actor = room.entities.get(player.entity_id)
                target = room.entities.get(clean_str(packet[2], 96))

                if not actor or not target:
                    await send(ws, ["e", "bad_target", clean_str(packet[2], 96)])
                    continue

                if distance(actor, target) > 5.0:
                    actor.target_x = target.x
                    actor.target_z = target.z
                    actor.state = "moving"
                    await send(ws, ["ev", room.tick, "too_far", target.id])
                    continue

                if target.kind in {"salt_node", "ore_node", "radio_tower"}:
                    if target.amount <= 0:
                        await send(ws, ["ev", room.tick, "depleted", target.id])
                        continue

                    item = target.resource
                    target.amount -= 1
                    target.state = "used" if target.amount <= 0 else "idle"

                    if target.amount <= 0:
                        target.respawn_ms = now_ms() + 15_000

                    player.inventory[item] = player.inventory.get(item, 0) + 1

                    await send(ws, ["inv", player.inventory])
                    await broadcast(room, ["ev", room.tick, "gather", [player.id, target.id, item, player.inventory[item]]])
                    continue

                if target.kind == "enemy":
                    target.hp -= 10

                    await broadcast(room, ["ev", room.tick, "hit", [player.id, target.id, 10, max(0, target.hp)]])

                    if target.hp <= 0:
                        player.inventory["ore"] = player.inventory.get("ore", 0) + 3
                        target.hp = target.max_hp
                        target.x = -55
                        target.z = 44
                        target.target_x = target.x
                        target.target_z = target.z
                        await send(ws, ["inv", player.inventory])
                        await broadcast(room, ["ev", room.tick, "loot", [player.id, "ore", 3]])
                    continue

                if target.kind == "npc":
                    await send(ws, ["ev", room.tick, "talk", ["Junk Trader", "Bring me salt, ore, and signal parts. This place still hums at night."]])
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
                await broadcast(room, ["chat", room.tick, player.id, player.name, text, now_ms()])
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
  <title>Rune Eye</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0b0e0a;
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
      left: 10px;
      top: 10px;
      background: rgba(12, 14, 10, 0.82);
      border: 1px solid #4b5638;
      padding: 9px 10px;
      font-size: 12px;
      line-height: 1.45;
      z-index: 10;
      min-width: 250px;
      max-width: calc(100vw - 30px);
    }

    #hud input {
      width: 100px;
      background: #151a12;
      color: #e8dcc0;
      border: 1px solid #4b5638;
      padding: 3px 5px;
    }

    #inventory {
      position: fixed;
      right: 10px;
      top: 10px;
      background: rgba(12, 14, 10, 0.82);
      border: 1px solid #4b5638;
      padding: 9px 10px;
      font-size: 12px;
      line-height: 1.5;
      z-index: 10;
      min-width: 155px;
    }

    #chat {
      position: fixed;
      left: 10px;
      bottom: 10px;
      width: min(390px, calc(100vw - 20px));
      background: rgba(12, 14, 10, 0.82);
      border: 1px solid #4b5638;
      padding: 9px;
      font-size: 12px;
      z-index: 10;
      box-sizing: border-box;
    }

    #chatlog {
      height: 95px;
      overflow: auto;
      white-space: pre-wrap;
      margin-bottom: 7px;
    }

    #chatinput {
      width: 100%;
      box-sizing: border-box;
      background: #151a12;
      color: #e8dcc0;
      border: 1px solid #4b5638;
      padding: 7px 8px;
    }

    #action {
      position: fixed;
      right: 10px;
      bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 10;
    }

    button {
      background: #2a3322;
      color: #e8dcc0;
      border: 1px solid #647246;
      padding: 12px 14px;
      font-size: 14px;
      border-radius: 6px;
    }

    #toast {
      position: fixed;
      left: 50%;
      top: 68px;
      transform: translateX(-50%);
      background: rgba(12, 14, 10, 0.88);
      border: 1px solid #7a6b3a;
      padding: 8px 12px;
      font-size: 13px;
      display: none;
      z-index: 20;
      max-width: calc(100vw - 40px);
      text-align: center;
    }

    @media (max-width: 700px) {
      #hud {
        font-size: 11px;
        min-width: 210px;
      }

      #inventory {
        top: auto;
        right: 10px;
        bottom: 92px;
        font-size: 11px;
      }

      #chat {
        height: 132px;
      }

      #chatlog {
        height: 72px;
      }

      button {
        padding: 11px 12px;
      }
    }
  </style>
</head>
<body>
  <div id="hud">
    <div><b>Rune Eye mobile MMO-lite</b></div>
    <div>Room: <input id="room" value="main"></div>
    <div>Player: <span id="player"></span></div>
    <div>Status: <span id="status">idle</span></div>
    <div>Players: <span id="count">0</span></div>
    <div>Tick: <span id="tick">0</span></div>
    <div>Target: <span id="target">none</span></div>
    <div>Tap ground to move. Tap thing to select.</div>
  </div>

  <div id="inventory">
    <b>Inventory</b>
    <div>Salt: <span id="salt">0</span></div>
    <div>Ore: <span id="ore">0</span></div>
    <div>Signal parts: <span id="signal_parts">0</span></div>
  </div>

  <div id="chat">
    <div id="chatlog"></div>
    <input id="chatinput" placeholder="chat..." maxlength="240">
  </div>

  <div id="action">
    <button id="actbtn">Interact</button>
    <button id="cambtn">Camera</button>
  </div>

  <div id="toast"></div>

<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const PROTOCOL_VERSION = 1;

const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playerEl = document.getElementById("player");
const roomInput = document.getElementById("room");
const tickEl = document.getElementById("tick");
const targetEl = document.getElementById("target");
const chatLogEl = document.getElementById("chatlog");
const chatInputEl = document.getElementById("chatinput");
const toastEl = document.getElementById("toast");
const actBtn = document.getElementById("actbtn");
const camBtn = document.getElementById("cambtn");

const invEls = {
  salt: document.getElementById("salt"),
  ore: document.getElementById("ore"),
  signal_parts: document.getElementById("signal_parts"),
};

let ws = null;
let players = new Map();
let entities = new Map();
let meshes = new Map();

let selectedId = null;
let cameraYaw = Math.PI / 4;
let cameraDistance = 92;
let cameraHeight = 62;
let dragging = false;
let lastPointer = null;
let lastTapTime = 0;

let me = {
  id: localStorage.getItem("runeEyePlayerId"),
  name: "",
  color: "",
  entityId: "",
};

if (!me.id) {
  me.id = crypto.randomUUID();
  localStorage.setItem("runeEyePlayerId", me.id);
}

me.name = "P-" + me.id.slice(0, 6);
me.color = colorFromId(me.id);
me.entityId = "player:" + me.id;

playerEl.textContent = me.name + " / " + me.id.slice(0, 8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e0a);
scene.fog = new THREE.Fog(0x0b0e0a, 140, 260);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const sun = new THREE.DirectionalLight(0xfff5d0, 2.4);
sun.position.set(80, 120, 60);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x7f8b70, 1.25));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x1a2014, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.name = "ground";
scene.add(ground);

const grid = new THREE.GridHelper(240, 48, 0x596641, 0x29321f);
grid.position.y = 0.02;
scene.add(grid);

addWorldProps();

window.addEventListener("resize", resize);
resize();

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("wheel", event => {
  cameraDistance = clamp(cameraDistance + event.deltaY * 0.05, 42, 140);
});

roomInput.addEventListener("change", connect);

chatInputEl.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  const text = chatInputEl.value.trim();
  if (!text) return;
  send(["chat", text]);
  chatInputEl.value = "";
});

actBtn.addEventListener("click", () => {
  if (!selectedId) {
    toast("select something first");
    return;
  }
  send(["act", Date.now(), selectedId]);
});

camBtn.addEventListener("click", () => {
  cameraYaw += Math.PI / 2;
});

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 62%)`;
}

function hslToColor(hsl) {
  return new THREE.Color(hsl);
}

function connect() {
  if (ws) ws.close();

  players.clear();
  entities.clear();
  selectedId = null;

  meshes.forEach(mesh => scene.remove(mesh));
  meshes.clear();

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
    let packet;
    try {
      packet = JSON.parse(event.data);
    } catch {
      return;
    }
    applyPacket(packet);
  };

  ws.onclose = event => {
    statusEl.textContent = "closed " + event.code;
  };

  ws.onerror = () => {
    statusEl.textContent = "error";
  };
}

function send(packet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(packet));
}

function applyPacket(packet) {
  if (!Array.isArray(packet) || packet.length === 0) return;

  const type = packet[0];

  if (type === "h") {
    return;
  }

  if (type === "i") {
    tickEl.textContent = String(packet[2] || 0);

    for (const pRaw of packet[4] || []) {
      const p = unpackPlayer(pRaw);
      players.set(p.id, p);
      if (p.id === me.id) updateInventory(p.inventory);
    }

    for (const eRaw of packet[5] || []) {
      const e = unpackEntity(eRaw);
      entities.set(e.id, e);
      ensureMesh(e);
    }

    countEl.textContent = String(players.size);
    return;
  }

  if (type === "u") {
    tickEl.textContent = String(packet[1]);

    for (const dRaw of packet[2] || []) {
      const d = unpackDelta(dRaw);
      let e = entities.get(d.id);

      if (!e) {
        e = makePlaceholderEntity(d.id);
        entities.set(e.id, e);
        ensureMesh(e);
      }

      Object.assign(e, d);
      updateMeshState(e);
    }

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
      countEl.textContent = String(players.size);
      addChatLine("system", p.name + " joined");
      return;
    }

    if (kind === "gather") {
      const playerId = payload[0];
      const item = payload[2];
      const count = payload[3];
      const p = players.get(playerId);
      toast((p?.name || "player") + " gathered " + item + " x" + count);
      return;
    }

    if (kind === "hit") {
      toast("hit " + payload[1] + " -" + payload[2]);
      return;
    }

    if (kind === "loot") {
      toast("loot: " + payload[1] + " x" + payload[2]);
      return;
    }

    if (kind === "talk") {
      addChatLine(payload[0], payload[1]);
      toast(payload[0] + ": " + payload[1]);
      return;
    }

    if (kind === "too_far") {
      toast("moving closer");
      return;
    }

    if (kind === "depleted") {
      toast("depleted");
      return;
    }
  }

  if (type === "inv") {
    updateInventory(packet[1] || {});
    return;
  }

  if (type === "chat") {
    addChatLine(packet[3] || packet[2], packet[4] || "");
    return;
  }

  if (type === "l") {
    const pid = packet[1];
    const eid = packet[2];

    players.delete(pid);
    entities.delete(eid);

    const mesh = meshes.get(eid);
    if (mesh) {
      scene.remove(mesh);
      meshes.delete(eid);
    }

    countEl.textContent = String(players.size);
    addChatLine("system", pid.slice(0, 8) + " left");
    return;
  }

  if (type === "e") {
    toast(packet[1] + " " + (packet[2] || ""));
  }
}

function unpackPlayer(a) {
  return {
    id: a[0],
    name: a[1],
    color: a[2],
    entityId: a[3],
    inventory: a[4] || {},
  };
}

function unpackEntity(a) {
  return {
    id: a[0],
    kind: a[1],
    ownerId: a[2],
    name: a[3],
    x: a[4],
    y: a[5],
    z: a[6],
    targetX: a[7],
    targetZ: a[8],
    hp: a[9],
    maxHp: a[10],
    resource: a[11],
    amount: a[12],
    state: a[13],
    flags: a[14],
  };
}

function unpackDelta(a) {
  return {
    id: a[0],
    x: a[1],
    y: a[2],
    z: a[3],
    targetX: a[4],
    targetZ: a[5],
    hp: a[6],
    amount: a[7],
    state: a[8],
    flags: a[9],
  };
}

function makePlaceholderEntity(id) {
  return {
    id,
    kind: id.startsWith("player:") ? "player" : "unknown",
    ownerId: id.startsWith("player:") ? id.slice("player:".length) : null,
    name: id,
    x: 0,
    y: 0,
    z: 0,
    targetX: 0,
    targetZ: 0,
    hp: 1,
    maxHp: 1,
    resource: "",
    amount: 0,
    state: "idle",
    flags: 0,
  };
}

function updateInventory(inv) {
  invEls.salt.textContent = String(inv.salt || 0);
  invEls.ore.textContent = String(inv.ore || 0);
  invEls.signal_parts.textContent = String(inv.signal_parts || 0);
}

function addChatLine(name, text) {
  chatLogEl.textContent += `${name}: ${text}\\n`;
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.style.display = "none", 1800);
}

function onPointerDown(event) {
  dragging = true;
  lastPointer = { x: event.clientX, y: event.clientY, t: performance.now() };
}

function onPointerMove(event) {
  if (!dragging || !lastPointer) return;

  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;

  if (Math.abs(dx) > 3) {
    cameraYaw -= dx * 0.005;
  }

  if (Math.abs(dy) > 3 && event.pointerType === "mouse" && event.buttons === 2) {
    cameraHeight = clamp(cameraHeight + dy * 0.15, 38, 95);
  }

  lastPointer.x = event.clientX;
  lastPointer.y = event.clientY;
}

function onPointerUp(event) {
  const wasDrag = lastPointer && Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 8;
  dragging = false;

  if (wasDrag) return;

  const now = performance.now();
  if (now - lastTapTime < 120) return;
  lastTapTime = now;

  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const clickable = [...meshes.values(), ground];
  const hits = raycaster.intersectObjects(clickable, true);

  if (!hits.length) return;

  const hit = hits[0];
  const root = findRootMesh(hit.object);

  if (root && root.userData.entityId) {
    selectedId = root.userData.entityId;
    const e = entities.get(selectedId);
    targetEl.textContent = e ? `${e.name} (${e.kind})` : selectedId;

    if (e && e.kind === "player" && e.ownerId === me.id) return;

    send(["act", Date.now(), selectedId]);
    return;
  }

  const p = hit.point;
  selectedId = null;
  targetEl.textContent = "ground";
  send(["move", Date.now(), p.x, p.z]);
}

function findRootMesh(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData && cur.userData.entityId) return cur;
    cur = cur.parent;
  }
  return null;
}

function ensureMesh(e) {
  if (meshes.has(e.id)) return meshes.get(e.id);

  let mesh;

  if (e.kind === "player") {
    mesh = makePlayerMesh(e);
  } else if (e.kind === "salt_node") {
    mesh = makeNodeMesh(e, 0xc8b878);
  } else if (e.kind === "ore_node") {
    mesh = makeNodeMesh(e, 0x77736a);
  } else if (e.kind === "radio_tower") {
    mesh = makeTowerMesh(e);
  } else if (e.kind === "npc") {
    mesh = makeNpcMesh(e);
  } else if (e.kind === "enemy") {
    mesh = makeEnemyMesh(e);
  } else {
    mesh = makeNodeMesh(e, 0xffffff);
  }

  mesh.position.set(e.x, e.y, e.z);
  mesh.userData.entityId = e.id;
  meshes.set(e.id, mesh);
  scene.add(mesh);

  return mesh;
}

function makePlayerMesh(e) {
  const group = new THREE.Group();
  const color = hslToColor(players.get(e.ownerId)?.color || colorFromId(e.ownerId || e.id));

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 3.6, 1.4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
  body.position.y = 1.8;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xd8bd8a, roughness: 0.9 })
  );
  head.position.y = 4.1;
  group.add(head);

  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 2.0, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x323820, roughness: 1 })
  );
  pack.position.set(0, 2.2, 0.95);
  group.add(pack);

  return group;
}

function makeNodeMesh(e, color) {
  const group = new THREE.Group();

  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(2.1, 0),
    new THREE.MeshStandardMaterial({ color, roughness: 1 })
  );
  rock.position.y = 1.5;
  rock.scale.set(1.5, 0.8, 1.2);
  group.add(rock);

  return group;
}

function makeTowerMesh(e) {
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({ color: 0x54606a, roughness: 0.8 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 11, 6), mat);
  pole.position.y = 5.5;
  group.add(pole);

  const dish = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 16), mat);
  dish.position.set(0, 9.3, 0.8);
  dish.rotation.x = Math.PI / 2;
  group.add(dish);

  return group;
}

function makeNpcMesh(e) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 3.2, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x8a6b32, roughness: 0.9 })
  );
  body.position.y = 1.6;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.2, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xc6a16d, roughness: 0.9 })
  );
  head.position.y = 3.9;
  group.add(head);

  return group;
}

function makeEnemyMesh(e) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.2, 0),
    new THREE.MeshStandardMaterial({ color: 0x813a2d, roughness: 0.8 })
  );
  body.position.y = 2.2;
  group.add(body);

  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.4, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffc15a, roughness: 0.5 })
  );
  eye.position.set(0, 2.5, 1.9);
  group.add(eye);

  return group;
}

function updateMeshState(e) {
  const mesh = ensureMesh(e);

  mesh.position.x = lerp(mesh.position.x, e.x, 0.35);
  mesh.position.y = e.y;
  mesh.position.z = lerp(mesh.position.z, e.z, 0.35);

  const dx = e.targetX - e.x;
  const dz = e.targetZ - e.z;
  if (Math.hypot(dx, dz) > 0.1) {
    mesh.rotation.y = Math.atan2(dx, dz);
  }

  mesh.visible = e.amount !== 0 || e.kind === "player" || e.kind === "npc" || e.kind === "enemy";
}

function addWorldProps() {
  const matA = new THREE.MeshStandardMaterial({ color: 0x263018, roughness: 1 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x3a3321, roughness: 1 });

  for (let i = 0; i < 55; i++) {
    const h = stableRand(i * 9281) * 4 + 2;
    const x = stableRand(i * 17 + 4) * 230 - 115;
    const z = stableRand(i * 29 + 8) * 230 - 115;

    if (Math.hypot(x, z) < 18) continue;

    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(stableRand(i + 2) * 1.8 + 0.6, 0),
      i % 2 ? matA : matB
    );
    rock.position.set(x, h * 0.18, z);
    rock.scale.y = stableRand(i + 5) * 0.8 + 0.4;
    scene.add(rock);
  }
}

function stableRand(n) {
  const x = Math.sin(n * 999.123) * 10000;
  return x - Math.floor(x);
}

function getMeEntity() {
  return entities.get(me.entityId);
}

function updateCamera() {
  const e = getMeEntity();

  const focusX = e ? e.x : 0;
  const focusZ = e ? e.z : 0;

  const cx = focusX + Math.sin(cameraYaw) * cameraDistance;
  const cz = focusZ + Math.cos(cameraYaw) * cameraDistance;

  camera.position.set(cx, cameraHeight, cz);
  camera.lookAt(focusX, 0, focusZ);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function frame() {
  for (const e of entities.values()) {
    updateMeshState(e);
  }

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