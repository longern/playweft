import type { FeaturedGame } from "./featured-games";
import Menu, { type MenuPosition } from "./Menu";
import type { RecentGame } from "./RoomHost";

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
  const act = (action: () => void) => {
    action();
    onClose();
  };

  return <Menu ariaLabel={`${game.name} actions`} anchor={anchor} position={position} className="game-card-menu" onClose={onClose}>
    <button type="button" role="menuitem" onClick={() => act(onShowInfo)}>Game info</button>
    <button type="button" role="menuitem" onClick={() => act(onToggleFavorite)}>{isFavorite ? "Unfavorite" : "Favorite"}</button>
    {canDelete && <button className="menu-danger" type="button" role="menuitem" onClick={() => act(onDelete)}>Delete</button>}
  </Menu>;
}
