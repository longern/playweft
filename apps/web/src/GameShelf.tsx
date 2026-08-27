import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FeaturedGame } from "./featured-games";
import type { DiscoveredGame as RecentGame } from "./game-manifest";
import { localizeGameName, useI18n } from "./i18n";
import type { MenuPosition } from "./Menu";

export type ShelfGame = RecentGame | FeaturedGame;
export type GameShelfKind = "favorite" | "recent" | "recommended";
export type ShelfGamePhase = "entering" | "exiting";

interface GameShelfProps {
  title: string;
  kind: GameShelfKind;
  games: ShelfGame[];
  activeGameId?: string;
  getItemClassName?(game: ShelfGame): string;
  onItemAnimationEnd?(game: ShelfGame): void;
  onSelect(game: ShelfGame): void;
  onOpenMenu(
    game: ShelfGame,
    kind: GameShelfKind,
    position: MenuPosition,
  ): void;
  onReorder?(games: ShelfGame[]): void;
  onDismissMenu?(): void;
}

interface FavoriteDragState {
  game: ShelfGame;
  games: ShelfGame[];
  pointerId: number;
  x: number;
  y: number;
}

interface FavoritePress {
  game: ShelfGame;
  games: ShelfGame[];
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  phase: "pending" | "menu" | "moved" | "dragging";
  target: HTMLButtonElement;
  timer?: number;
}

const LONG_PRESS_DELAY_MS = 450;
const DRAG_START_DISTANCE_PX = 8;

