/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import {
  UserProgression,
  MatchMode,
  AmmoBelt,
  Pilot,
  KillEvent,
  ControlMode,
  SkyZone,
  LeadIndicatorInfo,
  CameraMode,
  BombSightInfo,
  CampaignMissionState,
  WeaponType,
  GroundTarget
} from "./types";
import { MainMenu } from "./components/MainMenu";
import { PilotRegistration } from "./components/PilotRegistration";
import { GameHUD, ChatMessage } from "./components/GameHUD";
import { GameEngine } from "./game/gameEngine";
import { WorldRenderer } from "./game/worldRenderer";
import { InputManager } from "./game/inputManager";
import { DEFAULT_AIRCRAFT } from "./game/aircraftData";
import { MAP_REGISTRY } from "./game/content/maps/registry";
import { KnownMaps } from "./game/content/maps/mapTypes";
import { FlightPhysicsEngine } from "./game/flightModel";
import { loadHeightmap } from "./game/terrainModel";
import { Vector3, Quaternion, Euler } from "three";
import { Award, Trophy, ArrowRight } from "lucide-react";

// LocalStorage persistent store key
const STORAGE_KEY = "airframe_io_save_data";
const MULTIPLAYER_SESSION_KEY = "airframe_io_multiplayer_session";

const GHOST_PREFIXES = ["GHOST","RAVEN","VIPER","COBRA","EAGLE","SHARK","STORM","BLADE","IRON","WOLF","NOVA","APEX","ZERO","JADE","ONYX","LYNX","KITE","HAWK","FURY","FLAK"];
function generateCallsign(): string {
  const prefix = GHOST_PREFIXES[Math.floor(Math.random() * GHOST_PREFIXES.length)];
  const num = 1000 + Math.floor(Math.random() * 8999);
  return `${prefix}_${num}`;
}

function getMultiplayerSessionId(): string {
  const existing = localStorage.getItem(MULTIPLAYER_SESSION_KEY);
  if (existing) return existing;

  const sessionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(MULTIPLAYER_SESSION_KEY, sessionId);
  return sessionId;
}
type HudSnapshot = {
  pilots: Pilot[];
  groundTargets: GroundTarget[];
  zones: SkyZone[];
  killFeed: KillEvent[];
  team1Score: number;
  team2Score: number;
  matchTimer: number;
  bombSightInfo: BombSightInfo | null;
  campaignState: CampaignMissionState | null;
};

const INITIAL_PROGRESSION: UserProgression = {
  totalXp: 500, // starter XP
  planeXp: {},
  unlockedPlanes: ["falcon-mk2"],
  equippedMods: {},
  selectedPlaneId: "falcon-mk2",
  selectedBelt: AmmoBelt.Universal,
  invertMouseY: false,
  invertMouseX: false,
  controlMode: ControlMode.MouseAim,
  stats: {
    battlesPlayed: 0,
    kills: 0,
    deaths: 0,
    groundTargetsDestroyed: 0,
    victories: 0
  },
  customizations: {
    skin: "default",
    tracerColor: "amber",
    noseArt: ""
  }
};

