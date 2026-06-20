import json
import os
import time
import uuid
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse


app = FastAPI(title="airframe.io")

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


rooms: dict[str, set[WebSocket]] = {}
room_players: dict[str, dict[str, dict[str, Any]]] = {}


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

    bad = [
        i for i, server in enumerate(ice_servers)
        if not isinstance(server, dict) or "urls" not in server
    ]

    if bad:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "Metered returned malformed ICE server entries",
                "badIndexes": bad,
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

    room.add(ws)
    player_id = None

    await send(ws, {
        "type": "connected",
        "room": room_id,
        "serverTime": time.time(),
    })

    try:
        while True:
            raw = await ws.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send(ws, {
                    "type": "error",
                    "error": "Invalid JSON",
                    "raw": raw,
                })
                continue

            msg_type = msg.get("type")

            if msg_type == "join":
                player_id = str(msg.get("id") or uuid.uuid4())
                name = str(msg.get("name") or player_id[:8])

                players[player_id] = {
                    "id": player_id,
                    "name": name,
                    "x": float(msg.get("x", 500)),
                    "y": float(msg.get("y", 350)),
                    "r": float(msg.get("r", 0)),
                    "color": str(msg.get("color", "#e8dcc0")),
                    "lastSeen": time.time(),
                }

                await broadcast_snapshot(room_id)
                continue

            if msg_type == "state":
                pid = str(msg.get("id") or "")

                if not pid:
                    await send(ws, {
                        "type": "error",
                        "error": "State message missing player id",
                    })
                    continue

                player_id = pid

                existing = players.get(pid, {
                    "id": pid,
                    "name": pid[:8],
                    "color": "#e8dcc0",
                })

                existing.update({
                    "x": float(msg.get("x", existing.get("x", 500))),
                    "y": float(msg.get("y", existing.get("y", 350))),
                    "r": float(msg.get("r", existing.get("r", 0))),
                    "lastSeen": time.time(),
                })

                if "name" in msg:
                    existing["name"] = str(msg["name"])

                if "color" in msg:
                    existing["color"] = str(msg["color"])

                players[pid] = existing

                await broadcast_snapshot(room_id)
                continue

            await broadcast(room_id, msg, exclude=ws)

    except WebSocketDisconnect:
        pass

    except Exception as exc:
        await broadcast(room_id, {
            "type": "peer-error",
            "room": room_id,
            "message": str(exc),
        }, exclude=ws)

    finally:
        room.discard(ws)

        if player_id:
            players.pop(player_id, None)

        if not room:
            rooms.pop(room_id, None)
            room_players.pop(room_id, None)
            return

        await broadcast_snapshot(room_id)


async def send(ws: WebSocket, msg: Any):
    await ws.send_text(json.dumps(msg))


async def broadcast(room_id: str, msg: Any, exclude: WebSocket | None = None):
    room = rooms.get(room_id)

    if not room:
        return

    dead = []
    payload = json.dumps(msg)

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


async def broadcast_snapshot(room_id: str):
    players = room_players.get(room_id, {})

    await broadcast(room_id, {
        "type": "snapshot",
        "room": room_id,
        "serverTime": time.time(),
        "players": list(players.values()),
    })


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
      background: #0c111a;
      color: #e8dcc0;
      font-family: system-ui, sans-serif;
    }

    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
    }

    #hud {
      position: fixed;
      left: 14px;
      top: 12px;
      background: rgba(5, 7, 11, 0.76);
      border: 1px solid #2f3b52;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.45;
      min-width: 290px;
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
      width: 360px;
      max-height: 160px;
      overflow: auto;
      background: rgba(5, 7, 11, 0.76);
      border: 1px solid #2f3b52;
      padding: 10px;
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>

  <div id="hud">
    <div><b>airframe.io room test</b></div>
    <div>Room: <input id="room" value="main"></div>
    <div>Player: <span id="player"></span></div>
    <div>Status: <span id="status">idle</span></div>
    <div>Players: <span id="count">0</span></div>
    <div>Controls: WASD / arrow keys</div>
  </div>

  <pre id="log"></pre>

