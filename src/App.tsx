/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { MainMenu } from "./components/MainMenu";
import { PilotRegistration } from "./components/PilotRegistration";
import { GameHUD } from "./components/GameHUD";
import { PauseMenu } from "./components/screens/PauseMenu";
import { DebriefOverlay } from "./components/screens/DebriefOverlay";
import { SyncLoader } from "./components/screens/SyncLoader";
import { useProgression, getMultiplayerSessionId } from "./hooks/useProgression";
import { useMultiplayer } from "./hooks/useMultiplayer";
import { useGameEngine } from "./hooks/useGameEngine";

export default function App() {
  const { progression, isLoadingProgression, saveProgression } = useProgression();
  const multiplayer = useMultiplayer();
  
  const [showRegistration, setShowRegistration] = useState(false);

  const engine = useGameEngine(progression, saveProgression, multiplayer);

  // Presence ping
  useEffect(() => {
    if (engine.isPlaying) return;
    const sid = getMultiplayerSessionId();
    const ping = () => fetch(`/api/presence?sid=${encodeURIComponent(sid)}`).catch(() => {});
    ping();
    const id = setInterval(ping, 30_000);
    return () => clearInterval(id);
  }, [engine.isPlaying]);

  const playerPilotData = engine.activeEngine
    ? engine.hudSnapshot.pilots.find(p => p.id === "player")
    : undefined;

  return (
    <main
      id="app-viewport-frame"
      className="relative w-screen h-screen overflow-hidden bg-black text-white"
    >
      {/* 3D CANVAS INJECTION TARGET */}
      {engine.isPlaying && (
        <div
          id="webgl-canvas-container"
          ref={engine.canvasContainerRef}
          className="absolute inset-0 w-full h-full z-10 select-none cursor-crosshair pointer-events-auto"
        ></div>
      )}

      {/* COCKPIT PILOT HUD LAYER */}
      {engine.isPlaying && engine.activeEngine && (
        <div id="active-hud-hud" className="absolute inset-0 z-20 pointer-events-none">
          <GameHUD
            playerPilot={playerPilotData}
            pilots={engine.hudSnapshot.pilots}
            groundTargets={engine.hudSnapshot.groundTargets}
            skyZones={engine.hudSnapshot.zones}
            killFeed={engine.hudSnapshot.killFeed}
            team1Score={engine.hudSnapshot.team1Score}
            team2Score={engine.hudSnapshot.team2Score}
            matchTimer={engine.hudSnapshot.matchTimer}
            matchMode={engine.activeMatchMode}
            invertMouseY={progression.invertMouseY || false}
            onToggleInvertMouseY={() => {
              engine.saveProgressionAndSyncEngine({
                ...progression,
                invertMouseY: !progression.invertMouseY
              });
            }}
            invertMouseX={progression.invertMouseX || false}
            onToggleInvertMouseX={() => {
              engine.saveProgressionAndSyncEngine({
                ...progression,
                invertMouseX: !progression.invertMouseX
              });
            }}
            onExit={engine.handleEject}
            cameraMode={engine.cameraMode}
            inputFrame={engine.inputManagerRef.current?.getInputFrame()}
            hitmarker={engine.hitmarker}
            bombSightInfo={engine.hudSnapshot.bombSightInfo}
            campaignState={engine.hudSnapshot.campaignState}
            mapId={engine.activeEngine.selectedMapId}
            showTacticalMap={engine.showTacticalMap}
            onCloseTacticalMap={() => engine.setShowTacticalMap(false)}
            killPopups={engine.killPopups}
            chatMessages={multiplayer.chatMessages}
            onSendChat={(text) => multiplayer.sendChat(text, progression.nickname ?? "PILOT")}
          />
        </div>
      )}

      {/* PAUSE / SCOREBOARD OVERLAY */}
      {engine.isPlaying && engine.isPaused && (
        <PauseMenu
          pilots={engine.hudSnapshot.pilots}
          team1Score={engine.hudSnapshot.team1Score}
          team2Score={engine.hudSnapshot.team2Score}
          progression={progression}
          onTogglePause={engine.togglePause}
          onSaveProgression={engine.saveProgressionAndSyncEngine}
          onExit={engine.handleEject}
        />
      )}

      {/* HANGAR LOBBY MAIN MENU DASHBOARD */}
      {!engine.isPlaying && !engine.showDebrief && (
        <div id="lobby-panel" className="absolute inset-0 z-30 pointer-events-auto overflow-y-auto">
          <MainMenu
            progression={progression}
            onLaunchMatch={engine.launchMatch}
            onUpdateProgression={engine.saveProgressionAndSyncEngine}
            onOpenRegistration={() => setShowRegistration(true)}
          />
        </div>
      )}

      {/* PILOT REGISTRATION */}
      {!engine.isPlaying && !engine.showDebrief && showRegistration && (
        <PilotRegistration
          progression={progression}
          onComplete={(updated) => {
            engine.saveProgressionAndSyncEngine(updated);
            setShowRegistration(false);
          }}
          onClose={() => setShowRegistration(false)}
        />
      )}

      {/* POST-MATCH DEBRIEFING DIALOG OVERLAY */}
      {engine.showDebrief && engine.debriefData && (
        <DebriefOverlay
          victory={engine.debriefData.victory}
          xpEarned={engine.debriefData.xpEarned}
          kills={engine.debriefData.kills}
          structures={engine.debriefData.structures}
          missionName={engine.debriefData.missionName}
          onClose={() => {
            engine.setShowDebrief(false);
            engine.setDebriefData(null);
          }}
        />
      )}

      {/* PILOT PROFILE SYNCHRONIZATION OVERLAY */}
      <SyncLoader isLoading={isLoadingProgression} />
    </main>
  );
}
