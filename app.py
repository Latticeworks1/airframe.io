import asyncio
import json
import math
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse


SERVER_HZ = 30
DT = 1.0 / SERVER_HZ


rooms: dict[str, set[WebSocket]] = {}
room_players: dict[str, dict[str, dict[str, Any]]] = {}
room_inputs: dict[str, dict[str, dict[str, Any]]] = {}
room_ticks: dict[str, int] = {}


async def tick_loop():
    while True:
        await asyncio.sleep(DT)

        for room_id in list(rooms.keys()):
            if not rooms.get(room_id):
                continue

            players = room_players.get(room_id, {})
            inputs = room_inputs.get(room_id, {})

            if not players:
                continue

            room_ticks[room_id] = room_ticks.get(room_id, 0) + 1
            tick = room_ticks[room_id]

            updates = []

            for pid, player in players.items():
                inp = inputs.get(pid, default_input(pid))
                step_player(player, inp, DT)
                updates.append(pack_state(player))

            await broadcast(room_id, ["u", tick, updates])


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(tick_loop())
    yield
    task.cancel()


app = FastAPI(title="airframe.io", lifespan=lifespan)

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
        "meteredDomain": METERED_DOMAIN,
        "turnTtlSeconds": TURN_TTL_SECONDS,
        "activeRooms": len(rooms),
        "serverHz": SERVER_HZ,
    }


@app.get("/ice")
async def ice():
    label = f"airframe-{int(time.time())}-{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        created = await client.post(
            f"https://{METERED_DOMAIN}/api/v1/turn/credential",
            params={"secretKey": METERED_SECRET_KEY},
            json={
                "label": label,
                "expiryInSeconds": TURN_TTL_SECONDS,
            },
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
                detail={
                    "error": "Metered response missing apiKey",
                    "response": credential,
                },
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
            detail={
                "error": "Metered returned invalid ICE server list",
                "response": ice_servers,
            },
        )

    return {
        "iceServers": ice_servers,
        "ttlSeconds": TURN_TTL_SECONDS,
        "label": label,
    }


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    await ws.accept()

    room = rooms.setdefault(room_id, set())
    players = room_players.setdefault(room_id, {})
    inputs = room_inputs.setdefault(room_id, {})
    room_ticks.setdefault(room_id, 0)

    room.add(ws)
    player_id: str | None = None

    await send(ws, ["c", room_id, now_ms()])

    try:
        while True:
            raw = await ws.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send(ws, ["e", "invalid json"])
                continue

            if not isinstance(msg, list) or not msg:
                await send(ws, ["e", "packet must be a non-empty array"])
                continue

            kind = msg[0]

            if kind == "j":
                if len(msg) < 4:
                    await send(ws, ["e", "join packet requires ['j', id, name, color]"])
                    continue

                player_id = str(msg[1])
                name = str(msg[2])
                color = str(msg[3])

                player = make_player(player_id, name, color)
                players[player_id] = player
                inputs[player_id] = default_input(player_id)

                await send(ws, ["i", room_id, room_ticks.get(room_id, 0), [pack_player(p) for p in players.values()]])
                await broadcast(room_id, ["j", pack_player(player)], exclude=ws)
                continue

            if kind == "in":
                if len(msg) < 8:
                    await send(ws, ["e", "input packet requires ['in', id, seq, throttle, yaw, pitch, roll, fire]"])
                    continue

                pid = str(msg[1])

                if pid not in players:
                    await send(ws, ["e", f"unknown player id: {pid}"])
                    continue

                inputs[pid] = {
                    "id": pid,
                    "seq": int(msg[2]),
                    "throttle": clamp(float(msg[3]), -1.0, 1.0),
                    "yaw": clamp(float(msg[4]), -1.0, 1.0),
                    "pitch": clamp(float(msg[5]), -1.0, 1.0),
                    "roll": clamp(float(msg[6]), -1.0, 1.0),
                    "fire": 1 if msg[7] else 0,
                }
                continue

            await broadcast(room_id, msg, exclude=ws)

    except WebSocketDisconnect:
        pass

    except Exception as exc:
        await broadcast(room_id, ["e", str(exc)], exclude=ws)

    finally:
        room.discard(ws)

        if player_id:
            players.pop(player_id, None)
            inputs.pop(player_id, None)
            await broadcast(room_id, ["l", player_id])

        if not room:
            rooms.pop(room_id, None)
            room_players.pop(room_id, None)
            room_inputs.pop(room_id, None)
            room_ticks.pop(room_id, None)


