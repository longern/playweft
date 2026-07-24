import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  build: {
    outDir: "../web/dist/games/rps",
    emptyOutDir: true,
  },
}));
