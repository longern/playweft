import type { ActionError, JsonValue } from "@playweft/game-protocol";

export class GameRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuntimeError";
  }
}

export interface GameTransitionResult {
  state: JsonValue;
  events: JsonValue[];
}

export type GameActionResult =
  | ({ accepted: true } & GameTransitionResult)
  | { accepted: false; error: ActionError };

export interface GameRuntime {
  setup(context: JsonValue): JsonValue;
  applyAction(state: JsonValue, action: JsonValue, context: JsonValue): GameActionResult;
  view(state: JsonValue, events: JsonValue[], context: JsonValue): GameTransitionResult;
  playerLeft(state: JsonValue, context: JsonValue): GameTransitionResult;
  returnToRoom(state: JsonValue, context: JsonValue): boolean;
  dispose(): void;
}

export interface GameRuntimeAdapter {
  readonly kind: string;
  create(source: string): Promise<GameRuntime>;
}
