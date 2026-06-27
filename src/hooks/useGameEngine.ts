import { useState, useEffect, useRef, useCallback, MutableRefObject } from "react";
import { Vector3, Quaternion } from "three";
import { MatchSimulation } from "../game/matchSimulation";
import { WorldRenderer } from "../game/worldRenderer";
import { InputManager } from "../game/inputManager";
import { FlightPhysicsEngine } from "../game/flightModel";
import { MAP_REGISTRY } from "../game/content/maps/registry";
import { KnownMaps } from "../game/content/maps/mapTypes";
import { loadHeightmap } from "../game/terrainModel";
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
} from "../types";

export type HudSnapshot = {
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

export function beep(freq: number, type: OscillatorType, length: number) {
  try {
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
  } catch (_) {
    // Ignore audio errors
  }
}

export function useGameEngine(
  progression: UserProgression,
  saveProgression: (updated: UserProgression) => void,
  multiplayer: {
    connectMultiplayer: any;
    disconnectMultiplayer: any;
    roomRef: MutableRefObject<any>;
  }
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDebrief, setShowDebrief] = useState(false);
  const [debriefData, setDebriefData] = useState<{
    victory: boolean;
    xpEarned: number;
    kills: number;
    structures: number;
    missionName?: string;
  } | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const renderer3DRef = useRef<WorldRenderer | null>(null);
  const inputManagerRef = useRef<InputManager | null>(null);
  const activeEngineRef = useRef<MatchSimulation | null>(null);
  const [activeEngine, setActiveEngine] = useState<MatchSimulation | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>("third-person");
  const cameraModeRef = useRef<CameraMode>("third-person");

  const [hudSnapshot, setHudSnapshot] = useState<HudSnapshot>({
    pilots: [], groundTargets: [], zones: [], killFeed: [],
    team1Score: 0, team2Score: 0, matchTimer: 360,
    bombSightInfo: null, campaignState: null
  });
  
  const [activeMatchMode, setActiveMatchMode] = useState<MatchMode>(MatchMode.AirSupremacy);
  
  const [hitmarker, setHitmarker] = useState<{ active: boolean; type: "air" | "ground"; key: number }>({
    active: false, type: "air", key: 0
  });
  const [killPopups, setKillPopups] = useState<Array<{ key: number; value: number }>>([]);
  const killPopupKeyRef = useRef(0);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [showTacticalMap, setShowTacticalMap] = useState(false);

  const togglePause = useCallback(() => {
    const newVal = !isPausedRef.current;
    isPausedRef.current = newVal;
    setIsPaused(newVal);
    if (newVal) setShowTacticalMap(false);
  }, []);

  const setActiveCameraMode = useCallback((next: CameraMode) => {
    cameraModeRef.current = next;
    setCameraMode(next);
    renderer3DRef.current?.setCameraMode(next, "player");
  }, []);

  const toggleCameraMode = useCallback(() => {
    setActiveCameraMode(cameraModeRef.current === "first-person" ? "third-person" : "first-person");
  }, [setActiveCameraMode]);

  const toggleBombSight = useCallback(() => {
    const player = activeEngineRef.current?.pilots.find(p => p.id === "player");
    const canUseBombSight =
      cameraModeRef.current === "bombsight" ||
      (player && player.specs.weapons.includes(WeaponType.BOMB) && (player.ammo[WeaponType.BOMB] ?? 0) > 0);
    if (!canUseBombSight) return;
    setActiveCameraMode(cameraModeRef.current === "bombsight" ? "third-person" : "bombsight");
  }, [setActiveCameraMode]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        if (isPlaying) {
          e.preventDefault();
          if (showTacticalMap) setShowTacticalMap(false);
          else togglePause();
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
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isPlaying, showTacticalMap, togglePause]);

  useEffect(() => {
    if (hitmarker.active) {
      const timer = setTimeout(() => setHitmarker(prev => ({ ...prev, active: false })), 180);
      return () => clearTimeout(timer);
    }
  }, [hitmarker.key, hitmarker.active]);

  const saveProgressionAndSyncEngine = useCallback((updated: UserProgression) => {
    saveProgression(updated);
    if (activeEngineRef.current) {
      const player = activeEngineRef.current.pilots.find(p => p.id === "player");
      if (player) {
        player.invertMouseY = updated.invertMouseY ?? false;
        player.invertMouseX = updated.invertMouseX ?? false;
        if (updated.controlMode) player.controlMode = updated.controlMode;
      }
    }
  }, [saveProgression]);

  const handleMatchCompletion = useCallback((
    victory: boolean,
    xpEarned: number,
    engine: MatchSimulation,
    _renderer3D: WorldRenderer
  ) => {
    const player = engine.pilots.find(p => p.id === "player");
    const kills = player ? player.kills : 0;
    const structures = engine.targetsDestroyedThisMatch;

    if (victory) {
      beep(523.25, "sine", 0.15);
      setTimeout(() => beep(659.25, "sine", 0.15), 150);
      setTimeout(() => beep(783.99, "sine", 0.25), 300);
    } else {
      beep(220, "triangle", 0.3);
    }

    setDebriefData({
      victory, xpEarned, kills, structures,
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
      completedCampaignMissions: victory && engine.campaignMission
          ? Array.from(new Set([...(progression.completedCampaignMissions ?? []), engine.campaignMission.id]))
          : progression.completedCampaignMissions,
      stats: updatedStats
    };
    saveProgressionAndSyncEngine(updated);

    if (canvasContainerRef.current && (canvasContainerRef as any).current.cleanupHandler) {
      (canvasContainerRef as any).current.cleanupHandler();
      (canvasContainerRef as any).current.cleanupHandler = null;
    }
  }, [progression, saveProgressionAndSyncEngine]);

  const handleEject = useCallback(() => {
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
  }, [activeEngine]);

  const initThreeAndGame = useCallback(async (
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

    const engine = new MatchSimulation(
      planeId, belt, mods, mapId, mode,
      (killEvt) => {
        if (killEvt.killerName.includes("You")) {
          beep(440, "triangle", 0.08);
          const score = killEvt.method === "Heavy Ordnance" ? 200 : 300;
          const key = ++killPopupKeyRef.current;
          setKillPopups(prev => [...prev, { key, value: score }]);
          setTimeout(() => setKillPopups(prev => prev.filter(p => p.key !== key)), 1600);
        }
      },
      (victory, xpEarned) => handleMatchCompletion(victory, xpEarned, engine, renderer3D),
      progression.nickname,
      startOnGround,
      campaignMissionId
    );

    engine.onLocalPlayerHit = (tgtId, isGround) => {
      if (isGround) beep(260, "triangle", 0.045);
      else beep(680, "sine", 0.04);
      setHitmarker({ active: true, type: isGround ? "ground" : "air", key: Math.random() });
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
      if (!isPausedRef.current) setShowTacticalMap(current => !current);
    };
    inputManager.init();

    if (isMultiplayer) {
      multiplayer.connectMultiplayer(
        engine,
        renderer3D,
        mapId,
        mode,
        progression.nickname ?? "PILOT",
        progression.customizations.skin ?? "default",
        (tgtId: string, isGround: boolean) => {
          if (isGround) beep(260, "triangle", 0.045);
          else beep(680, "sine", 0.04);
          setHitmarker({ active: true, type: isGround ? "ground" : "air", key: Math.random() });
        },
        (reason: string) => {
          if (reason === "duplicate_session") window.alert("This pilot is already active in another multiplayer match.");
          multiplayer.disconnectMultiplayer();
          setActiveEngine(null);
          setIsPlaying(false);
        }
      );
    }

    engine.onVoxelHit = (targetId, localOffsetMeters, blastMeters) => renderer3D.deformAircraft(targetId, localOffsetMeters, blastMeters);
    engine.onPilotRespawn = (pilotId) => renderer3D.resetVoxelState(pilotId);
    engine.getVoxelImpact = (targetId, segStartLocal, segEndLocal) => renderer3D.findVoxelImpact(targetId, segStartLocal, segEndLocal);

    let lastTime = performance.now();
    let animId = 0;
    const playerTargetPoint = new Vector3();
    const activeAimPos = { x: 0, y: 0 };
    let activeAimPosInitialized = false;
    let playerWasDead = false;
    let lastHudSyncTime = 0;
    let fpsWindowStart = performance.now();
    let fpsFrameCount = 0;
    let fpsElement: HTMLElement | null = null;

    let telemPending: any[] = [];
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

    let clientTickSeq = 0;
    let clientAccumulator = 0;
    const CLIENT_TICK_RATE = 1 / 60;
    const pendingInputs: { seq: number; command: any }[] = [];
    const predictionHistory = new Map<number, { position: Vector3; velocity: Vector3; qx: number; qy: number; qz: number; qw: number }>();

    const loop = (now: number) => {
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      const inputFrame = inputManager.getInputFrame();

      const localPlayer = engine.pilots.find(p => p.id === "player");
      if (localPlayer && localPlayer.damage.fuselage > 0) {
        const pos = new Vector3(localPlayer.x, localPlayer.y, localPlayer.z);
        const rot = new Quaternion(localPlayer.qx, localPlayer.qy, localPlayer.qz, localPlayer.qw);
        const forward = new Vector3(0, 0, 1).applyQuaternion(rot).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(rot).normalize();
        const right = new Vector3(1, 0, 0).applyQuaternion(rot).normalize();

        const pitchMultiplier = progression.invertMouseY ? -1 : 1;
        const rollMultiplier = progression.invertMouseX ? -1 : 1;

        if (!activeAimPosInitialized) {
          activeAimPos.x = inputFrame.mousePos.x;
          activeAimPos.y = inputFrame.mousePos.y;
          activeAimPosInitialized = true;
        } else if (!inputFrame.rightMouse) {
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
        engine.secondaryWeaponPreference = cameraModeRef.current === "bombsight" ? WeaponType.BOMB : null;
        engine.update(dt, inputFrame, playerTargetPoint);
      }

      const playerIsDead = !localPlayer || localPlayer.damage.fuselage <= 0;
      if (playerWasDead && localPlayer && !playerIsDead) {
        activeAimPos.x = 0; activeAimPos.y = 0;
        activeAimPosInitialized = true;
        inputManager.recenterAim();
        playerTargetPoint.set(localPlayer.x, localPlayer.y, localPlayer.z);
      }
      playerWasDead = playerIsDead;

      // 1. Client-Side Prediction (Reconciliation)
      if (isMultiplayer && localPlayer && localPlayer.damage.fuselage > 0) {
        const serverPos = (localPlayer as any).serverPosition;
        if (serverPos) {
          const ackSeq = (localPlayer as any).serverLastProcessedSeq;
          while (pendingInputs.length > 0 && pendingInputs[0].seq <= ackSeq) {
            pendingInputs.shift();
          }
          const ackState = predictionHistory.get(ackSeq);
          if (ackState) {
            const dist = serverPos.distanceTo(ackState.position);
            if (dist > 2.5) { // Physics jitter fix threshold
              localPlayer.x = serverPos.x;
              localPlayer.y = serverPos.y;
              localPlayer.z = serverPos.z;
              localPlayer.vx = (localPlayer as any).serverVelocity.x;
              localPlayer.vy = (localPlayer as any).serverVelocity.y;
              localPlayer.vz = (localPlayer as any).serverVelocity.z;
              pendingInputs.forEach((inp) => FlightPhysicsEngine.update(localPlayer, inp.command, CLIENT_TICK_RATE, mapId));
            }
          }
          for (const key of predictionHistory.keys()) {
            if (key < ackSeq) predictionHistory.delete(key);
          }
          (localPlayer as any).serverPosition = null;
        }

        // Fixed tick local loop
        clientAccumulator += dt;
        if (clientAccumulator > 0.1) clientAccumulator = 0.1;
        while (clientAccumulator >= CLIENT_TICK_RATE) {
          clientTickSeq++;
          const controller = engine.getOrCreateController(localPlayer.id);
          const command = controller.update(localPlayer, inputFrame, playerTargetPoint, CLIENT_TICK_RATE);
          localPlayer.lastCommand = command;
          pendingInputs.push({ seq: clientTickSeq, command });

          FlightPhysicsEngine.update(localPlayer, command, CLIENT_TICK_RATE, mapId);
          engine.enforceMapBoundary(localPlayer, CLIENT_TICK_RATE);

          predictionHistory.set(clientTickSeq, {
            position: new Vector3(localPlayer.x, localPlayer.y, localPlayer.z),
            velocity: new Vector3(localPlayer.vx, localPlayer.vy, localPlayer.vz),
            qx: localPlayer.qx, qy: localPlayer.qy, qz: localPlayer.qz, qw: localPlayer.qw
          });

          if (multiplayer.roomRef.current) {
            multiplayer.roomRef.current.send("input", [
              clientTickSeq, command.pitch, command.roll, command.yaw, command.throttleDelta,
              command.boost ? 1 : 0, command.airbrake ? 1 : 0, command.primaryFire ? 1 : 0,
              command.secondaryFire ? 1 : 0, command.flaps === "landing" ? 2 : command.flaps === "combat" ? 1 : 0,
              command.gearDeployed ? 1 : 0
            ]);
          }
          clientAccumulator -= CLIENT_TICK_RATE;
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
          _netQ.set(pilot.qx, pilot.qy, pilot.qz, pilot.qw);
          _netQ.slerp(_netQSnap, alpha);
          pilot.qx = _netQ.x; pilot.qy = _netQ.y; pilot.qz = _netQ.z; pilot.qw = _netQ.w;
        }
      }

      renderer3D.updateWorld(engine.pilots, "player", engine.projectiles, engine.groundTargets, playerTargetPoint, engine.skyZones, mode, inputFrame, dt);
      
      fpsFrameCount++;
      const fpsElapsed = now - fpsWindowStart;
      if (fpsElapsed >= 500) {
        fpsElement ??= document.getElementById("hud-fps-counter");
        if (fpsElement) {
          const fps = (fpsFrameCount * 1000) / fpsElapsed;
          const frameMs = fps > 0 ? 1000 / fps : 0;
          const { drawCalls, triangles } = renderer3D.getRenderStats();
          fpsElement.textContent = `${Math.round(fps)} FPS · ${frameMs.toFixed(1)} MS · ${drawCalls} DC · ${(triangles / 1000).toFixed(1)}K TRI`;
          fpsElement.dataset.level = fps >= 55 ? "good" : fps >= 35 ? "warn" : "bad";
        }
        fpsWindowStart = now; fpsFrameCount = 0;
      }

      if (localPlayer?.physicsDebug) {
        const d = localPlayer.physicsDebug;
        const spd = Math.sqrt(localPlayer.vx ** 2 + localPlayer.vy ** 2 + localPlayer.vz ** 2) * 3.6;
        const manualYaw = (inputFrame.held.arrowRight ? 1 : 0) - (inputFrame.held.arrowLeft ? 1 : 0) + (inputFrame.held.e ? 0.65 : 0) - (inputFrame.held.q ? 0.65 : 0);
        telemPending.push({
          t: roundTelemetry(localPlayer.physicsTime ?? 0, 3), spd: roundTelemetry(spd, 1), alt: roundTelemetry(localPlayer.y, 1),
          thr: roundTelemetry(localPlayer.throttle, 2), aoa: roundTelemetry(d.aoaDeg, 2), ss: roundTelemetry(d.sideslipDeg, 2),
          cm: localPlayer.controlMode === ControlMode.MouseJoystick ? 1 : localPlayer.controlMode === ControlMode.KeyboardDirect ? 2 : 0,
          cp: roundTelemetry(localPlayer.lastCommand?.pitch ?? 0, 3), cr: roundTelemetry(localPlayer.lastCommand?.roll ?? 0, 3),
          cy: roundTelemetry(localPlayer.lastCommand?.yaw ?? 0, 3), myw: roundTelemetry(manualYaw, 2),
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
      multiplayer.disconnectMultiplayer();
      renderer3D.destroy();
      if (renderer3DRef.current === renderer3D) renderer3DRef.current = null;
    };
  }, [cameraModeRef, handleMatchCompletion, multiplayer, progression, toggleBombSight, toggleCameraMode]);

  const launchMatch = useCallback((
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
      initThreeAndGame(selectedPlaneId, belt, mods, mapId, mode, isMultiplayer, startOnGround, campaignMissionId);
    }, 150);
  }, [initThreeAndGame, setActiveCameraMode]);

  return {
    isPlaying,
    showDebrief,
    debriefData,
    cameraMode,
    hudSnapshot,
    activeMatchMode,
    hitmarker,
    killPopups,
    isPaused,
    showTacticalMap,
    activeEngine,
    canvasContainerRef,
    inputManagerRef,
    launchMatch,
    handleEject,
    togglePause,
    setShowDebrief,
    setDebriefData,
    setShowTacticalMap,
    saveProgressionAndSyncEngine
  };
}
