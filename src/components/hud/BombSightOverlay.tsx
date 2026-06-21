import React from "react";
import { Pilot, BombSightInfo, WeaponType } from "../../types";

interface BombSightOverlayProps {
  pilot: Pilot;
  sight: BombSightInfo | null | undefined;
}

export const BombSightOverlay: React.FC<BombSightOverlayProps> = ({ pilot, sight }) => {
  const bombs = pilot.ammo[WeaponType.BOMB] ?? 0;
  const ticks = Array.from({ length: 36 }, (_, index) => index * 10);

  return (
    <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden font-mono bg-[radial-gradient(circle_at_center,transparent_0%,transparent_48%,rgba(0,0,0,0.2)_66%,rgba(0,0,0,0.72)_100%)]">
      <svg
        className="absolute inset-0 h-full w-full opacity-90"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <filter id="bombsight-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g
          fill="none"
          stroke="#86efac"
          strokeOpacity="0.68"
          filter="url(#bombsight-glow)"
        >
          <circle cx="500" cy="500" r="310" strokeWidth="2" />
          <circle cx="500" cy="500" r="218" strokeWidth="1.5" strokeDasharray="7 12" />
          <circle cx="500" cy="500" r="86" strokeWidth="2" />
          <line x1="180" y1="500" x2="420" y2="500" strokeWidth="2" />
          <line x1="580" y1="500" x2="820" y2="500" strokeWidth="2" />
          <line x1="500" y1="164" x2="500" y2="420" strokeWidth="2" />
          <line x1="500" y1="580" x2="500" y2="838" strokeWidth="2" />
          <path d="M440 500H560M500 440V560" strokeWidth="3" />
          <path d="M452 365L500 340L548 365M452 635L500 660L548 635" strokeWidth="2" />

          {ticks.map(angle => (
            <line
              key={angle}
              x1="500"
              y1={angle % 30 === 0 ? "166" : "178"}
              x2="500"
              y2="194"
              strokeWidth={angle % 30 === 0 ? "3" : "1.5"}
              transform={`rotate(${angle} 500 500)`}
            />
          ))}
        </g>

        <g fill="#86efac" fillOpacity="0.72" fontFamily="monospace" fontSize="18">
          <text x="500" y="145" textAnchor="middle">000</text>
          <text x="850" y="507" textAnchor="middle">090</text>
          <text x="500" y="872" textAnchor="middle">180</text>
          <text x="150" y="507" textAnchor="middle">270</text>
        </g>
      </svg>

      {sight?.valid ? (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${sight.x}%`, top: `${sight.y}%` }}
        >
          <div className="w-16 h-16 rounded-full border-2 border-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.55)]">
            <div className="absolute left-1/2 -top-3 h-5 w-px bg-amber-300" />
            <div className="absolute left-1/2 -bottom-3 h-5 w-px bg-amber-300" />
            <div className="absolute top-1/2 -left-3 w-5 h-px bg-amber-300" />
            <div className="absolute top-1/2 -right-3 w-5 h-px bg-amber-300" />
          </div>
          <span className="absolute left-1/2 top-[72px] -translate-x-1/2 whitespace-nowrap text-[9px] font-black text-amber-300">
            IMPACT {sight.timeToImpact.toFixed(1)}S
          </span>
        </div>
      ) : null}

      <div className="absolute left-1/2 bottom-7 -translate-x-1/2 rounded border border-emerald-400/40 bg-black/65 px-5 py-2 text-center">
        <div className="text-[8px] tracking-[0.24em] text-emerald-300">GYRO-STABILIZED BOMB SIGHT</div>
        <div className="mt-1 text-[10px] font-black text-white">
          R RELEASE · V EXIT · BOMBS {bombs}
        </div>
      </div>
    </div>
  );
};
