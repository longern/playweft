# Integrate a Static Game with Playweft

Playweft treats a game as a static, versioned package described by one
Manifest. The platform fetches and validates that Manifest before it executes
the game client in a sandboxed iframe.

The platform owns rooms, identity, the lobby, permissions, networking and
authoritative Lua execution. The game client renders player-specific state and
sends intents over a transferred `MessagePort`.

## 1. Publish a game package

A package contains at least:

```text
my-game/
├── playweft.json
├── index.html
├── icon.svg
└── game.lua
```

When a user enters `https://games.example.com/my-game/`, Playweft fetches
`https://games.example.com/my-game/playweft.json`. A pasted URL whose path ends
in `.json` is treated as an explicit Manifest URL.

The Manifest is fetched by the browser before the iframe opens, so its response
must allow the Playweft origin through CORS, for example:

```http
Access-Control-Allow-Origin: https://play.example.com
```

The Lua entry is fetched server-side by Playweft's Worker and does **not** need
CORS. The Worker requires it to share the Manifest origin, enforces the size
limit, compiles it and locks its source hash in the room. The client entry is
opened as an iframe and also does not need CORS.
Production resources must use HTTPS. Local development may use `http://localhost`
or `http://127.0.0.1`.

## 2. Define `playweft.json`

Manifest v1 is strict: unknown fields and malformed values are rejected. The
JSON Schema is
[`game-manifest-v1.schema.json`](game-manifest-v1.schema.json).

```json
{
  "$schema": "https://playweft.dev/schemas/game-manifest-v1.json",
  "manifestVersion": 1,
  "id": "com.example.my-game",
  "version": "1.2.0",
  "protocol": {
    "min": 1,
    "max": 1
  },
  "client": {
    "entry": "./index.html"
  },
  "display": {
    "defaultLocale": "en",
    "locales": {
      "en": {
        "name": "My Game",
        "description": "A short catalogue description.",
        "category": "Strategy"
      },
      "zh-CN": {
        "name": "我的游戏",
        "description": "用于目录展示的简短介绍。",
        "category": "策略"
      }
    },
    "icon": "./icon.svg",
    "help": "./help.html"
  },
  "modes": {
    "solo": {},
    "room": {
      "players": {
        "min": 2,
        "max": 4
      },
      "server": {
        "runtime": "lua",
        "entry": "./game.lua",
        "persistence": "durable"
      }
    }
  },
  "permissions": {
    "clipboard.readText": {
      "reason": "Import a saved game configuration"
    }
  }
}
```

Key rules:

- `id` is a stable reverse-domain identifier. It does not change between
  releases of the same game.
- `version` is SemVer. Playweft locks `id`, `version`, Lua source hash, player
  limits and persistence mode when a room initializes.
- `protocol.min/max` is the range of Playweft bridge versions the package
  supports. The current version is `1`.
- `client.entry`, `display.icon`, `display.help` and the Lua `server.entry`
  resolve relative to the Manifest URL and must remain on its origin.
- Presence of `modes.solo` or `modes.room` determines where the game may run.
- `persistence: "durable"` persists authoritative state after each accepted
  action and permits Durable Object hibernation. `"live"` keeps active state in
  memory and routes actions over the room WebSocket.
- Permissions must be declared before use. The platform exposes only the
  declared, supported capabilities.

The platform limits a Manifest to 64 KiB and a Lua entry to 1 MiB.

## 3. Establish bridge v1

After the browser has validated the Manifest and the Worker has installed any
room server entry, Playweft opens `client.entry`. The iframe repeatedly
announces readiness. The platform validates its origin and transfers a
`MessagePort`.

```js
let gamePort;
let ownPlayerId;
let latestMatchId;
let latestVersion = -1;
const pendingRpc = new Map();

const announceReady = () => {
  window.parent.postMessage(
    { type: "playweft:bridge-ready", version: 1 },
    "*",
  );
};

const probe = window.setInterval(announceReady, 500);
announceReady();

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type !== "playweft:bridge" || event.data?.version !== 1) {
    return;
  }
  const [port] = event.ports;
  if (!port) return;

  gamePort = port;
  window.clearInterval(probe);
  gamePort.onmessage = onRpcMessage;
  gamePort.start();

  rpcCall("game.initialize").then((context) => {
    // context.mode is "solo" or "room".
    // room mode also returns phase and this room-scoped playerId.
    ownPlayerId = context.playerId;
    showWaitingForState();
  }).catch(showRpcError);
});

function rpcCall(method, params) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
    gamePort.postMessage({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });
  });
}
```

The window-level messages only transfer the port. Every port message uses
JSON-RPC 2.0. Batch messages are unsupported, and request IDs must be strings
containing 1–128 characters.

`game.initialize` takes no params. It is the only runtime registration call:
the platform has already loaded the package contract. Its result is:

```js
{
  mode: "solo" | "room",
  protocolVersion: 1,
  capabilities: ["clipboard.readText"],
  // room only:
  phase: "lobby" | "playing",
  playerId: "actor_..."
}
```

The game is in the platform-owned lobby after this request resolves. Do not
enable gameplay until the first `game.state` notification.

## 4. Receive state and submit actions

The platform sends:

| Method | Params |
| --- | --- |
| `game.state` | `{ phase, state, events, matchId, version, serverTime }`; state and events have already been projected for this player. |
| `platform.error` | `{ error: { code, message, retryable } }` for a failure not tied to an outstanding request. |