def make_player(pid: str, name: str, color: str) -> dict[str, Any]:
    spawn = (hash(pid) % 800) - 400

    return {
        "id": pid,
        "name": name,
        "color": color,
        "x": float(spawn),
        "y": 140.0,
        "z": float(-spawn),
        "vx": 0.0,
        "vy": 0.0,
        "vz": 120.0,
        "yaw": 0.0,
        "pitch": 0.0,
        "roll": 0.0,
        "throttleLevel": 0.45,
        "ack": 0,
    }


def default_input(pid: str) -> dict[str, Any]:
    return {
        "id": pid,
        "seq": 0,
        "throttle": 0.0,
        "yaw": 0.0,
        "pitch": 0.0,
        "roll": 0.0,
        "fire": 0,
    }


def step_player(p: dict[str, Any], inp: dict[str, Any], dt: float):
    p["ack"] = int(inp.get("seq", p.get("ack", 0)))

    throttle_input = float(inp.get("throttle", 0.0))
    yaw_input = float(inp.get("yaw", 0.0))
    pitch_input = float(inp.get("pitch", 0.0))
    roll_input = float(inp.get("roll", 0.0))

    p["throttleLevel"] = clamp(p["throttleLevel"] + throttle_input * dt * 0.65, 0.0, 1.0)

    yaw_rate = 1.45
    pitch_rate = 0.9
    roll_rate = 3.2

    p["yaw"] += yaw_input * yaw_rate * dt
    p["pitch"] = clamp(p["pitch"] + pitch_input * pitch_rate * dt, -0.75, 0.75)
    p["roll"] += roll_input * roll_rate * dt
    p["roll"] *= 0.94

    speed = 80.0 + p["throttleLevel"] * 240.0

    cp = math.cos(p["pitch"])
    sx = math.cos(p["yaw"]) * cp
    sy = math.sin(p["pitch"])
    sz = math.sin(p["yaw"]) * cp

    target_vx = sx * speed
    target_vy = sy * speed
    target_vz = sz * speed

    blend = 0.10

    p["vx"] += (target_vx - p["vx"]) * blend
    p["vy"] += (target_vy - p["vy"]) * blend
    p["vz"] += (target_vz - p["vz"]) * blend

    p["x"] += p["vx"] * dt
    p["y"] += p["vy"] * dt
    p["z"] += p["vz"] * dt

    p["x"] = wrap(p["x"], -1200.0, 1200.0)
    p["z"] = wrap(p["z"], -1200.0, 1200.0)

    if p["y"] < 35.0:
        p["y"] = 35.0
        p["vy"] = max(0.0, p["vy"])

    if p["y"] > 900.0:
        p["y"] = 900.0
        p["vy"] = min(0.0, p["vy"])


def pack_player(p: dict[str, Any]) -> list[Any]:
    return [
        p["id"],
        p["name"],
        p["color"],
        r3(p["x"]),
        r3(p["y"]),
        r3(p["z"]),
        r3(p["vx"]),
        r3(p["vy"]),
        r3(p["vz"]),
        r4(p["yaw"]),
        r4(p["pitch"]),
        r4(p["roll"]),
        int(p["ack"]),
    ]


