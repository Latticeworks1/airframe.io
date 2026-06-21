import React from "react";

export const CenterReticle: React.FC = () => {
  return (
    <div
      id="center-reticle"
      className="absolute left-0 top-0 z-30 pointer-events-none"
      style={{ transform: "translate3d(50vw, 50vh, 0) translate3d(-50%, -50%, 0)" }}
    >
      <svg width="58" height="58" viewBox="0 0 58 58" className="opacity-90">
        <circle
          cx="29"
          cy="29"
          r="15"
          fill="none"
          stroke="#000"
          strokeWidth="4"
          strokeDasharray="4 4"
        />
        <circle
          cx="29"
          cy="29"
          r="15"
          fill="none"
          stroke="#f8fafc"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        <line x1="8" y1="29" x2="20" y2="29" stroke="#000" strokeWidth="5" strokeLinecap="round" />
        <line x1="38" y1="29" x2="50" y2="29" stroke="#000" strokeWidth="5" strokeLinecap="round" />
        <line x1="29" y1="8" x2="29" y2="20" stroke="#000" strokeWidth="5" strokeLinecap="round" />
        <line x1="29" y1="38" x2="29" y2="50" stroke="#000" strokeWidth="5" strokeLinecap="round" />

        <line x1="8" y1="29" x2="20" y2="29" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        <line x1="38" y1="29" x2="50" y2="29" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        <line x1="29" y1="8" x2="29" y2="20" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        <line x1="29" y1="38" x2="29" y2="50" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />

        <circle cx="29" cy="29" r="2.2" fill="#f8fafc" stroke="#000" strokeWidth="1.25" />
      </svg>
    </div>
  );
};
