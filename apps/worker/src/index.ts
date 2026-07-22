import { GameRoom } from "./room";
import type { Env } from "./env";
import {
  issueGuestSession,
  PlatformSessionError,
  requirePlatformOrigin,
  requirePlatformSession,
} from "./platform-session";
import { generateRoomId, roomIdMaxAttempts } from "./room-id";

export { GameRoom };
export type { Env };

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/platform/guest") {
        return issueGuestSession(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        requirePlatformOrigin(request);
        const session = await requirePlatformSession(request, env);
        const body = await request.text();
        const attempts = roomIdMaxAttempts(env.ROOM_ID_MAX_ATTEMPTS);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const roomId = generateRoomId(env.ROOM_ID_FORMAT);
          const forwarded = new Request(new URL("/create", request.url), {
            body,
            headers: request.headers,
            method: request.method,
          });
          forwarded.headers.set("X-Playweft-Player-Id", session.sub);
          const response =
            await env.GAME_ROOMS.getByName(roomId).fetch(forwarded);
          if (response.status === 409) {
            if (attempt + 1 < attempts) continue;
            return Response.json(
              { error: "room id collision limit reached" },
              { status: 409 },
            );
          }
          if (!response.ok) return response;
          const launch = (await response.json()) as { gameUrl: string };
          return Response.json({ roomId, gameUrl: launch.gameUrl });
        }
      }
      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({
          service: "playweft-game-rooms",
          endpoints: {
            guestSession: "POST /api/platform/guest",
            createRoom: "POST /api/rooms",
            launch: "GET /api/rooms/:roomId/launch",
            initialize: "PUT /api/rooms/:roomId/initialize",
            join: "POST /api/rooms/:roomId/join",
            start: "POST /api/rooms/:roomId/start",
            leave: "POST /api/rooms/:roomId/leave",
            seat: "POST /api/rooms/:roomId/seat",
            ready: "POST /api/rooms/:roomId/ready",
            kick: "POST /api/rooms/:roomId/kick",
            transferHost: "POST /api/rooms/:roomId/transfer-host",
            dissolve: "POST /api/rooms/:roomId/dissolve",
            changeGame: "PUT /api/rooms/:roomId/game",
            returnToRoom: "POST /api/rooms/:roomId/return-to-room",
            state: "GET /api/rooms/:roomId/state",
            action: "POST /api/rooms/:roomId/actions",
            connect: "GET /api/rooms/:roomId/connect (WebSocket)",
          },
        });
      }

      const match =
        /^\/api\/rooms\/([a-zA-Z0-9_-]{1,128})\/(game|launch|initialize|join|start|leave|seat|ready|kick|transfer-host|dissolve|return-to-room|state|actions|connect)$/.exec(
          url.pathname,
        );
      if (!match) return Response.json({ error: "not found" }, { status: 404 });

      const roomId = match[1]!;
      const endpoint = match[2]!;
      const forwarded = new Request(
        new URL(`/${endpoint}`, request.url),
        request,
      );
      // These are authenticated, read-only requests. Browsers are allowed to
      // omit (or vary) Origin on a same-origin GET, so enforcing Origin here
      // makes a freshly redirected room fail before its iframe can load.
      // All mutations and the WebSocket handshake still require an exact
      // platform Origin below.
      if (endpoint !== "launch" && endpoint !== "state") {
        requirePlatformOrigin(request);
      }
      const session = await requirePlatformSession(request, env);
      forwarded.headers.set("X-Playweft-Player-Id", session.sub);
      return env.GAME_ROOMS.getByName(roomId).fetch(forwarded);
    } catch (error) {
      if (error instanceof PlatformSessionError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      console.error("worker request failed", error);
      return Response.json({ error: "internal worker error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
