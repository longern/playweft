# playweft

An open platform for turning static web games into connected multiplayer experiences.

Playweft turns a static game page into a connected game client. Each room has
one authoritative Durable Object, persisted JSON state, and optional WebSocket
clients. The static page submits player actions and renders returned state and
events.

## Repository layout

```text
apps/web                 React room launcher, invitation host, and local game history
apps/rps-demo            Static Rock-Paper-Scissors example, bundled under /games/rps/
apps/worker              Cloudflare HTTP API, Durable Objects, deployment config
packages/game-protocol   JSON values and wire-message contract shared by both apps
packages/runtime-core    Runtime interface independent of Lua and Cloudflare
packages/runtime-lua     Lua 5.4 implementation of that interface
```

Third-party static-game authors should start with the [integration guide](docs/game-integration/README.md).

`apps/` are independently runnable applications. `packages/` is intentionally
small: code goes there only when it is used across an app boundary or is a
replaceable runtime implementation. Adding a QuickJS or direct-Wasm runtime
means implementing `GameRuntime` and registering it in
`apps/worker/src/runtime-registry.ts`; the Durable Object and React client do
not need to know interpreter-specific details.

## Trust boundary

The platform page is always top-level. A third-party game is loaded from a
separate game-content origin in a sandboxed iframe and communicates only
through a `MessageChannel`:

```text
platform page (same origin, HttpOnly session, WebSocket) -> Worker -> Durable Object
                  |
                  +-> sandboxed third-party iframe (game intents and state only)
```

The iframe never receives a platform player ID, session token, cookie, or WebSocket URL.
On first launch it sends its Lua source through the bridge; the platform page
uses its own session to initialize the room. The Durable Object stores that
source hash atomically: a repeat with the same hash is harmless, while a
different script for an existing room is rejected. The iframe can subsequently
ask to perform a game action, but the Worker derives the user from its session
and maps it to a room-scoped opaque actor ID before invoking Lua. The public
room API deliberately has no CORS policy.

## Run locally

```sh
npm install
npm run dev:worker -- --var AUTH_SECRET:local-session-secret
npm run dev:rps
npm run dev:web
```

`AUTH_SECRET` signs the HttpOnly demo guest session and must be a
Worker secret in a real deployment. The guest issuer is only a minimal
local/demo identity provider and should be replaced with the platform's real
account/session issuer. Browser-facing mutations and WebSocket upgrades must
have an `Origin` equal to the Worker endpoint origin. Authenticated read
requests remain usable in browsers that omit `Origin` for a same-origin GET.

## Room API

| Request | Purpose |
| --- | --- |
| `POST /api/rooms` | Create a random room with `{ gameUrl }`; room IDs default to 4-character friendly codes and the URL is the only launch metadata persisted for that room. |
| `GET /api/rooms/:roomId/launch` | Read the game's entry URL for the invitation page. |
| `PUT /api/rooms/:roomId/initialize` | Atomically install `{ runtime?: "lua", script, minPlayers, maxPlayers }`; repeating the same complete configuration is safe. |
| `POST /api/rooms/:roomId/join` | Join the platform-owned lobby. The room creator is the host; when every seat is taken, new arrivals join as spectators. |
| `POST /api/rooms/:roomId/seat` | Choose an empty numbered seat with `{ seat }`, or leave a seat to spectate with `{ seat: null }`. The host keeps their seat. |
| `POST /api/rooms/:roomId/ready` | Set a seated non-host player's readiness with `{ ready }`. |
| `POST /api/rooms/:roomId/kick` | Room-host-only lobby action with `{ playerId }`. |
| `POST /api/rooms/:roomId/dissolve` | Room-host-only lobby action that closes the room for everyone and invalidates its invite link. |
| `POST /api/rooms/:roomId/start` | Room-host-only action; requires the minimum seated players and every seated non-host player ready, then locks the roster and calls Lua `setup({ players })`. |
| `POST /api/platform/guest` | Platform-only demo bootstrap; sets an HttpOnly guest session. |
| `GET /api/rooms/:roomId/state` | Read persisted state; requires a platform session. |
| `POST /api/rooms/:roomId/actions` | Submit `{ action }`; player identity comes from the platform session. |
| `GET /api/rooms/:roomId/connect` | Open a platform-owned WebSocket; requires a platform session. |

Before start, HTTP/WebSocket updates use `type: "lobby"` with the opaque
player list, host, phase, and player limits. After start they contain `type`,
`state`, `version`, and `scriptHash`; action updates also include `events`.
The platform shows this lobby itself, then makes the untrusted iframe fill the
viewport once the roster is locked.

## Rock-Paper-Scissors example

The game page is a static entry in `apps/rps-demo`, bundled with the platform at
`/games/rps/`. It has no direct API access and cannot be meaningfully opened as
a standalone game page. The platform homepage creates an ordinary room for it;
there is no dedicated demo route.

```sh
# Terminal 1: the trusted Worker. No game script needs pre-seeding.
npm run dev:worker -- --var AUTH_SECRET:local-session-secret

# Terminal 2: the static game example.
npm run dev:rps

# Terminal 3: trusted platform page.
npm run dev:web
```

