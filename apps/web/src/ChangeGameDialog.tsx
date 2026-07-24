import { useState } from "react";
import Dialog from "./Dialog";
import { FEATURED_GAMES } from "./featured-games";
import type { RecentGame } from "./RoomHost";
import { localizeGameName, useI18n } from "./i18n";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";

interface ChangeGameDialogProps {
  onClose(): void;
  onSubmit(url: string): void;
}

export default function ChangeGameDialog({
  onClose,
  onSubmit,
}: ChangeGameDialogProps) {
  const { locale, t } = useI18n();
  const [url, setUrl] = useState("");
  const recentGames = readRecentGames();

  return (
    <Dialog
      title={t("changeGame")}
      size="wide"
      onDismiss={onClose}
      actions={[
        { label: t("cancel") },
        {
          label: t("changeGame"),
          variant: "primary",
          onSelect: () => onSubmit(url),
        },
      ]}
    >
      <form
        className="change-game-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(url);
        }}
      >
        <label htmlFor="change-game-url">{t("gameUrl")}</label>
        <div className="change-game-url-input">
          <input
            id="change-game-url"
            type="url"
            required
            autoFocus
            placeholder={t("pasteStaticGameUrl")}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
      </form>
      {recentGames.length > 0 && (
        <GameChoices
          title={t("recentlyPlayed")}
          games={recentGames}
          selectedUrl={url}
          onSelect={setUrl}
        />
      )}
      <GameChoices
        title={t("recommended")}
        games={FEATURED_GAMES}
        selectedUrl={url}
        onSelect={setUrl}
      />
    </Dialog>
  );
}

function GameChoices({
  title,
  games,
  selectedUrl,
  onSelect,
}: {
  title: string;
  games: Array<RecentGame | (typeof FEATURED_GAMES)[number]>;
  selectedUrl: string;
  onSelect(url: string): void;
}) {
  const { locale } = useI18n();
  return (
    <section
      className="change-game-choices"
      aria-labelledby={`change-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <h3 id={`change-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h3>
      <div className="change-game-list">
        {games.map((game) => (
          <button
            key={game.url}
            className={`shelf-game ${game.url === selectedUrl ? "change-game-choice-selected" : ""}`}
            type="button"
            aria-pressed={game.url === selectedUrl}
            onClick={() => onSelect(game.url)}
          >
            <span className="shelf-art">
              {game.icon ? (
                <img src={game.icon} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>
                  {localizeGameName(game, locale).slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <span className="shelf-game-name">
              {localizeGameName(game, locale)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function readRecentGames(): RecentGame[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(RECENT_GAMES_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isRecentGame).slice(0, 8);
  } catch {
    return [];
  }
}

function isRecentGame(value: unknown): value is RecentGame {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as RecentGame).url === "string" &&
    typeof (value as RecentGame).name === "string"
  );
}