def pack_state(p: dict[str, Any]) -> list[Any]:
    return [
        p["id"],
        int(p["ack"]),
        r3(p["x"]),
        r3(p["y"]),
        r3(p["z"]),
        r3(p["vx"]),
        r3(p["vy"]),
        r3(p["vz"]),
        r4(p["yaw"]),
        r4(p["pitch"]),
        r4(p["roll"]),
    ]


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def wrap(v: float, lo: float, hi: float) -> float:
    span = hi - lo
    while v < lo:
        v += span
    while v > hi:
        v -= span
    return v


def r3(v: float) -> float:
    return round(float(v), 3)


def r4(v: float) -> float:
    return round(float(v), 4)


def now_ms() -> int:
    return int(time.time() * 1000)


async def send(ws: WebSocket, msg: Any):
    await ws.send_text(json.dumps(msg, separators=(",", ":")))


async def broadcast(room_id: str, msg: Any, exclude: WebSocket | None = None):
    room = rooms.get(room_id)

    if not room:
        return

    payload = json.dumps(msg, separators=(",", ":"))
    dead = []

    for peer in list(room):
        if peer is exclude:
            continue

        try:
            await peer.send_text(payload)
        except Exception:
            dead.append(peer)

    for peer in dead:
        room.discard(peer)

    if not room:
        rooms.pop(room_id, None)
        room_players.pop(room_id, None)
        room_inputs.pop(room_id, None)
        room_ticks.pop(room_id, None)


