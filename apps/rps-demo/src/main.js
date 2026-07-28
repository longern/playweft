import "./styles.css";

const status = document.querySelector("#status");
const waiting = document.querySelector("#waiting");
const result = document.querySelector("#result");
const buttons = [...document.querySelectorAll("[data-choice]")];
let port;
let state;
let hasChosen = false;
let actionPending = false;
let playerId;
let matchId;
let latestVersion = -1;
const pendingRpc = new Map();
const playweft = {
  game: {
    initialize() {
      return rpcCall("game.initialize");
    },
  },
  room: {
    action(action) {
      return rpcCall("room.action", { action });
    },
  },
  clipboard: {
    readText() {
      return rpcCall("clipboard.readText");
    },
  },
};
const announceBridgeReady = () =>
  window.parent.postMessage({ type: "playweft:bridge-ready", version: 1 }, "*");
const bridgeProbe = window.setInterval(announceBridgeReady, 500);

buttons.forEach((button) =>
  button.addEventListener("click", () => choose(button.dataset.choice)),
);

window.addEventListener("message", (event) => {
  if (
    event.source !== window.parent ||
    event.data?.type !== "playweft:bridge" ||
    event.data?.version !== 1
  )
    return;
  const [receivedPort] = event.ports;
  if (!receivedPort) return;
  port = receivedPort;
  window.clearInterval(bridgeProbe);
  port.onmessage = onRpcMessage;
  port.start();
  void playweft.game
    .initialize()
    .then((context) => {
      playerId = context.playerId;
      status.textContent = "Waiting for the host to start the game…";
    })
    .catch((error) => showError(rpcErrorMessage(error)));
  status.textContent = "Waiting for the host to start the game…";
});

announceBridgeReady();

function choose(choice) {
  if (!port) return showError("The platform is not connected yet");
  if (!state || hasChosen || actionPending) return;
  actionPending = true;
  hasChosen = true;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  void playweft.room
    .action({ type: "choose", choice })
    .then((result) => {
      actionPending = false;
      if (!result.accepted) {
        hasChosen = false;
        buttons.forEach((button) => {
          button.disabled = false;
        });
        showError(result.error.message);
      }
    })
    .catch((error) => {
      actionPending = false;
      hasChosen = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      showError(rpcErrorMessage(error));
    });
}

function onRpcMessage(event) {
  const payload = event.data;
  if (payload?.jsonrpc !== "2.0") return;
  if (Object.hasOwn(payload, "id")) {
    const pending = pendingRpc.get(payload.id);
    if (!pending) return;
    pendingRpc.delete(payload.id);
    if (payload.error) pending.reject(new PlayweftRpcError(payload.error));
    else pending.resolve(payload.result);
    return;
  }
  if (payload.method === "platform.error") {
    return showError(payload.params?.error?.message ?? "Platform error");
  }
  if (payload.method !== "game.state") return;
  const update = payload.params;
  if (update.matchId !== matchId) {
    matchId = update.matchId;
    latestVersion = -1;
  }
  if (typeof update.version === "number" && update.version <= latestVersion)
    return;
  if (typeof update.version === "number") latestVersion = update.version;
  state = update.state;
  status.textContent = "Game started";
  hasChosen = state.choices?.[playerId] === true;
  buttons.forEach((button) => {
    button.disabled = hasChosen;
  });
  waiting.textContent = hasChosen
    ? "Move locked in. Waiting for the other player…"
    : "Choose rock, paper, or scissors.";
  if (!state.lastResult) return;

  const round = state.lastResult;
  result.hidden = false;
  if (round.draw) {
    result.textContent = `Round ${round.round}: both players chose ${name(round.choices[0])}. Draw — play again.`;
  } else {
    const winnerIndex = Array.isArray(round.players)
      ? round.players.indexOf(round.winner) + 1
      : 0;
    result.textContent = `Round ${round.round}: player one chose ${name(round.choices[0])}; player two chose ${name(round.choices[1])}. Player ${winnerIndex || "?"} wins.`;
  }
}

function rpcCall(method, params) {
  if (!port) return Promise.reject(new Error("The platform is not connected"));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
    port.postMessage({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
  });
}

class PlayweftRpcError extends Error {
  constructor(error) {
    super(error.message);
    this.name = "PlayweftRpcError";
    this.rpcCode = error.code;
    this.code = error.data?.code;
    this.retryable = error.data?.retryable === true;
  }
}

function rpcErrorMessage(error) {
  return error instanceof Error ? error.message : "Unexpected platform error";
}

function name(choice) {
  return (
    { rock: "rock", paper: "paper", scissors: "scissors" }[choice] || choice
  );
}

function showError(message) {
  status.textContent = `Error: ${message}`;
}
