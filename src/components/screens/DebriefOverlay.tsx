/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Award, Trophy, ArrowRight } from "lucide-react";

interface DebriefOverlayProps {
  victory: boolean;
  xpEarned: number;
  kills: number;
  structures: number;
  missionName?: string;
  onClose: () => void;
}

export function DebriefOverlay({
  victory,
  xpEarned,
  kills,
  structures,
  missionName,
  onClose
}: DebriefOverlayProps) {
  return (
    <div
      id="dialog-debrief"
      className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto animate-fadeIn font-mono"
    >
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl max-w-lg w-full text-center shadow-2xl relative">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-600 to-amber-500 rounded-t-xl"></div>

        {/* Medallions or custom ribbons */}
        <div className="mx-auto w-16 h-16 rounded-full bg-slate-950 border border-amber-500 flex items-center justify-center text-amber-500 mb-4 animate-bounce">
          <Trophy size={28} />
        </div>

        <h2 className="text-2xl font-extrabold tracking-widest uppercase font-sans">
          Deployment Complete
        </h2>
        <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">
          Operational Debriefing Card
        </p>
        {missionName && (
          <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
            {missionName}
          </p>
        )}

        <div className="text-[28px] font-black tracking-widest mt-5 uppercase">
          {victory ? (
            <span className="text-emerald-400">Mission Victory</span>
          ) : (
            <span className="text-red-500">Mission Defeat</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3.5 mt-6 border-y border-slate-800/80 py-4 text-xs">
          <div className="bg-slate-950 p-3 rounded">
            <span className="text-[18px] font-sans font-bold text-emerald-400 block">{kills}</span>
            <span className="text-[9px] uppercase font-bold text-gray-500 block">Enemy Down</span>
          </div>
          <div className="bg-slate-950 p-3 rounded">
            <span className="text-[18px] font-sans font-bold text-indigo-400 block">{structures}</span>
            <span className="text-[9px] uppercase font-bold text-gray-400 block">Bases Slain</span>
          </div>
          <div className="bg-slate-950 p-3 rounded">
            <span className="text-[18px] font-sans font-bold text-amber-400 block">+{xpEarned}</span>
            <span className="text-[9px] uppercase font-bold text-gray-400 block">XP Earned</span>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-1 text-left bg-slate-950 p-4 rounded-lg border border-slate-850 text-xs text-slate-300 leading-normal">
          <div className="flex items-center gap-2 font-bold text-amber-500">
            <Award size={14} />
            <span>Aviator Compensation Policy</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            You have been compensated with standard aircraft allowances. Heavy bomb payloads and
            dogfighting records are indexed in persistent service logs.
          </p>
        </div>

        <button
          id="btn-close-debrief"
          onClick={onClose}
          className="mt-6 w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded cursor-pointer transition-all uppercase tracking-widest font-sans text-xs flex justify-center items-center gap-2 hover:shadow border-t border-red-400"
        >
          <span>Return to Hangar Lobby</span>
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}
