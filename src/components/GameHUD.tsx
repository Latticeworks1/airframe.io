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
  WeaponType,
  GroundTarget,
} from "../types";
import { MapPin, Zap } from "lucide-react";
import { MAP_REGISTRY } from "../game/content/maps/registry";

export interface ChatMessage {
  sender: string;
  text: string;
  ts: number;
}

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

const CockpitOverlay: React.FC<{ pilot: Pilot | undefined }> = ({ pilot }) => {
  const speed = pilot
    ? Math.floor(Math.sqrt(pilot.vx ** 2 + pilot.vy ** 2 + pilot.vz ** 2) * 3.6)
    : 0;
  const alt = pilot ? Math.floor(pilot.y) : 0;
  const hdg = pilot
    ? Math.round(((pilot.yaw * 180 / Math.PI) % 360 + 360) % 360)
    : 0;
  const thr = pilot ? Math.floor(pilot.throttle * 100) : 0;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1600 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="cockpit-coaming" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.88" />
            <stop offset="30%" stopColor="#0f172a" stopOpacity="0.96" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.99" />
          </linearGradient>
          <linearGradient id="cockpit-rail" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#64748b" stopOpacity="0.55" />
            <stop offset="35%" stopColor="#1e293b" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.96" />
          </linearGradient>
        </defs>

        {/* Low-profile glare shield: leaves the sky and peripheral view open. */}
        <path
          d="M0 900V810L120 752L310 782L470 748H1130L1290 782L1480 752L1600 810V900Z"
          fill="url(#cockpit-coaming)"
        />
        <path
          fill="none"
          stroke="#64748b"
          strokeOpacity="0.45"
          strokeWidth="3"
          d="M0 810L120 752L310 782L470 748H1130L1290 782L1480 752L1600 810"
        />

        {/* Short lower canopy rails suggest structure without framing the whole screen. */}
        <path
          d="M0 645L132 725L230 778L174 805L74 760L0 724Z"
          fill="url(#cockpit-rail)"
        />
        <path
          d="M1600 645L1468 725L1370 778L1426 805L1526 760L1600 724Z"
          fill="url(#cockpit-rail)"
        />
        <path
          d="M665 748L715 720H885L935 748Z"
          fill="#020617"
          fillOpacity="0.82"
          stroke="#334155"
          strokeOpacity="0.65"
          strokeWidth="2"
        />
      </svg>

      <div
        className="absolute left-1/2 bottom-[2.25%] -translate-x-1/2 font-mono flex items-center justify-center gap-3 rounded-md border border-slate-700/60 bg-slate-950/82 px-4 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        style={{
          minWidth: "min(560px, 72vw)",
        }}
      >
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-[10px]">
          <span className="text-slate-500 text-[7px] uppercase tracking-[0.18em]">Spd</span>
          <span className="text-emerald-300 font-bold tabular-nums">{speed}</span>
          <span className="text-slate-600 text-[7px]">km/h</span>
        </div>
        <div className="h-4 w-px bg-slate-700/70" />
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-[10px]">
          <span className="text-slate-500 text-[7px] uppercase tracking-[0.18em]">Hdg</span>
          <span className="text-amber-300 font-bold tabular-nums">{String(hdg).padStart(3, "0")}°</span>
        </div>
        <div className="h-4 w-px bg-slate-700/70" />
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-[10px]">
          <span className="text-slate-500 text-[7px] uppercase tracking-[0.18em]">Alt</span>
          <span className="text-sky-300 font-bold tabular-nums">{alt}</span>
          <span className="text-slate-600 text-[7px]">m</span>
        </div>
        <div className="h-4 w-px bg-slate-700/70" />
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-[10px]">
          <span className="text-slate-500 text-[7px] uppercase tracking-[0.18em]">Thr</span>
          <span className="text-orange-300 font-bold tabular-nums">{thr}%</span>
        </div>
      </div>
    </div>
  );
};

