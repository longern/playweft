import { Info, Star, StarOff, Trash2 } from "lucide-react";
import type { FeaturedGame } from "./featured-games";
import Menu, { type MenuPosition } from "./Menu";
import type { DiscoveredGame as RecentGame } from "./game-manifest";
import { localizeGameName, useI18n } from "./i18n";

type MenuGame = RecentGame | FeaturedGame;

interface GameMenuProps {
  game: MenuGame;
  anchor?: HTMLElement;
  position?: MenuPosition;
  isFavorite: boolean;
  canDelete: boolean;
  onClose(): void;
  onShowInfo(): void;
  onToggleFavorite(): void;
  onDelete(): void;
}

export default function GameMenu({
  game,
  anchor,
  position,
  isFavorite,
  canDelete,
  onClose,
  onShowInfo,
  onToggleFavorite,
  onDelete,
}: GameMenuProps) {
  const { locale, t } = useI18n();
  const act = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Menu
      ariaLabel={t("gameActions", {
        name: localizeGameName(game, locale),
      })}
      anchor={anchor}
      position={position}
      backdropClassName="game-card-menu-backdrop"
      className="game-card-menu"
      onClose={onClose}
    >
      <button type="button" role="menuitem" onClick={() => act(onShowInfo)}>
        <Info aria-hidden="true" />
        <span>{t("gameInfo")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => act(onToggleFavorite)}
      >
        {isFavorite ? (
          <StarOff aria-hidden="true" />
        ) : (
          <Star aria-hidden="true" />
        )}
        <span>{isFavorite ? t("unfavorite") : t("favorite")}</span>
      </button>
      {canDelete && (
        <button
          className="menu-danger"
          type="button"
          role="menuitem"
          onClick={() => act(onDelete)}
        >
          <Trash2 aria-hidden="true" />
          <span>{t("delete")}</span>
        </button>
      )}
    </Menu>
  );
}
