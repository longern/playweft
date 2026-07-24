import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Dialog from "./Dialog";
import { useI18n } from "./i18n";

interface InviteDialogProps {
  url: string;
  onClose(): void;
}

export default function InviteDialog({ url, onClose }: InviteDialogProps) {
  const { t } = useI18n();
  const [qrCode, setQrCode] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 256,
      margin: 1,
      color: { dark: "#202124", light: "#ffffff" },
    }).then((value) => {
      if (!cancelled) setQrCode(value);
    });
    return () => { cancelled = true; };
  }, [url]);

  return <Dialog title={t("invitePlayers")} onDismiss={onClose}>
    <div className="invite-dialog-content">
      {qrCode ? <img src={qrCode} alt={t("qrCodeForRoomLink")} /> : <span className="invite-dialog-loading" aria-label={t("generatingQrCode")} />}
    </div>
  </Dialog>;
}
