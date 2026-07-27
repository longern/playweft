# Integrate a Static Game with Playweft

Playweft loads your static game page in a cross-site iframe. Your page renders
the game and sends game intents; Playweft owns the room, anonymous players,
invite links, WebSocket, Lua execution, and permissions.

You do not need to install an npm package or call the Playweft API directly.
The complete integration surface is one browser-native `MessagePort`.

## Protocol at a glance

```text
game iframe                   Playweft platform
───────────                   ─────────────────
bridge-ready       ────────>  validates game origin
                     <──────  bridge + transferred MessagePort
descriptor         ────────>
initialize         ────────>
                     <──────  ready
action             ────────>
                     <──────  action-result | state | error
```

All messages after `bridge` travel through the transferred port. Message names
and the `version: 1` handshake are part of the protocol.

## 1. Publish the game page

- Publish the game as an HTTPS static site, such as a Cloudflare Pages project.
- Use a site different from the Playweft platform. Do not deploy it to the
  platform domain or a subdomain of that domain.
- A user pastes this page's URL into the platform home page to create a room.

The page must work inside an iframe. It must not depend on third-party cookies,
a Playweft account, or its own WebSocket service.

The game iframe allows scripts, same-origin access to the game's own origin,
and form submission. It does not allow top-level navigation, popups, or
downloads. A form that submits to the current page reloads the iframe and must
establish the Playweft bridge again; use `type="button"` or prevent the submit
event when a form is only being used for in-game controls.

## 2. Establish the bridge and register the game

When the game loads, repeatedly announce that it is ready to its parent window.
The platform validates the iframe origin and replies with a `MessagePort`.

```js
let gamePort;
let ownPlayerId;
let latestMatchId;
let latestVersion = -1;

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
  gamePort.onmessage = onPlatformMessage;
  gamePort.start();

  // Optional local-history metadata.
  gamePort.postMessage({
    type: "descriptor",
    descriptor: {
      name: "My Game",
      translations: {
        "zh-CN": { name: "我的游戏" },
      },
      icon: "/icon.svg",
      helpUrl: "/help.html",
      modes: ["solo", "room"],
      liveRoom: false,
    },
  });

  // Required room configuration. This compiles the Lua source but does not
  // start the game.
  gamePort.postMessage({
    type: "initialize",
    initialization: {
      runtime: "lua",
      script: gameLuaSource,
      minPlayers: 2,
      maxPlayers: 4,
      liveRoom: false,
    },
  });
});
```

`descriptor` is optional. `name` must contain 1–100 characters and is the
default game name. `translations` is an optional locale dictionary; use
`translations[locale].name` to provide a translated name, for example
`{ "zh-CN": { name: "我的游戏" } }`. Playweft selects the browser's language,
then falls back to `name` when a locale or translation is absent. `icon` and
`helpUrl` must be relative URLs or absolute URLs hosted on the game's own origin.
`modes` may include `"solo"` and/or `"room"`; omitted modes default to room
play. `liveRoom: true` declares that room play needs a non-hibernating,
always-live room connection. Live room state is kept in Durable Object memory
instead of being persisted after every action, so it is best for games that
need lower latency while players are actively connected. The game-facing
message protocol stays the same; the platform routes actions over the live
connection internally.

`initialize` is required. `minPlayers` and `maxPlayers` must be integers from
1 to 32, with `minPlayers <= maxPlayers`. The room atomically fixes the Lua
source, runtime, player limits, and `liveRoom` setting. Repeating the exact
same configuration is safe; submitting a different configuration fails.

## 3. Receive platform messages

The platform sends one of the following messages through the port.

| Message | Meaning |
| --- | --- |
| `{ type: "ready", phase, playerId }` | Registration and lobby join succeeded. `playerId` is this browser's opaque, room-scoped ID. |
| `{ type: "state", phase: "playing", state, events, matchId, version, serverTime }` | Player-specific game update. `version` only increases within one `matchId`; `serverTime` is Unix time in milliseconds. |
| `{ type: "action-result", requestId, accepted: true, matchId, version }` | The action was accepted. The accompanying `state` message remains the rendering source of truth. |
| `{ type: "action-result", requestId, accepted: false, matchId, version, error }` | The game rejected the action without changing state or incrementing `version`. |
| `{ type: "error", code, error, requestId? }` | A protocol or room operation failed. Action errors include their originating `requestId`; platform errors do not. `code` is stable enough for UI branching and `error` is human-readable. |

```js
function onPlatformMessage(event) {
  const message = event.data;

  if (message?.type === "ready") {
    ownPlayerId = message.playerId;
    showWaitingForHost();
    return;
  }

  if (message?.type === "state") {
    if (message.matchId !== latestMatchId) {
      latestMatchId = message.matchId;
      latestVersion = -1;
    }
    if (message.version <= latestVersion) return;
    latestVersion = message.version;
    render(message.state, message.events);
    enableGameControls();
    return;
  }

  if (message?.type === "action-result" && !message.accepted) {
    showError(message.error.message);
    return;
  }

  if (message?.type === "error") {
    showError(message.error);
  }
}
```

