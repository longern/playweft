import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Menu, { type MenuClose, type MenuHandle } from "./Menu";

const HOVER_CLOSE_DELAY = 150;

export interface AnchoredMenuTriggerProps {
  anchorRef: RefObject<HTMLButtonElement | null>;
  expanded: boolean;
  onClick(): void;
  onMouseEnter(): void;
  onMouseLeave(): void;
}

interface AnchoredMenuProps {
  ariaLabel: string;
  children: ReactNode | ((close: MenuClose) => ReactNode);
  className?: string;
  backdropClassName?: string;
  disabled?: boolean;
  openOnHover?: boolean;
  trigger(props: AnchoredMenuTriggerProps): ReactNode;
}

export default function AnchoredMenu({
  ariaLabel,
  children,
  className,
  backdropClassName,
  disabled = false,
  openOnHover = false,
  trigger,
}: AnchoredMenuProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<MenuHandle>(null);
  const hoverCloseTimer = useRef<number | undefined>(undefined);
  const suppressHoverOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [autoFocus, setAutoFocus] = useState(true);

  const cancelHoverClose = () => {
    window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = undefined;
  };

  const scheduleHoverClose = () => {
    if (!openOnHover || !window.matchMedia("(hover: hover)").matches) return;
    cancelHoverClose();
    hoverCloseTimer.current = window.setTimeout(() => {
      if (menu.current) {
        menu.current.close();
      } else {
        setOpen(false);
      }
    }, HOVER_CLOSE_DELAY);
  };

  const prepareAnchorClickClose = () => {
    suppressHoverOpen.current = true;
    cancelHoverClose();
  };

  const openFromHover = () => {
    if (
      disabled ||
      !openOnHover ||
      !window.matchMedia("(hover: hover)").matches ||
      suppressHoverOpen.current
    ) {
      return;
    }
    cancelHoverClose();
    setAutoFocus(false);
    setOpen(true);
  };

  const leaveAnchor = () => {
    suppressHoverOpen.current = false;
    scheduleHoverClose();
  };

  const toggleFromAnchor = () => {
    if (disabled) return;
    setAutoFocus(true);
    if (open) {
      prepareAnchorClickClose();
      menu.current?.close();
      return;
    }
    cancelHoverClose();
    setOpen(true);
  };

  useEffect(() => () => window.clearTimeout(hoverCloseTimer.current), []);

  useEffect(() => {
    if (disabled && open) menu.current?.close();
  }, [disabled, open]);

  return (
    <>
      {trigger({
        anchorRef: anchor,
        expanded: open,
        onClick: toggleFromAnchor,
        onMouseEnter: openFromHover,
        onMouseLeave: leaveAnchor,
      })}
      {open && (
        <Menu
          ref={menu}
          ariaLabel={ariaLabel}
          anchor={anchor.current ?? undefined}
          anchorHoverGuard={openOnHover}
          autoFocus={autoFocus}
          backdropClassName={backdropClassName}
          className={className}
          onAnchorGuardClick={prepareAnchorClickClose}
          onMouseEnter={cancelHoverClose}
          onMouseLeave={scheduleHoverClose}
          onClose={() => setOpen(false)}
        >
          {children}
        </Menu>
      )}
    </>
  );
}
