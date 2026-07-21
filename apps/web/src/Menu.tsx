import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface MenuProps {
  ariaLabel: string;
  children: ReactNode;
  anchor: HTMLElement;
  className?: string;
  style?: CSSProperties;
  onClose(): void;
}

export default function Menu({ ariaLabel, children, anchor, className = "", style, onClose }: MenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const close = () => setClosing(true);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const anchorRect = anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const left = Math.max(
      12,
      Math.min(anchorRect.right - width, window.innerWidth - width - 12),
    );
    setPosition({
      top: anchorRect.bottom + 8,
      left,
      transformOrigin: `${Math.max(12, Math.min(anchorRect.left + anchorRect.width / 2 - left, width - 12))}px top`,
    });
  }, [anchor]);

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
        aria-label={`Close ${ariaLabel}`}
        onClick={close}
      />
      <div
        ref={menu}
        className={`menu ${className} ${closing ? "menu-closing" : ""}`}
        role="menu"
        aria-label={ariaLabel}
        style={{ ...position, ...style }}
      >
        {children}
      </div>
    </>
  );
}
