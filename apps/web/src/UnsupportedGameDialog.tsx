import Dialog from "./Dialog";
import { useI18n } from "./i18n";

interface UnsupportedGameDialogProps {
  error: string;
  url: string;
  onClose(): void;
}

export default function UnsupportedGameDialog({
  error,
  url,
  onClose,
}: UnsupportedGameDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t("gameNotSupported")}
      onDismiss={onClose}
      actions={[
        { label: t("back") },
        {
          label: t("openSite"),
          variant: "primary",
          onSelect: () => {
            window.location.href = url;
          },
        },
      ]}
    >
      <div className="unsupported-game">
        <p>{error}</p>
        <span>{url}</span>
      </div>
    </Dialog>
  );
}