const CenterReticle: React.FC = () => {
  return (
    <div
      id="center-reticle"
      className="absolute left-1/2 top-1/2 z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2"
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

const BombSightOverlay: React.FC<{
  pilot: Pilot;
  sight: BombSightInfo | null | undefined;
}> = ({ pilot, sight }) => {
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
          {/* Leave the cardinal readouts clear instead of drawing the axes through them. */}
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

// Elevation colour bands used by the tactical map terrain renderer.
// Threshold values are normalised heightmap luminance (0–1); colours are
// chosen to approximate a standard topographic / nautical chart palette.
const ELEV_BANDS: { threshold: number; r: number; g: number; b: number }[] = [
  { threshold: 0.04, r: 10,  g: 30,  b: 72  },  // deep ocean
  { threshold: 0.10, r: 18,  g: 58,  b: 108 },  // ocean
  { threshold: 0.14, r: 30,  g: 90,  b: 145 },  // shallow water
  { threshold: 0.17, r: 200, g: 185, b: 145 },  // beach / sand
  { threshold: 0.30, r: 112, g: 155, b: 82  },  // coastal lowland
  { threshold: 0.48, r: 88,  g: 122, b: 60  },  // inland midland
  { threshold: 0.66, r: 110, g: 88,  b: 60  },  // highland
  { threshold: 1.00, r: 162, g: 142, b: 118 },  // mountain / peak
];

const TacticalMapOverlay: React.FC<{
  mapId: string;
  pilots: Pilot[];
  groundTargets: GroundTarget[];
  zones: SkyZone[];
  campaignState?: CampaignMissionState | null;
  matchMode: MatchMode;
  onClose: () => void;
}> = ({
  mapId,
  pilots,
  groundTargets,
  zones,
  campaignState,
  matchMode,
  onClose
}) => {
  const mapDef = MAP_REGISTRY[mapId];
  const radius = mapDef?.world.radius ?? 6000;
  const terrainDef = mapDef?.terrain;
  const terrainPath = terrainDef?.kind === "heightmap" ? terrainDef.path : `/maps/${mapId}.png`;
  const project = (x: number, z: number) => ({
    x: 400 + (x / radius) * 350,
    y: 400 - (z / radius) * 350
  });

  const [terrainDataUrl, setTerrainDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const SIZE = 512;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const src = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const out = new ImageData(SIZE, SIZE);
      const od  = out.data;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const h = src[i * 4] / 255;
        let band = ELEV_BANDS[ELEV_BANDS.length - 1];
        for (const b of ELEV_BANDS) { if (h < b.threshold) { band = b; break; } }
        od[i*4]   = band.r;
        od[i*4+1] = band.g;
        od[i*4+2] = band.b;
        od[i*4+3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      setTerrainDataUrl(canvas.toDataURL("image/png"));
    };
    img.src = terrainPath;
  }, [terrainPath]);

  // Grid spacing in world units — one line every ~8 km
  const gridKm = Math.ceil(radius / 4 / 1000) * 1000;
  const gridLines: number[] = [];
  for (let v = -radius; v <= radius; v += gridKm) gridLines.push(v);

  return (
    <div className="absolute inset-0 z-[80] pointer-events-auto bg-[#05080f]/90 backdrop-blur-md flex items-center justify-center p-5 font-mono">
      <div className="relative w-full max-w-6xl h-[min(820px,88vh)] rounded-2xl border border-slate-800/50 bg-[#080b12]/98 shadow-[0_0_70px_rgba(0,0,0,0.85)] overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-slate-800/40 bg-black/50 px-5 py-3">
          <div>
            <div className="text-[9px] font-black tracking-[0.25em] text-amber-500/80 uppercase">
              Tactical Chart — {mapDef?.name ?? mapId}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-600">
              Scale 1 : {(radius * 2 / 1000).toFixed(0)} km · {matchMode}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700/60 bg-slate-900/60 px-4 py-2 text-[9px] font-black tracking-widest text-slate-300 hover:bg-slate-800/60 cursor-pointer"
          >
            CLOSE [M]
          </button>
        </div>

        <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_280px] pt-14">
          <div className="relative min-h-0 p-3 flex flex-col gap-2">
            <div className="relative flex-1 min-h-0 rounded border border-slate-800/40 overflow-hidden bg-[#0a1820]">
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 800" aria-label="Tactical map">
                <defs>
                  <pattern id="chart-grid-major" width="87.5" height="87.5" patternUnits="userSpaceOnUse">
                    <path d="M87.5 0H0V87.5" fill="none" stroke="#334155" strokeOpacity="0.40" strokeWidth="0.6"/>
                  </pattern>
                  <pattern id="chart-grid-minor" width="17.5" height="17.5" patternUnits="userSpaceOnUse">
                    <path d="M17.5 0H0V17.5" fill="none" stroke="#1e293b" strokeOpacity="0.28" strokeWidth="0.3"/>
                  </pattern>
                </defs>

                {/* Chart base — ocean */}
                <rect x="0" y="0" width="800" height="800" fill="#0d1f30"/>

                {/* Banded terrain rendered from canvas */}
                {terrainDataUrl && (
                  <image href={terrainDataUrl} x="0" y="0" width="800" height="800" preserveAspectRatio="xMidYMid slice"/>
                )}

                {/* Chart grid overlaid on terrain */}
                <rect x="0" y="0" width="800" height="800" fill="url(#chart-grid-minor)"/>
                <rect x="0" y="0" width="800" height="800" fill="url(#chart-grid-major)"/>

                {/* Axes */}
                <line x1="400" y1="0" x2="400" y2="800" stroke="#334155" strokeOpacity="0.55" strokeWidth="0.8"/>
                <line x1="0" y1="400" x2="800" y2="400" stroke="#334155" strokeOpacity="0.55" strokeWidth="0.8"/>

                {/* Grid labels — km offset from centre */}
                {gridLines.filter(v => v !== 0).map(v => {
                  const px = project(v, 0); const py = project(0, v);
                  const label = `${v > 0 ? "+" : ""}${(v/1000).toFixed(0)}K`;
                  return (
                    <g key={v}>
                      <text x={px.x} y="796" textAnchor="middle" fill="#475569" fontSize="7" fontFamily="monospace">{label}</text>
                      <text x="4" y={py.y + 3} textAnchor="start" fill="#475569" fontSize="7" fontFamily="monospace">{label}</text>
                    </g>
                  );
                })}

                {/* Compass rose — bottom-right */}
                <g transform="translate(762,762)">
                  <circle r="16" fill="#0a1820" stroke="#334155" strokeWidth="0.8" strokeOpacity="0.7"/>
                  <path d="M0 -13L2.5 0L0 4L-2.5 0Z" fill="#cbd5e1"/>
                  <path d="M0 13L2.5 0L0 -4L-2.5 0Z" fill="#334155" fillOpacity="0.6"/>
                  <text y="-17" textAnchor="middle" fill="#cbd5e1" fontSize="7" fontFamily="monospace" fontWeight="900">N</text>
                </g>

                {/* Scale bar — bottom-left */}
                <g transform="translate(20,778)">
                  <rect width="70" height="4" fill="#cbd5e1" fillOpacity="0.5"/>
                  <rect x="35" width="35" height="4" fill="#0a1820" fillOpacity="0.6" stroke="#cbd5e1" strokeWidth="0.5"/>
                  <rect width="70" height="4" fill="none" stroke="#cbd5e1" strokeWidth="0.5"/>
                  <text x="0" y="-3" fill="#64748b" fontSize="7" fontFamily="monospace">{(gridKm/1000).toFixed(0)} KM</text>
                  <text x="70" y="-3" fill="#64748b" fontSize="7" fontFamily="monospace">{(gridKm*2/1000).toFixed(0)} KM</text>
                </g>

              {zones.map(zone => {
                const point = project(zone.x, zone.z);
                const zoneRadius = zone.radius / radius * 350;
                const color =
                  zone.owningTeam === 1 ? "#f87171" :
                  zone.owningTeam === 2 ? "#60a5fa" :
                  "#94a3b8";
                return (
                  <g key={zone.id}>
                    <circle cx={point.x} cy={point.y} r={zoneRadius} fill={color} fillOpacity="0.08" stroke={color} strokeOpacity="0.55" strokeDasharray="8 8" />
                    <text x={point.x} y={point.y + 4} textAnchor="middle" fill={color} fontSize="17" fontWeight="900">
                      {zone.name.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? "Z"}
                    </text>
                  </g>
                );
              })}

              {groundTargets.filter(target => !target.isDead).map(target => {
                const point = project(target.x, target.z);
                const color = target.team === 1 ? "#f87171" : "#60a5fa";
                return (
                  <g key={target.id} transform={`translate(${point.x} ${point.y})`}>
                    <rect x="-6" y="-6" width="12" height="12" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="2" transform="rotate(45)" />
                    <text x="10" y="-8" fill={color} fontSize="10" fontWeight="700">
                      {target.type.toUpperCase()}
                    </text>
                  </g>
                );
              })}

              {(() => {
                const playerPilotOnMap = pilots.find(p => p.id === "player");
                const myTeam = playerPilotOnMap?.team ?? 1;
                return pilots.filter(p => p.damage.fuselage > 0).map(pilot => {
                  const pt = project(pilot.x, pilot.z);
                  const isMe = pilot.id === "player";
                  const allied = pilot.team === myTeam;
                  const teamColor = pilot.team === 1 ? "#fb7185" : "#38bdf8";
                  const deg = pilot.yaw * 180 / Math.PI;

                  if (pilot.isBot) {
                    // Bots: hollow circle with small cross
                    const botColor = allied ? teamColor : teamColor;
                    return (
                      <g key={pilot.id} transform={`translate(${pt.x} ${pt.y})`}>
                        <circle r="7" fill="none" stroke={botColor} strokeWidth="1.5" strokeOpacity="0.6" strokeDasharray="4 2" />
                        <line x1="-4" y1="0" x2="4" y2="0" stroke={botColor} strokeWidth="1" strokeOpacity="0.6" />
                        <line x1="0" y1="-4" x2="0" y2="4" stroke={botColor} strokeWidth="1" strokeOpacity="0.6" />
                      </g>
                    );
                  }

                  // Real players: solid arrow
                  const fill = isMe ? "#facc15" : teamColor;
                  return (
                    <g key={pilot.id} transform={`translate(${pt.x} ${pt.y}) rotate(${deg})`}>
                      <path d="M0 -14L9 11L0 7L-9 11Z" fill={fill} stroke="#020617" strokeWidth="2" />
                      {/* Allied player name — not shown for enemies (CoD convention) */}
                      {allied && !isMe && (
                        <text
                          x="0" y="-20"
                          textAnchor="middle"
                          fill={teamColor}
                          fontSize="9"
                          fontWeight="700"
                          fontFamily="monospace"
                          transform={`rotate(${-deg})`}
                        >
                          {pilot.name}
                        </text>
                      )}
                    </g>
                  );
                });
              })()}
              </svg>
            </div>

            {/* Dynamic info strip */}
            {(() => {
              const t1 = pilots.filter(p => p.team === 1);
              const t2 = pilots.filter(p => p.team === 2);
              const t1Alive = t1.filter(p => p.damage.fuselage > 0).length;
              const t2Alive = t2.filter(p => p.damage.fuselage > 0).length;
              const t1Targets = groundTargets.filter(t => t.team === 1 && !t.isDead).length;
              const t2Targets = groundTargets.filter(t => t.team === 2 && !t.isDead).length;
              return (
                <div className="shrink-0 rounded border border-slate-800/40 bg-[#080b12]/80 px-4 py-2.5 flex gap-6 items-center text-[8px] font-mono">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[7px] font-black tracking-widest text-slate-600 uppercase">Airspace</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {zones.map(zone => {
                        const col = zone.owningTeam === 1 ? "bg-rose-500" : zone.owningTeam === 2 ? "bg-sky-500" : "bg-slate-600";
                        return (
                          <span key={zone.id} className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${col}`}/>
                            <span className="text-slate-400">{zone.name.split(" ")[0]}</span>
                          </span>
                        );
                      })}
                      {zones.length === 0 && <span className="text-slate-700">No zones</span>}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-slate-800 shrink-0"/>
                  <div className="flex gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] font-black tracking-widest text-rose-500/60 uppercase">Team 1</span>
                      <span className="text-slate-300"><span className="text-rose-400 font-black">{t1Alive}</span> airborne · <span className="text-slate-500">{t1Targets}</span> objs</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] font-black tracking-widest text-sky-500/60 uppercase">Team 2</span>
                      <span className="text-slate-300"><span className="text-sky-400 font-black">{t2Alive}</span> airborne · <span className="text-slate-500">{t2Targets}</span> objs</span>
                    </div>
                  </div>
                  {campaignState && (
                    <>
                      <div className="w-px h-8 bg-slate-800 shrink-0"/>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-[7px] font-black tracking-widest text-slate-600 uppercase">Mission — {campaignState.name}</span>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-800 rounded overflow-hidden">
                            <div className="h-full bg-amber-500/70 rounded" style={{ width: `${clamp(campaignState.progress / Math.max(1, campaignState.targetCount), 0, 1) * 100}%` }}/>
                          </div>
                          <span className="text-slate-500 shrink-0">{campaignState.progress}/{campaignState.targetCount}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          <aside className="border-l border-slate-800/40 bg-slate-950/40 p-4 text-left overflow-y-auto">
            {/* Full sorties board — all pilots including bots */}
            <div>
              <div className="text-[8px] font-black tracking-[0.2em] text-slate-600 uppercase mb-2">Sorties</div>
              {([1, 2] as const).map(team => {
                const teamPilots = [...pilots].filter(p => p.team === team).sort((a, b) => b.score - a.score);
                const hdr = team === 1
                  ? { c: "text-rose-400", b: "border-rose-500/20" }
                  : { c: "text-sky-400",  b: "border-sky-500/20"  };
                return (
                  <div key={team} className={`mb-2 rounded border ${hdr.b} bg-black/20`}>
                    <div className={`flex items-center justify-between px-3 py-1 border-b ${hdr.b}`}>
                      <span className={`text-[7.5px] font-black tracking-widest uppercase ${hdr.c}`}>Team {team}</span>
                      <span className="text-[6px] text-slate-700 font-mono">K · D · KDR · SCR</span>
                    </div>
                    <div className="px-3 py-1 space-y-px">
                      {teamPilots.map(p => {
                        const kdr = p.deaths === 0 ? p.kills.toFixed(0) : (p.kills / p.deaths).toFixed(1);
                        const isMe = p.id === "player";
                        const rowClass = isMe ? "text-amber-300" : p.isBot ? "text-slate-700" : "text-slate-400";
                        return (
                          <div key={p.id} className={`flex items-center gap-1 text-[7.5px] font-mono leading-tight ${rowClass}`}>
                            <span className="flex-1 truncate min-w-0">{isMe ? "▶ " : p.isBot ? "· " : "★ "}{p.name.replace(" (You)", "")}</span>
                            <span className="w-5 text-right shrink-0">{p.kills}</span>
                            <span className="text-slate-800">·</span>
                            <span className="w-5 text-right shrink-0">{p.deaths}</span>
                            <span className="text-slate-800">·</span>
                            <span className="w-7 text-right shrink-0">{kdr}</span>
                            <span className="text-slate-800">·</span>
                            <span className={`w-7 text-right shrink-0 font-black ${isMe ? "text-amber-300" : ""}`}>{p.score}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 text-[8px] font-black tracking-[0.2em] text-slate-600 uppercase mb-1">Symbols</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[7px] text-slate-600">
              <div className="flex items-center gap-1.5"><span className="text-amber-300 text-[9px]">▲</span> You</div>
              <div className="flex items-center gap-1.5"><span className="text-rose-400 text-[9px]">▲</span> Red</div>
              <div className="flex items-center gap-1.5"><span className="text-sky-400 text-[9px]">▲</span> Blue</div>
              <div className="flex items-center gap-1.5"><span className="text-slate-700 text-[9px]">⊕</span> Bot</div>
              <div className="flex items-center gap-1.5"><span className="text-slate-500 text-[9px]">◇</span> Obj</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

const LeadProjector: React.FC = () => {
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

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function signedAngleDegrees(value: number) {
  return ((value + 540) % 360) - 180;
}

const HorizontalSituationIndicator: React.FC<{
  pilot: Pilot;
  zones: SkyZone[];
}> = ({ pilot, zones }) => {
  const heading = normalizeDegrees(THREE_RAD_TO_DEG * pilot.yaw);
  const candidateZones = zones.filter(zone => zone.owningTeam !== pilot.team);
  const availableZones = candidateZones.length > 0 ? candidateZones : zones;
  let objective: SkyZone | null = null;
  let objectiveDistanceSq = Number.POSITIVE_INFINITY;
  for (const zone of availableZones) {
    const distanceSq =
      (zone.x - pilot.x) ** 2 + (zone.z - pilot.z) ** 2;
    if (distanceSq < objectiveDistanceSq) {
      objective = zone;
      objectiveDistanceSq = distanceSq;
    }
  }

  const dx = objective ? objective.x - pilot.x : 0;
  const dz = objective ? objective.z - pilot.z : 1;
  const bearing = objective
    ? normalizeDegrees(Math.atan2(dx, dz) * THREE_RAD_TO_DEG)
    : heading;
  const relativeBearing = signedAngleDegrees(bearing - heading);
  const distance = objective ? Math.sqrt(dx * dx + dz * dz) : 0;
  const objectiveLetter =
    objective?.name.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? "—";
  const capture = objective ? Math.abs(objective.captureProgress) : 0;

  const ticks = Array.from({ length: 12 }, (_, index) => index * 30);
  const cardinalLabel = (angle: number) => {
    if (angle === 0) return "N";
    if (angle === 90) return "E";
    if (angle === 180) return "S";
    if (angle === 270) return "W";
    return String(angle / 10).padStart(2, "0");
  };

  return (
    <div
      id="hud-hsi"
      className="absolute right-5 top-1/2 z-40 -translate-y-1/2 rounded-xl border border-slate-700/70 bg-slate-950/68 p-2 font-mono shadow-[0_14px_36px_rgba(0,0,0,0.48)] backdrop-blur-sm"
    >
      <div className="mb-1 flex items-center justify-between gap-3 px-1 text-[7px] font-bold uppercase tracking-[0.18em]">
        <span className="text-slate-500">HSI</span>
        <span className="text-emerald-300 tabular-nums">
          HDG {String(Math.round(heading) % 360).padStart(3, "0")}
        </span>
      </div>

      <svg width="138" height="138" viewBox="0 0 150 150" aria-label="Horizontal situation indicator">
        <circle cx="75" cy="75" r="62" fill="rgba(2,6,23,0.82)" stroke="#334155" strokeWidth="2" />
        <circle cx="75" cy="75" r="48" fill="none" stroke="rgba(71,85,105,0.65)" strokeWidth="1" />

        <g transform={`rotate(${-heading} 75 75)`}>
          {ticks.map(angle => {
            const radians = angle / THREE_RAD_TO_DEG;
            const outerX = 75 + Math.sin(radians) * 58;
            const outerY = 75 - Math.cos(radians) * 58;
            const innerX = 75 + Math.sin(radians) * 51;
            const innerY = 75 - Math.cos(radians) * 51;
            const labelX = 75 + Math.sin(radians) * 41;
            const labelY = 75 - Math.cos(radians) * 41;

            return (
              <g key={angle}>
                <line
                  x1={outerX}
                  y1={outerY}
                  x2={innerX}
                  y2={innerY}
                  stroke={angle % 90 === 0 ? "#f8fafc" : "#64748b"}
                  strokeWidth={angle % 90 === 0 ? 2 : 1}
                />
                <text
                  x={labelX}
                  y={labelY}
                  fill={angle % 90 === 0 ? "#f8fafc" : "#94a3b8"}
                  fontSize={angle % 90 === 0 ? 10 : 7}
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${heading} ${labelX} ${labelY})`}
                >
                  {cardinalLabel(angle)}
                </text>
              </g>
            );
          })}
        </g>

        <g transform={`rotate(${relativeBearing} 75 75)`}>
          <path
            d="M75 21L69 36H72V93H78V36H81Z"
            fill="#fbbf24"
            stroke="#111827"
            strokeWidth="1.5"
          />
          <path d="M75 129L70 116H80Z" fill="#d97706" />
        </g>

        <path d="M75 8L69 18H81Z" fill="#34d399" stroke="#020617" strokeWidth="1.5" />
        <circle cx="75" cy="75" r="5" fill="#020617" stroke="#e2e8f0" strokeWidth="1.5" />
        <text x="75" y="79" fill="#f8fafc" fontSize="9" fontWeight="800" textAnchor="middle">
          {objectiveLetter}
        </text>
      </svg>

      <div className="grid grid-cols-3 gap-1 border-t border-slate-800/90 pt-1 text-center text-[7px] uppercase">
        <div>
          <span className="block text-slate-600">Brg</span>
          <strong className="text-amber-300 tabular-nums">
            {String(Math.round(bearing) % 360).padStart(3, "0")}°
          </strong>
        </div>
        <div>
          <span className="block text-slate-600">Range</span>
          <strong className="text-sky-300 tabular-nums">
            {distance >= 1000 ? `${(distance / 1000).toFixed(1)}K` : `${Math.round(distance)}M`}
          </strong>
        </div>
        <div>
          <span className="block text-slate-600">Cap</span>
          <strong className="text-emerald-300 tabular-nums">{Math.round(capture)}%</strong>
        </div>
      </div>
    </div>
  );
};

const THREE_RAD_TO_DEG = 180 / Math.PI;

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
      {cameraMode === "first-person" && <CockpitOverlay pilot={playerPilot} />}
      {cameraMode !== "bombsight" && <LeadProjector />}
      {cameraMode !== "bombsight" && <CenterReticle />}
      {cameraMode === "bombsight" && (
        <BombSightOverlay pilot={playerPilot} sight={bombSightInfo} />
      )}
      {cameraMode === "first-person" && <HorizontalSituationIndicator pilot={playerPilot} zones={skyZones} />}
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

const ChatOverlay: React.FC<{ messages: ChatMessage[]; onSend: (t: string) => void }> = ({ messages, onSend }) => {
  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const now = Date.now();
  const recent = messages.filter(m => now - m.ts < 30000).slice(-5);

  const submit = () => {
    const text = input.trim();
    if (text) { onSend(text); setInput(""); }
    setOpen(false);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="absolute left-3 top-14 z-50 w-72 flex flex-col gap-1 pointer-events-none">
      <div className="flex flex-col gap-0.5">
        {recent.map((m, i) => (
          <div key={i} className="text-[9px] font-mono bg-black/45 rounded px-1.5 py-0.5 leading-snug">
            <span className="text-amber-400 font-black">{m.sender}</span>
            <span className="text-slate-200 ml-1">{m.text}</span>
          </div>
        ))}
      </div>
      {open && (
        <div className="pointer-events-auto flex items-center gap-1 bg-black/70 border border-slate-700 rounded px-2 py-1 mt-0.5">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") { setOpen(false); setInput(""); }
            }}
            maxLength={120}
            placeholder="Press Enter to send..."
            className="flex-1 bg-transparent text-[9px] text-white outline-none font-mono placeholder-slate-500"
          />
          <span className="text-[7px] text-slate-500 font-mono">ESC</span>
        </div>
      )}
      {!open && recent.length === 0 && (
        <div className="text-[6.5px] text-slate-600 font-mono">[T] CHAT</div>
      )}
    </div>
  );
};
