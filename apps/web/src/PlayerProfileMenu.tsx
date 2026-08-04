import { CircleUserRound, LogIn, Pencil } from "lucide-react";
import { useState } from "react";
import AnchoredMenu from "./AnchoredMenu";
import Dialog from "./Dialog";
import { useI18n } from "./i18n";
import {
  MAX_PLAYER_NICKNAME_LENGTH,
  normalizePlayerNickname,
} from "./player-profile";

export default function PlayerProfileMenu({
  nickname,
  onNicknameChange,
}: {
  nickname: string;
  onNicknameChange(value: string): void;
}) {
  const { t } = useI18n();
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
  const [draftNickname, setDraftNickname] = useState(nickname);

  const editNickname = () => {
    setDraftNickname(nickname);
    setNicknameDialogOpen(true);
  };

  return (
    <div className="player-profile">
      <AnchoredMenu
        ariaLabel={t("accountMenu")}
        backdropClassName="profile-menu-backdrop"
        className="profile-menu"
        disabled={nicknameDialogOpen}
        openOnHover
        trigger={({
          anchorRef,
          expanded,
          onClick,
          onMouseEnter,
          onMouseLeave,
        }) => (
          <button
            ref={anchorRef}
            className="player-profile-button"
            type="button"
            aria-label={t("accountMenu")}
            aria-haspopup="menu"
            aria-expanded={expanded}
            title={nickname || t("accountMenu")}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            <CircleUserRound aria-hidden="true" />
          </button>
        )}
      >
        {(closeMenu) => (
          <>
            <div
              className={`profile-menu-nickname${nickname ? "" : " profile-menu-nickname-empty"}`}
              title={nickname || t("nicknameNotSet")}
            >
              {nickname || t("nicknameNotSet")}
            </div>
            <div className="profile-menu-divider" role="separator" />
            <button type="button" role="menuitem" disabled>
              <LogIn aria-hidden="true" />
              <span>{t("loginUnavailable")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => closeMenu(editNickname)}
            >
              <Pencil aria-hidden="true" />
              <span>{t("editNickname")}</span>
            </button>
          </>
        )}
      </AnchoredMenu>
      {nicknameDialogOpen && (
        <Dialog
          title={t("editNickname")}
          onDismiss={() => setNicknameDialogOpen(false)}
          actions={[
            { label: t("cancel") },
            {
              label: t("save"),
              variant: "primary",
              onSelect: () =>
                onNicknameChange(normalizePlayerNickname(draftNickname)),
            },
          ]}
        >
          <label className="nickname-field">
            <span>{t("nickname")}</span>
            <input
              autoFocus
              type="text"
              maxLength={MAX_PLAYER_NICKNAME_LENGTH}
              placeholder={t("nicknamePlaceholder")}
              value={draftNickname}
              onChange={(event) => setDraftNickname(event.target.value)}
            />
            <small>{t("nicknameStoredLocally")}</small>
          </label>
        </Dialog>
      )}
    </div>
  );
}
