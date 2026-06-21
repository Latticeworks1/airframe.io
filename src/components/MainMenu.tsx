/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  UserProgression,
  MatchMode,
  AmmoBelt,
  CampaignMissionDefinition
} from "../types";
import { KnownMaps } from "../game/content/maps/mapTypes";
import { MAP_REGISTRY } from "../game/content/maps/registry";
import { DEFAULT_AIRCRAFT } from "../game/aircraftData";
import { CAMPAIGN_MISSIONS } from "../game/content/campaign/campaignMissions";
import {
  Lock,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Coins,
  User,
  ListTodo,
  ChevronDown,
  Wrench
} from "lucide-react";
import { PlanePreview3D } from "./PlanePreview3D";

interface MainMenuProps {
  progression: UserProgression;
  onLaunchMatch: (
    selectedPlane: string,
    belt: AmmoBelt,
    mods: string[],
    mapId: string,
    mode: MatchMode,
    isMultiplayer: boolean,
    startOnGround?: boolean,
    campaignMissionId?: string
  ) => void;
  onUpdateProgression: (updated: UserProgression) => void;
  onOpenRegistration: () => void;
}

enum HangarTab {
  Lobby = "PLAY",
  Campaign = "CAMPAIGN",
  Hangar = "HANGAR",
  Skins = "SKINS",
  Shop = "SHOP"
}

