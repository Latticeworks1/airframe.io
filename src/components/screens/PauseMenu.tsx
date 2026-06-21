/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Pilot, UserProgression } from "../../types";

interface PauseMenuProps {
  pilots: Pilot[];
  team1Score: number;
  team2Score: number;
  progression: UserProgression;
  onTogglePause: () => void;
  onSaveProgression: (updated: UserProgression) => void;
  onExit: () => void;
  playerPilotId?: string;
}

export function PauseMenu({
  pilots,
  team1Score,
  team2Score,
  progression,
  onTogglePause,
  onSaveProgression,
  onExit,
  playerPilotId = "player"
}: PauseMenuProps) {
  const renderTeam = (team: 1 | 2) => {
    const color =
      team === 1
        ? { hdr: "text-rose-400", border: "border-rose-500/25", row: "bg-rose-950/10" }
        : { hdr: "text-sky-400", border: "border-sky-500/25", row: "bg-sky-950/10" };
    const teamScore = team === 1 ? team1Score : team2Score;
    const teamPilots = [...pilots].filter(p => p.team === team).sort((a, b) => b.score - a.score);

    return (
      <div key={team} className="flex-1 min-w-0">
        <div className={`flex items-center justify-between pb-1.5 mb-2 border-b ${color.border}`}>
          <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${color.hdr}`}>
            Team {team}
          </span>
          <span className={`text-[11px] font-black font-mono ${color.hdr}`}>{teamScore}</span>
        </div>
        <div className="text-[7px] text-slate-600 font-mono tracking-wider grid grid-cols-[1fr_24px_24px_36px_40px] gap-x-2 px-1 mb-1">
          <span>PILOT</span>
          <span className="text-right">K</span>
          <span className="text-right">D</span>
          <span className="text-right">KDR</span>
          <span className="text-right">SCR</span>
        </div>
        {teamPilots.map(p => {
          const isMe = p.id === playerPilotId;
          const kdr = p.deaths === 0 ? p.kills.toFixed(0) : (p.kills / p.deaths).toFixed(2);
          const nameStyle = isMe
            ? "text-amber-300 font-black"
            : p.isBot
            ? "text-slate-500"
            : "text-slate-200 font-bold";
          return (
            <div
              key={p.id}
              className={`grid grid-cols-[1fr_24px_24px_36px_40px] gap-x-2 px-1 py-0.5 rounded text-[8px] font-mono ${
                isMe ? "bg-amber-950/30" : p.isBot ? "" : color.row
              }`}
            >
              <span className={`truncate ${nameStyle}`}>
                {p.name}
                {p.isBot ? "" : " *"}
              </span>
              <span className="text-right text-slate-300">{p.kills}</span>
              <span className="text-right text-slate-400">{p.deaths}</span>
              <span className="text-right text-slate-400">{kdr}</span>
              <span className={`text-right font-black ${isMe ? "text-amber-300" : "text-slate-300"}`}>
                {p.score}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const realPlayersCount = pilots.filter(p => !p.isBot).length;
  const botsCount = pilots.filter(p => p.isBot).length;

  return (
    <div
      id="tactical-pause-overlay"
      className="absolute inset-0 z-50 bg-[#050a12]/88 backdrop-blur-md flex items-start justify-center pt-10 px-4 pointer-events-auto font-mono animate-fadeIn overflow-y-auto"
    >
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <span className="text-[9px] text-amber-500 font-extrabold tracking-[0.25em] uppercase block">
              Game Paused
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              {realPlayersCount} real players · {botsCount} bots
            </span>
          </div>
          <button
            type="button"
            onClick={onTogglePause}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black tracking-widest uppercase rounded-lg cursor-pointer"
          >
            Resume [ESC]
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
            <button
              type="button"
              onClick={() => {
                onSaveProgression({
                  ...progression,
                  invertMouseY: !progression.invertMouseY
                });
              }}
              className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black cursor-pointer"
            >
              Pitch Invert:{" "}
              <span className={progression.invertMouseY ? "text-amber-400" : "text-slate-500"}>
                {progression.invertMouseY ? "ON" : "OFF"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveProgression({
                  ...progression,
                  invertMouseX: !progression.invertMouseX
                });
              }}
              className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black cursor-pointer"
            >
              Roll Invert:{" "}
              <span className={progression.invertMouseX ? "text-amber-400" : "text-slate-500"}>
                {progression.invertMouseX ? "ON" : "OFF"}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="px-4 py-2 border border-red-900/50 text-red-400 text-[9px] font-black rounded-lg hover:bg-red-950/30 cursor-pointer"
          >
            Quit Match
          </button>
        </div>
      </div>
    </div>
  );
}
