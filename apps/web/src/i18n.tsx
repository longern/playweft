import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];
export type InterpolationValues = Record<string, string | number>;
export interface GameTranslation {
  name?: string;
}

export type GameTranslations = Record<string, GameTranslation>;

export function isGameTranslations(value: unknown): value is GameTranslations {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  return Object.entries(value).every(([locale, translation]) => {
    if (
      locale.length === 0 ||
      locale.length > 35 ||
      translation === null ||
      typeof translation !== "object" ||
      Array.isArray(translation)
    )
      return false;
    const name = (translation as { name?: unknown }).name;
    return (
      name === undefined ||
      (typeof name === "string" && name.length > 0 && name.length <= 100)
    );
  });
}

const english = {
  language: "Language",
  english: "English",
  chineseSimplified: "Chinese (Simplified)",
  creatingRoom: "Creating room",
  loadingGame: "Loading game",
  checkingGame: "Checking game",
  joiningRoom: "Joining room",
  cancel: "Cancel",
  playGamesTogether: "Play games together",
  playweftHome: "Playweft home",
  createRoom: "Create room",
  joinRoom: "Join room",
  gameUrlOrRoomCode: "Game URL or room code",
  pasteGameUrlOrRoomCode: "Paste a static game URL or room code",
  favorites: "Favorites",
  recentlyPlayed: "Recently played",
  recommended: "Recommended",
  gameInformation: "Game information",
  closeGameInformation: "Close game information",
  backHome: "Back home",
  playGame: "Play game",
  playSolo: "Play solo",
  enterRoomCode: "Enter room code",
  gameNotSupported: "Game not supported",
  back: "Back",
  openSite: "Open site",
  gameRoom: "Game room",
  backToPlayweftHome: "Back to Playweft home",
  roomOptions: "Room options",
  players: "Players",
  connecting: "Connecting...",
  playersToStart: "{{count}} to start",
  joinSeat: "Join seat {{seat}}",
  moveToSeat: "Move to seat {{seat}}",
  sitHere: "Sit here",
  you: "You",
  ready: "Ready",
  notReady: "Not ready",
  player: "Player {{seat}}",
  host: "Host",
  closePlayerMenu: "Close player menu",
  playerOptions: "Player options for {{name}}",
  makeHost: "Make host",
  remove: "Remove",
  invitePlayer: "Invite a player",
  invite: "Invite",
  spectatorCount: "{{count}} spectator{{suffix}}",
  spectating: "Spectating",
  spectate: "Spectate",
  chooseEmptySeat: "Choose an empty seat to play.",
  starting: "Starting...",
  startGame: "Start game",
  cancelReady: "Cancel ready",
  copyInviteLink: "Copy invite link",
  inviteLinkCopied: "Invite link copied",
  returnToRoom: "Return to room",
  leaveRoom: "Leave room?",
  leave: "Leave",
  needRoomLinkToReturn: "You will need the room link to return.",
  dissolveRoom: "Dissolve room?",
  dissolveRoomAction: "Dissolve room",
  dissolveRoomDescription:
    "This closes the room for everyone and the invite link will stop working.",
  gameHelp: "Game help",
  gameInfo: "Game info",
  changeGame: "Change game",
  gameHelpTitle: "{{name}} help",
  invitePlayers: "Invite players",
  qrCodeForRoomLink: "QR code for the room link",
  generatingQrCode: "Generating QR code",
  gameActions: "{{name}} actions",
  favorite: "Favorite",
  unfavorite: "Unfavorite",
  delete: "Delete",
  gameUrl: "Game URL",
  pasteStaticGameUrl: "Paste a static game URL",
  closeDialog: "Close {{title}} dialog",
  closeMenu: "Close {{label}}",
  dismissError: "Dismiss error",
  unexpectedError: "Unexpected error",
  enterFullGameUrl: "Enter a full game URL, including https://.",
  gameCompatibilityCheck: "Game compatibility check",
  gameBridgeUnavailable: "This URL does not expose the Playweft game bridge.",
  gameLaunchMissing:
    "This game did not describe how Playweft should launch it.",
  gameBridgeLaunchMissing:
    "This game opened the Playweft bridge but did not describe how to launch.",
  gameInitializationMissing:
    "This game did not send Playweft room initialization.",
  liveConnectionFailed: "Live connection to the platform failed",
  liveConnectionNotRestored: "Live connection could not be restored",
  actionRequestIdRequired: "An action requestId is required",
  gameNotStarted: "The game has not started",
  liveConnectionNotReady: "Live connection is not ready",
  inviteCopyFailed:
    "Could not copy automatically. Copy the invite link from the address bar.",
  invalidInitialization: "Invalid game initialization message",
  invalidGameLimits:
    "The game must provide a Lua script and valid minPlayers / maxPlayers",
} as const;

export type TranslationKey = keyof typeof english;
type TranslationDictionary = Record<TranslationKey, string>;
export type Translator = (
  key: TranslationKey,
  values?: InterpolationValues,
) => string;