The game is in the lobby after `ready`; it should not allow gameplay until its
first `state` message. The platform owns the lobby, host privileges, player
limits, kicking, and game start.

Current error codes are `INITIALIZATION_REJECTED`, `INVALID_ACTION_REQUEST`,
`GAME_NOT_STARTED`, `ACTION_REJECTED`, `ROOM_ERROR`, and
`REALTIME_CONNECTION_FAILED`. These are platform/transport failures carried by
`type: "error"`. Normal game-rule rejections use `type: "action-result"` with
`accepted: false` and the game-defined `error.code`.

## 4. Submit an action

```js
function chooseCard(card) {
  const requestId = crypto.randomUUID();
  gamePort?.postMessage({
    type: "action",
    requestId,
    action: { type: "choose", card },
  });
}
```

Every action requires a non-empty `requestId` up to 128 characters. Keep the
action pending until its matching `action-result` or request-scoped platform
`error`. Retrying the same ID with the same action is safe: Playweft returns
the stored result without running Lua again. Reusing the ID with different
content is an error. An action must be JSON-serializable and no larger than
8 KiB. The platform derives player identity from the top-level page's HttpOnly
session and ignores identity fields in the submitted action.

## 5. Write the Lua game

Initialization only compiles Lua. `setup(context)` runs only after the host
starts the game and the player roster is locked:

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
      {
        type = "chosen",
        player = context.actor.id,
      },
    },
  }
end
```

When a player leaves an active game, Playweft calls the optional lifecycle
handler below before removing that player from the room. Context contains
`{ protocolVersion, matchId, version, leftAt, actor }`. Return the updated
state and events needed to let remaining players continue.

```lua
function on_player_left(state, context)
  state.disconnected = context.actor.id

  return {
    state = state,
    events = {
      {
        type = "player_left",
        player = context.actor.id,
      },
    },
  }
end
```

When the room host selects **Return to room**, the platform asks the game
runtime whether the current session may be dissolved. Implement the optional
`on_return_to_room(state, context)` callback and return `true` to allow the
room to return to its lobby. Returning `false`, or omitting the callback,
keeps the game running. It does not modify game state. Context contains
`{ protocolVersion, matchId, version, serverTime, actor }`.

```lua
function on_return_to_room(state, context)
  return state.lastResult ~= nil
end
```

`setup` receives this context:

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

`players` contains only seated participants in seat order. `id` is an opaque,
room-scoped identity. `name` is optional presentation data and never an
authorization key. `match.id` is new for every game started in the room;
`ownerId` refers to one player, `startedAt` is Unix time in milliseconds, and
`randomSeed` is a positive 32-bit integer. Store any match metadata needed
after setup in authoritative state.

`on_action` context contains `{ protocolVersion, matchId, actionId, actionAt,
version, actor }`. `actor` is `{ id, role, seat?, name?, isOwner }`; `role` is
`"player"` or `"spectator"`. `version` is the current version before applying
the action and `actionAt` is authoritative Unix time in milliseconds.

An action must explicitly return one of:

```lua
-- Accepted: persists state, increments version, then projects state/events.
{ accepted = true, state = state, events = events }

-- Rejected: requester-only result; state and version do not change.
{
  accepted = false,
  error = { code = "NOT_YOUR_TURN", message = "Wait for the other player" },
}
```

Error codes must match `[A-Z][A-Z0-9_]{0,63}` and messages contain 1–500
characters. All values must be JSON-serializable. Lua has no network,
file-system, random, module-loading, or debug APIs.

### Give each recipient private state and events

The state returned by `setup`, `on_action`, and `on_player_left` is the
server's authoritative state. Every game must define
`view(state, events, context)` and return exactly what the current recipient
may see:

```lua
function view(state, events, context)
  local hand = state.hands[context.viewer.id]
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
      ownHand = hand,
      opponentCardCounts = state.opponentCardCounts,
    },
    events = visible_events,
  }
end
```

Context is `{ protocolVersion, matchId, version, serverTime, viewer }`.
`viewer` has the same structure as `actor`, so spectator views are explicit.
The callback runs independently before every HTTP action response, state read,
initial WebSocket snapshot, and WebSocket update. Both input tables are copies:
mutating them in `view` cannot change authoritative state or the events seen by
another recipient. Games with no private data may simply return
`{ state = state, events = events }`.

## Constraints and security boundary

- Do not create `fetch`, WebSocket, or EventSource connections to Playweft.
  The platform does not enable CORS for the game page.
- Do not implement authentication, host privileges, kicking, player limits, or
  starting the game inside the game page. The platform lobby owns these rules.
- Do not persist `playerId` as a long-lived identity. It is valid only within
  the current room and Lua game.
- The platform may load the game invisibly in the lobby to collect metadata and
  Lua configuration. Do not allow actual play until the first `state` message.

For a complete working reference, see [`apps/rps-demo`](../../apps/rps-demo).