export default function App() {
  const [progression, setProgression] = useState<UserProgression>(INITIAL_PROGRESSION);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDebrief, setShowDebrief] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [debriefData, setDebriefData] = useState<{
    victory: boolean;
    xpEarned: number;
    kills: number;
    structures: number;
    missionName?: string;
  } | null>(null);

  // Active game instances
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const renderer3DRef = useRef<WorldRenderer | null>(null);
  const inputManagerRef = useRef<InputManager | null>(null);
  const [activeEngine, setActiveEngine] = useState<GameEngine | null>(null);

  // POV and Lead Targeting State
  const [cameraMode, setCameraMode] = useState<CameraMode>("third-person");
  const cameraModeRef = useRef<CameraMode>("third-person");

  // Low-frequency React snapshot. Per-frame targeting transforms bypass React.
  const [hudSnapshot, setHudSnapshot] = useState<HudSnapshot>({
    pilots: [],
    groundTargets: [],
    zones: [],
    killFeed: [],
    team1Score: 0,
    team2Score: 0,
    matchTimer: 360,
    bombSightInfo: null,
    campaignState: null
  });
  const [activeMatchMode, setActiveMatchMode] = useState<MatchMode>(MatchMode.AirSupremacy);

  // Hitmarker state to register and flash damage indicator overlays
  const [hitmarker, setHitmarker] = useState<{ active: boolean; type: "air" | "ground"; key: number }>({
    active: false,
    type: "air",
    key: 0
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const multiplayerSocketRef = useRef<WebSocket | null>(null);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [showTacticalMap, setShowTacticalMap] = useState(false);

  const togglePause = () => {
    const newVal = !isPausedRef.current;
    isPausedRef.current = newVal;
    setIsPaused(newVal);
  };

  const setActiveCameraMode = (next: CameraMode) => {
    cameraModeRef.current = next;
    setCameraMode(next);
    renderer3DRef.current?.setCameraMode(next);
  };

  const toggleCameraMode = () => {
    setActiveCameraMode(
      cameraModeRef.current === "first-person"
        ? "third-person"
        : "first-person"
    );
  };

  const toggleBombSight = () => {
    setActiveCameraMode(
      cameraModeRef.current === "bombsight"
        ? "third-person"
        : "bombsight"
    );
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isPlaying) {
          e.preventDefault();
          togglePause();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (hitmarker.active) {
      const timer = setTimeout(() => {
        setHitmarker(prev => ({ ...prev, active: false }));
      }, 180);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitmarker.key]);

  // Load persistence — auto-assign callsign so registration is never a gate
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const base: UserProgression = {
        ...INITIAL_PROGRESSION,
        ...(parsed ?? {}),
        stats: { ...INITIAL_PROGRESSION.stats, ...(parsed?.stats || {}) },
        equippedMods: parsed?.equippedMods || {},
        unlockedPlanes: parsed?.unlockedPlanes || ["falcon-mk2"]
      };
      if (!base.nickname) {
        base.nickname = generateCallsign();
        base.rankCode = base.rankCode || "CDT";
        localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
      }
      setProgression(base);
    } catch (e) {
      console.warn("Failed loading progression save state", e);
    }
  }, []);

  const saveProgression = (updated: UserProgression) => {
    setProgression(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("localStorage persistence error", e);
    }
    if (activeEngine) {
      const player = activeEngine.pilots.find(p => p.id === "player");
      if (player) {
        player.invertMouseY = updated.invertMouseY ?? false;
        player.invertMouseX = updated.invertMouseX ?? false;
        if (updated.controlMode) {
          player.controlMode = updated.controlMode;
        }
      }
    }
  };

  // Launch Active Dogfight
  const handleLaunchMatch = (
    selectedPlaneId: string,
    belt: AmmoBelt,
    mods: string[],
    mapId: string,
    mode: MatchMode,
    isMultiplayer: boolean,
    startOnGround: boolean = false,
    campaignMissionId?: string
  ) => {
    setActiveCameraMode("third-person");
    setShowTacticalMap(false);
    setIsPlaying(true);
    setShowDebrief(false);
    setActiveMatchMode(mode);
    setIsPaused(false);
    isPausedRef.current = false;

    // Short timeout to let the Canvas container render, then init Three.js
    setTimeout(() => {
      initThreeAndGame(
        selectedPlaneId,
        belt,
        mods,
        mapId,
        mode,
        isMultiplayer,
        startOnGround,
        campaignMissionId
      );
    }, 150);
  };

  const initThreeAndGame = async (
    planeId: string,
    belt: AmmoBelt,
    mods: string[],
    mapId: string,
    mode: MatchMode,
    isMultiplayer: boolean,
    startOnGround: boolean = false,
    campaignMissionId?: string
  ) => {
    if (!canvasContainerRef.current) return;

    const mapDef = MAP_REGISTRY[mapId] ?? MAP_REGISTRY[KnownMaps.IslandChain];

    // Pre-load heightmap before instantiating GameEngine so spawn calculations are correct
    if (mapDef.terrain.kind === "heightmap") {
      try {
        await loadHeightmap(mapDef.terrain.path, mapDef.world.radius, mapDef.terrain.elevationScale);
      } catch (e) {
        console.error("Failed to pre-load heightmap:", e);
      }
    }

    // 1. Initialize 3D Renderer
    const renderer3D = new WorldRenderer(canvasContainerRef.current, mapDef, () => {
      console.log("WebGL World initialized successfully.");
    });
    renderer3DRef.current = renderer3D;
    renderer3D.setCameraMode(cameraModeRef.current);

    // 2. Initialize Game Rules Engine
    const engine = new GameEngine(
      planeId,
      belt,
      mods,
      mapId,
      mode,
      (killEvt) => {
        // Trigger small audio click or visual shaking if player got kill
        if (killEvt.killerName.includes("You")) {
          try { beep(440, "triangle", 0.08); } catch(_) {}
        }
      },
      (victory, xpEarned) => {
        // MATCH OVER CALLBACK
        handleMatchCompletion(victory, xpEarned, engine, renderer3D);
      },
      progression.nickname,
      startOnGround,
      campaignMissionId
    );

    engine.onLocalPlayerHit = (tgtId, isGround) => {
      try {
        if (isGround) {
          beep(260, "triangle", 0.045);
        } else {
          beep(680, "sine", 0.04);
        }
      } catch (_) {}
      setHitmarker({
        active: true,
        type: isGround ? "ground" : "air",
        key: Math.random()
      });
    };

    engine.onProjectileImpact = (type, position) => {
      const size =
        type === WeaponType.BOMB ? 2.8 :
        type === WeaponType.ROCKET ? 1.5 :
        0.55;
      renderer3D.triggerExplosion(position.x, position.y, position.z, size);
    };

    const player = engine.pilots.find(p => p.id === "player");
    if (player) {
      player.controlMode = progression.controlMode || ControlMode.MouseAim;
      player.invertMouseY = progression.invertMouseY ?? false;
      player.invertMouseX = progression.invertMouseX ?? false;
    }

    setActiveEngine(engine);

    // 3. Setup control structures using the InputManager class
    const inputManager = new InputManager();
    inputManagerRef.current = inputManager;
    inputManager.onCameraToggle = toggleCameraMode;
    inputManager.onBombSightToggle = toggleBombSight;
    inputManager.onTacticalMapToggle = () => {
      setShowTacticalMap(current => !current);
    };
    inputManager.init();

    // --- WebSocket Multiplayer Setup Section ---
    let socket: WebSocket | null = null;
    const multiplayerSessionId = getMultiplayerSessionId();
    const myPilotId = `pilot_${multiplayerSessionId.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
    const myCallsign = progression.nickname || "Maverick_99";

    if (isMultiplayer) {
      engine.isMultiplayer = true;
      const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
      const wsUrl = `${protocol}${window.location.host}/multiplayer`;
      try {
        socket = new WebSocket(wsUrl);
        multiplayerSocketRef.current = socket;
        socket.onerror = (err) => {
          console.warn("Multiplayer matchmaking offline or connectivity error. Operating in offline/local capability.", err);
        };
      } catch (wsErr) {
        console.warn("Unable to establish WebSocket connection", wsErr);
      }

      if (socket) {
        socket.onopen = () => {
          const localPlayer = engine.pilots.find(p => p.id === "player");
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "join",
              queueKey: `${mapId}_${mode}`,
              sessionId: multiplayerSessionId,
              pilotId: myPilotId,
              name: `${myCallsign} (You)`,
              specs: localPlayer?.specs || DEFAULT_AIRCRAFT[0],
              skin: progression.customizations.skin || "default",
              ammo: localPlayer?.ammo || {}
            }));
          }
        };

        socket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          if (msg.type === "welcome") {
            engine.isHost = (msg.hostId === myPilotId);
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer && (msg.assignedTeam === 1 || msg.assignedTeam === 2)) {
              localPlayer.team = msg.assignedTeam;
            }
            // Sync initial other remote players into engine
            // Keep player and bots if we are host, otherwise filter out old remotes
            engine.pilots = engine.pilots.filter(p => p.id === "player" || p.isBot);

            msg.players.forEach((player: any) => {
              if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
                engine.pilots.push({
                  id: player.id,
                  name: player.name,
                  isBot: false,
                  team: player.team,
                  aircraftId: player.aircraftId,
                  specs: player.specs,
                  x: player.x, y: player.y, z: player.z,
                  vx: player.vx, vy: player.vy, vz: player.vz,
                  pitch: player.pitch, yaw: player.yaw, roll: player.roll,
                  throttle: player.throttle,
                  engineTemperature: 75,
                  damage: player.damage,
                  ammo: player.ammo || {},
                  ammoBelt: AmmoBelt.Universal,
                  modifications: [],
                  score: player.score || 0,
                  kills: player.kills || 0,
                  deaths: player.deaths || 0,
                  xpEarned: 0
                });
              }
            });

            // Sync initial ground targets
            if (msg.groundTargets?.length > 0) {
              msg.groundTargets.forEach((syncTarget: any) => {
                const localTarget = engine.groundTargets.find(t => t.id === syncTarget.id);
                if (localTarget) {
                  localTarget.hp = syncTarget.hp;
                  localTarget.isDead = syncTarget.isDead;
                }
              });
            }

            // Sync initial sky zone ownership
            if (msg.skyZones?.length > 0) {
              msg.skyZones.forEach((syncZone: any) => {
                const localZone = engine.skyZones.find(z => z.id === syncZone.id);
                if (localZone) {
                  localZone.owningTeam = syncZone.owningTeam;
                  localZone.captureProgress = syncZone.captureProgress;
                }
              });
            }

            // Sync team scores
            if (msg.scores) {
              engine.team1Score = msg.scores.team1 ?? 0;
              engine.team2Score = msg.scores.team2 ?? 0;
            }
          }

          else if (msg.type === "join_rejected") {
            console.warn("Multiplayer join rejected:", msg.reason);
            if (msg.reason === "duplicate_session") {
              window.alert("This pilot is already active in another multiplayer match.");
            }
            socket?.close();
            setActiveEngine(null);
            setIsPlaying(false);
          }

          else if (msg.type === "player_joined") {
            const player = msg.player;
            if (player.id !== myPilotId && !engine.pilots.some(p => p.id === player.id)) {
              engine.pilots.push({
                id: player.id,
                name: player.name,
                isBot: false,
                team: player.team,
                aircraftId: player.aircraftId,
                specs: player.specs,
                x: player.x, y: player.y, z: player.z,
                vx: player.vx, vy: player.vy, vz: player.vz,
                pitch: player.pitch, yaw: player.yaw, roll: player.roll,
                throttle: player.throttle,
                engineTemperature: 75,
                damage: player.damage,
                ammo: player.ammo || {},
                ammoBelt: AmmoBelt.Universal,
                modifications: [],
                score: player.score || 0,
                kills: player.kills || 0,
                deaths: player.deaths || 0,
                xpEarned: 0
              });
            }
          }

          else if (msg.type === "player_updated") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) {
              remote.x = msg.state.x;
              remote.y = msg.state.y;
              remote.z = msg.state.z;
              remote.vx = msg.state.vx;
              remote.vy = msg.state.vy;
              remote.vz = msg.state.vz;
              remote.pitch = msg.state.pitch;
              remote.yaw = msg.state.yaw;
              remote.roll = msg.state.roll;
              remote.throttle = msg.state.throttle;
              remote.damage = msg.state.damage;
              remote.ammo = msg.state.ammo as typeof remote.ammo;
              remote.score = msg.state.score;
              remote.kills = msg.state.kills;
              remote.deaths = msg.state.deaths;
            }
          }

          else if (msg.type === "player_left") {
            engine.pilots = engine.pilots.filter(p => p.id !== msg.id);
          }

          else if (msg.type === "player_fired") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) {
              engine.spawnProjectile(remote, msg.weaponType);
            }
          }

          else if (msg.type === "kill_confirmed") {
            const netToLocal = (id: string) => id === myPilotId ? "player" : id;
            const killer = engine.pilots.find(p => p.id === netToLocal(msg.killerId));
            const victim = engine.pilots.find(p => p.id === netToLocal(msg.victimId));
            if (killer && victim) {
              engine.forceRegisterKill(killer.id, victim.id, msg.weapon);
            }
          }

          else if (msg.type === "ground_updated") {
            const localTarget = engine.groundTargets.find(t => t.id === msg.targetId);
            if (localTarget) {
              localTarget.hp = msg.hp;
              localTarget.isDead = msg.isDead;
            }
          }

          else if (msg.type === "scores_updated") {
            engine.team1Score = msg.team1Score;
            engine.team2Score = msg.team2Score;
          }

          else if (msg.type === "host_changed") {
            engine.isHost = (msg.hostId === myPilotId);
          }

          else if (msg.type === "damage_inflicted") {
            const localPlayer = engine.pilots.find(p => p.id === "player");
            if (localPlayer) {
              const spot = new Vector3(
                msg.hitSpotLocal.x,
                msg.hitSpotLocal.y,
                msg.hitSpotLocal.z
              );
              FlightPhysicsEngine.applyDamage(localPlayer, msg.damage, msg.bulletType, spot);
            }
          }

          else if (msg.type === "bots_updated") {
            if (!engine.isHost) {
              msg.bots.forEach((syncBot: any) => {
                const localBot = engine.pilots.find(p => p.id === syncBot.id);
                if (localBot) {
                  localBot.x = syncBot.x;
                  localBot.y = syncBot.y;
                  localBot.z = syncBot.z;
                  localBot.vx = syncBot.vx;
                  localBot.vy = syncBot.vy;
                  localBot.vz = syncBot.vz;
                  localBot.pitch = syncBot.pitch;
                  localBot.yaw = syncBot.yaw;
                  localBot.roll = syncBot.roll;
                  localBot.throttle = syncBot.throttle;
                  localBot.damage = syncBot.damage;
                }
              });
            }
          }
          if (msg.type === "chat_broadcast") {
            setChatMessages(prev => [...prev.slice(-49), {
              sender: msg.senderName,
              text: msg.text,
              ts: Date.now()
            }]);
          }
        } catch (err) {
          console.error("Multiplayer message parse/apply error:", err);
        }
      };

      // Wire engine real-time action callbacks to WebSocket broadcasts
      engine.onProjectileSpawn = (weaponType) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "fire",
            weaponType
          }));
        }
      };

      engine.onGroundTargetDamage = (targetId, hp, isDead) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "ground_damage",
            targetId, hp, isDead
          }));
        }
      };

      engine.onLocalPlayerKill = (killerId, victimId, weapon) => {
        if (killerId !== "player") return;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "kill",
            killerId: myPilotId,
            victimId,
            weapon
          }));
        }
      };

      engine.onPlayerDamage = (shooterId, targetId, damage, bulletType, hitSpotLocal) => {
        if (shooterId !== "player") return;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "damage_inflicted",
            targetId,
            damage,
            bulletType,
            hitSpotLocal: { x: hitSpotLocal.x, y: hitSpotLocal.y, z: hitSpotLocal.z }
          }));
        }
      };
    }
  }

    // 4. RAF Loop
    let lastTime = performance.now();
    let animId = 0;
    const playerTargetPoint = new Vector3();
    const activeAimPos = { x: 0, y: 0 };
    let activeAimPosInitialized = false;
    let playerWasDead = false;
    let lastSendTime = 0;
    let lastHudSyncTime = 0;
    let fpsWindowStart = performance.now();
    let fpsFrameCount = 0;
    let fpsElement: HTMLElement | null = null;

    // Per-match telemetry — streams frames to /telemetry-ws in 100ms batches.
    // Written to telemetry.jsonl on the server in real time; no memory accumulation.
    type TelemetryFrame = {
      t: number; spd: number; alt: number; thr: number;
      avP: number; avQ: number; avR: number;
      mx: number; my: number; mz: number;
      aoa: number; ss: number; qPa: number;
      lw: boolean; rw: boolean; sev: number;
      elv: number; ail: number; rud: number;
      pitch: number; roll: number; yaw: number;
      // absolute world position and body-axis unit vectors in world space
      px: number; py: number; pz: number;
      fwX: number; fwY: number; fwZ: number;
      upX: number; upY: number; upZ: number;
      rtX: number; rtY: number; rtZ: number;
      cm: number;
      cp: number; cr: number; cy: number;
      mp: number; mr: number; myw: number;
      ax: number; ay: number;
    };
    let telemPending: TelemetryFrame[] = [];
    const telemWsProto = location.protocol === "https:" ? "wss://" : "ws://";
    const telemWs = new WebSocket(`${telemWsProto}${location.host}/telemetry-ws`);
    const roundTelemetry = (value: number, decimals: number) => {
      const scale = 10 ** decimals;
      return Math.round(value * scale) / scale;
    };

    const flushTelemetry = () => {
      if (telemPending.length === 0 || telemWs.readyState !== WebSocket.OPEN) return;
      telemWs.send(JSON.stringify(telemPending));
      telemPending = [];
    };
    const telemFlushInterval = setInterval(flushTelemetry, 100);

    let leadHudElements: {
      target: HTMLElement;
      lead: HTMLElement;
      distance: HTMLElement;
      lock: HTMLElement;
      lockText: HTMLElement;
    } | null = null;

    const updateLeadHud = (indicator: LeadIndicatorInfo | null) => {
      if (!leadHudElements) {
        const target = document.getElementById("target-marker-box");
        const lead = document.getElementById("target-lead-dot-indicator");
        const distance = document.getElementById("target-lead-distance");
        const lock = document.getElementById("hud-radar-lock");
        const lockText = document.getElementById("hud-radar-lock-text");

        if (target && lead && distance && lock && lockText) {
          leadHudElements = { target, lead, distance, lock, lockText };
        }
      }

      if (!leadHudElements) return;

      const { target, lead, distance, lock, lockText } = leadHudElements;
      if (!indicator) {
        target.style.opacity = "0";
        lead.style.opacity = "0";
        lock.style.opacity = "0";
        return;
      }

      const targetX = Math.max(0, Math.min(100, indicator.x));
      const targetY = Math.max(0, Math.min(100, indicator.y));
      const leadX = Math.max(0, Math.min(100, indicator.sX));
      const leadY = Math.max(0, Math.min(100, indicator.sY));
      const scale = Math.max(0.5, Math.min(1.5, 650 / (indicator.distance + 250)));

      target.style.opacity = "1";
      lead.style.opacity = "1";
      lock.style.opacity = "1";
      target.style.transform =
        `translate3d(${targetX}vw, ${targetY}vh, 0) translate3d(-50%, -50%, 0)`;
      lead.style.transform =
        `translate3d(${leadX}vw, ${leadY}vh, 0) translate3d(-50%, -50%, 0) scale(${scale})`;
      distance.textContent = indicator.distance >= 1000
        ? `${(indicator.distance / 1000).toFixed(1)}KM`
        : `${Math.floor(indicator.distance)}M`;
      lockText.textContent = `RADAR TRACER LOCK • ${indicator.name}`;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      const inputFrame = inputManager.getInputFrame();

      // Calculate player target point in front of plane direction using client mouse aiming
      const player = engine.pilots.find(p => p.id === "player");
      if (player && player.damage.fuselage > 0) {
        const pos = new Vector3(player.x, player.y, player.z);
        
        // Compute standard direction vectors from model rotations
        const rot = new Quaternion().setFromEuler(new Euler(player.pitch, player.yaw, player.roll, "YXZ"));
        const forward = new Vector3(0, 0, 1).applyQuaternion(rot).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(rot).normalize();
        const right = new Vector3(1, 0, 0).applyQuaternion(rot).normalize();

        const pitchMultiplier = progression.invertMouseY ? -1 : 1;
        const rollMultiplier = progression.invertMouseX ? -1 : 1;
        
        // Handle free look vs normal mouse aiming.
        // During free look (secondary/right click is held), hold the aim coordinate frozen relative to airplane.
        // On release, smoothly slide the actual target coordinate from its frozen point back into standard mouse control line.
        const isFreeLook = inputFrame.rightMouse;
        if (!activeAimPosInitialized) {
          activeAimPos.x = inputFrame.mousePos.x;
          activeAimPos.y = inputFrame.mousePos.y;
          activeAimPosInitialized = true;
        } else if (!isFreeLook) {
          activeAimPos.x += (inputFrame.mousePos.x - activeAimPos.x) * Math.min(1.0, dt * 10);
          activeAimPos.y += (inputFrame.mousePos.y - activeAimPos.y) * Math.min(1.0, dt * 10);
        }

        // Target point slides on a virtual panel 240m ahead
        playerTargetPoint
          .copy(pos)
          .addScaledVector(forward, 240)
          .addScaledVector(right, activeAimPos.x * 125 * rollMultiplier)
          .addScaledVector(up, activeAimPos.y * 95 * pitchMultiplier);
      }

      // Tick dynamics equations if not paused
      if (!isPausedRef.current) {
        engine.secondaryWeaponPreference =
          cameraModeRef.current === "bombsight" ? WeaponType.BOMB : null;
        engine.update(dt, inputFrame, playerTargetPoint);
      }

      const playerIsDead = !player || player.damage.fuselage <= 0;
      if (playerWasDead && player && !playerIsDead) {
        activeAimPos.x = 0;
        activeAimPos.y = 0;
        activeAimPosInitialized = true;
        inputManager.recenterAim();
        playerTargetPoint.set(player.x, player.y, player.z);
      }
      playerWasDead = playerIsDead;

      // Throttled: Send our local state updates to multiplayer server (35ms intervals)
      if (isMultiplayer && socket && socket.readyState === WebSocket.OPEN && now - lastSendTime > 35) {
        lastSendTime = now;
        if (player) {
          socket.send(JSON.stringify({
            type: "update",
            pilotState: {
              x: player.x,
              y: player.y,
              z: player.z,
              vx: player.vx,
              vy: player.vy,
              vz: player.vz,
              pitch: player.pitch,
              yaw: player.yaw,
              roll: player.roll,
              throttle: player.throttle,
              damage: player.damage,
              ammo: player.ammo,
              score: player.score,
              kills: player.kills,
              deaths: player.deaths
            }
          }));
        }

        // If we became the designated host client for this match, synchronize Bot movements + general scores
        if (engine.isHost) {
          const syncBots = engine.pilots.filter(p => p.isBot).map(b => ({
            id: b.id,
            x: b.x, y: b.y, z: b.z,
            vx: b.vx, vy: b.vy, vz: b.vz,
            pitch: b.pitch, yaw: b.yaw, roll: b.roll,
            throttle: b.throttle,
            damage: b.damage
          }));

          socket.send(JSON.stringify({
            type: "bots_sync",
            bots: syncBots
          }));

          socket.send(JSON.stringify({
            type: "score_sync",
            team1Score: engine.team1Score,
            team2Score: engine.team2Score
          }));
        }
      }

      // React owns readable telemetry, not animation-rate transforms.
      if (now - lastHudSyncTime >= 80) {
        lastHudSyncTime = now;
        setHudSnapshot({
          pilots: [...engine.pilots],
          groundTargets: [...engine.groundTargets],
          zones: [...engine.skyZones],
          killFeed: [...engine.killFeed],
          team1Score: engine.team1Score,
          team2Score: engine.team2Score,
          matchTimer: engine.matchTimer,
          bombSightInfo: renderer3D.bombSightInfo,
          campaignState: engine.campaignState
            ? { ...engine.campaignState }
            : null
        });
      }

      // Relay coordinates into Three Renderer
      renderer3D.updateWorld(
        engine.pilots,
        "player",
        engine.projectiles,
        engine.groundTargets,
        playerTargetPoint,
        engine.skyZones,
        mode,
        inputFrame,
        dt
      );
      updateLeadHud(renderer3D.leadIndicator2D);

      fpsFrameCount++;
      const fpsElapsed = now - fpsWindowStart;
      if (fpsElapsed >= 500) {
        fpsElement ??= document.getElementById("hud-fps-counter");
        if (fpsElement) {
          const fps = fpsFrameCount * 1000 / fpsElapsed;
          const frameMs = fps > 0 ? 1000 / fps : 0;
          const { drawCalls } = renderer3D.getRenderStats();
          fpsElement.textContent =
            `${Math.round(fps)} FPS · ${frameMs.toFixed(1)} MS · ${drawCalls} DC`;
          fpsElement.dataset.level = fps >= 55 ? "good" : fps >= 35 ? "warn" : "bad";
        }
        fpsWindowStart = now;
        fpsFrameCount = 0;
      }

      // Telemetry — queue one frame per tick, flushed every 100ms via telemWs
      if (player?.physicsDebug) {
        const d = player.physicsDebug;
        const spd = Math.sqrt(player.vx**2 + player.vy**2 + player.vz**2) * 3.6;
        const bodyQ = new Quaternion().setFromEuler(new Euler(player.pitch, player.yaw, player.roll, "YXZ"));
        const fwd = new Vector3(0, 0, 1).applyQuaternion(bodyQ);
        const upv = new Vector3(0, 1, 0).applyQuaternion(bodyQ);
        const rgt = new Vector3(1, 0, 0).applyQuaternion(bodyQ);
        const manualPitch = (inputFrame.held.w ? 1 : 0) - (inputFrame.held.s ? 1 : 0);
        const manualRoll = (inputFrame.held.d ? 1 : 0) - (inputFrame.held.a ? 1 : 0);
        const manualYaw =
          (inputFrame.held.arrowRight ? 1 : 0) -
          (inputFrame.held.arrowLeft ? 1 : 0) +
          (inputFrame.held.e ? 0.65 : 0) -
          (inputFrame.held.q ? 0.65 : 0);
        const controlMode =
          player.controlMode === ControlMode.MouseJoystick ? 1 :
          player.controlMode === ControlMode.KeyboardDirect ? 2 : 0;
        telemPending.push({
          t:    roundTelemetry(player.physicsTime ?? 0, 3),
          spd:  roundTelemetry(spd, 1),
          alt:  roundTelemetry(player.y, 1),
          thr:  roundTelemetry(player.throttle, 2),
          avP:  roundTelemetry((player.avz ?? 0) * 57.296, 2),
          // Body +X rotation is nose-down; expose pitch response as nose-up-positive.
          avQ:  roundTelemetry(-(player.avx ?? 0) * 57.296, 2),
          avR:  roundTelemetry((player.avy ?? 0) * 57.296, 2),
          mx:   roundTelemetry(d.aeroTorqueX, 0),
          my:   roundTelemetry(d.aeroTorqueY, 0),
          mz:   roundTelemetry(d.aeroTorqueZ, 0),
          aoa:  roundTelemetry(d.aoaDeg, 2),
          ss:   roundTelemetry(d.sideslipDeg, 2),
          qPa:  roundTelemetry(d.dynamicPressure, 0),
          lw:   d.leftWingStalled,
          rw:   d.rightWingStalled,
          sev:  roundTelemetry(d.stallSeverity, 3),
          elv:  roundTelemetry(d.elevatorDeflection, 3),
          ail:  roundTelemetry(d.aileronDeflection, 3),
          rud:  roundTelemetry(d.rudderDeflection, 3),
          pitch: roundTelemetry(-player.pitch, 4),
          roll:  roundTelemetry(player.roll, 4),
          yaw:   roundTelemetry(player.yaw, 4),
          px: roundTelemetry(player.x, 1),
          py: roundTelemetry(player.y, 1),
          pz: roundTelemetry(player.z, 1),
          fwX: roundTelemetry(fwd.x, 4),
          fwY: roundTelemetry(fwd.y, 4),
          fwZ: roundTelemetry(fwd.z, 4),
          upX: roundTelemetry(upv.x, 4),
          upY: roundTelemetry(upv.y, 4),
          upZ: roundTelemetry(upv.z, 4),
          rtX: roundTelemetry(rgt.x, 4),
          rtY: roundTelemetry(rgt.y, 4),
          rtZ: roundTelemetry(rgt.z, 4),
          cm: controlMode,
          cp: roundTelemetry(player.lastCommand?.pitch ?? 0, 3),
          cr: roundTelemetry(player.lastCommand?.roll ?? 0, 3),
          cy: roundTelemetry(player.lastCommand?.yaw ?? 0, 3),
          mp: manualPitch,
          mr: manualRoll,
          myw: roundTelemetry(manualYaw, 2),
          ax: roundTelemetry(activeAimPos.x, 3),
          ay: roundTelemetry(activeAimPos.y, 3),
        });
      }

      // Clear transient edges and mouse movement only after every frame consumer has read them.
      inputManager.clearPressedEdges();

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    // Store references for cleanup on ejection
    (canvasContainerRef as any).current.cleanupHandler = () => {
      cancelAnimationFrame(animId);
      clearInterval(telemFlushInterval);
      flushTelemetry();
      telemWs.close();
      inputManager.destroy();
      inputManagerRef.current = null;
      
      if (socket) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
      
      renderer3D.destroy();
      if (renderer3DRef.current === renderer3D) {
        renderer3DRef.current = null;
      }
    };
  };

  const handleMatchCompletion = (
    victory: boolean,
    xpEarned: number,
    engine: GameEngine,
    _renderer3D: WorldRenderer
  ) => {
    // Collect final accomplishments of human pilot
    const player = engine.pilots.find(p => p.id === "player");
    const kills = player ? player.kills : 0;
    const structures = engine.targetsDestroyedThisMatch;

    // Trigger audio beeps
    try {
      if (victory) {
        beep(523.25, "sine", 0.15);
        setTimeout(() => beep(659.25, "sine", 0.15), 150);
        setTimeout(() => beep(783.99, "sine", 0.25), 300);
      } else {
        beep(220, "triangle", 0.3);
      }
    } catch (_) {}

    setDebriefData({
      victory,
      xpEarned,
      kills,
      structures,
      missionName: engine.campaignMission?.operation
    });
    setShowDebrief(true);
    setShowTacticalMap(false);
    setIsPlaying(false);
    setActiveEngine(null);

    // Save outputs back to persistent Local Store
    const updatedStats = {
      battlesPlayed: progression.stats.battlesPlayed + 1,
      kills: progression.stats.kills + kills,
      deaths: progression.stats.deaths + (player ? player.deaths : 0),
      groundTargetsDestroyed: progression.stats.groundTargetsDestroyed + structures,
      victories: progression.stats.victories + (victory ? 1 : 0),
    };

    const updated: UserProgression = {
      ...progression,
      totalXp: progression.totalXp + xpEarned,
      completedCampaignMissions:
        victory && engine.campaignMission
          ? Array.from(new Set([
              ...(progression.completedCampaignMissions ?? []),
              engine.campaignMission.id
            ]))
          : progression.completedCampaignMissions,
      stats: updatedStats
    };
    saveProgression(updated);

    // Run renderer destruction
    if (canvasContainerRef.current && (canvasContainerRef as any).current.cleanupHandler) {
      (canvasContainerRef as any).current.cleanupHandler();
      (canvasContainerRef as any).current.cleanupHandler = null;
    }
  };

  const handleEject = () => {
    if (activeEngine) {
      // counted as unfinished match
      if (canvasContainerRef.current && (canvasContainerRef as any).current.cleanupHandler) {
        (canvasContainerRef as any).current.cleanupHandler();
        (canvasContainerRef as any).current.cleanupHandler = null;
      }
      setActiveEngine(null);
      setIsPlaying(false);
      setShowTacticalMap(false);
      setIsPaused(false);
      isPausedRef.current = false;
    }
  };

  // Sound generator helper using Web Audio API
  const beep = (freq: number, type: OscillatorType, length: number) => {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.type = type;
    
    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + length);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + length);
  };

  const playerPilotData = activeEngine
    ? hudSnapshot.pilots.find(p => p.id === "player")
    : undefined;

  return (
    <main id="app-viewport-frame" className="relative w-screen h-screen overflow-hidden bg-black text-white">
      
      {/* 3D CANVAS INJECTION TARGET */}
      {isPlaying && (
        <div
          id="webgl-canvas-container"
          ref={canvasContainerRef}
          className="absolute inset-0 w-full h-full z-10 select-none cursor-crosshair pointer-events-auto"
        ></div>
      )}

      {/* COCKPIT PILOT HUD LAYER */}
      {isPlaying && activeEngine && (
        <div id="active-hud-hud" className="absolute inset-0 z-20 pointer-events-none">
          <GameHUD
            playerPilot={playerPilotData}
            pilots={hudSnapshot.pilots}
            groundTargets={hudSnapshot.groundTargets}
            skyZones={hudSnapshot.zones}
            killFeed={hudSnapshot.killFeed}
            team1Score={hudSnapshot.team1Score}
            team2Score={hudSnapshot.team2Score}
            matchTimer={hudSnapshot.matchTimer}
            matchMode={activeMatchMode}
            invertMouseY={progression.invertMouseY || false}
            onToggleInvertMouseY={() => {
              saveProgression({
                ...progression,
                invertMouseY: !progression.invertMouseY
              });
            }}
            invertMouseX={progression.invertMouseX || false}
            onToggleInvertMouseX={() => {
              saveProgression({
                ...progression,
                invertMouseX: !progression.invertMouseX
              });
            }}
            onExit={handleEject}
            cameraMode={cameraMode}
            inputFrame={inputManagerRef.current?.getInputFrame()}
            hitmarker={hitmarker}
            bombSightInfo={hudSnapshot.bombSightInfo}
            campaignState={hudSnapshot.campaignState}
            mapId={activeEngine.selectedMapId}
            showTacticalMap={showTacticalMap}
            onCloseTacticalMap={() => setShowTacticalMap(false)}
            chatMessages={chatMessages}
            onSendChat={(text) => {
              const sock = multiplayerSocketRef.current;
              if (sock && sock.readyState === WebSocket.OPEN) {
                sock.send(JSON.stringify({
                  type: "chat",
                  senderName: progression.nickname || "PILOT",
                  text
                }));
              } else {
                setChatMessages(prev => [...prev.slice(-49), {
                  sender: progression.nickname || "PILOT",
                  text,
                  ts: Date.now()
                }]);
              }
            }}
          />
        </div>
      )}

      {/* TACTICAL PAUSE OVERLAY */}
      {isPlaying && isPaused && (
        <div id="tactical-pause-overlay" className="absolute inset-0 z-50 bg-[#070b14]/85 backdrop-blur-md flex flex-col items-center justify-center p-6 pointer-events-auto font-mono text-center animate-fadeIn">
          <div className="max-w-md w-full bg-[#0d1525]/90 border border-slate-900 rounded-2xl p-8 shadow-2xl shadow-black/95">
            <span className="text-[10px] text-amber-500 font-extrabold tracking-[0.25em] uppercase block mb-1">SYSTEM HALTED</span>
            <h1 className="text-3xl font-black text-slate-100 tracking-tight uppercase mb-6" style={{ textShadow: "1.5px 1.5px 0px #000, -1.5px -1.5px 0px #000, 1.5px -1.5px 0px #000, -1.5px 1.5px 0px #000" }}>
              TACTICAL PAUSE
            </h1>
            
            <div className="flex flex-col gap-3 mb-8 text-left">
              <span className="text-[9px] text-[#475569] font-black uppercase tracking-wider mb-1">JET CONTROL TUNEMENT</span>
              
              {/* Invert Mouse Y Toggle */}
              <button
                type="button"
                onClick={() => {
                  const updated = {
                    ...progression,
                    invertMouseY: !progression.invertMouseY
                  };
                  saveProgression(updated);
                  if (activeEngine) {
                    const player = activeEngine.pilots.find(p => p.id === "player");
                    if (player) {
                      player.invertMouseY = updated.invertMouseY ?? false;
                    }
                  }
                }}
                className="flex items-center justify-between px-4 py-2.5 bg-slate-950/60 border border-slate-900 hover:border-slate-800 rounded-xl text-xs font-bold transition-all text-slate-350 cursor-pointer"
              >
                <span>INVERT MOUSE PITCH (Y-AXIS)</span>
                <span className={progression.invertMouseY ? "text-amber-500 font-black" : "text-slate-500 font-bold"}>
                  {progression.invertMouseY ? "ON" : "OFF"}
                </span>
              </button>

              {/* Invert Mouse X Toggle */}
              <button
                type="button"
                onClick={() => {
                  const updated = {
                    ...progression,
                    invertMouseX: !progression.invertMouseX
                  };
                  saveProgression(updated);
                  if (activeEngine) {
                    const player = activeEngine.pilots.find(p => p.id === "player");
                    if (player) {
                      player.invertMouseX = updated.invertMouseX ?? false;
                    }
                  }
                }}
                className="flex items-center justify-between px-4 py-2.5 bg-slate-950/60 border border-slate-900 hover:border-slate-800 rounded-xl text-xs font-bold transition-all text-slate-350 cursor-pointer"
              >
                <span>INVERT MOUSE ROLL (X-AXIS)</span>
                <span className={progression.invertMouseX ? "text-amber-500 font-black" : "text-slate-500 font-bold"}>
                  {progression.invertMouseX ? "ON" : "OFF"}
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {/* RESUME BUTTON */}
              <button
                type="button"
                onClick={togglePause}
                className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black tracking-widest uppercase rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                RESUME FLIGHT
              </button>
              
              {/* QUIT BUTTON */}
              <button
                type="button"
                onClick={handleEject}
                className="w-full py-3 px-4 bg-black/40 hover:bg-red-950/30 border border-slate-900 hover:border-red-900/40 text-red-400 text-xs font-black tracking-widest uppercase rounded-xl transition-all active:scale-95 cursor-pointer"
              >
                QUIT MATCH
              </button>
            </div>
            
            <p className="text-[8px] text-slate-500 uppercase mt-4 tracking-wider">
              Press [ESC] to instantly resume flight
            </p>
          </div>
        </div>
      )}

      {/* HANGAR LOBBY MAIN MENU DASHBOARD */}
      {!isPlaying && !showDebrief && (
        <div id="lobby-panel" className="absolute inset-0 z-30 pointer-events-auto overflow-y-auto">
          <MainMenu
            progression={progression}
            onLaunchMatch={handleLaunchMatch}
            onUpdateProgression={saveProgression}
            onOpenRegistration={() => setShowRegistration(true)}
          />
        </div>
      )}

      {/* PILOT REGISTRATION — opt-in via PROFILE button, never a gate */}
      {(!isPlaying && !showDebrief && showRegistration) && (
        <PilotRegistration
          progression={progression}
          onComplete={(updated) => {
            saveProgression(updated);
            setShowRegistration(false);
          }}
          onClose={() => setShowRegistration(false)}
        />
      )}

      {/* POST-MATCH DEBRIEFING DIALOG OVERLAY */}
      {showDebrief && debriefData && (
        <div id="dialog-debrief" className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto animate-fadeIn font-mono">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl max-w-lg w-full text-center shadow-2xl relative">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-600 to-amber-500 rounded-t-xl"></div>
            
            {/* Medallions or custom ribbons */}
            <div className="mx-auto w-16 h-16 rounded-full bg-slate-950 border border-amber-500 flex items-center justify-center text-amber-500 mb-4 animate-bounce">
              <Trophy size={28} />
            </div>

            <h2 className="text-2xl font-extrabold tracking-widest uppercase font-sans">
              Deployment Complete
            </h2>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">Operational Debriefing Card</p>
            {debriefData.missionName && (
              <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
                {debriefData.missionName}
              </p>
            )}

            <div className="text-[28px] font-black tracking-widest mt-5 uppercase">
              {debriefData.victory ? (
                <span className="text-emerald-400">MISSION VICTORY</span>
              ) : (
                <span className="text-red-500">MISSION DEFEAT</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3.5 mt-6 border-y border-slate-800/80 py-4 text-xs">
              <div className="bg-slate-950 p-3 rounded">
                <span className="text-[18px] font-sans font-bold text-emerald-400 block">{debriefData.kills}</span>
                <span className="text-[9px] uppercase font-bold text-gray-500 block">Enemy Down</span>
              </div>
              <div className="bg-slate-950 p-3 rounded">
                <span className="text-[18px] font-sans font-bold text-indigo-400 block">{debriefData.structures}</span>
                <span className="text-[9px] uppercase font-bold text-gray-400 block">Bases Slain</span>
              </div>
              <div className="bg-slate-950 p-3 rounded">
                <span className="text-[18px] font-sans font-bold text-amber-400 block">+{debriefData.xpEarned}</span>
                <span className="text-[9px] uppercase font-bold text-gray-400 block">XP Earned</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-1 text-left bg-slate-950 p-4 rounded-lg border border-slate-850 text-xs text-slate-300 leading-normal">
              <div className="flex items-center gap-2 font-bold text-amber-500">
                <Award size={14} />
                <span>Aviator Compensation Policy</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                You have been compensated with standard aircraft allowances. Heavy bomb payloads and dogfighting records are indexed in persistent service logs.
              </p>
            </div>

            <button
              id="btn-close-debrief"
              onClick={() => {
                setShowDebrief(false);
                setDebriefData(null);
              }}
              className="mt-6 w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded cursor-pointer transition-all uppercase tracking-widest font-sans text-xs flex justify-center items-center gap-2 hover:shadow border-t border-red-400"
            >
              <span>Return to Hangar Lobby</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

    </main>
  );
}
