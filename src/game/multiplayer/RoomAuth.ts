import fs from "fs";
import path from "path";

export class RoomAuth {
  async onAuth(client: any, options: any): Promise<any> {
  const token = options.token;
  const nickname = options.nickname;
  if (!token || typeof token !== "string" || token.length > 128) {
    throw new Error("Invalid session token");
  }

  const saveDir = fs.existsSync("/data") ? "/data/saves" : path.join(process.cwd(), "saves");
  const filePath = path.join(saveDir, `${token}.json`);

  // On ephemeral deployments (HuggingFace Spaces) the save directory is reset
  // on every container restart. Allow joining with the options data as a guest
  // rather than hard-rejecting returning players whose session file no longer exists.
  if (!fs.existsSync(filePath)) {
    console.warn(`[Auth] No save for token ${token.slice(0, 8)}… — guest session`);
    return {
      nickname: nickname || "Pilot",
      selectedPlaneId: options.aircraftId || "falcon-mk2",
      isGuest: true
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const save = JSON.parse(raw);
    // Accept nickname from options so a player who changed it without re-registering
    // is not blocked; the canonical name lives in the save for history only.
    return { ...save, nickname: nickname || save.nickname };
  } catch (err) {
    console.error(`onAuth validation failed for ${token}:`, err);
    return {
      nickname: nickname || "Pilot",
      selectedPlaneId: options.aircraftId || "falcon-mk2",
      isGuest: true
    };
  }
}
}