interface SkinPreset {
  id: string;
  name: string;
  description: string;
  cost: number;
  unlockedByDefault: boolean;
  hex: string;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  progression,
  onLaunchMatch,
  onUpdateProgression,
  onOpenRegistration
}) => {
  const [activeTab, setActiveTab] = useState<HangarTab>(HangarTab.Lobby);
  const [selectedPlaneId, setSelectedPlaneId] = useState(progression.selectedPlaneId || "falcon-mk2");
  const [selectedBelt, setSelectedBelt] = useState<AmmoBelt>(progression.selectedBelt || AmmoBelt.Universal);
  const [selectedMapId, setSelectedMapId] = useState<string>(KnownMaps.IslandChain);
  const [selectedMode, setSelectedMode] = useState<MatchMode>(MatchMode.AirSupremacy);
  // Custom persist simulated Gold currency
  const [gold, setGold] = useState<number>(() => {
    const saved = localStorage.getItem("airframe_gold");
    return saved ? parseInt(saved) : 850;
  });

  // Daily Quests Claim System state
  const [unlockedSkins, setUnlockedSkins] = useState<string[]>(() => {
    const saved = localStorage.getItem("airframe_unlocked_skins");
    return saved ? JSON.parse(saved) : ["default"];
  });

  const [claimedDaily, setClaimedDaily] = useState(false);
  const [liveCounts, setLiveCounts] = useState<{ total: number; byQueue: Record<string, number> }>({ total: 0, byQueue: {} });
  const [liveBlips, setLiveBlips] = useState<{ team: 1 | 2; nx: number; ny: number }[]>([]);

  useEffect(() => {
    const pollHealth = async () => {
      try {
        const r = await fetch("/api/health");
        if (r.ok) {
          const d = await r.json();
          setLiveCounts({ total: d.totalPlayers ?? 0, byQueue: d.byQueue ?? {} });
        }
      } catch { /* offline */ }
    };
    const pollPreview = async () => {
      try {
        const r = await fetch("/api/preview");
        if (r.ok) {
          const d = await r.json();
          const WORLD_R = 18000;
          const blips = (d.players ?? []).map((p: { team: number; x: number; z: number }) => ({
            team: p.team as 1 | 2,
            nx: Math.min(1, Math.max(0, (p.x + WORLD_R) / (WORLD_R * 2))),
            ny: Math.min(1, Math.max(0, (p.z + WORLD_R) / (WORLD_R * 2)))
          }));
          setLiveBlips(blips);
        }
      } catch { /* offline */ }
    };
    pollHealth(); pollPreview();
    const hi = setInterval(pollHealth, 6000);
    const pi = setInterval(pollPreview, 3000);
    return () => { clearInterval(hi); clearInterval(pi); };
  }, []);

  // Ready Room UI Popups States
  const [_showModeDropdown, setShowModeDropdown] = useState(false);
  const [showLoadoutDrawer, setShowLoadoutDrawer] = useState(false);
  const [showQuestDrawer, setShowQuestDrawer] = useState(false);
  const [showCoinsDrawer, setShowCoinsDrawer] = useState(false);

  // Active plane specifications definitions
  const currentPlane = DEFAULT_AIRCRAFT.find(a => a.id === selectedPlaneId) || DEFAULT_AIRCRAFT[0];
  const isPlaneUnlocked = progression.unlockedPlanes.includes(selectedPlaneId);

  // Pilot stats and level calculations
  const playerXP = progression.totalXp;
  const playerLevel = Math.floor(playerXP / 1500) + 1;
  const xpCurrentLevel = playerXP % 1500;
  const xpNextLevelPercent = Math.min(100, Math.floor((xpCurrentLevel / 1500) * 100));

  // Skins custom presets
  const SKIN_PRESETS: SkinPreset[] = [
    { id: "default", name: "Raw Alloy Gray", description: "Matte factory titanium shielding finish.", cost: 0, unlockedByDefault: true, hex: "#6b7280" },
    { id: "camo", name: "Royal Camouflage", description: "Classic RFC forest green and clay brown camouflage.", cost: 800, unlockedByDefault: false, hex: "#2d5a27" },
    { id: "crimson", name: "Crimson Devil", description: "Intense burning blood-red decals with dark wing stripes.", cost: 1500, unlockedByDefault: false, hex: "#991b1b" },
    { id: "carbon", name: "Carbon Void", description: "Gloss dark carbon fiber weave with neon cyan indicators.", cost: 2400, unlockedByDefault: false, hex: "#111827" },
    { id: "gold", name: "Golden Ace", description: "Polished celestial solid gold coating for supreme pilots.", cost: 4000, unlockedByDefault: false, hex: "#eab308" }
  ];

  const activeSkinId = progression.customizations?.skin || "default";
  const activeSkin = SKIN_PRESETS.find(s => s.id === activeSkinId) || SKIN_PRESETS[0];

  // Save Gold and Skins state to localStorage
  useEffect(() => {
    localStorage.setItem("airframe_gold", gold.toString());
  }, [gold]);

  useEffect(() => {
    localStorage.setItem("airframe_unlocked_skins", JSON.stringify(unlockedSkins));
  }, [unlockedSkins]);

  // Handle outside clicks to close popups
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        // We let individual buttons handle themselves, or simplify to closing everything when clicking backdrop center.
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handlers
  const handleUnlockPlane = (planeId: string, cost: number) => {
    if (progression.totalXp >= cost && !progression.unlockedPlanes.includes(planeId)) {
      const updated: UserProgression = {
        ...progression,
        totalXp: progression.totalXp - cost,
        unlockedPlanes: [...progression.unlockedPlanes, planeId]
      };
      onUpdateProgression(updated);
    }
  };

  const handleEquipPlane = (planeId: string) => {
    const updated: UserProgression = {
      ...progression,
      selectedPlaneId: planeId
    };
    onUpdateProgression(updated);
    setSelectedPlaneId(planeId);
  };

  const availableTheaters = [
    { id: KnownMaps.IslandChain,  mode: MatchMode.AirSupremacy },
    { id: KnownMaps.StormFront,   mode: MatchMode.Intercept    },
    { id: KnownMaps.DesertCanyon, mode: MatchMode.DuelArena    },
    { id: KnownMaps.AlpineValley, mode: MatchMode.AirSupremacy }
  ];

  const handleCycleMap = (direction: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      osc.type = "triangle";
      gainNode.gain.setValueAtTime(0.015, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } catch (_) {}

    const index = availableTheaters.findIndex(theater => theater.id === selectedMapId);
    const nextIndex =
      (index + direction + availableTheaters.length) % availableTheaters.length;
    const nextTheater = availableTheaters[nextIndex];
    setSelectedMapId(nextTheater.id);
    setSelectedMode(nextTheater.mode);
  };

  const handleUnlockSkin = (skin: SkinPreset) => {
    if (progression.totalXp >= skin.cost && !unlockedSkins.includes(skin.id)) {
      setUnlockedSkins([...unlockedSkins, skin.id]);
      const updated: UserProgression = {
        ...progression,
        totalXp: progression.totalXp - skin.cost,
        customizations: {
          ...progression.customizations,
          skin: skin.id
        }
      };
      onUpdateProgression(updated);
    }
  };

  const handleEquipSkin = (skinId: string) => {
    const updated: UserProgression = {
      ...progression,
      customizations: {
        ...progression.customizations,
        skin: skinId
      }
    };
    onUpdateProgression(updated);
  };

  const handleClaimDailyCredits = () => {
    if (claimedDaily) return;
    setClaimedDaily(true);
    const updated: UserProgression = {
      ...progression,
      totalXp: progression.totalXp + 600
    };
    onUpdateProgression(updated);
  };

  const handleConvertGold = () => {
    if (progression.totalXp >= 1000) {
      setGold(prev => prev + 250);
      const updated: UserProgression = {
        ...progression,
        totalXp: progression.totalXp - 1000
      };
      onUpdateProgression(updated);
    }
  };

  const handleToggleUpgradeMod = (modId: string) => {
    const currentMods = progression.equippedMods?.[selectedPlaneId] || [];
    let updatedMods: string[];
    if (currentMods.includes(modId)) {
      updatedMods = currentMods.filter(m => m !== modId);
    } else {
      updatedMods = [...currentMods, modId];
    }

    const updated: UserProgression = {
      ...progression,
      equippedMods: {
        ...(progression.equippedMods || {}),
        [selectedPlaneId]: updatedMods
      }
    };
    onUpdateProgression(updated);
  };

  const handleLaunch = () => {
    if (!isPlaneUnlocked) return;

    const finalProg: UserProgression = {
      ...progression,
      selectedPlaneId,
      selectedBelt
    };
    onUpdateProgression(finalProg);

    const activeMods = progression.equippedMods?.[selectedPlaneId] || [];
    onLaunchMatch(
      selectedPlaneId,
      selectedBelt,
      activeMods,
      selectedMapId,
      selectedMode,
      true
    );
  };

  const handleLaunchCampaign = (mission: CampaignMissionDefinition) => {
    const missionMods = progression.equippedMods?.[mission.aircraftId] || [];
    onLaunchMatch(
      mission.aircraftId,
      selectedBelt,
      missionMods,
      mission.mapId,
      mission.mode,
      false,
      mission.startOnGround ?? false,
      mission.id
    );
  };

  // Upgrades list helper
  const COMBAT_UPGRADES = [
    { id: "fuel-heavy", name: "High-Octane Engine Mix", effects: "+12% Engine Power, -5% Wing Health", slot: "Powertrain" },
    { id: "engine-polishing", name: "NACA Air Intake Polish", effects: "-6% Fuselage Parasitic Drag", slot: "Aerodynamics" },
    { id: "stripped-frame", name: "Precision Weight Stripping", effects: "-8% Deadweight, -10% Hitpoints", slot: "Structure" },
    { id: "reinforced-skin", name: "Composite Alloy Hulling", effects: "+20% Hitpoints, +5% Drag", slot: "Armor" },
    { id: "polished-guns", name: "Low-Friction Gun Gaskets", effects: "+10% Wing-Roll Speed Rate", slot: "Weapons" }
  ];

  return (
    <div
      id="lobby-root"
      className="relative h-screen w-full bg-[#03060c] text-slate-100 font-sans flex flex-col justify-between overflow-hidden select-none"
    >
      {/* 3D WEBGL CARRIER PREVIEW BACKGROUND */}
      <div className="absolute inset-0 z-0">
        <PlanePreview3D planeId={selectedPlaneId} fullScreen={true} skinId={activeSkinId} mapId={selectedMapId} />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-slate-950/20 to-[#03050a]/90 pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-96 bg-gradient-to-t from-[#03060c] via-[#03060c]/60 to-transparent pointer-events-none" />

        {/* Live battle blips — shown when an active game is running */}
        {liveBlips.length > 0 && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            {liveBlips.map((b, i) => (
              <div
                key={i}
                className="absolute"
                style={{ left: `${b.nx * 100}%`, top: `${b.ny * 100}%` }}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${b.team === 1 ? "bg-sky-400" : "bg-red-400"} opacity-80 animate-ping`}
                  style={{ animationDuration: `${1.8 + (i % 3) * 0.4}s`, animationDelay: `${(i * 0.17) % 1}s` }}
                />
              </div>
            ))}
            <div className="absolute bottom-20 right-8 flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-400 animate-ping" style={{ animationDuration: "2s" }} />
              <span className="text-[6.5px] font-black text-emerald-400/70 uppercase font-mono tracking-widest">LIVE MATCH IN PROGRESS</span>
            </div>
          </div>
        )}

        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-12 pointer-events-none select-none opacity-20">
          <span className="text-[7px] text-[#475569] tracking-[0.8em] font-mono uppercase">AERO COMMAND HUB DECK ZONE B</span>
          <span className="text-[7.5px] text-[#475569] tracking-[0.8em] font-mono uppercase">HEADING 285°</span>
        </div>
      </div>

      {/* Large Diegetic Plane Cycle Arrows on Left/Right edges of the screen */}
      {activeTab === HangarTab.Lobby && (() => {
        const curQueueKey = `${selectedMapId}_${selectedMode}`;
        const mapPlayerCount = liveCounts.byQueue[curQueueKey] ?? 0;
        const mapDef = MAP_REGISTRY[selectedMapId];
        const theaterIdx = availableTheaters.findIndex(t => t.id === selectedMapId);
        const modeName = selectedMode === "air_supremacy" ? "AIR SUPREMACY"
                       : selectedMode === "intercept"     ? "INTERCEPT"
                       : selectedMode === "duel_arena"    ? "DUEL ARENA"
                       : selectedMode.toUpperCase();
        return (
          <>
            {/* Left arrow */}
            <div className="absolute left-6 top-1/2 -translate-y-1/2 z-40 hidden md:block">
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); handleCycleMap(-1); }}
                aria-label="Previous map"
                className="group flex items-center justify-center w-16 h-16 bg-[#050912]/55 hover:bg-[#050912]/85 border border-slate-900 hover:border-amber-500/60 rounded-full transition-all duration-200 cursor-pointer active:scale-90 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)]"
              >
                <ChevronLeft size={32} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
              </button>
            </div>

            {/* Right arrow */}
            <div className="absolute right-6 top-1/2 -translate-y-1/2 z-40 hidden md:block">
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); handleCycleMap(1); }}
                aria-label="Next map"
                className="group flex items-center justify-center w-16 h-16 bg-[#050912]/55 hover:bg-[#050912]/85 border border-slate-900 hover:border-amber-500/60 rounded-full transition-all duration-200 cursor-pointer active:scale-90 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)]"
              >
                <ChevronRight size={32} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
              </button>
            </div>

            {/* Theater nameplate — centered, just above Click to Play zone */}
            <div className="absolute left-1/2 -translate-x-1/2 top-[18%] z-40 flex flex-col items-center gap-1 pointer-events-none select-none">
              <span className="text-[6.5px] font-black tracking-[0.4em] text-slate-600 uppercase font-mono">
                THEATER {String(theaterIdx + 1).padStart(2, "0")} / {availableTheaters.length}
              </span>
              <h2
                className="text-xl md:text-2xl font-black font-mono tracking-widest uppercase text-slate-100 leading-none"
                style={{ textShadow: "0 2px 14px #000b, 0 0 2px #000" }}
              >
                {mapDef?.name ?? selectedMapId}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[7.5px] font-black tracking-[0.22em] text-amber-500 uppercase font-mono">{modeName}</span>
                <span className="text-slate-700 text-[8px]">·</span>
                <span className="text-[7.5px] font-bold text-emerald-400 font-mono tracking-wide">
                  {mapPlayerCount} IN LOBBY
                </span>
              </div>
              {/* Position dots */}
              <div className="flex items-center gap-1.5 mt-1">
                {availableTheaters.map((t, i) => (
                  <div key={t.id} className={`rounded-full transition-all duration-200 ${i === theaterIdx ? "w-4 h-1 bg-amber-400" : "w-1 h-1 bg-slate-700"}`} />
                ))}
              </div>
            </div>

            {/* Aircraft name bottom-left */}
            <div className="absolute left-4 bottom-24 md:left-8 md:bottom-20 max-w-xs text-left select-none pointer-events-none z-40">
              <span className="text-[6.5px] font-black tracking-[0.3em] text-slate-600 uppercase font-mono block">ASSIGNED CRAFT</span>
              <h1 className="text-xl md:text-3xl font-black font-mono tracking-tight text-slate-100 uppercase leading-none mt-0.5"
                style={{ textShadow: "0 2px 8px #000a" }}>
                {currentPlane.name}
              </h1>
              <p className="text-[8.5px] text-slate-500 font-mono tracking-wide mt-1 uppercase">
                {currentPlane.weapons.join("  ·  ")}
              </p>
            </div>
          </>
        );
      })()}

      {/* 1. TOP BAR */}
      <header className="relative z-45 w-full bg-[#050912]/80 border-b border-slate-900/60 shadow-lg shadow-black/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center h-14">
          
          {/* Brand/Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center font-black text-[13px] text-white shadow-md shadow-red-900/40">
              A
            </div>
            <div className="text-left select-none leading-none">
              <span className="font-extrabold text-[13px] tracking-wider text-slate-100 font-mono">
                AIRFRAME<span className="text-amber-500">.IO</span>
              </span>
              <span className="text-[6.5px] text-slate-500 uppercase font-mono tracking-widest block mt-0.5">3D BATTLE PROTOCOL</span>
            </div>
            <div className="flex items-center gap-1 bg-emerald-950/60 border border-emerald-500/25 rounded px-1.5 py-0.5 ml-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[8px] font-black text-emerald-400 font-mono tracking-wider">{liveCounts.total} ONLINE</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1">
            {Object.values(HangarTab).map((tab) => {
              const isSelected = activeTab === tab;
              return (
                <button
                  key={tab}
                  id={tab === HangarTab.Lobby ? "btn-launch-fight" : undefined}
                  disabled={tab === HangarTab.Lobby && !isPlaneUnlocked}
                  onClick={() => {
                    if (tab === HangarTab.Lobby) {
                      handleLaunch();
                      return;
                    }

                    setActiveTab(tab);
                    // Close other popups for a clean switch
                    setShowModeDropdown(false);
                  }}
                  title={
                    tab === HangarTab.Lobby && !isPlaneUnlocked
                      ? "Unlock this aircraft before launching"
                      : undefined
                  }
                  className={`px-3.5 py-1.5 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? "bg-amber-500 text-slate-950 font-extrabold shadow-md shadow-amber-500/10 text-shadow-sm"
                      : "text-slate-400 hover:text-slate-150 hover:bg-slate-900/40"
                  } ${tab === HangarTab.Lobby && !isPlaneUnlocked ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {tab}
                </button>
              );
            })}
            
            {/* PROFILE Trigger Tab */}
            <button
              onClick={onOpenRegistration}
              className="px-3.5 py-1.5 rounded-lg text-[10px] font-black tracking-wider uppercase text-slate-400 hover:text-slate-150 hover:bg-slate-900/40 cursor-pointer transition-all flex items-center gap-1.5"
            >
              <User size={10.5} className="text-[#94a3b8]" />
              PROFILE
            </button>
          </nav>

          {/* Quick Stats on Right */}
          <div className="flex items-center gap-2.5">
            {/* Coins Indicators & Converter popup - Moved from Footer to Header */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowCoinsDrawer(!showCoinsDrawer);
                  setShowQuestDrawer(false);
                  setShowLoadoutDrawer(false);
                }}
                className="flex items-center gap-3 bg-slate-950/60 border border-slate-900 hover:border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-[9.5px] cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <Coins size={11.5} className="text-amber-500" />
                  <span className="text-amber-500">{progression.totalXp.toLocaleString()}</span>
                  <span className="text-[7px] text-[#475569] uppercase font-bold ml-0.5">Creds</span>
                </div>
                <div className="w-px h-3 bg-slate-800" />
                <div className="flex items-center gap-1">
                  <Sparkles size={11} className="text-cyan-400" />
                  <span className="text-cyan-400">{gold}</span>
                  <span className="text-[7px] text-[#475569] uppercase font-bold ml-0.5 font-sans">Gold</span>
                </div>
                <ChevronDown size={11} className="text-slate-500" />
              </button>

              {/* Currency popover exchange overlay - Opened Downward from top-right */}
              {showCoinsDrawer && (
                <div className="absolute right-0 top-11 w-72 bg-[#050914]/98 border border-slate-800 rounded-xl p-3.5 z-50 text-left backdrop-blur-xl shadow-2xl animate-scaleIn">
                  <span className="text-[7.5px] font-black text-slate-500 tracking-wider uppercase block mb-2">QUICK ACCOUNT EXCHANGE</span>
                  <div className="p-2.5 bg-slate-905 border border-slate-900 rounded-lg flex flex-col justify-between text-[11px]">
                    <div>
                      <span className="text-[9px] font-black text-slate-205 uppercase block">XP TRADE REQUISITION</span>
                      <span className="text-[7.5px] text-slate-400 block font-sans mt-0.5 leading-normal">Exchange 1,000 XP combat match earnings to gain instant gold.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleConvertGold}
                      disabled={progression.totalXp < 1000}
                      className="w-full text-center py-1.5 mt-2 bg-cyan-950 hover:bg-cyan-900 text-cyan-400 border border-cyan-500/20 rounded text-[8px] font-bold uppercase transition-all cursor-pointer"
                    >
                      TRADE 1,000 XP FOR +250 GOLD
                    </button>
                  </div>
                </div>
              )}
            </div>

            {activeSkinId !== "default" && (
              <span className="text-[7.5px] font-bold tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-md">
                🎨 {activeSkin.name.toUpperCase()}
              </span>
            )}
            <div className="flex flex-col text-right select-none">
              <span className="text-[10px] text-slate-350 leading-none font-bold font-mono">
                {progression.nickname || "GUEST_CADET"}
              </span>
              <span className="text-[6.5px] text-slate-500 tracking-wider">
                Rank Code: {progression.rankCode || "CDT"}
              </span>
            </div>
          </div>

        </div>
      </header>

      {/* 2. CENTER STAGE CONTENT */}
      <main
        onClick={activeTab === HangarTab.Lobby && isPlaneUnlocked ? handleLaunch : undefined}
        className={`relative z-40 w-full max-w-7xl mx-auto flex-grow flex flex-col justify-center items-center px-4 overflow-hidden ${
          activeTab === HangarTab.Lobby && isPlaneUnlocked ? "cursor-pointer" : ""
        }`}
      >
        
        {/* Lobby State: Click to Play center — theater nameplate and aircraft info rendered in the arrow overlay above */}
        {activeTab === HangarTab.Lobby && (
          <div className="w-full h-full min-h-[70vh] flex flex-col justify-center items-center text-center animate-fadeIn py-6 relative">
            <div
              className="animate-click-to-play pointer-events-none select-none whitespace-nowrap text-center text-3xl md:text-5xl font-black tracking-[0.16em] text-white uppercase"
              style={{
                textShadow:
                  "0 0 4px #000, 0 0 9px #000, 3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000"
              }}
            >
              Click to Play
            </div>
          </div>
        )}

        {/* Hangar Tab Content Showcase */}
        {activeTab === HangarTab.Hangar && (
          <div className="w-full max-w-5xl bg-[#050912]/92 border border-slate-900/80 p-5 rounded-xl backdrop-blur-md flex flex-col gap-4 animate-scaleUp pointer-events-auto max-h-[80vh] overflow-y-auto mt-2">
            <div className="text-left flex justify-between items-center border-b border-slate-900 pb-2.5 shrink-0 select-none">
              <div>
                <h3 className="text-[11.5px] font-black tracking-wider text-amber-500 uppercase font-mono">FLEET HANGARS SHOWROOM</h3>
                <p className="text-[8px] text-slate-400 uppercase mt-0.5">Deploy advanced aircraft utilizing XP match earnings</p>
              </div>
              <span className="text-[9px] text-[#475569] uppercase font-bold font-mono">Vault: <strong className="text-amber-500">{progression.totalXp.toLocaleString()} XP</strong></span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {DEFAULT_AIRCRAFT.map(plane => {
                const isUnlocked = progression.unlockedPlanes.includes(plane.id);
                const isSelected = selectedPlaneId === plane.id;

                const unlockCost = plane.id === "falcon-mk2" ? 0
                                 : plane.id === "kite-9" ? 1800
                                 : plane.id === "vulcan-51" ? 3000
                                 : plane.id === "grizzly-a1" ? 4500
                                 : plane.id === "twinwolf" ? 6000 : 0;

                return (
                  <div
                    key={plane.id}
                    onClick={() => isUnlocked && handleEquipPlane(plane.id)}
                    className={`p-3.5 rounded-lg border text-left flex flex-col justify-between h-[155px] transition-all relative select-none cursor-pointer ${
                      isSelected
                        ? "bg-slate-900 border-amber-500/85 text-amber-500 font-bold ring-2 ring-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                        : isUnlocked
                        ? "bg-slate-950/40 border-slate-850 hover:border-slate-800 hover:bg-slate-950/70"
                        : "bg-slate-950/20 border-slate-950 opacity-60"
                    }`}
                  >
                    <div className="flex flex-col gap-1 items-start text-left">
                      <div className="flex items-center gap-1.5 leading-none">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: plane.color }} />
                        <span className="text-[10.5px] font-black uppercase tracking-tight truncate max-w-[100px] text-slate-200">{plane.name}</span>
                      </div>
                      <span className="text-[7.5px] text-amber-500 font-mono tracking-tight uppercase leading-none mt-0.5">{plane.class}</span>
                      <span className="text-[8px] text-slate-500 normal-case leading-normal font-sans tracking-tight mt-1.5 line-clamp-3">
                        {plane.description}
                      </span>
                    </div>

                    <div className="w-full mt-2">
                      {!isUnlocked ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnlockPlane(plane.id, unlockCost);
                          }}
                          disabled={progression.totalXp < unlockCost}
                          className={`w-full text-center text-[8px] py-1 rounded font-black border uppercase flex items-center justify-center gap-1 transition-all ${
                            progression.totalXp >= unlockCost
                              ? "bg-amber-500 border-amber-400 hover:bg-amber-400 text-[#0f172a] cursor-pointer"
                              : "bg-slate-900 border-slate-850 text-slate-550 cursor-not-allowed"
                          }`}
                        >
                          <Lock size={8} />
                          {unlockCost} XP
                        </button>
                      ) : isSelected ? (
                        <span className="w-full block text-center text-[8px] font-black bg-amber-500/10 border border-amber-500/15 text-amber-500 py-1 rounded">
                          DEPLOYED
                        </span>
                      ) : (
                        <span className="w-full block text-center text-[8px] font-bold bg-slate-900 border border-slate-800 text-slate-400 py-1 rounded hover:text-slate-100 transition-all">
                          MOUNT JET
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === HangarTab.Campaign && (
          <div className="w-full max-w-5xl bg-[#050912]/94 border border-slate-800/90 p-5 rounded-xl backdrop-blur-md flex flex-col gap-4 animate-scaleUp pointer-events-auto max-h-[80vh] overflow-y-auto mt-2">
            <div className="text-left border-b border-slate-800 pb-3">
              <h3 className="text-[12px] font-black tracking-[0.2em] text-amber-400 uppercase font-mono">
                Campaign Operations
              </h3>
              <p className="mt-1 text-[8px] text-slate-400 uppercase tracking-wider">
                Assigned aircraft are issued as mission loaners. Complete objectives before time expires.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {CAMPAIGN_MISSIONS.map(mission => {
                const completed = progression.completedCampaignMissions?.includes(mission.id) ?? false;
                const aircraft = DEFAULT_AIRCRAFT.find(plane => plane.id === mission.aircraftId);

                return (
                  <article
                    key={mission.id}
                    className={`rounded-xl border p-4 text-left flex flex-col min-h-[245px] ${
                      completed
                        ? "border-emerald-500/40 bg-emerald-950/15"
                        : "border-slate-800 bg-slate-950/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[7px] font-black tracking-[0.2em] text-slate-500 uppercase">
                          Mission {String(mission.order).padStart(2, "0")}
                        </span>
                        <h4 className="mt-1 text-[14px] font-black uppercase text-slate-100">
                          {mission.name}
                        </h4>
                      </div>
                      <span className={`rounded border px-2 py-1 text-[7px] font-black uppercase ${
                        completed
                          ? "border-emerald-500/40 text-emerald-300"
                          : "border-amber-500/30 text-amber-300"
                      }`}>
                        {completed ? "Complete" : `+${mission.xpReward} XP`}
                      </span>
                    </div>

                    <p className="mt-3 flex-1 text-[9px] leading-relaxed text-slate-400">
                      {mission.briefing}
                    </p>

                    <div className="mt-3 space-y-1 border-y border-slate-800/80 py-3 font-mono text-[8px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">AIRCRAFT</span>
                        <span className="font-bold text-slate-200">{aircraft?.name ?? mission.aircraftId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">THEATER</span>
                        <span className="font-bold text-slate-200">{mission.mapId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">OBJECTIVE</span>
                        <span className="font-bold text-amber-300">{mission.targetCount} TARGETS</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleLaunchCampaign(mission)}
                      className="mt-3 w-full rounded-lg bg-amber-500 px-3 py-2 text-[9px] font-black tracking-[0.16em] text-slate-950 uppercase hover:bg-amber-400 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      Launch Operation
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* Skins Tab Content Showcase */}
        {activeTab === HangarTab.Skins && (
          <div className="w-full max-w-5xl bg-[#050912]/92 border border-slate-900/80 p-5 rounded-xl backdrop-blur-md flex flex-col gap-4 animate-scaleUp pointer-events-auto max-h-[80vh] overflow-y-auto mt-2">
            <div className="text-left flex justify-between items-center border-b border-slate-900 pb-2.5 shrink-0 select-none">
              <div>
                <h3 className="text-[11.5px] font-black tracking-wider text-amber-500 uppercase font-mono">AIRCRAFT AESTHETIC COATINGS</h3>
                <p className="text-[8px] text-slate-400 uppercase mt-0.5">Acquire and equip visual skins onto the 3D showcase model</p>
              </div>
              <span className="text-[9.5px] font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-0.5 rounded uppercase">
                SHOWROOM DIRECT SYNC
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5">
              {SKIN_PRESETS.map(skin => {
                const isUnlocked = unlockedSkins.includes(skin.id);
                const isEquipped = activeSkinId === skin.id;

                return (
                  <div
                    key={skin.id}
                    className={`p-3.5 rounded-lg border text-left flex flex-col justify-between h-[155px] transition-all relative select-none ${
                      isEquipped
                        ? "bg-slate-900 border-amber-500/85 text-amber-500 font-bold shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                        : "bg-slate-950/40 border-slate-850 text-slate-350 hover:bg-slate-950/60 transition-all"
                    }`}
                  >
                    <div className="flex flex-col gap-1 items-start text-left">
                      <div className="flex items-center gap-1.5 leading-none">
                        <div className="w-3.5 h-3.5 rounded border border-white/10" style={{ backgroundColor: skin.hex }} />
                        <span className="text-[10px] font-black uppercase tracking-tight text-slate-200">{skin.name}</span>
                      </div>
                      <span className="text-[7.5px] text-slate-500 normal-case leading-normal font-sans tracking-tight mt-1 line-clamp-3">
                        {skin.description}
                      </span>
                    </div>

                    <div className="w-full mt-2">
                      {!isUnlocked ? (
                        <button
                          type="button"
                          onClick={() => handleUnlockSkin(skin)}
                          disabled={progression.totalXp < skin.cost}
                          className={`w-full text-center text-[8px] py-1 rounded font-black border uppercase flex items-center justify-center gap-1 transition-all ${
                            progression.totalXp >= skin.cost
                              ? "bg-amber-500 border-amber-400 hover:bg-amber-400 text-[#0f172a] cursor-pointer"
                              : "bg-slate-900 border-slate-850 text-slate-550 cursor-not-allowed"
                          }`}
                        >
                          <Lock size={8} />
                          {skin.cost} XP
                        </button>
                      ) : isEquipped ? (
                        <span className="w-full block text-center text-[8px] font-black bg-amber-500/10 border border-amber-500/15 text-amber-500 py-1 rounded">
                          MOUNTED
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleEquipSkin(skin.id)}
                          className="w-full block text-center text-[8px] font-bold bg-slate-900 border border-slate-800 text-slate-400 py-1 rounded hover:text-slate-100 transition-all cursor-pointer"
                        >
                          EQUIP FINISH
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shop Tab Content Showcase */}
        {activeTab === HangarTab.Shop && (
          <div className="w-full max-w-4xl bg-[#050912]/92 border border-slate-900/80 p-5 rounded-xl backdrop-blur-md flex flex-col gap-4 animate-scaleUp pointer-events-auto max-h-[80vh] overflow-y-auto mt-2">
            <div className="text-left flex justify-between items-center border-b border-slate-900 pb-2.5 shrink-0 select-none font-mono">
              <div>
                <h3 className="text-[11.5px] font-black tracking-wider text-amber-500 uppercase">REQ BLACK-MARKET DISPATCH</h3>
                <p className="text-[8px] text-slate-400 uppercase mt-0.5">Sandbox utilities &amp; commercial credit exchanges</p>
              </div>
              <span className="text-[9.5px] text-slate-400 font-bold uppercase">COMMERCIAL CONTRACTS SECURE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              
              {/* Gold Exchange card */}
              <div className="bg-slate-950/60 border border-slate-900 p-4 rounded-lg flex flex-col justify-between h-[135px]">
                <div>
                  <span className="text-[10px] font-black text-slate-200 uppercase block">⚙️ PREMIUM EXCHANGE PACK</span>
                  <p className="text-[8px] text-slate-400 normal-case font-sans mt-1.5 leading-normal">
                    Expose accumulated combat XP credits to gold currencies for high-tier skins showroom customization.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleConvertGold}
                  disabled={progression.totalXp < 1000}
                  className={`w-full text-center py-2 rounded text-[8.5px] font-bold uppercase transition-all border ${
                    progression.totalXp < 1000
                      ? "bg-slate-900 border-slate-850 text-slate-550 cursor-not-allowed"
                      : "bg-cyan-950 hover:bg-cyan-900 text-cyan-400 border-cyan-500/30 cursor-pointer"
                  }`}
                >
                  TRADE 1,000 XP → +250 GOLD
                </button>
              </div>

              {/* Sandbox full access */}
              <div className="bg-slate-950/60 border border-slate-900 p-4 rounded-lg flex flex-col justify-between h-[135px]">
                <div>
                  <div className="flex justify-between items-center leading-none">
                    <span className="text-[10px] font-black text-slate-200 uppercase block">🏅 ELITE sandbox credentials</span>
                    <span className="text-[6.5px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded font-black">
                      VIP
                    </span>
                  </div>
                  <p className="text-[8px] text-slate-400 normal-case font-sans mt-1.5 leading-normal">
                    Instantly deploy all locked aircrafts and gains infinite sandbox credits testing flight aerodynamics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const updated: UserProgression = {
                      ...progression,
                      unlockedPlanes: DEFAULT_AIRCRAFT.map(a => a.id),
                      totalXp: progression.totalXp + 10000
                    };
                    onUpdateProgression(updated);
                    setGold(prev => prev + 2000);
                  }}
                  className="w-full text-center py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded text-[8.5px] font-black uppercase transition-all border border-amber-450 cursor-pointer shadow-lg"
                >
                  ACTIVATE ALL SANDBOX CREDENTIALS (+10k XP)
                </button>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* 3. BOTTOM STRIP */}
      <footer className="relative z-45 w-full bg-[#050912]/80 border-t border-slate-900/60 shadow-inner backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-col md:flex-row justify-between items-center gap-3">
          
          {/* Daily Quest on Left */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            
            {/* Daily Quest Button & Drawer */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQuestDrawer(!showQuestDrawer);
                  setShowLoadoutDrawer(false);
                  setShowCoinsDrawer(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-800 text-slate-300 hover:text-slate-100 transition-all font-mono text-[9.5px] font-bold uppercase flex items-center gap-1.5 cursor-pointer"
              >
                <ListTodo size={11} className="text-[#a8a29e]" />
                <span>{claimedDaily ? "DAILY: COMPLETED" : "DAILY QUEST"}</span>
                <ChevronDown size={11} className="text-slate-500" />
              </button>

              {/* Daily Quest Drawer overlay */}
              {showQuestDrawer && (
                <div className="absolute left-1/2 -translate-x-1/2 md:translate-x-0 md:left-0 bottom-11 w-80 bg-[#050914]/98 border border-slate-800 rounded-xl max-w-[310px] p-3.5 z-50 text-left backdrop-blur-xl shadow-2xl space-y-3 animate-scaleIn">
                  <span className="text-[7.5px] font-black text-slate-500 tracking-wider uppercase">ACTIVE TACTICAL ORDERS</span>
                  
                  <div className="space-y-2.5 text-[11px]">
                    <div className="p-2.5 bg-slate-905 border border-slate-900 rounded-lg">
                      <span className="text-[9px] font-black text-slate-205 uppercase block">🔫 DOGFIGHT EXTRACTION</span>
                      <span className="text-[7.5px] text-slate-400  leading-normal block mt-0.5 font-sans">Down 15 adversary fighters during fight maps matches.</span>
                      <div className="flex justify-between text-[7px] text-slate-500 mt-1.5 font-mono">
                        <span>PROGRESS: {progression.stats.kills || 0} / 15 DOWNED</span>
                        <span className="text-amber-500 font-bold">+1,500 XP</span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-905 border border-slate-900 rounded-lg flex justify-between items-center">
                      <div>
                        <span className="text-[9px] font-black text-slate-205 uppercase block">⚙️ REQ DAILY GRANTED SUPPLY</span>
                        <span className="text-[7.5px] text-slate-400 block font-sans">Collect free credits once per day.</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClaimDailyCredits}
                        disabled={claimedDaily}
                        className={`px-2 py-1 rounded text-[7.5px] font-black cursor-pointer uppercase border ${
                          claimedDaily
                            ? "bg-slate-900 border-slate-850 text-slate-600 cursor-not-allowed"
                            : "bg-emerald-950 border-emerald-500/30 text-emerald-450 hover:bg-emerald-900 transition-all"
                        }`}
                      >
                        {claimedDaily ? "✓ CLAIMED" : "CLAIM +600 XP"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* XP Progress (Slim status center bar) */}
          <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-900 rounded-lg px-4 py-1.5 font-mono text-[9px]">
            <span className="font-bold text-slate-400 whitespace-nowrap">LVL {playerLevel} PROGRESS</span>
            <div className="w-40 md:w-56 h-1.5 bg-slate-900/90 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full transition-all duration-300"
                style={{ width: `${xpNextLevelPercent}%` }}
              />
            </div>
            <span className="text-[#94a3b8] font-bold shrink-0">{xpCurrentLevel} / 1500 XP</span>
          </div>

          {/* Loadout button on Right */}
          <div className="flex items-center gap-2">
            
            {/* Loadout configuration widget popup */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowLoadoutDrawer(!showLoadoutDrawer);
                  setShowQuestDrawer(false);
                  setShowCoinsDrawer(false);
                }}
                className={`px-3.5 py-1.5 rounded-lg border text-[9.5px] font-black tracking-wider uppercase transition-all duration-150 flex items-center gap-1.5 cursor-pointer bg-slate-950/60 ${
                  showLoadoutDrawer
                    ? "border-amber-500 text-amber-500 ring-2 ring-amber-500/10"
                    : "border-slate-850 hover:border-slate-800 text-slate-350 hover:text-slate-100"
                }`}
              >
                <Wrench size={11.5} className="text-amber-500 animate-pulse" />
                <span>LOADOUT</span>
                <ChevronDown size={11} className="text-slate-500" />
              </button>

              {/* Loadout Bottom Drawer overlay popover */}
              {showLoadoutDrawer && (
                <div className="absolute right-0 bottom-11 w-80 md:w-96 bg-[#050914]/98 border border-slate-800 rounded-xl p-4 z-50 text-left backdrop-blur-xl shadow-2xl space-y-4 animate-scaleUp">
                  
                  {/* Select Ammunition belt */}
                  <div>
                    <span className="text-[7.5px] font-black text-slate-500 tracking-wider uppercase">1. CHOOSE AMMUNITION BELT</span>
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      {Object.values(AmmoBelt).map(belt => {
                        const isSelected = selectedBelt === belt;
                        return (
                          <button
                            key={belt}
                            onClick={() => setSelectedBelt(belt)}
                            className={`p-1.5 rounded-md border text-left flex flex-col cursor-pointer transition-all ${
                              isSelected
                                ? "bg-amber-500/10 border-amber-500 text-amber-400"
                                : "bg-slate-950/60 border-slate-900 hover:border-slate-800 text-slate-450 hover:text-slate-300"
                            }`}
                          >
                            <span className="text-[9px] font-extrabold uppercase leading-none">{belt}</span>
                            <span className="text-[6.5px] text-slate-500 mt-0.5 normal-case tracking-normal">
                              {belt === AmmoBelt.Universal ? "General multirole"
                               : belt === AmmoBelt.ArmorPiercing ? "Hard armor kinetics"
                               : belt === AmmoBelt.Tracer ? "High luminosity light"
                               : belt === AmmoBelt.Incendiary ? "Incendiary ignition"
                               : "Radar absolute stealth"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Flight Upgrades modules installer */}
                  <div>
                    <span className="text-[7.5px] font-black text-slate-500 tracking-wider uppercase block mb-1.5">2. CENTRAL UPGRADES ({progression.equippedMods?.[selectedPlaneId]?.length || 0} MOUNTED)</span>
                    <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                      {COMBAT_UPGRADES.map(mod => {
                        const equippedMods = progression.equippedMods?.[selectedPlaneId] || [];
                        const isEquipped = equippedMods.includes(mod.id);

                        return (
                          <div
                            key={mod.id}
                            onClick={() => handleToggleUpgradeMod(mod.id)}
                            className={`p-2 rounded-lg border text-left flex justify-between items-center cursor-pointer transition-all ${
                              isEquipped
                                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-extrabold"
                                : "bg-slate-950/60 border-slate-900 text-slate-400 hover:border-slate-800 hover:bg-slate-950/80"
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase leading-none">{mod.name}</span>
                              <span className="text-[7px] text-slate-500 leading-none mt-1 tracking-tight normal-case">{mod.effects}</span>
                            </div>
                            <span className="text-[7.5px] tracking-wider uppercase shrink-0 px-1 bg-slate-900 text-slate-500 rounded border border-slate-800 ml-2">
                              {isEquipped ? "✓ ON" : "MOUNT"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              )}
            </div>

          </div>

        </div>
      </footer>

    </div>
  );
};
