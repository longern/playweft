import type { GameRoom } from "./room";

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  AUTH_SECRET?: string;
  ROOM_ID_FORMAT?: string;
  ROOM_ID_MAX_ATTEMPTS?: string;
}
