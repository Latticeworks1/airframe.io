/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { UserProgression } from "../types";
import { ShieldCheck, User, Lock, ChevronRight, RefreshCw, Star, Info, Check, Sparkles } from "lucide-react";
import { motion } from "motion/react";

interface PilotRegistrationProps {
  progression: UserProgression;
  onComplete: (updatedProgression: UserProgression) => void;
  onClose?: () => void;
}

const CALLSIGN_PRESETS = [
  "Maverick", "Goose", "Iceman", "Viper", "Jester", "Hollywood", 
  "Wolfman", "Cougar", "Merlin", "Zephyr", "Apex", "Specter", 
  "Ghostrider", "Reaper", "Cyclone", "Interceptor", "Shadow"
];

export const PilotRegistration: React.FC<PilotRegistrationProps> = ({
  progression,
  onComplete,
  onClose
}) => {
  const [activeMode, setActiveMode] = useState<"nickname" | "signin">("nickname");
  const [nickname, setNickname] = useState(progression.nickname || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Generate random preset
  const handleRandomPreset = () => {
    const randomPreset = CALLSIGN_PRESETS[Math.floor(Math.random() * CALLSIGN_PRESETS.length)];
    const number = Math.floor(100 + Math.random() * 900);
    setNickname(`${randomPreset}_${number}`);
    setErrorMsg(null);
  };

  const validateNickname = (name: string): boolean => {
    if (name.length < 3) {
      setErrorMsg("Callsign must be at least 3 characters.");
      return false;
    }
    if (name.length > 15) {
      setErrorMsg("Callsign must be 15 characters or less.");
      return false;
    }
    const slugRegex = /^[a-zA-Z0-9_-]+$/;
    if (!slugRegex.test(name)) {
      setErrorMsg("Only letters, numbers, hyphens or underscores allowed.");
      return false;
    }
    return true;
  };

  const handleNicknameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = nickname.trim();
    if (!validateNickname(cleanName)) return;

    // Save local profile info
    const updated: UserProgression = {
      ...progression,
      nickname: cleanName,
      rankCode: progression.rankCode || "CDT"
    };

    setSuccessMsg("Tactical clearance granted! Transferring to lobby...");
    setTimeout(() => {
      onComplete(updated);
    }, 1000);
  };

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("Credentials password must be at least 6 characters.");
      return;
    }

    const cleanName = nickname.trim() || email.split("@")[0].substring(0, 10);
    if (isRegistering && !validateNickname(cleanName)) {
      return;
    }

    // Set Premium Squad credentials status
    const updated: UserProgression = {
      ...progression,
      nickname: cleanName,
      isLoggedIn: true,
      rankCode: isRegistering ? "CPT" : (progression.rankCode || "CDR"),
      totalXp: progression.totalXp + (isRegistering ? 500 : 0) // registration reward
    };

    setSuccessMsg(isRegistering ? "Pilot credentials created successfully! +500 XP granted" : "Pilot database credentials synchronized!");
    setTimeout(() => {
      onComplete(updated);
    }, 1200);
  };

  return (
    <div id="registration-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md select-none font-mono">
      {/* Dynamic Radar Wave Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,24,38,1)_1px,transparent_1px),linear-gradient(90deg,rgba(18,24,38,1)_1px,transparent_1px)] bg-[size:32px_32px]"></div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        id="registration-container"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative"
      >
        {/* Decorative Top Accent line */}
        <div className="h-1 bg-gradient-to-r from-red-500 via-amber-500 to-indigo-500"></div>

        {/* Title / Banner section */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800 text-center relative">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
            >
              [X] CLOSE
            </button>
          )}

          <div className="w-12 h-12 bg-red-650 rounded-lg mx-auto flex items-center justify-center text-white border-b border-red-500 shadow-md shadow-red-500/10 mb-2">
            <ShieldCheck size={24} />
          </div>
          <h2 className="text-xl font-extrabold tracking-widest text-slate-100 font-sans">
            TACTICAL CLEARANCE
          </h2>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">
            Setup flight callsign or sync pilot database profile
          </p>

          {/* Mode Switcher Tabs */}
          <div className="flex gap-1.5 mt-5 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                setActiveMode("nickname");
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-1 px-2.5 text-[10px] uppercase font-bold rounded cursor-pointer transition-all ${
                activeMode === "nickname"
                  ? "bg-slate-800 text-red-400"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Callsign Clearance
            </button>
            <button
              onClick={() => {
                setActiveMode("signin");
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-1 px-2.5 text-[10px] uppercase font-bold rounded cursor-pointer transition-all ${
                activeMode === "signin"
                  ? "bg-slate-800 text-amber-400"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Database Sign-In
            </button>
          </div>
        </div>

        {/* Form Body layout */}
        <div className="p-6">
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-rose-950/30 border border-rose-500/40 text-rose-400 text-[11px] p-2.5 rounded text-left flex items-start gap-1.5 pointer-events-auto"
            >
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-emerald-950/30 border border-emerald-500/40 text-emerald-300 text-[11px] p-2.5 rounded text-left flex items-start gap-1.5"
            >
              <Check size={13} className="shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </motion.div>
          )}

          {/* A. LOCAL CALLSIGN CLEARANCE SCREEN */}
          {activeMode === "nickname" && (
            <form onSubmit={handleNicknameSubmit} className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest block">
                  1. Flight Callsign / Nickname
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-grow">
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => {
                        setNickname(e.target.value.replace(/\s+/g, "_"));
                        setErrorMsg(null);
                      }}
                      placeholder="e.g. Maverick_9"
                      maxLength={15}
                      required
                      className="w-full bg-slate-950 border border-slate-800 px-3 py-2 text-xs rounded text-slate-100 placeholder-slate-700 outline-none focus:border-red-500/50"
                    />
                    <User size={13} className="absolute right-3 top-2.5 text-slate-600" />
                  </div>
                  <button
                    type="button"
                    onClick={handleRandomPreset}
                    title="Generate Random Callsign"
                    className="px-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-red-400 rounded cursor-pointer transition-all"
                  >
                    <RefreshCw size={13} className="active:rotate-180 transition-transform duration-200" />
                  </button>
                </div>
                <span className="text-[9px] text-slate-600 block">
                  3-15 chars. Only alphanumeric characters, hyphens or underscores.
                </span>
              </div>

              {/* Suggestion tags list */}
              <div className="space-y-1.5 text-left">
                <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">
                  Quick-Select Presets
                </span>
                <div className="flex flex-wrap gap-1">
                  {CALLSIGN_PRESETS.slice(0, 6).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        const num = Math.floor(10 + Math.random() * 90);
                        setNickname(`${preset}_${num}`);
                        setErrorMsg(null);
                      }}
                      className="px-2 py-0.5 bg-slate-950 border border-slate-850 hover:border-slate-700 hover:bg-slate-900 rounded text-[9px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-4 py-3 bg-red-600 hover:bg-red-500 text-white text-xs font-bold uppercase rounded-lg border-t border-red-400 shadow shadow-red-600/10 cursor-pointer transition-all flex items-center justify-center gap-1"
              >
                <span>Obtain Cadet Clearance</span>
                <ChevronRight size={13} />
              </button>
            </form>
          )}

          {/* B. DATABASE SIGN IN SCREEN */}
          {activeMode === "signin" && (
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest block">
                  Pilot Email Credentials
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="pilot@squadron-hq.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 text-xs rounded text-slate-100 placeholder-slate-700 outline-none focus:border-amber-500/50"
                  />
                  <span className="absolute right-3 top-2.5 text-[9px] text-slate-600 font-bold uppercase">SQUAD</span>
                </div>
              </div>

              <div className="space-y-1.5 text-left">
                <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest block">
                  Secure Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 text-xs rounded text-slate-100 placeholder-slate-700 outline-none focus:border-amber-500/50"
                  />
                  <Lock size={13} className="absolute right-3 top-2.5 text-slate-600" />
                </div>
              </div>

              {isRegistering && (
                <div className="space-y-1.5 text-left">
                  <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest block">
                    Choose Flight Callsign
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value.replace(/\s+/g, "_"))}
                      placeholder="e.g. RedLeader"
                      maxLength={15}
                      required={isRegistering}
                      className="w-full bg-slate-950 border border-slate-800 px-3 py-2 text-xs rounded text-slate-100 outline-none focus:border-amber-500/50"
                    />
                    <button
                      type="button"
                      onClick={handleRandomPreset}
                      className="px-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-amber-400 rounded cursor-pointer"
                    >
                      Preset
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center text-[10px] py-1 border-t border-b border-slate-800/40">
                <span className="text-gray-500">
                  {isRegistering ? "Already have a combat profile?" : "First time commissioning?"}
                </span>
                <button
                  type="button"
                  onClick={() => setIsRegistering(!isRegistering)}
                  className="text-amber-400 font-bold uppercase hover:underline cursor-pointer"
                >
                  {isRegistering ? "Retrieve Credentials" : "Commission New Profile"}
                </button>
              </div>

              <button
                type="submit"
                className="w-full mt-4 py-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold uppercase rounded-lg border-t border-amber-400 shadow shadow-amber-600/10 cursor-pointer transition-all flex items-center justify-center gap-1"
              >
                <Star size={12} />
                <span>{isRegistering ? "Commission Profile (+500 XP)" : "Establish Tactical Connection"}</span>
              </button>
            </form>
          )}

          {/* Secure Clearance Banner Footer Info */}
          <div className="mt-5 border-t border-slate-800/60 pt-4 flex gap-3 text-[10px] text-gray-500 text-left items-center">
            <Sparkles size={14} className="text-amber-500 shrink-0 animate-pulse" />
            <span>
              All stats, XP ratings, custom modifications slots and unlock items will sync to your Pilot Commission credentials.
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
