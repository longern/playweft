import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const defaultFeaturedGamesPath = fileURLToPath(
  new URL("./featured-games.local.json", import.meta.url),
);

function embeddedFeaturedGameSources(): unknown[] | null {
  const configuredPath = process.env.PLAYWEFT_FEATURED_GAMES_FILE;
  const filePath = configuredPath
    ? resolve(process.env.INIT_CWD ?? process.cwd(), configuredPath)
    : defaultFeaturedGamesPath;
  if (!existsSync(filePath)) {
    if (configuredPath) {
      throw new Error(`Featured-games file does not exist: ${filePath}`);
    }
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse featured-games file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => {
      if (typeof item === "string") return item.trim().length === 0;
      return item === null || typeof item !== "object" || Array.isArray(item);
    })
  ) {
    throw new Error(
      `Featured-games file ${filePath} must contain an array of game objects or list URLs`,
    );
  }
  return value;
}

export default defineConfig({
  plugins: [react()],
  define: {
    __PLAYWEFT_FEATURED_GAME_SOURCES__: JSON.stringify(
      embeddedFeaturedGameSources(),
    ),
  },
  server: {
    port: 9133,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        ws: true,
      },
    },
  },
});
