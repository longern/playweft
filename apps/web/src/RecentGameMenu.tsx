import { useCallback, useEffect, useRef, useState } from "react";
import type { RecentGame } from "./RoomHost";

interface RecentGameMenuProps {
  game: RecentGame;
  x: number;
  y: number;
  onClose(): void;
  onTogglePinned(): void;
  onDelete(): void;
}

export default function RecentGameMenu({ game, x, y, onClose, onTogglePinned, onDelete }: RecentGameMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close]);

  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    const timeout = window.setTimeout(onClose, 170);
    return () => window.clearTimeout(timeout);
  }, [closing, onClose]);

  const act = (action: () => void) => {
    action();
    close();
  };

  return <>
    <div className={`recent-game-menu-backdrop ${closing ? "recent-game-menu-backdrop-closing" : ""}`} aria-hidden="true" />
    <div
      ref={menu}
      className={`recent-game-menu ${closing ? "recent-game-menu-closing" : ""}`}
      role="menu"
      aria-label={`${game.name} actions`}
      style={{ left: x, top: y }}
    >
      <button type="button" role="menuitem" onClick={() => act(onTogglePinned)}>{game.pinned ? "Unpin" : "Pin to top"}</button>
      <button className="recent-game-menu-delete" type="button" role="menuitem" onClick={() => act(onDelete)}>Delete</button>
    </div>
  </>;
}
