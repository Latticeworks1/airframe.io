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
  const [isLoadingProgression, setIsLoadingProgression] = useState(true);
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
  const activeEngineRef = useRef<GameEngine | null>(null);
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
  const [killPopups, setKillPopups] = useState<Array<{ key: number; value: number }>>([]);
  const killPopupKeyRef = useRef(0);
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
    const player = activeEngineRef.current?.pilots.find(p => p.id === "player");
    const canUseBombSight = cameraModeRef.current === "bombsight" ||
      (player && player.specs.weapons.includes(WeaponType.BOMB) && (player.ammo[WeaponType.BOMB] ?? 0) > 0);
    if (!canUseBombSight) return;
    setActiveCameraMode(
      cameraModeRef.current === "bombsight"
        ? "third-person"
        : "bombsight"
    );
  };

  // Presence ping: registers this client as online while on the main menu so
  // lobby viewers count toward the total shown in the health endpoint
  useEffect(() => {
    if (isPlaying) return;
    const sid = getMultiplayerSessionId();
    const ping = () => fetch(`/api/presence?sid=${encodeURIComponent(sid)}`).catch(() => {});
    ping();
    const id = setInterval(ping, 30_000);
    return () => clearInterval(id);
  }, [isPlaying]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        if (isPlaying) {
          e.preventDefault();
          togglePause();
        }
      }
      // Delete: self-destruct when stuck (wings gone or aircraft stranded on ground)
      if (e.key === "Delete" && isPlaying) {
        const eng = activeEngineRef.current;
        if (!eng) return;
        const player = eng.pilots.find(p => p.id === "player");
        if (player && player.damage.fuselage > 0) {
          const speed = Math.sqrt(player.vx ** 2 + player.vy ** 2 + player.vz ** 2);
          const wingsGone = player.damage.leftWing <= 0 || player.damage.rightWing <= 0;
          if (wingsGone || speed < 5) {
            player.damage.fuselage = 0;
            player.damage.engine = 0;
          }
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

  // Load persistence — query the backend persistent bucket first, fall back and migrate local cache
  useEffect(() => {
    const loadData = async () => {
      const sid = getMultiplayerSessionId();
      let base: UserProgression | null = null;

      try {
        const res = await fetch(`/api/progression?sid=${encodeURIComponent(sid)}`);
        if (res.ok) {
          const serverData = await res.json();
          if (serverData && serverData.status !== "not_found") {
            base = {
              ...INITIAL_PROGRESSION,
              ...serverData,
              stats: { ...INITIAL_PROGRESSION.stats, ...(serverData.stats || {}) },
              equippedMods: serverData.equippedMods || {},
              unlockedPlanes: serverData.unlockedPlanes || ["falcon-mk2"]
            };
          }
        }
      } catch (e) {
        console.warn("Failed fetching progression from server, falling back to cache", e);
      }

      // Fall back to local storage cache if not found on server (migration path)
      if (!base) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed) {
            base = {
              ...INITIAL_PROGRESSION,
              ...parsed,
              stats: { ...INITIAL_PROGRESSION.stats, ...(parsed.stats || {}) },
              equippedMods: parsed.equippedMods || {},
              unlockedPlanes: parsed.unlockedPlanes || ["falcon-mk2"]
            };

            // Migrate browser-bound local save to the server
            await fetch("/api/progression", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: sid, progression: base })
            }).catch(e => console.warn("Failed migrating local storage save to server", e));
          }
        } catch (e) {
          console.warn("Failed loading progression from local storage", e);
        }
      }

      // If still no profile exists (first load), create a new cadet
      if (!base) {
        base = {
          ...INITIAL_PROGRESSION,
          nickname: generateCallsign(),
          rankCode: "CDT",
          unlockedPlanes: ["falcon-mk2"]
        };

        // Write new profile to server
        await fetch("/api/progression", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, progression: base })
        }).catch(e => console.warn("Failed saving new profile to server", e));
      }

      // Always write to local storage as fallback/cache
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
      } catch (e) {
        console.warn("Failed to write fallback cache to local storage", e);
      }

      setProgression(base);
      setIsLoadingProgression(false);
    };

    loadData();
  }, []);

  const saveProgression = (updated: UserProgression) => {
    setProgression(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("localStorage persistence error", e);
    }
    // Persist to server-side bucket storage asynchronously
    const sid = getMultiplayerSessionId();
    fetch("/api/progression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, progression: updated })
    }).catch(e => console.warn("Failed saving progression to server", e));
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
        if (killEvt.killerName.includes("You")) {
          try { beep(440, "triangle", 0.08); } catch(_) {}
          const score = killEvt.method === "Heavy Ordnance" ? 200 : 300;
          const key = ++killPopupKeyRef.current;
          setKillPopups(prev => [...prev, { key, value: score }]);
          setTimeout(() => setKillPopups(prev => prev.filter(p => p.key !== key)), 1600);
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
    activeEngineRef.current = engine;

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
              // Host displaces a bot to make room for the real player
              if (engine.isHost) engine.removeBot(player.team);
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
              // Store snapshot for dead-reckoning; position/orientation blended in the loop
              const sq = new Quaternion().setFromEuler(new Euler(msg.state.pitch, msg.state.yaw, msg.state.roll, "YXZ"));
              remote.netSnap = {
                x: msg.state.x, y: msg.state.y, z: msg.state.z,
                vx: msg.state.vx, vy: msg.state.vy, vz: msg.state.vz,
                qx: sq.x, qy: sq.y, qz: sq.z, qw: sq.w,
                at: performance.now()
              };
            }
          }

          else if (msg.type === "player_left") {
            engine.pilots = engine.pilots.filter(p => p.id !== msg.id);
            // Host fills the vacated slot with a bot
            if (engine.isHost && msg.team) engine.addBot(msg.team as 1 | 2);
          }

          else if (msg.type === "player_fired") {
            const remote = engine.pilots.find(p => p.id === msg.id);
            if (remote) {
              engine.spawnProjectile(remote, msg.weaponType);
            }
          }

          else if (msg.type === "voxel_impact") {
            const lv = new Vector3(msg.lx, msg.ly, msg.lz);
            renderer3D.deformAircraft(msg.targetId, lv, msg.blast);
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
              const botSnapAt = performance.now();
              msg.bots.forEach((syncBot: any) => {
                const localBot = engine.pilots.find(p => p.id === syncBot.id);
                if (localBot) {
                  localBot.vx = syncBot.vx;
                  localBot.vy = syncBot.vy;
                  localBot.vz = syncBot.vz;
                  localBot.throttle = syncBot.throttle;
                  localBot.damage = syncBot.damage;
                  const bq = new Quaternion().setFromEuler(new Euler(syncBot.pitch, syncBot.yaw, syncBot.roll, "YXZ"));
                  localBot.netSnap = {
                    x: syncBot.x, y: syncBot.y, z: syncBot.z,
                    vx: syncBot.vx, vy: syncBot.vy, vz: syncBot.vz,
                    qx: bq.x, qy: bq.y, qz: bq.z, qw: bq.w,
                    at: botSnapAt
                  };
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
    engine.onVoxelHit = (targetId, localOffsetMeters, blastMeters) => {
      renderer3D.deformAircraft(targetId, localOffsetMeters, blastMeters);
      if (isMultiplayer && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "voxel_impact",
          targetId,
          lx: localOffsetMeters.x, ly: localOffsetMeters.y, lz: localOffsetMeters.z,
          blast: blastMeters
        }));
      }
    };

    engine.onPilotRespawn = (pilotId: string) => {
      renderer3D.resetVoxelState(pilotId);
    };

    engine.getVoxelImpact = (targetId, segStartLocal, segEndLocal) => {
      return renderer3D.findVoxelImpact(targetId, segStartLocal, segEndLocal);
    };
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

    // Reusable objects for remote interpolation — allocated once to avoid GC pressure
    const _netQ = new Quaternion();
    const _netQSnap = new Quaternion();
    const _netEuler = new Euler();
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
      if (isMultiplayer && socket && socket.readyState === WebSocket.OPEN && now - lastSendTime > 16) {
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

      // Dead-reckon remote pilots: extrapolate from last network snapshot using that
      // snapshot's velocity, then blend the displayed position toward the extrapolated
      // position with exponential smoothing so corrections arrive without a hard snap.
      if (isMultiplayer) {
        const snapNow = performance.now();
        const alpha = 1 - Math.exp(-dt * 25);
        for (const pilot of engine.pilots) {
          if (pilot.id === "player" || !pilot.netSnap) continue;
          const snap = pilot.netSnap;
          const age = (snapNow - snap.at) / 1000;
          pilot.x += (snap.x + snap.vx * age - pilot.x) * alpha;
          pilot.y += (snap.y + snap.vy * age - pilot.y) * alpha;
          pilot.z += (snap.z + snap.vz * age - pilot.z) * alpha;
          _netQSnap.set(snap.qx, snap.qy, snap.qz, snap.qw);
          _netQ.setFromEuler(_netEuler.set(pilot.pitch, pilot.yaw, pilot.roll, "YXZ"));
          _netQ.slerp(_netQSnap, alpha);
          _netEuler.setFromQuaternion(_netQ, "YXZ");
          pilot.pitch = _netEuler.x;
          pilot.yaw = _netEuler.y;
          pilot.roll = _netEuler.z;
        }
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
            killPopups={killPopups}
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

      {/* PAUSE / SCOREBOARD OVERLAY */}
      {isPlaying && isPaused && (() => {
        const allPilots = hudSnapshot.pilots;
        const renderTeam = (team: 1 | 2) => {
          const color = team === 1 ? { hdr: "text-rose-400", border: "border-rose-500/25", row: "bg-rose-950/10" } : { hdr: "text-sky-400", border: "border-sky-500/25", row: "bg-sky-950/10" };
          const teamScore = team === 1 ? hudSnapshot.team1Score : hudSnapshot.team2Score;
          const pilots = [...allPilots].filter(p => p.team === team).sort((a, b) => b.score - a.score);
          return (
            <div key={team} className="flex-1 min-w-0">
              <div className={`flex items-center justify-between pb-1.5 mb-2 border-b ${color.border}`}>
                <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${color.hdr}`}>Team {team}</span>
                <span className={`text-[11px] font-black font-mono ${color.hdr}`}>{teamScore}</span>
              </div>
              <div className="text-[7px] text-slate-600 font-mono tracking-wider grid grid-cols-[1fr_24px_24px_36px_40px] gap-x-2 px-1 mb-1">
                <span>PILOT</span><span className="text-right">K</span><span className="text-right">D</span><span className="text-right">KDR</span><span className="text-right">SCR</span>
              </div>
              {pilots.map(p => {
                const isMe = p.id === "player";
                const kdr = p.deaths === 0 ? p.kills.toFixed(0) : (p.kills / p.deaths).toFixed(2);
                const nameStyle = isMe ? "text-amber-300 font-black" : p.isBot ? "text-slate-500" : "text-slate-200 font-bold";
                return (
                  <div key={p.id} className={`grid grid-cols-[1fr_24px_24px_36px_40px] gap-x-2 px-1 py-0.5 rounded text-[8px] font-mono ${isMe ? "bg-amber-950/30" : p.isBot ? "" : color.row}`}>
                    <span className={`truncate ${nameStyle}`}>{p.name}{p.isBot ? "" : " ★"}</span>
                    <span className="text-right text-slate-300">{p.kills}</span>
                    <span className="text-right text-slate-400">{p.deaths}</span>
                    <span className="text-right text-slate-400">{kdr}</span>
                    <span className={`text-right font-black ${isMe ? "text-amber-300" : "text-slate-300"}`}>{p.score}</span>
                  </div>
                );
              })}
            </div>
          );
        };
        return (
          <div id="tactical-pause-overlay" className="absolute inset-0 z-50 bg-[#050a12]/88 backdrop-blur-md flex items-start justify-center pt-10 px-4 pointer-events-auto font-mono animate-fadeIn overflow-y-auto">
            <div className="w-full max-w-5xl">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <span className="text-[9px] text-amber-500 font-extrabold tracking-[0.25em] uppercase block">GAME PAUSED</span>
                  <span className="text-[11px] text-slate-400 font-mono">{hudSnapshot.pilots.filter(p => !p.isBot).length} real players · {hudSnapshot.pilots.filter(p => p.isBot).length} bots</span>
                </div>
                <button type="button" onClick={togglePause} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black tracking-widest uppercase rounded-lg cursor-pointer">
                  RESUME [ESC]
                </button>
              </div>

              {/* Scoreboard */}
              <div className="flex gap-6 mb-6">
                {renderTeam(1)}
                <div className="w-px bg-slate-800" />
                {renderTeam(2)}
              </div>

              {/* Settings row */}
              <div className="border-t border-slate-800 pt-4 flex flex-wrap gap-3 items-center justify-between">
                <div className="flex gap-3 flex-wrap">
                  <button type="button"
                    onClick={() => { const u = { ...progression, invertMouseY: !progression.invertMouseY }; saveProgression(u); if (activeEngine) { const pl = activeEngine.pilots.find(p => p.id === "player"); if (pl) pl.invertMouseY = u.invertMouseY ?? false; } }}
                    className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black cursor-pointer"
                  >
                    PITCH INVERT: <span className={progression.invertMouseY ? "text-amber-400" : "text-slate-500"}>{progression.invertMouseY ? "ON" : "OFF"}</span>
                  </button>
                  <button type="button"
                    onClick={() => { const u = { ...progression, invertMouseX: !progression.invertMouseX }; saveProgression(u); if (activeEngine) { const pl = activeEngine.pilots.find(p => p.id === "player"); if (pl) pl.invertMouseX = u.invertMouseX ?? false; } }}
                    className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black cursor-pointer"
                  >
                    ROLL INVERT: <span className={progression.invertMouseX ? "text-amber-400" : "text-slate-500"}>{progression.invertMouseX ? "ON" : "OFF"}</span>
                  </button>
                </div>
                <button type="button" onClick={handleEject} className="px-4 py-2 border border-red-900/50 text-red-400 text-[9px] font-black rounded-lg hover:bg-red-950/30 cursor-pointer">
                  QUIT MATCH
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* PILOT PROFILE SYNCHRONIZATION OVERLAY */}
      {isLoadingProgression && (
        <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center font-mono text-slate-100 animate-fadeIn">
          <div className="relative flex flex-col items-center max-w-sm w-full px-6 text-center">
            {/* Spinning combat flight systems HUD loader */}
            <div className="w-12 h-12 rounded-full border-2 border-slate-800 border-t-amber-500 animate-spin mb-6"></div>
            <h1 className="text-sm font-bold tracking-[0.25em] text-amber-500 uppercase mb-2">
              AIRFRAME LINK
            </h1>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest animate-pulse">
              Syncing pilot profile...
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
