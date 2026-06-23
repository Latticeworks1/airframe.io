import { Vector3 } from "three";
import { Pilot } from "../../types";

export interface ChatMessage {
  sender: string;
  text: string;
  ts: number;
}

export interface MultiplayerMatchContext {
  isMultiplayer: boolean;
  isHost: boolean;
  team1Score: number;
  team2Score: number;
  matchTimer: number;
  matchEnded: boolean;
  pilots: Pilot[];
  groundTargets: any[];
  skyZones: any[];
  projectiles: any[];
  killFeed: any[];
  xpEarnedThisMatch: number;
  spawnProjectile(pilot: Pilot, type: any): void;
  forceRegisterKill(killerId: string, victimId: string, weapon: string): void;
  forceEndGame(playerWon: boolean): void;
  addBot(team: 1 | 2): void;
  removeBot(team: 1 | 2): void;
  onProjectileSpawn?: (type: any) => void;
  onProjectileImpact?: (type: any, position: Vector3, ownerId: string) => void;
  onGroundTargetDamage?: (targetId: string, hp: number, isDead: boolean) => void;
  onLocalPlayerKill?: (killerId: string, victimId: string, weapon: string) => void;
  onLocalPlayerHit?: (targetId: string, isGround: boolean) => void;
  onPlayerDamage?: (shooterId: string, targetId: string, damage: number, bulletType: string, hitSpotLocal: Vector3) => void;
  onVoxelHit?: (targetId: string, localOffsetMeters: Vector3, blastMeters: number) => void;
  onPilotRespawn?: (pilotId: string) => void;
}
