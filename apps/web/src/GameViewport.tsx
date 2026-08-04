import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "./i18n";

export default function GameViewport({
  children,
  infoExpanded,
  onOpenInfo,
  showOptions = true,
}: {
  children: ReactNode;
  infoExpanded: boolean;
  onOpenInfo(): void;
  showOptions?: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {children}
      {showOptions && (
        <button
          className="game-options"
          type="button"
          aria-label={t("gameInformation")}
          aria-expanded={infoExpanded}
          onClick={onOpenInfo}
        >
          <MoreHorizontal aria-hidden="true" size={24} />
        </button>
      )}
    </>
  );
}