INDEX_HTML = """
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>airframe.io</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #080d14;
      color: #e8dcc0;
      font-family: system-ui, sans-serif;
    }

    #hud {
      position: fixed;
      left: 14px;
      top: 12px;
      background: rgba(5, 7, 11, 0.78);
      border: 1px solid #2f3b52;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.45;
      min-width: 340px;
      z-index: 10;
    }

    #hud input {
      width: 120px;
      background: #111722;
      color: #e8dcc0;
      border: 1px solid #2f3b52;
      padding: 3px 5px;
    }

    #log {
      position: fixed;
      right: 14px;
      bottom: 12px;
      width: 460px;
      max-height: 170px;
      overflow: auto;
      background: rgba(5, 7, 11, 0.78);
      border: 1px solid #2f3b52;
      padding: 10px;
      font-size: 12px;
      white-space: pre-wrap;
      z-index: 10;
    }

    canvas {
      display: block;
    }
  </style>
</head>
<body>
  <div id="hud">
    <div><b>airframe.io 3D sync test</b></div>
    <div>Room: <input id="room" value="main"></div>
    <div>Player: <span id="player"></span></div>
    <div>Status: <span id="status">idle</span></div>
    <div>Players: <span id="count">0</span></div>
    <div>TX: <span id="tx">0</span> RX: <span id="rx">0</span></div>
    <div>Server tick: <span id="tick">0</span></div>
    <div>Controls: W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle</div>
  </div>

  <pre id="log"></pre>

<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playerEl = document.getElementById("player");
const roomInput = document.getElementById("room");
const logEl = document.getElementById("log");
const txEl = document.getElementById("tx");
const rxEl = document.getElementById("rx");
const tickEl = document.getElementById("tick");

const SERVER_HZ = 30;
const FIXED_DT = 1 / SERVER_HZ;

let ws = null;
let keys = new Set();
let players = new Map();
let meshes = new Map();
let pendingInputs = [];

let txPackets = 0;
let rxPackets = 0;
let inputSeq = 0;
let lastInputSend = 0;
let serverTick = 0;

let me = {
  id: localStorage.getItem("airframePlayerId"),
  name: "",
  color: "",
  x: 0,
  y: 140,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 120,
  yaw: 0,
  pitch: 0,
  roll: 0,
  throttleLevel: 0.45,
  ack: 0
};

if (!me.id) {
  me.id = crypto.randomUUID();
  localStorage.setItem("airframePlayerId", me.id);
}

me.name = "P-" + me.id.slice(0, 6);
me.color = colorFromId(me.id);
playerEl.textContent = me.name + " / " + me.id.slice(0, 8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080d14);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 2.2);
light.position.set(200, 600, 300);
scene.add(light);

scene.add(new THREE.AmbientLight(0x8899aa, 0.9));

const grid = new THREE.GridHelper(2400, 48, 0x3c4a66, 0x1d2738);
grid.position.y = 0;
scene.add(grid);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 2400),
  new THREE.MeshStandardMaterial({ color: 0x0f1722, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.5;
scene.add(floor);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", event => keys.add(event.key.toLowerCase()));
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
roomInput.addEventListener("change", connect);

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360}, 70%, 65%)`;
}

function log(msg) {
  logEl.textContent += msg + "\\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function connect() {
  if (ws) ws.close();

  players.clear();
  meshes.forEach(m => scene.remove(m));
  meshes.clear();
  pendingInputs = [];
  inputSeq = 0;

  const room = roomInput.value.trim() || "main";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/ws/${encodeURIComponent(room)}`;

  statusEl.textContent = "connecting";
  log("connecting " + url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    statusEl.textContent = "connected";
    log("connected");
    send(["j", me.id, me.name, me.color]);
  };

  ws.onmessage = event => {
    rxPackets++;
    rxEl.textContent = String(rxPackets);

    let packet;

    try {
      packet = JSON.parse(event.data);
    } catch {
      log("bad json: " + event.data);
      return;
    }

    applyPacket(packet);
  };

  ws.onclose = event => {
    statusEl.textContent = "closed " + event.code;
    log("closed " + event.code);
  };

  ws.onerror = () => {
    statusEl.textContent = "error";
    log("websocket error");
  };
}

function send(packet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify(packet));
  txPackets++;
  txEl.textContent = String(txPackets);
}

function applyPacket(packet) {
  if (!Array.isArray(packet) || packet.length === 0) return;

  const type = packet[0];

  if (type === "c") {
    log("connected to room " + packet[1]);
    return;
  }

  if (type === "i") {
    const list = packet[3] || [];
    serverTick = packet[2] || 0;
    tickEl.textContent = String(serverTick);

    for (const packed of list) {
      const p = unpackPlayer(packed);
      players.set(p.id, p);
      ensureMesh(p);
      if (p.id === me.id) reconcile(p);
    }

    countEl.textContent = String(players.size);
    return;
  }

  if (type === "j") {
    const p = unpackPlayer(packet[1]);
    players.set(p.id, p);
    ensureMesh(p);
    countEl.textContent = String(players.size);
    return;
  }

  if (type === "u") {
    serverTick = packet[1];
    tickEl.textContent = String(serverTick);

    const updates = packet[2] || [];

    for (const packed of updates) {
      const s = unpackState(packed);
      let p = players.get(s.id);

      if (!p) {
        p = {
          id: s.id,
          name: s.id.slice(0, 6),
          color: "#e8dcc0",
          throttleLevel: 0.45
        };
        players.set(s.id, p);
        ensureMesh(p);
      }

      Object.assign(p, s);

      if (s.id === me.id) {
        reconcile(p);
      }
    }

    countEl.textContent = String(players.size);
    return;
  }

  if (type === "l") {
    const id = packet[1];
    players.delete(id);

    const mesh = meshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      meshes.delete(id);
    }

    countEl.textContent = String(players.size);
    return;
  }

  if (type === "e") {
    log("server error: " + packet[1]);
  }
}

function unpackPlayer(a) {
  return {
    id: a[0],
    name: a[1],
    color: a[2],
    x: a[3],
    y: a[4],
    z: a[5],
    vx: a[6],
    vy: a[7],
    vz: a[8],
    yaw: a[9],
    pitch: a[10],
    roll: a[11],
    ack: a[12],
    throttleLevel: 0.45
  };
}

function unpackState(a) {
  return {
    id: a[0],
    ack: a[1],
    x: a[2],
    y: a[3],
    z: a[4],
    vx: a[5],
    vy: a[6],
    vz: a[7],
    yaw: a[8],
    pitch: a[9],
    roll: a[10]
  };
}

function getInput() {
  let throttle = 0;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;

  if (keys.has("shift")) throttle += 1;
  if (keys.has("control")) throttle -= 1;

  if (keys.has("a") || keys.has("arrowleft")) yaw += 1;
  if (keys.has("d") || keys.has("arrowright")) yaw -= 1;

  if (keys.has("w") || keys.has("arrowup")) pitch += 1;
  if (keys.has("s") || keys.has("arrowdown")) pitch -= 1;

  if (keys.has("q")) roll += 1;
  if (keys.has("e")) roll -= 1;

  return {
    seq: ++inputSeq,
    throttle,
    yaw,
    pitch,
    roll,
    fire: keys.has(" ")
  };
}

function reconcile(authoritative) {
  const ack = authoritative.ack || 0;

  pendingInputs = pendingInputs.filter(input => input.seq > ack);

  me.x = authoritative.x;
  me.y = authoritative.y;
  me.z = authoritative.z;
  me.vx = authoritative.vx;
  me.vy = authoritative.vy;
  me.vz = authoritative.vz;
  me.yaw = authoritative.yaw;
  me.pitch = authoritative.pitch;
  me.roll = authoritative.roll;
  me.ack = authoritative.ack;

  for (const input of pendingInputs) {
    simulate(me, input, FIXED_DT);
  }

  players.set(me.id, me);
}

function simulate(p, input, dt) {
  p.throttleLevel = clamp((p.throttleLevel ?? 0.45) + input.throttle * dt * 0.65, 0, 1);

  p.yaw += input.yaw * 1.45 * dt;
  p.pitch = clamp(p.pitch + input.pitch * 0.9 * dt, -0.75, 0.75);
  p.roll += input.roll * 3.2 * dt;
  p.roll *= 0.94;

  const speed = 80 + p.throttleLevel * 240;

  const cp = Math.cos(p.pitch);
  const fx = Math.cos(p.yaw) * cp;
  const fy = Math.sin(p.pitch);
  const fz = Math.sin(p.yaw) * cp;

  const tx = fx * speed;
  const ty = fy * speed;
  const tz = fz * speed;

  const blend = 0.10;

  p.vx += (tx - p.vx) * blend;
  p.vy += (ty - p.vy) * blend;
  p.vz += (tz - p.vz) * blend;

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  p.x = wrap(p.x, -1200, 1200);
  p.z = wrap(p.z, -1200, 1200);

  if (p.y < 35) {
    p.y = 35;
    p.vy = Math.max(0, p.vy);
  }

  if (p.y > 900) {
    p.y = 900;
    p.vy = Math.min(0, p.vy);
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

function ensureMesh(p) {
  if (meshes.has(p.id)) return meshes.get(p.id);

  const group = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.color || "#e8dcc0"),
    roughness: 0.7,
    metalness: 0.1
  });

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(8, 34, 4),
    material
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(36, 2, 8),
    material
  );
  wing.position.z = -2;
  group.add(wing);

  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(14, 2, 8),
    material
  );
  tail.position.z = -15;
  group.add(tail);

  const label = document.createElement("canvas");

  meshes.set(p.id, group);
  scene.add(group);

  return group;
}

function updateMeshes() {
  for (const [id, p] of players.entries()) {
    const mesh = ensureMesh(p);

    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = -p.yaw + Math.PI / 2;
    mesh.rotation.x = p.pitch;
    mesh.rotation.z = p.roll;
  }
}

function updateCamera() {
  const p = me;

  const back = 170;
  const up = 75;

  const fx = Math.cos(p.yaw) * Math.cos(p.pitch);
  const fz = Math.sin(p.yaw) * Math.cos(p.pitch);

  camera.position.x = p.x - fx * back;
  camera.position.y = p.y + up;
  camera.position.z = p.z - fz * back;

  camera.lookAt(p.x, p.y + 18, p.z);
}

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (now - lastInputSend > 1000 / SERVER_HZ) {
    lastInputSend = now;

    const input = getInput();
    pendingInputs.push(input);

    simulate(me, input, FIXED_DT);
    players.set(me.id, me);

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