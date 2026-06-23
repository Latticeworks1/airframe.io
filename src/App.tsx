/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import {
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
  GroundTarget,
  UserProgression
} from "./types";
import { MainMenu } from "./components/MainMenu";
import { PilotRegistration } from "./components/PilotRegistration";
import { GameHUD } from "./components/GameHUD";
import { GameEngine } from "./game/gameEngine";
import { WorldRenderer } from "./game/worldRenderer";
import { InputManager } from "./game/inputManager";
import { MAP_REGISTRY } from "./game/content/maps/registry";
import { KnownMaps } from "./game/content/maps/mapTypes";
import { loadHeightmap } from "./game/terrainModel";
import { Vector3, Quaternion, Euler } from "three";

// Screens and hooks
import { PauseMenu } from "./components/screens/PauseMenu";
import { DebriefOverlay } from "./components/screens/DebriefOverlay";
import { SyncLoader } from "./components/screens/SyncLoader";
import { useProgression, getMultiplayerSessionId } from "./hooks/useProgression";
import { useMultiplayer } from "./hooks/useMultiplayer";

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

export default function App() {
  const { progression, isLoadingProgression, saveProgression } = useProgression();
  const {
    chatMessages,
    connectMultiplayer,
    disconnectMultiplayer,
    sendChat,
    socketRef,
    dataChansRef,
    myPilotIdRef,
  } = useMultiplayer();

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

  const [killPopups, setKillPopups] = useState<Array<{ key: number; value: number }>>([]);
  const killPopupKeyRef = useRef(0);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [showTacticalMap, setShowTacticalMap] = useState(false);

  const togglePause = () => {
    const newVal = !isPausedRef.current;
    isPausedRef.current = newVal;
    setIsPaused(newVal);
    if (newVal) {
      setShowTacticalMap(false);
    }
  };

  const setActiveCameraMode = (next: CameraMode) => {
    cameraModeRef.current = next;
    setCameraMode(next);
    renderer3DRef.current?.setCameraMode(next, "player");
  };

  const toggleCameraMode = () => {
    setActiveCameraMode(
      cameraModeRef.current === "first-person" ? "third-person" : "first-person"
    );
  };

  const toggleBombSight = () => {
    const player = activeEngineRef.current?.pilots.find(p => p.id === "player");
    const canUseBombSight =
      cameraModeRef.current === "bombsight" ||
      (player &&
        player.specs.weapons.includes(WeaponType.BOMB) &&
        (player.ammo[WeaponType.BOMB] ?? 0) > 0);
    if (!canUseBombSight) return;
    setActiveCameraMode(cameraModeRef.current === "bombsight" ? "third-person" : "bombsight");
  };

  // Presence ping
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
          if (showTacticalMap) {
            setShowTacticalMap(false);
          } else {
            togglePause();
          }
        }
      }
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
  }, [isPlaying, showTacticalMap]);

  useEffect(() => {
    if (hitmarker.active) {
      const timer = setTimeout(() => {
        setHitmarker(prev => ({ ...prev, active: false }));
      }, 180);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitmarker.key]);

  const saveProgressionAndSyncEngine = (updated: UserProgression) => {
    saveProgression(updated);
    if (activeEngineRef.current) {
      const player = activeEngineRef.current.pilots.find(p => p.id === "player");
      if (player) {
        player.invertMouseY = updated.invertMouseY ?? false;
        player.invertMouseX = updated.invertMouseX ?? false;
        if (updated.controlMode) {
          player.controlMode = updated.controlMode;
        }
      }
    }
  };

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

    if (mapDef.terrain.kind === "heightmap") {
      try {
        await loadHeightmap(mapDef.terrain.path, mapDef.world.radius, mapDef.terrain.elevationScale);
      } catch (e) {
        console.error("Failed to pre-load heightmap:", e);
      }
    }

    const renderer3D = new WorldRenderer(canvasContainerRef.current, mapDef, () => {
      console.log("WebGL World initialized successfully.");
    });
    renderer3DRef.current = renderer3D;
    renderer3D.setCameraMode(cameraModeRef.current, "player");

    const engine = new GameEngine(
      planeId,
      belt,
      mods,
      mapId,
      mode,
      (killEvt) => {
        if (killEvt.killerName.includes("You")) {
          try {
            beep(440, "triangle", 0.08);
          } catch (_) {}
          const score = killEvt.method === "Heavy Ordnance" ? 200 : 300;
          const key = ++killPopupKeyRef.current;
          setKillPopups(prev => [...prev, { key, value: score }]);
          setTimeout(() => setKillPopups(prev => prev.filter(p => p.key !== key)), 1600);
        }
      },
      (victory, xpEarned) => {
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
      const size = type === WeaponType.BOMB ? 2.8 : type === WeaponType.ROCKET ? 1.5 : 0.55;
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

    const inputManager = new InputManager();
    inputManagerRef.current = inputManager;
    inputManager.onCameraToggle = toggleCameraMode;
    inputManager.onBombSightToggle = toggleBombSight;
    inputManager.onTacticalMapToggle = () => {
      if (!isPausedRef.current) {
        setShowTacticalMap(current => !current);
      }
    };
    inputManager.init();

    if (isMultiplayer) {
      connectMultiplayer(
        engine,
        renderer3D,
        mapId,
        mode,
        progression.nickname ?? "PILOT",
        progression.customizations.skin ?? "default",
        (tgtId, isGround) => {
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
        },
        (reason) => {
          if (reason === "duplicate_session") {
            window.alert("This pilot is already active in another multiplayer match.");
          }
          disconnectMultiplayer();
          setActiveEngine(null);
          setIsPlaying(false);
        }
      );
    }

    engine.onVoxelHit = (targetId, localOffsetMeters, blastMeters) => {
      renderer3D.deformAircraft(targetId, localOffsetMeters, blastMeters);
      if (isMultiplayer && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "voxel_impact",
            targetId,
            lx: localOffsetMeters.x,
            ly: localOffsetMeters.y,
            lz: localOffsetMeters.z,
            blast: blastMeters
          })
        );
      }
    };

    engine.onPilotRespawn = (pilotId: string) => {
      renderer3D.resetVoxelState(pilotId);
    };

    engine.getVoxelImpact = (targetId, segStartLocal, segEndLocal) => {
      return renderer3D.findVoxelImpact(targetId, segStartLocal, segEndLocal);
    };

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

    type TelemetryFrame = {
      t: number; spd: number; alt: number; thr: number;
      avP: number; avQ: number; avR: number;
      mx: number; my: number; mz: number;
      aoa: number; ss: number; qPa: number;
      lw: boolean; rw: boolean; sev: number;
      elv: number; ail: number; rud: number;
      pitch: number; roll: number; yaw: number;
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

    const _netQ = new Quaternion();
    const _netQSnap = new Quaternion();
    const _netEuler = new Euler();

    const loop = (now: number) => {
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      const inputFrame = inputManager.getInputFrame();

      const localPlayer = engine.pilots.find(p => p.id === "player");
      if (localPlayer && localPlayer.damage.fuselage > 0) {
        const pos = new Vector3(localPlayer.x, localPlayer.y, localPlayer.z);

        const rot = new Quaternion().setFromEuler(
          new Euler(localPlayer.pitch, localPlayer.yaw, localPlayer.roll, "YXZ")
        );
        const forward = new Vector3(0, 0, 1).applyQuaternion(rot).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(rot).normalize();
        const right = new Vector3(1, 0, 0).applyQuaternion(rot).normalize();

        const pitchMultiplier = progression.invertMouseY ? -1 : 1;
        const rollMultiplier = progression.invertMouseX ? -1 : 1;

        const isFreeLook = inputFrame.rightMouse;
        if (!activeAimPosInitialized) {
          activeAimPos.x = inputFrame.mousePos.x;
          activeAimPos.y = inputFrame.mousePos.y;
          activeAimPosInitialized = true;
        } else if (!isFreeLook) {
          activeAimPos.x += (inputFrame.mousePos.x - activeAimPos.x) * Math.min(1.0, dt * 10);
          activeAimPos.y += (inputFrame.mousePos.y - activeAimPos.y) * Math.min(1.0, dt * 10);
        }

        playerTargetPoint
          .copy(pos)
          .addScaledVector(forward, 240)
          .addScaledVector(right, activeAimPos.x * 125 * rollMultiplier)
          .addScaledVector(up, activeAimPos.y * 95 * pitchMultiplier);
      }

      if (!isPausedRef.current) {
        engine.secondaryWeaponPreference =
          cameraModeRef.current === "bombsight" ? WeaponType.BOMB : null;
        engine.update(dt, inputFrame, playerTargetPoint);
      }

      const playerIsDead = !localPlayer || localPlayer.damage.fuselage <= 0;
      if (playerWasDead && localPlayer && !playerIsDead) {
        activeAimPos.x = 0;
        activeAimPos.y = 0;
        activeAimPosInitialized = true;
        inputManager.recenterAim();
        playerTargetPoint.set(localPlayer.x, localPlayer.y, localPlayer.z);
      }
      playerWasDead = playerIsDead;

      if (isMultiplayer && now - lastSendTime > 16) {
        lastSendTime = now;
        if (localPlayer) {
          const r1 = (v: number) => Math.round(v * 10) / 10;
          const r3 = (v: number) => Math.round(v * 1000) / 1000;
          const r2d = (v: number) => Math.round(v * 100) / 100;
          const dm = localPlayer.damage;
          const pilotState = {
            x: r1(localPlayer.x),
            y: r1(localPlayer.y),
            z: r1(localPlayer.z),
            vx: r2d(localPlayer.vx),
            vy: r2d(localPlayer.vy),
            vz: r2d(localPlayer.vz),
            pitch: r3(localPlayer.pitch),
            yaw: r3(localPlayer.yaw),
            roll: r3(localPlayer.roll),
            throttle: r2d(localPlayer.throttle),
            damage: {
              engine: r2d(dm.engine),
              leftWing: r2d(dm.leftWing),
              rightWing: r2d(dm.rightWing),
              tail: r2d(dm.tail),
              cockpit: r2d(dm.cockpit),
              fuelTank: r2d(dm.fuelTank),
              fuselage: r2d(dm.fuselage),
              hasFire: dm.hasFire,
              hasOilLeak: dm.hasOilLeak
            },
            ammo: localPlayer.ammo,
            score: localPlayer.score,
            kills: localPlayer.kills,
            deaths: localPlayer.deaths
          };

          // Send to server for state bookkeeping (new joiner welcome snapshots)
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "update", pilotState }));
          }

          // Also broadcast directly to peers via DataChannels (bypasses HF proxy)
          const dcPayload = JSON.stringify({
            type: "player_updated",
            id: myPilotIdRef.current,
            state: pilotState
          });
          dataChansRef.current.forEach(dc => {
            if (dc.readyState === "open") dc.send(dcPayload);
          });
        }

        if (engine.isHost) {
          const syncBots = engine.pilots
            .filter(p => p.isBot)
            .map(b => {
              const bd = b.damage;
              return {
                id: b.id,
                x: Math.round(b.x * 10) / 10,
                y: Math.round(b.y * 10) / 10,
                z: Math.round(b.z * 10) / 10,
                vx: Math.round(b.vx * 100) / 100,
                vy: Math.round(b.vy * 100) / 100,
                vz: Math.round(b.vz * 100) / 100,
                pitch: Math.round(b.pitch * 1000) / 1000,
                yaw: Math.round(b.yaw * 1000) / 1000,
                roll: Math.round(b.roll * 1000) / 1000,
                throttle: Math.round(b.throttle * 100) / 100,
                damage: {
                  engine: Math.round(bd.engine * 100) / 100,
                  leftWing: Math.round(bd.leftWing * 100) / 100,
                  rightWing: Math.round(bd.rightWing * 100) / 100,
                  tail: Math.round(bd.tail * 100) / 100,
                  cockpit: Math.round(bd.cockpit * 100) / 100,
                  fuelTank: Math.round(bd.fuelTank * 100) / 100,
                  fuselage: Math.round(bd.fuselage * 100) / 100,
                  hasFire: bd.hasFire,
                  hasOilLeak: bd.hasOilLeak
                }
              };
            });

          const botsPayload = JSON.stringify({ type: "bots_updated", bots: syncBots });
          const scorePayload = JSON.stringify({
            type: "scores_updated",
            team1Score: engine.team1Score,
            team2Score: engine.team2Score,
            matchTimer: Math.round(engine.matchTimer * 10) / 10
          });

          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "bots_sync", bots: syncBots }));
            socketRef.current.send(JSON.stringify({
              type: "score_sync",
              team1Score: engine.team1Score,
              team2Score: engine.team2Score,
              matchTimer: Math.round(engine.matchTimer * 10) / 10
            }));
          }

          dataChansRef.current.forEach(dc => {
            if (dc.readyState === "open") {
              dc.send(botsPayload);
              dc.send(scorePayload);
            }
          });
        }
      }

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
          campaignState: engine.campaignState ? { ...engine.campaignState } : null
        });
      }

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
          const fps = (fpsFrameCount * 1000) / fpsElapsed;
          const frameMs = fps > 0 ? 1000 / fps : 0;
          const { drawCalls, triangles } = renderer3D.getRenderStats();
          const trisK = (triangles / 1000).toFixed(1);
          fpsElement.textContent = `${Math.round(
            fps
          )} FPS · ${frameMs.toFixed(1)} MS · ${drawCalls} DC · ${trisK}K TRI`;
          fpsElement.dataset.level = fps >= 55 ? "good" : fps >= 35 ? "warn" : "bad";
        }
        fpsWindowStart = now;
        fpsFrameCount = 0;
      }

      if (localPlayer?.physicsDebug) {
        const d = localPlayer.physicsDebug;
        const spd = Math.sqrt(localPlayer.vx ** 2 + localPlayer.vy ** 2 + localPlayer.vz ** 2) * 3.6;
        const bodyQ = new Quaternion().setFromEuler(
          new Euler(localPlayer.pitch, localPlayer.yaw, localPlayer.roll, "YXZ")
        );
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
        const controlModeVal =
          localPlayer.controlMode === ControlMode.MouseJoystick
            ? 1
            : localPlayer.controlMode === ControlMode.KeyboardDirect
            ? 2
            : 0;
        telemPending.push({
          t: roundTelemetry(localPlayer.physicsTime ?? 0, 3),
          spd: roundTelemetry(spd, 1),
          alt: roundTelemetry(localPlayer.y, 1),
          thr: roundTelemetry(localPlayer.throttle, 2),
          avP: roundTelemetry((localPlayer.avz ?? 0) * 57.296, 2),
          avQ: roundTelemetry(-(localPlayer.avx ?? 0) * 57.296, 2),
          avR: roundTelemetry((localPlayer.avy ?? 0) * 57.296, 2),
          mx: roundTelemetry(d.aeroTorqueX, 0),
          my: roundTelemetry(d.aeroTorqueY, 0),
          mz: roundTelemetry(d.aeroTorqueZ, 0),
          aoa: roundTelemetry(d.aoaDeg, 2),
          ss: roundTelemetry(d.sideslipDeg, 2),
          qPa: roundTelemetry(d.dynamicPressure, 0),
          lw: d.leftWingStalled,
          rw: d.rightWingStalled,
          elv: roundTelemetry(d.elevatorDeflection, 3),
          ail: roundTelemetry(d.aileronDeflection, 3),
          rud: roundTelemetry(d.rudderDeflection, 3),
          pitch: roundTelemetry(-localPlayer.pitch, 4),
          roll: roundTelemetry(localPlayer.roll, 4),
          yaw: roundTelemetry(localPlayer.yaw, 4),
          px: roundTelemetry(localPlayer.x, 1),
          py: roundTelemetry(localPlayer.y, 1),
          pz: roundTelemetry(localPlayer.z, 1),
          fwX: roundTelemetry(fwd.x, 4),
          fwY: roundTelemetry(fwd.y, 4),
          fwZ: roundTelemetry(fwd.z, 4),
          upX: roundTelemetry(upv.x, 4),
          upY: roundTelemetry(upv.y, 4),
          upZ: roundTelemetry(upv.z, 4),
          rtX: roundTelemetry(rgt.x, 4),
          rtY: roundTelemetry(rgt.y, 4),
          rtZ: roundTelemetry(rgt.z, 4),
          cm: controlModeVal,
          cp: roundTelemetry(localPlayer.lastCommand?.pitch ?? 0, 3),
          cr: roundTelemetry(localPlayer.lastCommand?.roll ?? 0, 3),
          cy: roundTelemetry(localPlayer.lastCommand?.yaw ?? 0, 3),
          mp: manualPitch,
          mr: manualRoll,
          myw: roundTelemetry(manualYaw, 2),
          ax: roundTelemetry(activeAimPos.x, 3),
          ay: roundTelemetry(activeAimPos.y, 3),
          sev: roundTelemetry(d.stallSeverity, 3)
        });
      }

      inputManager.clearPressedEdges();
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    (canvasContainerRef as any).current.cleanupHandler = () => {
      cancelAnimationFrame(animId);
      clearInterval(telemFlushInterval);
      flushTelemetry();
      telemWs.close();
      inputManager.destroy();
      inputManagerRef.current = null;

      disconnectMultiplayer();

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
    const player = engine.pilots.find(p => p.id === "player");
    const kills = player ? player.kills : 0;
    const structures = engine.targetsDestroyedThisMatch;

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

    const updatedStats = {
      battlesPlayed: progression.stats.battlesPlayed + 1,
      kills: progression.stats.kills + kills,
      deaths: progression.stats.deaths + (player ? player.deaths : 0),
      groundTargetsDestroyed: progression.stats.groundTargetsDestroyed + structures,
      victories: progression.stats.victories + (victory ? 1 : 0)
    };

    const updated: UserProgression = {
      ...progression,
      totalXp: progression.totalXp + xpEarned,
      completedCampaignMissions:
        victory && engine.campaignMission
          ? Array.from(
              new Set([...(progression.completedCampaignMissions ?? []), engine.campaignMission.id])
            )
          : progression.completedCampaignMissions,
      stats: updatedStats
    };
    saveProgressionAndSyncEngine(updated);

    if (canvasContainerRef.current && (canvasContainerRef as any).current.cleanupHandler) {
      (canvasContainerRef as any).current.cleanupHandler();
      (canvasContainerRef as any).current.cleanupHandler = null;
    }
  };

  const handleEject = () => {
    if (activeEngine) {
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
    <main
      id="app-viewport-frame"
      className="relative w-screen h-screen overflow-hidden bg-black text-white"
    >
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
              saveProgressionAndSyncEngine({
                ...progression,
                invertMouseY: !progression.invertMouseY
              });
            }}
            invertMouseX={progression.invertMouseX || false}
            onToggleInvertMouseX={() => {
              saveProgressionAndSyncEngine({
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
            onSendChat={(text) => sendChat(text, progression.nickname ?? "PILOT")}
          />
        </div>
      )}

      {/* PAUSE / SCOREBOARD OVERLAY */}
      {isPlaying && isPaused && (
        <PauseMenu
          pilots={hudSnapshot.pilots}
          team1Score={hudSnapshot.team1Score}
          team2Score={hudSnapshot.team2Score}
          progression={progression}
          onTogglePause={togglePause}
          onSaveProgression={saveProgressionAndSyncEngine}
          onExit={handleEject}
        />
      )}

      {/* HANGAR LOBBY MAIN MENU DASHBOARD */}
      {!isPlaying && !showDebrief && (
        <div id="lobby-panel" className="absolute inset-0 z-30 pointer-events-auto overflow-y-auto">
          <MainMenu
            progression={progression}
            onLaunchMatch={handleLaunchMatch}
            onUpdateProgression={saveProgressionAndSyncEngine}
            onOpenRegistration={() => setShowRegistration(true)}
          />
        </div>
      )}

      {/* PILOT REGISTRATION */}
      {!isPlaying && !showDebrief && showRegistration && (
        <PilotRegistration
          progression={progression}
          onComplete={(updated) => {
            saveProgressionAndSyncEngine(updated);
            setShowRegistration(false);
          }}
          onClose={() => setShowRegistration(false)}
        />
      )}

      {/* POST-MATCH DEBRIEFING DIALOG OVERLAY */}
      {showDebrief && debriefData && (
        <DebriefOverlay
          victory={debriefData.victory}
          xpEarned={debriefData.xpEarned}
          kills={debriefData.kills}
          structures={debriefData.structures}
          missionName={debriefData.missionName}
          onClose={() => {
            setShowDebrief(false);
            setDebriefData(null);
          }}
        />
      )}

      {/* PILOT PROFILE SYNCHRONIZATION OVERLAY */}
      <SyncLoader isLoading={isLoadingProgression} />
    </main>
  );
}