For local development, open `http://localhost:9133`, enter
`http://localhost:9139`, then create a room. In a deployed build, select the
built-in game from the homepage, which resolves to `/games/rps/`. Copy the
resulting `/r/<roomId>` link to another browser or device. Each browser receives
an anonymous platform session. The first player chooses one of three buttons;
the server reveals both choices only after a second player chooses. A draw clears
both choices and starts the next round.

The platform keeps a browser-local list of recently used game URLs. A game may
send `{ name, icon }` through the bridge after loading; those labels improve the
local history but are not stored as a global catalogue. The room Durable Object
stores only the entry URL, fixed Lua configuration and player limits, game
state, the room creator, and opaque room-scoped player membership.

## Room cleanup

Durable Object instances may hibernate automatically, but persisted storage is
not removed by hibernation. Each room therefore schedules a one-hour idle
alarm. Creating, opening, initializing, connecting, or acting in a room moves
the expiry forward. When the alarm finds no connected WebSockets and no activity
for an hour, it calls `storage.deleteAll()` and the invite link becomes invalid.

## Deploy to Cloudflare

Use one public origin, `https://play.example.com`, for the trusted platform
app, Worker API, WebSocket, Durable Object, and the bundled RPS sample at
`/games/rps/`. `npm run build:web` builds both frontend entries into
`apps/web/dist`, which is uploaded by the Worker configuration.

Third-party games should still use a separate origin. That keeps untrusted game
content out of the platform cookie's same-site context; the Worker's same-origin
check remains the second defence.

Write the Worker session secret interactively. Do not put it in Git; `secret
put` immediately creates a new Worker version:

```sh
npx wrangler secret put AUTH_SECRET --config apps/worker/wrangler.jsonc
```

Room ID generation is optional to configure. By default, the Worker uses
`ROOM_ID_FORMAT=code:4` with the friendly alphabet
`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, and retries up to
`ROOM_ID_MAX_ATTEMPTS=8` collisions. Supported formats are `code:N`,
`digits:N`, `base64url:N`, and `uuid`. If the frontend is separately
configured, set `VITE_ROOM_ID_FORMAT` to the same value so the home input can
recognize room codes without an extra config request.

Deploy the platform. The Worker configuration uploads `apps/web/dist`, including
the RPS files under `/games/rps/`; `/api/*` runs the Worker first while other
navigation requests are handled by the React SPA.

```sh
npm run deploy:platform
```

After the first Worker deployment, bind `play.example.com` to that Worker in
the Cloudflare Dashboard. Browser requests are accepted only when their origin
matches the Worker endpoint they reach.

The built-in game uses relative paths, so no game-origin environment variable is
required. Redeploy the platform whenever its frontend, bundled game, or Worker
code changes.

## Lua game contract

```lua
function setup(context)
  -- context.players is the platform-locked anonymous roster.
  -- context.randomSeed is a cryptographically generated, stable integer for this room.
  return { score = 0, players = context.players, seed = context.randomSeed }
end

function on_action(state, action, context)
  if action.type == "add" then
    state.score = state.score + action.amount
  end
  return {
    state = state,
    events = { { player = context.playerId, score = state.score } },
  }
end
```

An optional `on_player_left(state, context)` callback runs when a player uses
the platform's **Leave game** action during play. It receives `{ playerId,
version }` and returns `{ state, events }`, allowing the game to continue with
the remaining players or expose its own ended/disbanded state.

An optional `on_return_to_room(state, context)` callback controls whether the
room host may end the current session and return every player to the lobby. It
must return `true` to permit the transition; omitted callbacks deny it.

Values crossing the Lua boundary must be JSON-compatible: null, booleans,
finite numbers, strings, arrays, and objects with string keys. `context` for an
action is `{ playerId, version }`. `setup` receives `{ players, randomSeed }`
only after the room host starts the game. `randomSeed` is generated once by the
platform and is intended for a deterministic PRNG stored in game state; Lua
does not expose `math.random`.

## Runtime boundaries

Lua runs from a build-time imported Wasm module, rather than fetching or
compiling Wasm inside a request. `patches/wasmoon+1.16.0.patch` is source
control, not build output: `patch-package` applies it after every install so
Wasmoon's generated loader accepts the Worker-provided `WebAssembly.Module`.

The runtime enforces a 64 KiB source/state limit, 8 KiB action limit, 16 KiB
event limit, 32 levels of nesting, 2,048 table entries, and 50,000 Lua
instructions per invocation. Lua does not receive I/O, OS, package/require,
coroutines, random, or debug APIs. The current generic Wasm build cannot impose
a separate hard Lua heap cap without invoking a dynamically generated callback
Wasm module, which Workers disallow; the serialized input/output limits are the
memory boundary for this initial version. A production high-tenant runtime
should use a custom Lua Wasm build with a statically linked quota allocator.

## Verify

```sh
npm run check
npm run build:web
npx wrangler deploy --config apps/worker/wrangler.jsonc --dry-run
```
