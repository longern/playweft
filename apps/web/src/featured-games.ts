import type { GameMode } from "./RoomHost";
import type { GameTranslations } from "./i18n";

/**
 * Curated games shown on the home page. Add static entries here as games are
 * approved for discovery; this is intentionally not room or user data.
 */
export interface FeaturedGame {
  name: string;
  translations?: GameTranslations;
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
    translations: { "zh-CN": { name: "石头剪刀布" } },
    url: "https://playweft-rps-demo.pages.dev/",
    icon: "https://playweft-rps-demo.pages.dev/rps.svg",
    description: "A quick two-player round.",
    category: "Quick match",
    modes: ["room"],
  },
];
