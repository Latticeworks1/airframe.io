import os
import time
import uuid
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse


app = FastAPI(title="airframe.io signaling server")

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


@app.get("/")
def home():
    return {
        "status": "airframe signaling online",
        "dev": "/dev",
        "health": "/health",
        "ice": "/ice",
        "ws": "/ws/{room_id}",
    }


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
    room.add(ws)

    await broadcast(room_id, {
        "type": "peer-joined",
        "room": room_id,
        "peerCount": len(room),
    }, exclude=ws)

    try:
        while True:
            msg = await ws.receive_text()
            await broadcast(room_id, msg, exclude=ws, raw=True)

    except WebSocketDisconnect:
        await leave_room(room_id, ws)

    except Exception as exc:
        await broadcast(room_id, {
            "type": "peer-error",
            "room": room_id,
            "message": str(exc),
        }, exclude=ws)
        await leave_room(room_id, ws)


async def broadcast(
    room_id: str,
    msg: Any,
    exclude: WebSocket | None = None,
    raw: bool = False,
):
    room = rooms.get(room_id)
    if not room:
        return

    dead = []

    for peer in list(room):
        if peer is exclude:
            continue

        try:
            if raw:
                await peer.send_text(msg)
            else:
                await peer.send_json(msg)
        except Exception:
            dead.append(peer)

    for peer in dead:
        room.discard(peer)

    if not room:
        rooms.pop(room_id, None)


async def leave_room(room_id: str, ws: WebSocket):
    room = rooms.get(room_id)
    if not room:
        return

    room.discard(ws)

    if not room:
        rooms.pop(room_id, None)
        return

    await broadcast(room_id, {
        "type": "peer-left",
        "room": room_id,
        "peerCount": len(room),
    })


@app.get("/dev", response_class=HTMLResponse)
def dev():
    return """
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Airframe P2P Dev Test</title>
  <style>
    body {
      background: #111722;
      color: #e8dcc0;
      font-family: system-ui, sans-serif;
      padding: 24px;
      max-width: 960px;
      margin: auto;
    }
    button, input {
      font: inherit;
      padding: 8px 10px;
      margin: 4px;
    }
    pre {
      background: #05070b;
      border: 1px solid #2f3b52;
      padding: 12px;
      min-height: 240px;
      white-space: pre-wrap;
      overflow: auto;
    }
  </style>
</head>
<body>
  <h1>Airframe P2P Dev Test</h1>

  <div>
    <button onclick="testHealth()">Test health</button>
    <button onclick="testIce()">Test ICE</button>
  </div>

  <div>
    <input id="room" value="test-room">
    <button onclick="connectSocket()">Connect room</button>
    <button onclick="sendSocketTest()">Send room test</button>
  </div>

  <div>
    <button onclick="startHost()">Start as host</button>
    <button onclick="startJoiner()">Start as joiner</button>
    <button onclick="sendPing()">Send DataChannel ping</button>
  </div>

  <pre id="log"></pre>

<script>
let ws;
let pc;
let dc;
let iceServers;

const logBox = document.getElementById("log");

function log(value) {
  if (typeof value !== "string") {
    value = JSON.stringify(value, null, 2);
  }
  logBox.textContent += value + "\\n";
  logBox.scrollTop = logBox.scrollHeight;
}

async function testHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    log("health passed");
    log(data);
  } catch (err) {
    log("health failed");
    log(String(err));
  }
}

async function testIce() {
  try {
    const res = await fetch("/ice");
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));
    if (!Array.isArray(data.iceServers)) throw new Error("iceServers is not an array");
    if (data.iceServers.length === 0) throw new Error("iceServers is empty");

    iceServers = data.iceServers;

    log("ice passed");
    log({
      count: iceServers.length,
      ttlSeconds: data.ttlSeconds,
      label: data.label,
      iceServers
    });
  } catch (err) {
    log("ice failed");
    log(String(err));
  }
}

function connectSocket() {
  const room = document.getElementById("room").value.trim();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/ws/${room}`;

  ws = new WebSocket(url);

  ws.onopen = () => log("websocket open");
  ws.onclose = event => log(`websocket closed: ${event.code}`);
  ws.onerror = () => log("websocket error");

  ws.onmessage = async event => {
    log("websocket received: " + event.data);

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    await handleSignal(msg);
  };
}

function sendSocketTest() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log("websocket is not open");
    return;
  }

  const msg = {
    type: "test",
    message: "hello from another tab",
    t: Date.now()
  };

  ws.send(JSON.stringify(msg));
  log("websocket sent: " + JSON.stringify(msg));
}

async function createPeer() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("connect websocket first");
  }

  if (!iceServers) {
    await testIce();
  }

  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignal({
        type: "candidate",
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    log("peer state: " + pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    log("ice state: " + pc.iceConnectionState);
  };

  pc.ondatachannel = event => {
    dc = event.channel;
    bindChannel();
    log("datachannel received");
  };
}

async function startHost() {
  try {
    await createPeer();

    dc = pc.createDataChannel("game", {
      ordered: false,
      maxRetransmits: 0
    });

    bindChannel();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendSignal({
      type: "offer",
      offer
    });

    log("host offer sent");
  } catch (err) {
    log("host failed");
    log(String(err));
  }
}

async function startJoiner() {
  try {
    await createPeer();
    log("joiner ready");
  } catch (err) {
    log("joiner failed");
    log(String(err));
  }
}

function bindChannel() {
  dc.onopen = () => log("datachannel open");
  dc.onmessage = event => log("datachannel received: " + event.data);
  dc.onclose = () => log("datachannel closed");
  dc.onerror = () => log("datachannel error");
}

function sendSignal(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("websocket is not open");
  }

  ws.send(JSON.stringify(msg));
  log("signal sent: " + msg.type);
}

async function handleSignal(msg) {
  try {
    if (!pc) {
      log("signal ignored, peer not started: " + msg.type);
      return;
    }

    if (msg.type === "offer") {
      await pc.setRemoteDescription(msg.offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignal({
        type: "answer",
        answer
      });

      log("answer sent");
      return;
    }

    if (msg.type === "answer") {
      await pc.setRemoteDescription(msg.answer);
      log("answer accepted");
      return;
    }

    if (msg.type === "candidate") {
      await pc.addIceCandidate(msg.candidate);
      log("candidate added");
      return;
    }
  } catch (err) {
    log("signal failed: " + msg.type);
    log(String(err));
  }
}

function sendPing() {
  if (!dc) {
    log("datachannel missing");
    return;
  }

  if (dc.readyState !== "open") {
    log("datachannel not open: " + dc.readyState);
    return;
  }

  const msg = JSON.stringify({
    type: "aircraft-state",
    t: performance.now(),
    aircraft: {
      id: "dev-plane",
      x: Math.round(Math.random() * 1000),
      y: 500,
      z: Math.round(Math.random() * 1000),
      yaw: Math.random()
    }
  });

  dc.send(msg);
  log("datachannel sent: " + msg);
}
</script>
</body>
</html>
"""