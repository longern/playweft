import type { GameMode } from "./RoomHost";

/**
 * Curated games shown on the home page. Add static entries here as games are
 * approved for discovery; this is intentionally not room or user data.
 */
export interface FeaturedGame {
  name: string;
  url: string;
  icon?: string;
  description: string;
  category: string;
  modes?: GameMode[];
  liveRoom?: boolean;
}

export const FEATURED_GAMES: FeaturedGame[] = [
  {
    name: "Rock Paper Scissors",
    url: "https://playweft-rps-demo.pages.dev/",
    icon: "https://playweft-rps-demo.pages.dev/rps.svg",
    description: "A quick two-player round.",
    category: "Quick match",
    modes: ["room"],
  },
];
