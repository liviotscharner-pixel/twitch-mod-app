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
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
  token_type?: string;
}

export interface ChatMessage {
  id: string;
  channel: string;
  user: string;
  displayName: string;
  userId?: string;
  message: string;
  timestamp: number;
  color?: string;
  badges?: string[];
  isAction?: boolean;
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

export const TIMEOUT_PRESETS = [
  { label: '10s', seconds: 10 },
  { label: '1m', seconds: 60 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 },
] as const;

export const OAUTH_SCOPES = [
  'user:read:email',
  'user:read:moderated_channels',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:chat_settings',
  'moderator:read:chat_settings',
  'chat:read',
  'chat:edit',
] as const;
