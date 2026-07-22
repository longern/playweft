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

## 2. Establish the bridge and register the game

When the game loads, repeatedly announce that it is ready to its parent window.
The platform validates the iframe origin and replies with a `MessagePort`.

```js
let gamePort;
let ownPlayerId;
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
      icon: "/icon.svg",
      helpUrl: "/help.html",
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
    },
  });
});
```

`descriptor` is optional. `name` must contain 1–100 characters. `icon` and
`helpUrl` must be relative URLs or absolute URLs hosted on the game's own origin.

`initialize` is required. `minPlayers` and `maxPlayers` must be integers from
1 to 32, with `minPlayers <= maxPlayers`. The room atomically fixes the Lua
source, runtime, and player limits. Repeating the exact same configuration is
safe; submitting a different configuration fails.

## 3. Receive platform messages

The platform sends one of the following messages through the port.

| Message | Meaning |
| --- | --- |
| `{ type: "ready", phase, playerId }` | Registration and lobby join succeeded. `playerId` is this browser's opaque, room-scoped ID. |
| `{ type: "state", phase: "playing", state, events, version }` | Authoritative game update. `version` only increases; duplicates for the same version are not sent. |
| `{ type: "action-result", requestId, version }` | The action with `requestId` was accepted and persisted at `version`. The accompanying `state` message remains the rendering source of truth. |
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
    if (message.version <= latestVersion) return;
    latestVersion = message.version;
    render(message.state, message.events);
    enableGameControls();
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
`REALTIME_CONNECTION_FAILED`.

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
action pending until its matching `action-result` or request-scoped `error`.
An action must be JSON-serializable and no larger than 8 KiB. The platform
derives player identity from the top-level page's HttpOnly session; it ignores
any identity fields in the submitted action. `playerId` from `ready` is useful
only for rendering this browser's local view.

## 5. Write the Lua game

Initialization only compiles Lua. `setup(context)` runs only after the host
starts the game and the player roster is locked:

```lua
function setup(context)
  -- A locked roster of opaque, room-scoped player IDs.
  -- randomSeed is generated once by Playweft for this room.
  return {
    players = context.players,
    seed = context.randomSeed,
    moves = {},
  }
end

function on_action(state, action, context)
  if action.type ~= "choose" then
    return {
      state = state,
      events = {
        { type = "invalid_action" },
      },
    }
  end

  state.moves[context.playerId] = action.card

  return {
    state = state,
    events = {
      {
        type = "chosen",
        player = context.playerId,
      },
    },
  }
end
```

When a player leaves an active game, Playweft calls the optional lifecycle
handler below before removing that player from the room. It receives the same
`{ playerId, version }` context as an action. Return the updated state and any
events needed to let remaining players continue or show that the game ended.

```lua
function on_player_left(state, context)
  state.disconnected = context.playerId

  return {
    state = state,
    events = {
      {
        type = "player_left",
        player = context.playerId,
      },
    },
  }
end
```

When the room host selects **Return to room**, the platform asks the game
runtime whether the current session may be dissolved. Implement the optional
`on_return_to_room(state, context)` callback and return `true` to allow the
room to return to its lobby. Returning `false`, or omitting the callback,
keeps the game running. The callback receives `{ playerId, version }`; it does
not modify game state.

```lua
function on_return_to_room(state, context)
  return state.lastResult ~= nil
end
```

`setup` receives `{ players, randomSeed }`. `randomSeed` is a stable,
cryptographically generated positive 32-bit integer for the room. Store it in
game state and use a deterministic PRNG when the game needs random outcomes.
`on_action` receives `{ playerId, version }`. It must return `{ state, events
}`; both fields are returned to game clients in the next `state` message. All
values must be JSON-serializable. Lua has no network, file-system, random,
module-loading, or debug APIs.

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