<script>
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playerEl = document.getElementById("player");
const roomInput = document.getElementById("room");
const logEl = document.getElementById("log");

let ws = null;
let keys = new Set();
let players = new Map();

let me = {
  id: localStorage.getItem("airframePlayerId"),
  name: "",
  x: 500,
  y: 350,
  r: 0,
  color: ""
};

if (!me.id) {
  me.id = crypto.randomUUID();
  localStorage.setItem("airframePlayerId", me.id);
}

me.name = "P-" + me.id.slice(0, 6);
me.color = colorFromId(me.id);

playerEl.textContent = me.name + " / " + me.id.slice(0, 8);

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

function resize() {
  canvas.width = Math.floor(window.innerWidth * devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

window.addEventListener("resize", resize);
resize();

window.addEventListener("keydown", event => keys.add(event.key.toLowerCase()));
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));

roomInput.addEventListener("change", connect);

function connect() {
  if (ws) {
    ws.close();
  }

  const room = roomInput.value.trim() || "main";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/ws/${encodeURIComponent(room)}`;

  statusEl.textContent = "connecting";
  log("connecting " + url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    statusEl.textContent = "connected";
    log("connected");

    send({
      type: "join",
      id: me.id,
      name: me.name,
      x: me.x,
      y: me.y,
      r: me.r,
      color: me.color
    });
  };

  ws.onmessage = event => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      log("bad message: " + event.data);
      return;
    }

    if (msg.type === "snapshot") {
      players.clear();

      for (const p of msg.players) {
        players.set(p.id, p);
      }

      countEl.textContent = String(players.size);
    }

    if (msg.type === "error") {
      log("server error: " + JSON.stringify(msg));
    }
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

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(msg));
}

let lastSend = 0;

function update(dt) {
  const speed = 240;

  let ax = 0;
  let ay = 0;

  if (keys.has("w") || keys.has("arrowup")) ay -= 1;
  if (keys.has("s") || keys.has("arrowdown")) ay += 1;
  if (keys.has("a") || keys.has("arrowleft")) ax -= 1;
  if (keys.has("d") || keys.has("arrowright")) ax += 1;

  if (ax || ay) {
    const len = Math.hypot(ax, ay);
    ax /= len;
    ay /= len;

    me.x += ax * speed * dt;
    me.y += ay * speed * dt;
    me.r = Math.atan2(ay, ax);
  }

  me.x = Math.max(24, Math.min(window.innerWidth - 24, me.x));
  me.y = Math.max(24, Math.min(window.innerHeight - 24, me.y));

  const now = performance.now();

  if (now - lastSend > 50) {
    lastSend = now;

    send({
      type: "state",
      id: me.id,
      name: me.name,
      x: me.x,
      y: me.y,
      r: me.r,
      color: me.color
    });
  }
}

function drawGrid() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx.fillStyle = "#0c111a";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(232, 220, 192, 0.08)";
  ctx.lineWidth = 1;

  const step = 48;

  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(232, 220, 192, 0.18)";
  ctx.strokeRect(12, 12, w - 24, h - 24);
}

function drawPlane(p) {
  ctx.save();

  ctx.translate(p.x, p.y);
  ctx.rotate(p.r || 0);

  ctx.fillStyle = p.color || "#e8dcc0";
  ctx.strokeStyle = "#05070b";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -10);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.fillStyle = p.id === me.id ? "#ffffff" : "#e8dcc0";
  ctx.font = "12px system-ui";
  ctx.fillText(p.name || p.id.slice(0, 6), p.x + 16, p.y - 14);
}

function draw() {
  drawGrid();

  for (const p of players.values()) {
    drawPlane(p);
  }

  if (!players.has(me.id)) {
    drawPlane(me);
  }
}

let last = performance.now();

function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

connect();
requestAnimationFrame(loop);
</script>
</body>
</html>
"""