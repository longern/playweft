import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [
    {
      name: "emit-game-server-entry",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "game.lua",
          source: readFileSync(new URL("./game.lua", import.meta.url), "utf8"),
        });
      },
    },
  ],
  build: {
    outDir: "../web/dist/games/rps",
    emptyOutDir: true,
  },
}));
