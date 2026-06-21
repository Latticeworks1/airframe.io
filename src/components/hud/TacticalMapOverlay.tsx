import React from "react";
import { Pilot, GroundTarget, SkyZone, CampaignMissionState, MatchMode } from "../../types";
import { MAP_REGISTRY } from "../../game/content/maps/registry";

interface TacticalMapOverlayProps {
  mapId: string;
  pilots: Pilot[];
  groundTargets: GroundTarget[];
  zones: SkyZone[];
  campaignState?: CampaignMissionState | null;
  matchMode: MatchMode;
  onClose: () => void;
}

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export const TacticalMapOverlay: React.FC<TacticalMapOverlayProps> = ({
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
    img.onerror = (err) => {
      console.error("Failed to load map terrain heightmap:", terrainPath, err);
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

        <div className="h-full pt-14 min-h-0">
          <div className="h-full p-3 flex flex-col gap-2">
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
                      const botColor = allied ? teamColor : teamColor;
                      return (
                        <g key={pilot.id} transform={`translate(${pt.x} ${pt.y})`}>
                          <circle r="7" fill="none" stroke={botColor} strokeWidth="1.5" strokeOpacity="0.6" strokeDasharray="4 2" />
                          <line x1="-4" y1="0" x2="4" y2="0" stroke={botColor} strokeWidth="1" strokeOpacity="0.6" />
                          <line x1="0" y1="-4" x2="0" y2="4" stroke={botColor} strokeWidth="1" strokeOpacity="0.6" />
                        </g>
                      );
                    }

                    const fill = isMe ? "#facc15" : teamColor;
                    return (
                      <g key={pilot.id} transform={`translate(${pt.x} ${pt.y}) rotate(${deg})`}>
                        <path d="M0 -14L9 11L0 7L-9 11Z" fill={fill} stroke="#020617" strokeWidth="2" />
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
                  <div className="w-px h-8 bg-slate-800 shrink-0"/>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[7px] font-black tracking-widest text-slate-600 uppercase">Legend</span>
                    <div className="flex gap-2.5 text-[7px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1"><span className="text-amber-300 text-[8px]">▲</span> You</span>
                      <span className="flex items-center gap-1"><span className="text-rose-400 text-[8px]">▲</span> Red</span>
                      <span className="flex items-center gap-1"><span className="text-sky-400 text-[8px]">▲</span> Blue</span>
                      <span className="flex items-center gap-1"><span className="text-slate-500 text-[8px]">⊕</span> Bot</span>
                      <span className="flex items-center gap-1"><span className="text-slate-400 text-[8px]">◇</span> Obj</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
