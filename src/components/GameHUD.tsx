/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Pilot,
  KillEvent,
  SkyZone,
  MatchMode,
  CameraMode,
  BombSightInfo,
  CampaignMissionState,
  GroundTarget,
} from "../types";
import { Zap, MapPin } from "lucide-react";
import { CenterReticle } from "./hud/CenterReticle";
import { BombSightOverlay } from "./hud/BombSightOverlay";
import { TacticalMapOverlay } from "./hud/TacticalMapOverlay";
import { LeadProjector } from "./hud/LeadProjector";
import { ChatOverlay, ChatMessage } from "./hud/ChatOverlay";
import { CockpitPanel } from "./hud/CockpitPanel";

interface HUDProps {
  playerPilot: Pilot | undefined;
  pilots: Pilot[];
  groundTargets: GroundTarget[];
  skyZones: SkyZone[];
  killFeed: KillEvent[];
  team1Score: number;
  team2Score: number;
  matchTimer: number;
  matchMode: MatchMode;
  invertMouseY?: boolean;
  onToggleInvertMouseY?: () => void;
  invertMouseX?: boolean;
  onToggleInvertMouseX?: () => void;
  onExit: () => void;
  cameraMode: CameraMode;
  inputFrame?: any;
  hitmarker?: { active: boolean; type: "air" | "ground"; key: number };
  bombSightInfo?: BombSightInfo | null;
  campaignState?: CampaignMissionState | null;
  mapId: string;
  showTacticalMap: boolean;
  onCloseTacticalMap: () => void;
  chatMessages?: ChatMessage[];
  onSendChat?: (text: string) => void;
  killPopups?: Array<{ key: number; value: number }>;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

function textOutline(px = 1) {
  return {
    textShadow: `
      ${px}px ${px}px 0 #000,
      -${px}px -${px}px 0 #000,
      ${px}px -${px}px 0 #000,
      -${px}px ${px}px 0 #000,
      0 ${px}px 0 #000,
      0 -${px}px 0 #000
    `,
  };
}





export const GameHUD: React.FC<HUDProps> = ({
  playerPilot,
  pilots,
  groundTargets,
  skyZones,
  killFeed,
  team1Score,
  team2Score,
  matchTimer,
  matchMode,
  onExit,
  cameraMode,
  hitmarker,
  bombSightInfo,
  campaignState,
  mapId,
  showTacticalMap,
  onCloseTacticalMap,
  chatMessages = [],
  onSendChat,
  killPopups = [],
}) => {
  if (!playerPilot) return null;

  const speedKmph = Math.floor(
    Math.sqrt(
      playerPilot.vx * playerPilot.vx +
        playerPilot.vy * playerPilot.vy +
        playerPilot.vz * playerPilot.vz
    ) * 3.6
  );

  const altitudeM = Math.floor(playerPilot.y);
  const throttlePercent = Math.floor(playerPilot.throttle * 100);

  const isStalling = speedKmph < playerPilot.specs.stallSpeedKmph;
  const isOverspeed =
    speedKmph > playerPilot.specs.structuralLimitSpeedKmph * 0.95;

  return (
    <div
      id="game-hud-layout"
      className="absolute inset-0 pointer-events-none select-none text-slate-100"
    >
      {cameraMode === "first-person" && <CockpitPanel />}
      {cameraMode !== "bombsight" && <LeadProjector />}
      {cameraMode !== "bombsight" && <CenterReticle />}
      {cameraMode === "bombsight" && (
        <BombSightOverlay pilot={playerPilot} sight={bombSightInfo} />
      )}

      {showTacticalMap && (
        <TacticalMapOverlay
          mapId={mapId}
          pilots={pilots}
          groundTargets={groundTargets}
          zones={skyZones}
          campaignState={campaignState}
          matchMode={matchMode}
          onClose={onCloseTacticalMap}
        />
      )}

      <div
        id="hud-top-bar"
        className="absolute top-2.5 left-2.5 right-2.5 z-40 flex justify-between items-start"
      >
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={onExit}
            className="bg-black/55 border border-slate-950 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-200 hover:text-amber-400"
            style={textOutline(1)}
          >
            Exit
          </button>

          <div
            id="hud-fps-counter"
            data-level="good"
            className="hud-fps-counter px-1 py-1 font-mono text-[8px] font-bold tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
          >
            -- FPS · -- MS · -- DC
          </div>

        </div>

        <div className="absolute left-1/2 top-0 -translate-x-1/2 flex flex-col items-center justify-center bg-black/55 border border-slate-950 px-3.5 py-1 rounded-lg backdrop-blur-md min-w-[240px]">
          <div className="flex items-center justify-between w-full text-xs font-black">
            <div className="flex items-center gap-1.5 text-blue-400">
              <span className="text-[9px] font-extrabold uppercase" style={textOutline(1)}>
                BLUE
              </span>
              <span className="text-sm font-black text-blue-400" style={textOutline(1.5)}>
                {team2Score}
              </span>
            </div>

            <div
              className="text-white text-base tracking-wider px-3.5 font-black"
              style={textOutline(1.5)}
            >
              {formatTimer(matchTimer)}
            </div>

            <div className="flex items-center gap-1.5 text-red-400">
              <span className="text-sm font-black text-red-400" style={textOutline(1.5)}>
                {team1Score}
              </span>
              <span className="text-[9px] font-extrabold uppercase" style={textOutline(1)}>
                RED
              </span>
            </div>
          </div>

          <div
            className="text-[7.5px] text-amber-400 uppercase tracking-widest font-extrabold"
            style={textOutline(1)}
          >
            {matchMode.toUpperCase()}
          </div>
          {campaignState && (
            <div
              className="mt-0.5 text-[7px] text-emerald-300 uppercase tracking-wider font-bold"
              style={textOutline(1)}
            >
              {campaignState.objectiveLabel}: {campaignState.progress}/{campaignState.targetCount}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-1">
            {skyZones.map(zone => {
              const zoneClass =
                zone.owningTeam === 1
                  ? "border-red-500 text-red-400"
                  : zone.owningTeam === 2
                  ? "border-blue-500 text-blue-400"
                  : "border-slate-700 text-slate-400";

              const zoneLetter =
                zone.name.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? "?";

              return (
                <div
                  key={zone.id}
                  className={`bg-black/45 border px-2 py-0.5 rounded flex items-center gap-1 text-[8px] font-bold ${zoneClass}`}
                >
                  <MapPin size={8} />
                  <span>{zoneLetter}</span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-[9.5px] font-black uppercase pr-0.5">
            <span className="text-emerald-400" style={textOutline(1)}>
              KILLS: <strong className="text-white">{playerPilot.kills}</strong>
            </span>
            <span className="text-slate-300" style={textOutline(1)}>
              SCORE: <strong className="text-white">{playerPilot.score}</strong>
            </span>
          </div>
        </div>
      </div>

      <div
        id="hud-flight-tape"
        className="absolute left-6 top-1/2 z-40 -translate-y-1/2 text-left font-black tracking-widest text-[#f8fafc] flex flex-col gap-4"
      >
        <div className="flex flex-col">
          <span className="text-[9.5px] text-amber-400 uppercase leading-none" style={textOutline(1)}>
            SPD
          </span>
          <span className="text-3xl font-black leading-none text-white mt-0.5 flex items-baseline gap-1" style={textOutline(1.5)}>
            {speedKmph}
            <span className="text-[10px] font-bold text-white/95 tracking-normal">
              KM/H
            </span>
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[9.5px] text-amber-400 uppercase leading-none" style={textOutline(1)}>
            ALT
          </span>
          <span className="text-3xl font-black leading-none text-white mt-0.5 flex items-baseline gap-1" style={textOutline(1.5)}>
            {altitudeM}
            <span className="text-[10px] font-bold text-white/95 tracking-normal">
              M
            </span>
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[9.5px] text-amber-400 uppercase leading-none" style={textOutline(1)}>
            THR
          </span>
          <span className="text-xl font-black leading-none text-white mt-0.5" style={textOutline(1.5)}>
            {throttlePercent}% {playerPilot.throttle > 1.0 ? "WEP" : ""}
          </span>
        </div>

        <div className="flex flex-col gap-1 text-[9.5px] font-black uppercase mt-2">
          <span
            className={playerPilot.gearDeployed ? "text-amber-500" : "text-slate-400"}
            style={textOutline(1)}
          >
            GEAR: {playerPilot.gearDeployed ? "DOWN" : "UP"}
          </span>
          <span
            className={playerPilot.flaps !== "up" ? "text-amber-500 font-bold" : "text-slate-400"}
            style={textOutline(1)}
          >
            FLAPS: {playerPilot.flaps}
          </span>
          <span
            className={
              playerPilot.airbrakeDeployed
                ? "text-rose-400 animate-pulse"
                : "text-slate-400"
            }
            style={textOutline(1)}
          >
            AIRBRAKES: {playerPilot.airbrakeDeployed ? "ACTIVE" : "RETRACTED"}
          </span>
        </div>
      </div>

      <div id="hud-center-alerts" className="absolute inset-0 z-35 pointer-events-none">
        {isStalling && (
          <div className="absolute left-1/2 top-[28%] -translate-x-1/2 bg-red-950/90 border border-red-500 text-red-400 font-extrabold px-5 py-2 rounded shadow-xl animate-bounce text-[10px] tracking-widest uppercase">
            STALL RECOVERY - INCREASE SPEED
          </div>
        )}

        {isOverspeed && (
          <div className="absolute left-1/2 top-[28%] -translate-x-1/2 bg-red-950/90 border border-amber-500 text-amber-400 font-extrabold px-5 py-2 rounded shadow-xl animate-pulse text-[10px] tracking-widest uppercase">
            HIGH EXCURSION G-LIMIT EXCEEDED
          </div>
        )}

      </div>

      <div
        id="hud-footer"
        className="absolute left-2.5 right-2.5 bottom-2.5 z-40 flex justify-between items-end gap-4"
      >
        <div className="flex flex-col text-left gap-1 px-4 items-start text-[9.5px] font-black uppercase pb-1.5">
          <span
            className="text-amber-400 font-extrabold tracking-widest text-[8.5px] mb-1"
            style={textOutline(1)}
          >
            AIRFRAME HEALTH
          </span>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between w-28 text-[9px]">
              <span
                className={
                  playerPilot.damage.engine > 0.8
                    ? "text-emerald-400"
                    : "text-rose-500 font-extrabold"
                }
                style={textOutline(1)}
              >
                ENGINE: {Math.floor(playerPilot.damage.engine * 100)}%
              </span>
            </div>
            <div className="w-28 h-1 bg-black/50 border border-black/80 rounded-sm overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  playerPilot.damage.engine > 0.8
                    ? "bg-emerald-500"
                    : playerPilot.damage.engine > 0.4
                    ? "bg-amber-400"
                    : "bg-rose-600 animate-pulse"
                }`}
                style={{
                  width: `${clamp(playerPilot.damage.engine * 100, 0, 100)}%`,
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-0.5 mt-1">
            <div className="flex items-center justify-between w-28 text-[9px]">
              <span
                className={
                  playerPilot.damage.fuselage > 0.8
                    ? "text-emerald-400"
                    : "text-rose-500 font-extrabold"
                }
                style={textOutline(1)}
              >
                FUSELAGE: {Math.floor(playerPilot.damage.fuselage * 100)}%
              </span>
            </div>
            <div className="w-28 h-1 bg-black/50 border border-black/80 rounded-sm overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  playerPilot.damage.fuselage > 0.8
                    ? "bg-emerald-500"
                    : playerPilot.damage.fuselage > 0.4
                    ? "bg-amber-400"
                    : "bg-rose-600 animate-pulse"
                }`}
                style={{
                  width: `${clamp(playerPilot.damage.fuselage * 100, 0, 100)}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="hidden md:flex flex-col gap-1 max-w-[340px] text-left">
          {killFeed.slice(-2).map(evt => {
            const killerIsRed = evt.killerTeam === 1;
            const victimIsRed = evt.victimTeam === 1;

            return (
              <div
                key={evt.id}
                className="bg-black/45 border-l border-slate-800 px-2 py-0.5 rounded text-[8px] text-slate-400 flex items-center gap-1 uppercase"
              >
                <Zap size={7} className="text-amber-500 animate-pulse shrink-0" />
                <span className="truncate">
                  <strong className={killerIsRed ? "text-red-400" : "text-blue-400"}>
                    {evt.killerName}
                  </strong>{" "}
                  downed{" "}
                  <strong className={victimIsRed ? "text-red-400" : "text-blue-400"}>
                    {evt.victimName}
                  </strong>
                </span>
              </div>
            );
          })}
        </div>

        <div className="bg-black/55 border border-slate-950 px-3 py-1.5 rounded-lg flex flex-col items-start min-w-[145px] text-left">
          <span
            className="text-[7.5px] uppercase text-amber-400 font-extrabold tracking-wider mb-1"
            style={textOutline(1)}
          >
            AMMO
          </span>

          <div className="w-full flex flex-col text-[9px] gap-0.5 leading-none">
            {Object.entries(playerPilot.ammo).map(([weaponType, rounds]) => {
              const roundsCount = rounds as number;
              const shortLabel = weaponType
                .replace("mm MG", " MG")
                .replace("mm Cannon", " C")
                .toUpperCase();

              return (
                <div
                  key={weaponType}
                  className="flex items-center justify-between gap-3 w-full"
                >
                  <span
                    className="text-[7.5px] text-amber-400 uppercase font-black tracking-tight"
                    style={textOutline(1)}
                  >
                    {shortLabel}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-white font-black text-[10px]"
                      style={textOutline(1)}
                    >
                      {roundsCount}
                    </span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-sm border border-slate-700/80 bg-slate-900/80">
                      <span
                        className="block h-full origin-left bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.55)]"
                        style={{
                          transform: `scaleX(${clamp(roundsCount / 300, 0, 1)})`,
                        }}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {hitmarker?.active && (
        <div
          key={hitmarker.key}
          className="absolute inset-0 flex justify-center items-center pointer-events-none z-[60]"
        >
          <svg className="w-14 h-14 hitmarker-animate" viewBox="0 0 100 100">
            <line x1="28" y1="28" x2="42" y2="42" stroke="#000" strokeWidth="11.5" strokeLinecap="round" />
            <line x1="72" y1="28" x2="58" y2="42" stroke="#000" strokeWidth="11.5" strokeLinecap="round" />
            <line x1="28" y1="70" x2="42" y2="58" stroke="#000" strokeWidth="11.5" strokeLinecap="round" />
            <line x1="72" y1="70" x2="58" y2="58" stroke="#000" strokeWidth="11.5" strokeLinecap="round" />

            <line x1="28" y1="28" x2="42" y2="42" stroke={hitmarker.type === "ground" ? "#f59e0b" : "#f43f5e"} strokeWidth="5.5" strokeLinecap="round" />
            <line x1="72" y1="28" x2="58" y2="42" stroke={hitmarker.type === "ground" ? "#f59e0b" : "#f43f5e"} strokeWidth="5.5" strokeLinecap="round" />
            <line x1="28" y1="70" x2="42" y2="58" stroke={hitmarker.type === "ground" ? "#f59e0b" : "#f43f5e"} strokeWidth="5.5" strokeLinecap="round" />
            <line x1="72" y1="70" x2="58" y2="58" stroke={hitmarker.type === "ground" ? "#f59e0b" : "#f43f5e"} strokeWidth="5.5" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Kill score popup — floats center-screen, fades up */}
      {killPopups.map(p => (
        <div
          key={p.key}
          className="absolute left-1/2 top-[42%] -translate-x-1/2 pointer-events-none select-none z-50"
          style={{ animation: "killPopupRise 1.55s ease-out forwards" }}
        >
          <span
            className="text-[22px] font-black font-mono tracking-widest"
            style={{
              color: "#facc15",
              textShadow: "0 0 12px #fff, 0 0 24px #fff8, 0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000"
            }}
          >
            +{p.value}
          </span>
        </div>
      ))}

      {/* In-game chat overlay */}
      {onSendChat && (
        <ChatOverlay messages={chatMessages} onSend={onSendChat} />
      )}

    </div>
  );
};