export default function GameShelf({
  title,
  kind,
  games,
  activeGameId,
  getItemClassName,
  onItemAnimationEnd,
  onSelect,
  onOpenMenu,
  onReorder,
  onDismissMenu,
}: GameShelfProps) {
  const { locale } = useI18n();
  const [drag, setDrag] = useState<FavoriteDragState>();
  const shelf = useRef<HTMLElement>(null);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const press = useRef<FavoritePress | undefined>(undefined);
  const suppressClick = useRef<string | undefined>(undefined);
  const moveFavoritePressRef = useRef<((event: PointerEvent) => void) | undefined>(
    undefined,
  );
  const endFavoritePressRef = useRef<
    ((event: PointerEvent, cancelled?: boolean) => void) | undefined
  >(undefined);
  const flipFrame = useRef<number | undefined>(undefined);
  const slotAnimations = useRef(new Map<string, Animation>());
  const displayGames = drag?.games ?? games;

  const clearPress = () => {
    const current = press.current;
    if (current?.timer !== undefined) window.clearTimeout(current.timer);
    press.current = undefined;
  };

  const preventFollowingClick = (gameId: string) => {
    suppressClick.current = gameId;
    window.setTimeout(() => {
      if (suppressClick.current === gameId) suppressClick.current = undefined;
    }, 0);
  };

  const openMenu = (
    game: ShelfGame,
    target: HTMLButtonElement,
    position: MenuPosition,
  ) => {
    target.focus();
    onOpenMenu(game, kind, position);
  };

  const startFavoritePress = (
    game: ShelfGame,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      !onReorder ||
      games.length < 2 ||
      event.button !== 0
    ) {
      return;
    }
    const target = event.currentTarget;
    const nextPress: FavoritePress = {
      game,
      games,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      phase: "pending",
      target,
    };
    target.setPointerCapture(event.pointerId);
    if (usesLongPressMenu(event.pointerType)) {
      nextPress.timer = window.setTimeout(() => {
        if (press.current !== nextPress || nextPress.phase !== "pending") return;
        nextPress.phase = "menu";
        preventFollowingClick(game.manifestId);
        openMenu(game, target, {
          left: nextPress.startX,
          top: nextPress.startY,
        });
      }, LONG_PRESS_DELAY_MS);
    }
    press.current = nextPress;
  };

  const moveFavoritePress = (event: PointerEvent) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );
    const shouldStartDragging =
      distance >= DRAG_START_DISTANCE_PX &&
      ((current.phase === "pending" && !usesLongPressMenu(current.pointerType)) ||
        current.phase === "menu");
    if (shouldStartDragging) {
      const wasMenu = current.phase === "menu";
      if (current.timer !== undefined) window.clearTimeout(current.timer);
      current.phase = "dragging";
      event.preventDefault();
      if (wasMenu) onDismissMenu?.();
    } else if (
      current.phase === "pending" &&
      distance >= DRAG_START_DISTANCE_PX
    ) {
      if (current.timer !== undefined) window.clearTimeout(current.timer);
      current.phase = "moved";
      return;
    }
    if (current.phase !== "dragging") return;

    event.preventDefault();
    const targetId = favoriteAtPoint(event.clientX, event.clientY, shelf.current);
    const fromIndex = current.games.findIndex(
      (game) => game.manifestId === current.game.manifestId,
    );
    const targetIndex = current.games.findIndex(
      (game) => game.manifestId === targetId,
    );
    const reordered =
      fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex
        ? moveItem(current.games, fromIndex, targetIndex)
        : current.games;
    if (reordered !== current.games) {
      const before = readSlotRects(slotRefs.current);
      cancelSlotAnimations();
      current.games = reordered;
      scheduleSlotFlip(before, current.game.manifestId);
    }
    setDrag({
      game: current.game,
      games: reordered,
      pointerId: current.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const endFavoritePress = (event: PointerEvent, cancelled = false) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearPress();
    try {
      if (current.target.hasPointerCapture(event.pointerId))
        current.target.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may release capture before pointerup reaches the window.
    }
    if (current.phase === "dragging" && !cancelled) {
      onReorder?.(current.games);
      preventFollowingClick(current.game.manifestId);
    } else if (current.phase !== "pending") {
      preventFollowingClick(current.game.manifestId);
    }
    setDrag(undefined);
  };

  moveFavoritePressRef.current = moveFavoritePress;
  endFavoritePressRef.current = endFavoritePress;

  useEffect(() => {
    const move = (event: PointerEvent) =>
      moveFavoritePressRef.current?.(event);
    const end = (event: PointerEvent) => endFavoritePressRef.current?.(event);
    const cancel = (event: PointerEvent) =>
      endFavoritePressRef.current?.(event, true);
    // Use capture so a long-press menu backdrop cannot swallow the pointer
    // stream after the drag has started.
    window.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("pointerup", end, { capture: true });
    window.addEventListener("pointercancel", cancel, { capture: true });
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }, []);

  useEffect(
    () => () => {
      if (press.current?.timer !== undefined)
        window.clearTimeout(press.current.timer);
      window.cancelAnimationFrame(flipFrame.current ?? 0);
      cancelSlotAnimations();
    },
    [],
  );

  const cancelSlotAnimations = () => {
    for (const animation of slotAnimations.current.values()) animation.cancel();
    slotAnimations.current.clear();
  };

  const scheduleSlotFlip = (
    before: Map<string, DOMRect>,
    draggedGameId: string,
  ) => {
    window.cancelAnimationFrame(flipFrame.current ?? 0);
    flipFrame.current = window.requestAnimationFrame(() => {
      for (const [gameId, element] of slotRefs.current) {
        if (gameId === draggedGameId) continue;
        const previous = before.get(gameId);
        if (!previous) continue;
        const next = element.getBoundingClientRect();
        const dx = previous.left - next.left;
        const dy = previous.top - next.top;
        if (!dx && !dy) continue;
        const animation = element.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          {
            duration: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? 0
              : 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );
        slotAnimations.current.set(gameId, animation);
        const forget = () => {
          if (slotAnimations.current.get(gameId) === animation)
            slotAnimations.current.delete(gameId);
        };
        animation.onfinish = forget;
        animation.oncancel = forget;
      }
    });
  };

  return (
    <section
      ref={shelf}
      className="game-shelf"
      aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
    >
      <div className="shelf-heading">
        <h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
          {title}
        </h2>
      </div>
      <div className="shelf-row">
        {displayGames.map((game) => (
          <div
            className={`shelf-game-slot ${activeGameId === game.manifestId ? "shelf-game-menu-target" : ""} ${drag?.game.manifestId === game.manifestId ? "shelf-game-dragging" : ""} ${getItemClassName?.(game) ?? ""}`}
            key={game.manifestId}
            ref={(element) => {
              if (element) slotRefs.current.set(game.manifestId, element);
              else slotRefs.current.delete(game.manifestId);
            }}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                onItemAnimationEnd?.(game);
              }
            }}
          >
            <button
              className="shelf-game"
              data-favorite-game-id={onReorder ? game.manifestId : undefined}
              onClick={(event) => {
                if (suppressClick.current === game.manifestId) {
                  event.preventDefault();
                  suppressClick.current = undefined;
                  return;
                }
                onSelect(game);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const current = press.current;
                if (current?.game.manifestId === game.manifestId) {
                  if (current.timer !== undefined)
                    window.clearTimeout(current.timer);
                  current.phase = "menu";
                  preventFollowingClick(game.manifestId);
                }
                openMenu(game, event.currentTarget, {
                  left: event.clientX,
                  top: event.clientY,
                });
              }}
              onPointerDown={(event) => startFavoritePress(game, event)}
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
          </div>
        ))}
      </div>
      {drag && (
        <div
          className="favorite-drag-overlay"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <span className="shelf-art">
            {drag.game.icon ? (
              <img src={drag.game.icon} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>
                {localizeGameName(drag.game, locale).slice(0, 2).toUpperCase()}
              </span>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

function favoriteAtPoint(
  x: number,
  y: number,
  shelf: HTMLElement | null,
): string | undefined {
  const buttons = shelf?.querySelectorAll<HTMLButtonElement>(
    "[data-favorite-game-id]",
  );
  if (!buttons) return undefined;
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return button.dataset.favoriteGameId;
    }
  }
  return undefined;
}

function readSlotRects(
  slots: Map<string, HTMLDivElement>,
): Map<string, DOMRect> {
  return new Map(
    [...slots].map(([gameId, element]) => [gameId, element.getBoundingClientRect()]),
  );
}

function usesLongPressMenu(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return items;
  next.splice(toIndex, 0, item);
  return next;
}
