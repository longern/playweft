import type {
  JsonValue,
  RoomJoin,
  RoomLobby,
  RoomSnapshot,
} from "@playweft/game-protocol";

export type {
  RoomJoin,
  RoomLobby,
  RoomSnapshot,
} from "@playweft/game-protocol";

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

function endpoint(path: string): URL {
  return new URL(`${apiBase}${path}`, window.location.origin);
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const error =
      body !== null && typeof body === "object" && "error" in body
        ? body.error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : `request failed (${response.status})`,
    );
  }
  return body as T;
}

export interface RoomInitialization {
  runtime?: "lua";
  script: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface CreatedRoom {
  roomId: string;
  gameUrl: string;
}

export interface RoomLaunch {
  gameUrl: string;
}

export function initializeRoom(
  roomId: string,
  initialization: RoomInitialization,
): Promise<RoomLobby> {
  return fetch(
    endpoint(`/api/rooms/${encodeURIComponent(roomId)}/initialize`),
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(initialization),
    },
  ).then(responseJson<RoomLobby>);
}

export function joinRoom(roomId: string): Promise<RoomJoin> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/join`), {
    method: "POST",
    credentials: "same-origin",
  }).then(responseJson<RoomJoin>);
}

export function startRoom(roomId: string): Promise<RoomSnapshot> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/start`), {
    method: "POST",
    credentials: "same-origin",
  }).then(responseJson<RoomSnapshot>);
}

export function leaveRoom(roomId: string): Promise<RoomLobby | RoomSnapshot> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/leave`), {
    method: "POST",
    credentials: "same-origin",
  }).then(responseJson<RoomLobby | RoomSnapshot>);
}

export function setRoomSeat(
  roomId: string,
  seat: number | null,
): Promise<RoomLobby> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/seat`), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seat }),
  }).then(responseJson<RoomLobby>);
}

export function setPlayerReady(
  roomId: string,
  ready: boolean,
): Promise<RoomLobby> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/ready`), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ready }),
  }).then(responseJson<RoomLobby>);
}

export function kickPlayer(
  roomId: string,
  playerId: string,
): Promise<RoomLobby> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/kick`), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  }).then(responseJson<RoomLobby>);
}

export function transferRoomHost(
  roomId: string,
  playerId: string,
): Promise<RoomLobby> {
  return fetch(
    endpoint(`/api/rooms/${encodeURIComponent(roomId)}/transfer-host`),
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    },
  ).then(responseJson<RoomLobby>);
}

export function dissolveRoom(roomId: string): Promise<{ dissolved: true }> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/dissolve`), {
    method: "POST",
    credentials: "same-origin",
  }).then(responseJson<{ dissolved: true }>);
}

export function returnRoomToLobby(roomId: string): Promise<RoomLobby> {
  return fetch(
    endpoint(`/api/rooms/${encodeURIComponent(roomId)}/return-to-room`),
    { method: "POST", credentials: "same-origin" },
  ).then(responseJson<RoomLobby>);
}

export function createRoom(gameUrl: string): Promise<CreatedRoom> {
  return fetch(endpoint("/api/rooms"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameUrl }),
  }).then(responseJson<CreatedRoom>);
}

export function getRoomLaunch(roomId: string): Promise<RoomLaunch> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/launch`), {
    credentials: "same-origin",
  }).then(responseJson<RoomLaunch>);
}

export function changeRoomGame(
  roomId: string,
  gameUrl: string,
): Promise<RoomLaunch> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/game`), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameUrl }),
  }).then(responseJson<RoomLaunch>);
}

export function createGuestSession(): Promise<void> {
  return fetch(endpoint("/api/platform/guest"), {
    method: "POST",
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok)
      throw new Error(
        ((await response.json()) as { error?: string }).error ??
          "could not create platform session",
      );
  });
}

export function sendAction(
  roomId: string,
  action: JsonValue,
): Promise<RoomSnapshot> {
  return fetch(endpoint(`/api/rooms/${encodeURIComponent(roomId)}/actions`), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  }).then(responseJson<RoomSnapshot>);
}

export function connectRoom(roomId: string): WebSocket {
  const url = endpoint(`/api/rooms/${encodeURIComponent(roomId)}/connect`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url);
}
