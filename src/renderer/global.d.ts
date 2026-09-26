interface ChatMessageDto {
  id: string;
  channel: string;
  user: string;
  displayName: string;
  userId?: string;
  message: string;
  timestamp: number;
  color?: string;
  badges?: string[];
  role?: 'mod' | 'vip' | 'sub' | 'normal';
  isAction?: boolean;
  isSystem?: boolean;
}

interface TwitchModApi {
  getAuthStatus: () => Promise<{
    loggedIn: boolean;
    user: { id: string; login: string; display_name: string; profile_image_url?: string } | null;
    clientIdConfigured: boolean;
    storePath?: string;
    redirectUri?: string;
    authMode?: 'device' | 'pkce';
  }>;
  login: () => Promise<{ user: { id: string; login: string; display_name: string } }>;
  onDeviceCode: (
    callback: (payload: { userCode: string; verificationUri: string }) => void
  ) => () => void;
  logout: () => Promise<{ ok: boolean }>;
  listChannels: () => Promise<{
    channels: Array<{
      broadcaster_id: string;
      broadcaster_login: string;
      broadcaster_name: string;
      is_own?: boolean;
    }>;
    user: { id: string; login: string; display_name: string };
  }>;
  openChannel: (data: {
    broadcasterId: string;
    broadcasterLogin: string;
    broadcasterName: string;
    moderatorUserId: string;
    moderatorLogin: string;
  }) => Promise<{ ok: boolean }>;
  openUserWindow: (payload: {
    broadcasterId: string;
    broadcasterLogin: string;
    broadcasterName: string;
    moderatorUserId: string;
    moderatorLogin: string;
    userLogin: string;
    userId?: string;
    displayName?: string;
    history: ChatMessageDto[];
  }) => Promise<{ ok: boolean }>;
  getUserBootstrap: (windowKey: string) => Promise<{
    broadcasterId: string;
    broadcasterLogin: string;
    broadcasterName: string;
    moderatorUserId: string;
    moderatorLogin: string;
    userLogin: string;
    userId?: string;
    displayName?: string;
    history: ChatMessageDto[];
  } | null>;
  forwardChatMessage: (payload: {
    broadcasterId: string;
    message: ChatMessageDto;
  }) => Promise<{ ok: boolean }>;
  onUserChatMessage: (callback: (message: ChatMessageDto) => void) => () => void;
  onUserHistoryRefresh: (callback: (history: ChatMessageDto[]) => void) => () => void;
  getChatCredentials: () => Promise<{ login: string; accessToken: string; clientId: string }>;
  timeout: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
    duration: number;
    reason?: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  ban: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
    reason?: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  unban: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  deleteMessage: (payload: {
    broadcasterId: string;
    moderatorId: string;
    messageId: string;
  }) => Promise<{ ok: boolean }>;
  clearChat: (payload: {
    broadcasterId: string;
    moderatorId: string;
  }) => Promise<{ ok: boolean }>;
  getChatSettings: (payload: {
    broadcasterId: string;
    moderatorId: string;
  }) => Promise<{
    emote_mode: boolean;
    follower_mode: boolean;
    follower_mode_duration: number | null;
    slow_mode: boolean;
    slow_mode_wait_time: number | null;
    subscriber_mode: boolean;
    unique_chat_mode: boolean;
  }>;
  updateChatSettings: (payload: {
    broadcasterId: string;
    moderatorId: string;
    settings: Record<string, unknown>;
  }) => Promise<unknown>;
}

interface Window {
  twitchMod: TwitchModApi;
}
