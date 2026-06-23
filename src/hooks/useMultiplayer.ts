/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback } from "react";
import { MatchMode } from "../types";
import { getMultiplayerSessionId } from "./useProgression";
import { Client, Room } from "@colyseus/sdk";
import { ChatMessage, MultiplayerMatchContext } from "./multiplayer/types";
import { setupRoomListeners } from "./multiplayer/listeners";

export function useMultiplayer() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const roomRef = useRef<Room | null>(null);
  const myPilotIdRef = useRef<string>("");

  const disconnectMultiplayer = useCallback(() => {
    if (roomRef.current) {
      try {
        roomRef.current.leave();
      } catch (err) {
        console.warn("Error leaving room:", err);
      }
      roomRef.current = null;
    }
  }, []);

  const connectMultiplayer = useCallback(
    (
      engine: MultiplayerMatchContext,
      _renderer3D: any,
      mapId: string,
      mode: MatchMode,
      nickname: string,
      skin: string,
      onLocalPlayerHit: (tgtId: string, isGround: boolean) => void,
      onMatchRejected: (reason: string) => void
    ) => {
      disconnectMultiplayer();

      const sessionId = getMultiplayerSessionId();
      engine.isMultiplayer = true;
      engine.isHost = false;

      // Discard locally-spawned bots — the server is authoritative and will
      // deliver the real roster via Colyseus state sync (onAdd).
      engine.pilots = engine.pilots.filter(p => p.id === "player");

      const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
      const client = new Client(`${protocol}${window.location.host}`);

      console.log(`[Multiplayer] Connecting to Colyseus at ${window.location.host}...`);

      client.joinOrCreate("air_combat", {
        token: sessionId,
        nickname: nickname || "Maverick",
        aircraftId: engine.pilots.find(p => p.id === "player")?.specs.id || "falcon-mk2",
        skin: skin || "default",
        mapId,
        mode
      })
      .then((room) => {
        roomRef.current = room;
        myPilotIdRef.current = room.sessionId;

        console.log(`[Multiplayer] Joined room: ${room.roomId}`);

        // Register all schema sync & message listeners from separate module
        setupRoomListeners(room, engine, setChatMessages, onLocalPlayerHit);
      })
      .catch((err) => {
        console.error("[Multiplayer] Join failed:", err);
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "connectMultiplayer.catch",
            message: err?.message || String(err),
            stack: err?.stack || ""
          })
        }).catch(() => {});
        onMatchRejected("connection_failed");
      });

      // Bind local player shoots callback to nothing on server auth
      engine.onProjectileSpawn = () => {};
      engine.onGroundTargetDamage = () => {};
      engine.onLocalPlayerKill = () => {};
      engine.onPlayerDamage = () => {};
    },
    [disconnectMultiplayer]
  );

  const sendChat = useCallback((text: string, nickname: string) => {
    if (roomRef.current) {
      roomRef.current.send("chat", text);
    } else {
      setChatMessages((prev) => [
        ...prev.slice(-49),
        { sender: nickname || "Cadet", text, ts: Date.now() }
      ]);
    }
  }, []);

  return {
    chatMessages,
    setChatMessages,
    connectMultiplayer,
    disconnectMultiplayer,
    sendChat,
    roomRef,
    myPilotIdRef
  };
}
