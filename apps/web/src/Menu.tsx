import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "./i18n";

export interface MenuPosition {
  left: number;
  top: number;
}

interface MenuProps {
  ariaLabel: string;
  children: ReactNode;
  anchor?: HTMLElement;
  className?: string;
  position?: MenuPosition;
  style?: CSSProperties;
  onClose(): void;
}

const MENU_GUTTER = 12;

export default function Menu({ ariaLabel, children, anchor, className = "", position, style, onClose }: MenuProps) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [computedPosition, setComputedPosition] = useState<CSSProperties>();
  const close = () => setClosing(true);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const maxLeft = window.innerWidth - width - MENU_GUTTER;
    const maxTop = window.innerHeight - height - MENU_GUTTER;

    if (position) {
      const left = clamp(position.left, MENU_GUTTER, maxLeft);
      const top = clamp(position.top, MENU_GUTTER, maxTop);
      setComputedPosition({
        left,
        top,
        transformOrigin: `${clamp(position.left - left, MENU_GUTTER, width - MENU_GUTTER)}px ${clamp(position.top - top, MENU_GUTTER, height - MENU_GUTTER)}px`,
      });
      return;
    }

    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const preferredTop = anchorRect.bottom + 8;
    const flippedTop = anchorRect.top - height - 8;
    const opensAbove = preferredTop > maxTop && flippedTop >= MENU_GUTTER;
    const left = clamp(anchorRect.right - width, MENU_GUTTER, maxLeft);
    const top = clamp(opensAbove ? flippedTop : preferredTop, MENU_GUTTER, maxTop);
    setComputedPosition({
      top,
      left,
      transformOrigin: `${clamp(anchorRect.left + anchorRect.width / 2 - left, MENU_GUTTER, width - MENU_GUTTER)}px ${opensAbove ? "bottom" : "top"}`,
    });
  }, [anchor, position]);

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
  }, []);

  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    const timeout = window.setTimeout(onClose, 170);
    return () => window.clearTimeout(timeout);
  }, [closing, onClose]);

  return (
    <>
      <button
        className={`menu-backdrop ${closing ? "menu-backdrop-closing" : ""}`}
        type="button"
        aria-label={t("closeMenu", { label: ariaLabel })}
        onClick={close}
      />
      <div
        ref={menu}
        className={`menu ${className} ${closing ? "menu-closing" : ""}`}
        role="menu"
        aria-label={ariaLabel}
        style={{ ...computedPosition, ...style }}
      >
        {children}
      </div>
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
