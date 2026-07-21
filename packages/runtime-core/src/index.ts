import type { JsonValue } from "@playweft/game-protocol";

export class GameRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuntimeError";
  }
}

export interface GameActionResult {
  state: JsonValue;
  events: JsonValue[];
}

export interface GameRuntime {
  setup(context: JsonValue): JsonValue;
  applyAction(state: JsonValue, action: JsonValue, context: JsonValue): GameActionResult;
  playerLeft(state: JsonValue, context: JsonValue): GameActionResult;
  returnToRoom(state: JsonValue, context: JsonValue): boolean;
  dispose(): void;
}

export interface GameRuntimeAdapter {
  readonly kind: string;
  create(source: string): Promise<GameRuntime>;
}
