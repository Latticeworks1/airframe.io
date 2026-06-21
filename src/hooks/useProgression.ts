/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { UserProgression, AmmoBelt, ControlMode } from "../types";

const STORAGE_KEY = "airframe_io_save_data";
const MULTIPLAYER_SESSION_KEY = "airframe_io_multiplayer_session";

const GHOST_PREFIXES = [
  "GHOST",
  "RAVEN",
  "VIPER",
  "COBRA",
  "EAGLE",
  "SHARK",
  "STORM",
  "BLADE",
  "IRON",
  "WOLF",
  "NOVA",
  "APEX",
  "ZERO",
  "JADE",
  "ONYX",
  "LYNX",
  "KITE",
  "HAWK",
  "FURY",
  "FLAK"
];

function generateCallsign(): string {
  const prefix = GHOST_PREFIXES[Math.floor(Math.random() * GHOST_PREFIXES.length)];
  const num = 1000 + Math.floor(Math.random() * 8999);
  return `${prefix}_${num}`;
}

export function getMultiplayerSessionId(): string {
  const existing = localStorage.getItem(MULTIPLAYER_SESSION_KEY);
  if (existing) return existing;

  const sessionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(MULTIPLAYER_SESSION_KEY, sessionId);
  return sessionId;
}

export const INITIAL_PROGRESSION: UserProgression = {
  totalXp: 500, // starter XP
  planeXp: {},
  unlockedPlanes: ["falcon-mk2"],
  equippedMods: {},
  selectedPlaneId: "falcon-mk2",
  selectedBelt: AmmoBelt.Universal,
  invertMouseY: false,
  invertMouseX: false,
  controlMode: ControlMode.MouseAim,
  stats: {
    battlesPlayed: 0,
    kills: 0,
    deaths: 0,
    groundTargetsDestroyed: 0,
    victories: 0
  },
  customizations: {
    skin: "default",
    tracerColor: "amber",
    noseArt: ""
  }
};

export function useProgression() {
  const [progression, setProgression] = useState<UserProgression>(INITIAL_PROGRESSION);
  const [isLoadingProgression, setIsLoadingProgression] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const sid = getMultiplayerSessionId();
      let base: UserProgression | null = null;

      try {
        const res = await fetch(`/api/progression?sid=${encodeURIComponent(sid)}`);
        if (res.ok) {
          const serverData = await res.json();
          if (serverData && serverData.status !== "not_found") {
            base = {
              ...INITIAL_PROGRESSION,
              ...serverData,
              stats: { ...INITIAL_PROGRESSION.stats, ...(serverData.stats || {}) },
              equippedMods: serverData.equippedMods || {},
              unlockedPlanes: serverData.unlockedPlanes || ["falcon-mk2"]
            };
          }
        }
      } catch (e) {
        console.warn("Failed fetching progression from server, falling back to cache", e);
      }

      // Fall back to local storage cache if not found on server (migration path)
      if (!base) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed) {
            base = {
              ...INITIAL_PROGRESSION,
              ...parsed,
              stats: { ...INITIAL_PROGRESSION.stats, ...(parsed.stats || {}) },
              equippedMods: parsed.equippedMods || {},
              unlockedPlanes: parsed.unlockedPlanes || ["falcon-mk2"]
            };

            // Migrate browser-bound local save to the server
            await fetch("/api/progression", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: sid, progression: base })
            }).catch(e => console.warn("Failed migrating local storage save to server", e));
          }
        } catch (e) {
          console.warn("Failed loading progression from local storage", e);
        }
      }

      // If still no profile exists (first load), create a new cadet
      if (!base) {
        base = {
          ...INITIAL_PROGRESSION,
          nickname: generateCallsign(),
          rankCode: "CDT",
          unlockedPlanes: ["falcon-mk2"]
        };

        // Write new profile to server
        await fetch("/api/progression", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, progression: base })
        }).catch(e => console.warn("Failed saving new profile to server", e));
      }

      // Always write to local storage as fallback/cache
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
      } catch (e) {
        console.warn("Failed to write fallback cache to local storage", e);
      }

      setProgression(base);
      setIsLoadingProgression(false);
    };

    loadData();
  }, []);

  const saveProgression = (updated: UserProgression) => {
    setProgression(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("localStorage persistence error", e);
    }
    // Persist to server-side bucket storage asynchronously
    const sid = getMultiplayerSessionId();
    fetch("/api/progression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, progression: updated })
    }).catch(e => console.warn("Failed saving progression to server", e));
  };

  return {
    progression,
    isLoadingProgression,
    saveProgression
  };
}
