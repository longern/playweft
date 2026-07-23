import "./styles.css";
import gameScript from "../game.lua?raw";

const status = document.querySelector("#status");
const waiting = document.querySelector("#waiting");
const result = document.querySelector("#result");
const buttons = [...document.querySelectorAll("[data-choice]")];
let port;
let state;
let hasChosen = false;
let pendingActionId;
let playerId;
let latestVersion = -1;
const announceBridgeReady = () => window.parent.postMessage({ type: "playweft:bridge-ready", version: 1 }, "*");
const bridgeProbe = window.setInterval(announceBridgeReady, 500);

buttons.forEach((button) => button.addEventListener("click", () => choose(button.dataset.choice)));

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.type !== "playweft:bridge" || event.data?.version !== 1) return;
  const [receivedPort] = event.ports;
  if (!receivedPort) return;
  port = receivedPort;
  window.clearInterval(bridgeProbe);
  port.onmessage = onPlatformMessage;
  port.start();
  port.postMessage({
    type: "descriptor",
    descriptor: {
      name: "Rock Paper Scissors",
      icon: "/rps.svg",
      modes: ["room"],
      liveRoom: false,
    },
  });
  port.postMessage({
    type: "initialize",
    initialization: {
      runtime: "lua",
      script: gameScript,
      minPlayers: 2,
      maxPlayers: 2,
      liveRoom: false,
    },
  });
  status.textContent = "Waiting for the host to start the game…";
});

announceBridgeReady();

function choose(choice) {
  if (!port) return showError("The platform is not connected yet");
  if (!state || hasChosen || pendingActionId) return;
  pendingActionId = crypto.randomUUID();
  hasChosen = true;
  buttons.forEach((button) => { button.disabled = true; });
  port.postMessage({
    type: "action",
    requestId: pendingActionId,
    action: { type: "choose", choice },
  });
}

function onPlatformMessage(event) {
  const payload = event.data;
  if (payload.type === "ready") {
    playerId = payload.playerId;
    status.textContent = "Waiting for the host to start the game…";
    return;
  }
  if (payload.type === "action-result") {
    if (payload.requestId === pendingActionId) pendingActionId = undefined;
    return;
  }
  if (payload.type === "error") {
    if (payload.requestId === pendingActionId) {
      pendingActionId = undefined;
      hasChosen = false;
      buttons.forEach((button) => { button.disabled = false; });
    }
    return showError(payload.error);
  }
  if (payload.type !== "state") return;
  if (typeof payload.version === "number" && payload.version <= latestVersion) return;
  if (typeof payload.version === "number") latestVersion = payload.version;
  state = payload.state;
  status.textContent = "Game started";
  if (state.choices && Object.keys(state.choices).length === 0) hasChosen = false;
  buttons.forEach((button) => { button.disabled = hasChosen; });
  waiting.textContent = hasChosen ? "Move locked in. Waiting for the other player…" : "Choose rock, paper, or scissors.";
  if (!state.lastResult) return;

  const round = state.lastResult;
  result.hidden = false;
  if (round.draw) {
    result.textContent = `Round ${round.round}: both players chose ${name(round.choices[0])}. Draw — play again.`;
  } else {
    const winnerIndex = Array.isArray(round.players) ? round.players.indexOf(round.winner) + 1 : 0;
    result.textContent = `Round ${round.round}: player one chose ${name(round.choices[0])}; player two chose ${name(round.choices[1])}. Player ${winnerIndex || "?"} wins.`;
  }
}

function name(choice) {
  return { rock: "rock", paper: "paper", scissors: "scissors" }[choice] || choice;
}

function showError(message) {
  status.textContent = `Error: ${message}`;
}
