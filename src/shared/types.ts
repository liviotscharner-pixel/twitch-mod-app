export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
  email?: string;
}

export interface ModeratedChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  /** True when this entry is the logged-in user's own channel (broadcaster). */
  is_own?: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
  token_type?: string;
}

export type ChatRole = 'mod' | 'vip' | 'sub' | 'normal';

export interface ChatMessage {
  id: string;
  channel: string;
  user: string;
  displayName: string;
  userId?: string;
  message: string;
  timestamp: number;
  color?: string;
  /** Twitch badge names from IRC tags, e.g. moderator, vip, subscriber, broadcaster */
  badges?: string[];
  role?: ChatRole;
  isAction?: boolean;
  /** Twitch IRC emotes= tag for native/global/channel emotes */
  emotes?: string;
  isSystem?: boolean;
}

export interface ChatSettings {
  emote_mode: boolean;
  follower_mode: boolean;
  follower_mode_duration: number | null;
  slow_mode: boolean;
  slow_mode_wait_time: number | null;
  subscriber_mode: boolean;
  unique_chat_mode: boolean;
}

export interface ChannelWindowData {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  moderatorUserId: string;
  moderatorLogin: string;
}

export interface UserWindowData {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  moderatorUserId: string;
  moderatorLogin: string;
  userLogin: string;
  userId?: string;
  displayName?: string;
}

export interface OpenUserWindowPayload extends UserWindowData {
  history: ChatMessage[];
}

export const TIMEOUT_PRESETS = [
  { label: '10s', seconds: 10 },
  { label: '1m', seconds: 60 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 },
] as const;

export const CHATTERS_SCOPE = 'moderator:read:chatters';
export const MODERATORS_SCOPE = 'moderation:read';
export const VIPS_SCOPE = 'channel:read:vips';
export const FOLLOWERS_SCOPE = 'moderator:read:followers';
export const BROADCAST_SCOPE = 'channel:manage:broadcast';

export const OAUTH_SCOPES = [
  'user:read:email',
  'user:read:moderated_channels',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:chat_settings',
  'moderator:read:chat_settings',
  'chat:read',
  'chat:edit',
  CHATTERS_SCOPE,
  MODERATORS_SCOPE,
  VIPS_SCOPE,
  FOLLOWERS_SCOPE,
  BROADCAST_SCOPE,
] as const;

export interface ChatChatter {
  userId: string;
  userLogin: string;
  displayName: string;
}

export type MemberGroup = 'broadcaster' | 'moderator' | 'vip' | 'viewer';

export interface MemberListResult {
  ok: boolean;
  needsRelogin?: boolean;
  message?: string;
  total?: number;
  chatters?: ChatChatter[];
  moderatorLogins?: string[];
  vipLogins?: string[];
  modsFromApi?: boolean;
  vipsFromApi?: boolean;
}

export interface UserInfoRequest {
  userLogin: string;
  userId?: string;
  broadcasterId: string;
  broadcasterLogin: string;
}

export interface UserInfo {
  ok: boolean;
  message?: string;
  userId: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  createdAt?: string;
  broadcasterType?: string;
  description?: string;
  followers?: number | null;
  followsChannel?: boolean | null;
  followedAt?: string | null;
  followsNeedsScope?: boolean;
  isLive?: boolean;
  streamTitle?: string | null;
  streamGame?: string | null;
  viewerCount?: number | null;
  lastTitle?: string | null;
  lastGame?: string | null;
}

export interface ChannelBroadcastInfo {
  title: string;
  gameName: string;
  gameId: string;
  canEdit: boolean;
  needsBroadcastScope: boolean;
}

export interface CategorySearchResult {
  id: string;
  name: string;
  boxArtUrl?: string;
}

export interface UpdateChannelResult {
  ok: boolean;
  message?: string;
  needsRelogin?: boolean;
  notBroadcaster?: boolean;
  title?: string;
  gameName?: string;
  gameId?: string;
}
