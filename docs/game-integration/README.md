# Integrate a Static Game with Playweft

Playweft loads your static game page in a cross-site iframe. Your page renders
the game and sends game intents; Playweft owns the room, anonymous players,
invite links, WebSocket, Lua execution, and permissions.

You do not need to install an npm package. Do not call the Playweft API
directly.

## 1. Publish the game page

- Publish the game as an HTTPS static site, such as a Cloudflare Pages project.
- Use a site different from the Playweft platform. Do not deploy it to the
  platform domain or a subdomain of that domain.
- A user pastes this page's URL into the platform home page to create a room.

The page must work inside an iframe. It must not depend on third-party cookies,
a Playweft account, or its own WebSocket service.

## 2. Establish the bridge

When the game loads, repeatedly announce that it is ready to its parent
window. The platform replies with a `MessagePort`. All subsequent communication
uses that port rather than global `window` messages.

```js
let gamePort;

const announceReady = () => {
  window.parent.postMessage({ type: "playweft:bridge-ready", version: 1 }, "*");
};

const probe = window.setInterval(announceReady, 500);
announceReady();

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type !== "playweft:bridge" || event.data?.version !== 1) return;
  const [port] = event.ports;
  if (!port) return;

  gamePort = port;
  window.clearInterval(probe);
  gamePort.onmessage = onPlatformMessage;
  gamePort.start();

  // Optional: used only in the platform's local recent-games list.
  gamePort.postMessage({
    type: "descriptor",
    descriptor: { name: "My Game", icon: "/icon.svg" },
  });

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

`descriptor` is optional. `name` must contain 1–100 characters. `icon` must be
a relative URL or an absolute URL hosted on the game's own origin.

`initialize` is required. `minPlayers` and `maxPlayers` must be integers from
1 to 32, with `minPlayers <= maxPlayers`. The room atomically fixes the Lua
source, runtime, and player limits. Repeating the exact same configuration is
safe; submitting a different configuration fails.

## 3. Receive state and submit actions

The platform does not send game state while the room is in its lobby. Show a
“waiting for the host to start” message and disable game controls. Once the
host starts the game, the platform sends Lua state through the port:

```js
function onPlatformMessage(event) {
  const message = event.data;
  if (message?.type === "state") {
    render(message.state);
    enableGameControls();
    return;
  }
  if (message?.type === "error") {
    showError(message.error);
  }
}

function chooseCard(card) {
  gamePort?.postMessage({
    type: "action",
    action: { type: "choose", card },
  });
}
```

An action must be JSON-serializable and no larger than 8 KiB. The platform
derives player identity from the top-level page's HttpOnly session and maps it
to an opaque ID within the room. The game page never receives a real identity,
cookie, access token, or WebSocket URL.

## 4. Write the Lua game

Initialization only compiles Lua. `setup(context)` runs only after the host
starts the game and the player roster is locked:

```lua
function setup(context)
  -- A locked roster of opaque, room-scoped player IDs.
  return { players = context.players, moves = {} }
end

function on_action(state, action, context)
  if action.type ~= "choose" then
    return { state = state, events = { { type = "invalid_action" } } }
  end

  state.moves[context.playerId] = action.card
  return {
    state = state,
    events = { { type = "chosen", player = context.playerId } },
  }
end
```

`setup` receives `{ players }`. `on_action` receives a context of
`{ playerId, version }`. It must return `{ state, events }`; all returned
values must be JSON-serializable. Lua has no network, file-system, random,
module-loading, or debug APIs.

## Constraints and security boundary

- Do not create `fetch`, WebSocket, or EventSource connections to Playweft.
  The platform does not enable CORS for the game page.
- Do not implement authentication, host privileges, kicking, player limits, or
  starting the game inside the game page. The platform lobby owns these rules.
- Do not persist a player ID as a long-lived identity. It is valid only within
  the current room and Lua game.
- The platform may load the game invisibly in the lobby to collect metadata and
  Lua configuration. Do not allow actual play until the first `state` message.

For a complete working reference, see [`apps/rps-demo`](../../apps/rps-demo).