const chineseSimplified: TranslationDictionary = {
  language: "语言",
  english: "English",
  chineseSimplified: "简体中文",
  creatingRoom: "正在创建房间",
  loadingGame: "正在加载游戏",
  checkingGame: "正在检查游戏",
  joiningRoom: "正在加入房间",
  cancel: "取消",
  playGamesTogether: "一起玩游戏",
  playweftHome: "Playweft 首页",
  createRoom: "创建房间",
  joinRoom: "加入房间",
  gameUrlOrRoomCode: "游戏 URL 或房间码",
  pasteGameUrlOrRoomCode: "粘贴静态游戏 URL 或输入房间码",
  favorites: "收藏",
  recentlyPlayed: "最近玩过",
  recommended: "推荐游戏",
  gameInformation: "游戏信息",
  closeGameInformation: "关闭游戏信息",
  backHome: "返回首页",
  playGame: "开始游戏",
  playSolo: "单人游玩",
  enterRoomCode: "输入房间码",
  gameNotSupported: "不支持该游戏",
  back: "返回",
  openSite: "打开网站",
  gameRoom: "游戏房间",
  backToPlayweftHome: "返回 Playweft 首页",
  roomOptions: "房间选项",
  players: "玩家",
  connecting: "正在连接...",
  playersToStart: "{{count}} 人即可开始",
  joinSeat: "加入座位 {{seat}}",
  moveToSeat: "移至座位 {{seat}}",
  sitHere: "坐在这里",
  you: "你",
  ready: "准备就绪",
  notReady: "未准备",
  player: "玩家 {{seat}}",
  host: "房主",
  closePlayerMenu: "关闭玩家菜单",
  playerOptions: "{{name}} 的选项",
  makeHost: "设为房主",
  remove: "移除",
  invitePlayer: "邀请玩家",
  invite: "邀请",
  spectatorCount: "{{count}} 位观战者",
  spectating: "正在观战",
  spectate: "观战",
  chooseEmptySeat: "选择一个空座位即可加入游戏。",
  starting: "正在开始...",
  startGame: "开始游戏",
  cancelReady: "取消准备",
  copyInviteLink: "复制邀请链接",
  inviteLinkCopied: "邀请链接已复制",
  returnToRoom: "返回房间",
  leaveRoom: "离开房间？",
  leave: "离开",
  needRoomLinkToReturn: "你需要通过房间链接才能再次加入。",
  dissolveRoom: "解散房间？",
  dissolveRoomAction: "解散房间",
  dissolveRoomDescription: "这会关闭所有人的房间，邀请链接也将失效。",
  gameHelp: "游戏帮助",
  gameInfo: "游戏信息",
  changeGame: "更换游戏",
  gameHelpTitle: "{{name}} 帮助",
  invitePlayers: "邀请玩家",
  qrCodeForRoomLink: "房间链接二维码",
  generatingQrCode: "正在生成二维码",
  gameActions: "{{name}} 的操作",
  favorite: "收藏",
  unfavorite: "取消收藏",
  delete: "删除",
  gameUrl: "游戏 URL",
  pasteStaticGameUrl: "粘贴静态游戏 URL",
  closeDialog: "关闭{{title}}对话框",
  closeMenu: "关闭{{label}}",
  dismissError: "关闭错误提示",
  unexpectedError: "发生未知错误",
  enterFullGameUrl: "请输入完整游戏 URL，包括 https://。",
  gameCompatibilityCheck: "游戏兼容性检查",
  gameBridgeUnavailable: "该 URL 未提供 Playweft 游戏桥接。",
  gameLaunchMissing: "该游戏没有说明 Playweft 应如何启动它。",
  gameBridgeLaunchMissing: "该游戏已打开 Playweft 桥接，但没有说明如何启动。",
  gameInitializationMissing: "该游戏没有发送 Playweft 房间初始化信息。",
  liveConnectionFailed: "与平台的实时连接失败",
  liveConnectionNotRestored: "无法恢复与平台的实时连接",
  actionRequestIdRequired: "操作请求必须包含 requestId",
  gameNotStarted: "游戏尚未开始",
  liveConnectionNotReady: "实时连接尚未就绪",
  inviteCopyFailed: "无法自动复制，请从地址栏复制邀请链接。",
  invalidInitialization: "无效的游戏初始化信息",
  invalidGameLimits: "游戏必须提供 Lua 脚本以及有效的 minPlayers / maxPlayers",
};

const resources: Record<Locale, TranslationDictionary> = {
  en: english,
  "zh-CN": chineseSimplified,
};

export function resolveLocale(value: string | undefined): Locale {
  if (value === "zh-CN" || value?.toLowerCase().startsWith("zh"))
    return "zh-CN";
  return "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: InterpolationValues = {},
): string {
  return resources[locale][key].replace(/{{(\w+)}}/g, (token, name: string) =>
    values[name] === undefined ? token : String(values[name]),
  );
}

export function localizeGameName(
  game: { name: string; translations?: GameTranslations },
  locale: Locale,
): string {
  const translations = game.translations;
  if (!translations) return game.name;
  return (
    translations[locale]?.name ??
    translations[locale.split("-")[0]!]?.name ??
    game.name
  );
}

interface I18nContextValue {
  locale: Locale;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = resolveLocale(navigator.language);
  const t = useCallback(
    (key: TranslationKey, values?: InterpolationValues) =>
      translate(locale, key, values),
    [locale],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
