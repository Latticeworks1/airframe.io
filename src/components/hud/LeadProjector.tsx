import React from "react";

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

export const LeadProjector: React.FC = () => {
  return (
    <div
      id="hud-lead-projector"
      className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
    >
      <div
        id="target-marker-box"
        className="absolute left-0 top-0 opacity-0 will-change-transform"
      >
        <div className="w-[18px] h-[18px] border border-red-500/50 rounded-sm bg-transparent shadow-[0_0_0_1px_#000]" />
      </div>

      <div
        id="target-lead-dot-indicator"
        className="absolute left-0 top-0 opacity-0 will-change-transform"
        style={{ transformOrigin: "center center" }}
      >
        <div
          className="w-7 h-7 border border-amber-400 rounded-full flex items-center justify-center relative bg-amber-400/10 select-none animate-pulse"
          style={{ boxShadow: "0 0 0 1px #000, inset 0 0 0 1px #000" }}
        >
          <div
            id="target-lead-center-dot"
            className="w-1.5 h-1.5 bg-red-500 rounded-full"
            style={{ boxShadow: "0 0 0 1px #000" }}
          />

          <div
            id="target-lead-distance"
            className="absolute left-[75%] top-[75%] text-[7px] font-black leading-none text-amber-400 whitespace-nowrap"
            style={textOutline(1)}
          />
        </div>
      </div>
    </div>
  );
};