```js
function onRpcMessage(event) {
  const message = event.data;
  if (message?.jsonrpc !== "2.0") return;

  if (Object.hasOwn(message, "id")) {
    const pending = pendingRpc.get(message.id);
    if (!pending) return;
    pendingRpc.delete(message.id);
    if (message.error) pending.reject(new PlayweftRpcError(message.error));
    else pending.resolve(message.result);
    return;
  }

  if (message.method === "game.state") {
    const update = message.params;
    if (update.matchId !== latestMatchId) {
      latestMatchId = update.matchId;
      latestVersion = -1;
    }
    if (update.version <= latestVersion) return;
    latestVersion = update.version;
    render(update.state, update.events);
  }
}

async function chooseCard(card) {
  const result = await rpcCall("room.action", {
    action: { type: "choose", card },
  });
  if (!result.accepted) showError(result.error.message);
}
```

The JSON-RPC ID also becomes the idempotent server action ID. Reusing it with
different action content is an error. Actions must be JSON-compatible and no
larger than 8 KiB. The platform derives player identity from its HttpOnly
session; identity fields inside actions have no authority.

JSON-RPC failures use standard `-32600` through `-32603` codes. Platform
failures use `-32000` with a stable string code and retry hint in `error.data`.
A game-rule rejection is a successful RPC result with `accepted: false`.

## 5. Use declared permissions

The iframe is explicitly denied direct Async Clipboard access. A game that
declares `permissions["clipboard.readText"]` may call:

```js
const text = await rpcCall("clipboard.readText");
```

The Manifest `reason` is displayed in the platform-controlled permission UI.
The first approval is remembered per game origin. Later reads skip the custom
approval prompt but still show a short top-level notice. Browser-native
clipboard UI may still appear.

The result is limited to 64 KiB. Stable failure codes include `USER_DENIED`,
`REQUEST_EXPIRED`, `NOT_SUPPORTED`, `NOT_ALLOWED`, `TOO_LARGE`, `BUSY`,
`RATE_LIMITED`, `READ_FAILED` and `PERMISSION_NOT_DECLARED`.

## 6. Write the Lua game

The platform compiles the fetched Lua entry while initializing the room.
`setup(context)` runs only when the host starts and locks the seated roster:

```lua
function setup(context)
  return {
    players = context.players,
    match = context.match,
    moves = {},
  }
end

function on_action(state, action, context)
  if action.type ~= "choose" then
    return {
      accepted = false,
      error = {
        code = "INVALID_ACTION",
        message = "Expected a choose action",
      },
    }
  end

  state.moves[context.actor.id] = action.card
  return {
    accepted = true,
    state = state,
    events = {
      { type = "chosen", player = context.actor.id },
    },
  }
end
```

`setup` receives:

```lua
{
  protocolVersion = 1,
  match = {
    id = "match_...",
    ownerId = "actor_...",
    startedAt = 1785123456789,
    randomSeed = 123,
  },
  players = {
    { id = "actor_...", name = "Alice", seat = 1 },
    { id = "actor_...", seat = 2 },
  },
}
```

Player IDs are opaque and room-scoped. Names are optional presentation data,
never authorization keys. `on_action` receives `{ protocolVersion, matchId,
actionId, actionAt, version, actor }`; actor contains `{ id, role, seat?, name?,
isOwner }`.

An action must explicitly return:

```lua
-- Accepted: persists state and increments version.
{ accepted = true, state = state, events = events }

-- Rejected: state and version do not change.
{
  accepted = false,
  error = { code = "NOT_YOUR_TURN", message = "Wait for the other player" },
}
```

Error codes match `[A-Z][A-Z0-9_]{0,63}` and messages contain 1–500
characters. All values must be JSON-compatible. Lua has no network,
file-system, random, module-loading or debug APIs.

Optional lifecycle hooks:

- `on_player_left(state, context)` may update state after a player disconnects.
- `on_return_to_room(state, context)` returns a boolean allowing or rejecting
  the host's request to dissolve the current match and return to the lobby.

### Project private state for every recipient

Authoritative state and events are never sent directly. Every game defines
`view(state, events, context)`:

```lua
function view(state, events, context)
  local visible_events = {}
  for _, event in ipairs(events) do
    if event.player == nil or event.player == context.viewer.id then
      table.insert(visible_events, event)
    end
  end
  return {
    state = {
      turn = state.turn,
      board = state.board,
      ownHand = state.hands[context.viewer.id],
      opponentCardCounts = state.opponentCardCounts,
    },
    events = visible_events,
  }
end
```

Context is `{ protocolVersion, matchId, version, serverTime, viewer }`.
`viewer` has the same shape as an action actor, including spectator role.
Projection runs independently for every HTTP response, state read, initial
WebSocket snapshot and WebSocket update. Inputs are copies, so mutations in
`view` cannot alter authoritative state or another recipient's view.

## Security boundary

- Fetch and validate the Manifest in the browser, then install the Lua entry
  through the Worker, before opening the iframe.
- Keep all package resources on the Manifest origin.
- Do not call Playweft HTTP or WebSocket APIs from the game. Only use the
  transferred MessagePort.
- Do not implement authentication, room host authority, kicking, readiness,
  seating or game start inside the iframe.
- Do not treat `playerId` as a long-lived identity.
- Do not call `navigator.clipboard.readText()` directly; declare and use the
  platform RPC.

See [`apps/rps-demo`](../../apps/rps-demo) for a complete package.
