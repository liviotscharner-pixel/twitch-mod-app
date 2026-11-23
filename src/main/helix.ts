import { HELIX_BASE } from '../shared/constants';
import type { ChatChatter, ChatSettings, ModeratedChannel, TwitchUser } from '../shared/types';

export class HelixError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HelixError';
    this.status = status;
  }
}

export function isMissingScopeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = err instanceof HelixError ? err.status : 0;
  const msg = err.message.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    msg.includes('missing scope') ||
    msg.includes('required scope') ||
    (msg.includes('scope') && (msg.includes('missing') || msg.includes('authorize') || msg.includes('authorized')))
  );
}

async function helixRequest<T>(
  method: string,
  path: string,
  accessToken: string,
  clientId: string,
  options?: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown }
): Promise<T> {
  const url = new URL(`${HELIX_BASE}/${path.replace(/^\//, '')}`);
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Client-Id': clientId,
  };
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return {} as T;
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }

  if (!res.ok) {
    const msg =
      (json as { message?: string })?.message ||
      text ||
      `Helix-Fehler ${res.status}`;
    throw new HelixError(res.status, msg);
  }

  return json as T;
}

export function helixGet<T>(
  path: string,
  accessToken: string,
  clientId: string,
  query?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  return helixRequest<T>('GET', path, accessToken, clientId, { query });
}

export function helixPost<T>(
  path: string,
  accessToken: string,
  clientId: string,
  query?: Record<string, string | number | boolean | undefined | null>,
  body?: unknown
): Promise<T> {
  return helixRequest<T>('POST', path, accessToken, clientId, { query, body });
}

export function helixPatch<T>(
  path: string,
  accessToken: string,
  clientId: string,
  query?: Record<string, string | number | boolean | undefined | null>,
  body?: unknown
): Promise<T> {
  return helixRequest<T>('PATCH', path, accessToken, clientId, { query, body });
}

export function helixDelete<T>(
  path: string,
  accessToken: string,
  clientId: string,
  query?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  return helixRequest<T>('DELETE', path, accessToken, clientId, { query });
}

export async function getModeratedChannels(
  accessToken: string,
  clientId: string,
  userId: string
): Promise<ModeratedChannel[]> {
  const channels: ModeratedChannel[] = [];
  let cursor: string | undefined;

  do {
    const data = await helixGet<{
      data: ModeratedChannel[];
      pagination?: { cursor?: string };
    }>('moderation/channels', accessToken, clientId, {
      user_id: userId,
      first: 100,
      after: cursor,
    });
    channels.push(...(data.data || []));
    cursor = data.pagination?.cursor;
  } while (cursor);

  return channels;
}

/**
 * Helix Get Moderated Channels never includes the caller's own channel.
 * Prepend it (as broadcaster) and dedupe by broadcaster_id.
 */
export function withOwnChannel(user: TwitchUser, moderated: ModeratedChannel[]): ModeratedChannel[] {
  const own: ModeratedChannel = {
    broadcaster_id: user.id,
    broadcaster_login: user.login,
    broadcaster_name: user.display_name || user.login,
    is_own: true,
  };
  const rest = moderated.filter((ch) => ch.broadcaster_id !== user.id);
  return [own, ...rest];
}

export async function banOrTimeoutUser(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string,
  userId: string,
  duration?: number,
  reason?: string
): Promise<void> {
  const data: { user_id: string; duration?: number; reason?: string } = {
    user_id: userId,
  };
  if (duration !== undefined && duration > 0) {
    data.duration = duration;
  }
  if (reason) data.reason = reason;

  await helixPost(
    'moderation/bans',
    accessToken,
    clientId,
    { broadcaster_id: broadcasterId, moderator_id: moderatorId },
    { data }
  );
}

export async function unbanUser(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string,
  userId: string
): Promise<void> {
  await helixDelete('moderation/bans', accessToken, clientId, {
    broadcaster_id: broadcasterId,
    moderator_id: moderatorId,
    user_id: userId,
  });
}

export async function deleteChatMessage(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string,
  messageId: string
): Promise<void> {
  await helixDelete('moderation/chat', accessToken, clientId, {
    broadcaster_id: broadcasterId,
    moderator_id: moderatorId,
    message_id: messageId,
  });
}

export async function clearChat(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string
): Promise<void> {
  // Delete all messages via Helix: omit message_id to clear chat
  await helixDelete('moderation/chat', accessToken, clientId, {
    broadcaster_id: broadcasterId,
    moderator_id: moderatorId,
  });
}

export async function getChatSettings(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string
): Promise<ChatSettings> {
  const data = await helixGet<{ data: ChatSettings[] }>('chat/settings', accessToken, clientId, {
    broadcaster_id: broadcasterId,
    moderator_id: moderatorId,
  });
  const s = data.data?.[0];
  if (!s) {
    return {
      emote_mode: false,
      follower_mode: false,
      follower_mode_duration: null,
      slow_mode: false,
      slow_mode_wait_time: null,
      subscriber_mode: false,
      unique_chat_mode: false,
    };
  }
  return s;
}

export async function updateChatSettings(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string,
  settings: Partial<ChatSettings>
): Promise<ChatSettings> {
  const data = await helixPatch<{ data: ChatSettings[] }>(
    'chat/settings',
    accessToken,
    clientId,
    { broadcaster_id: broadcasterId, moderator_id: moderatorId },
    settings
  );
  return data.data?.[0] || (settings as ChatSettings);
}

export async function resolveUserId(
  accessToken: string,
  clientId: string,
  login: string
): Promise<string> {
  const data = await helixGet<{ data: { id: string; login: string }[] }>(
    'users',
    accessToken,
    clientId,
    { login: login.toLowerCase().replace(/^@/, '') }
  );
  const user = data.data?.[0];
  if (!user) throw new Error(`Benutzer „${login}“ nicht gefunden.`);
  return user.id;
}

async function paginateHelix<T>(
  path: string,
  accessToken: string,
  clientId: string,
  query: Record<string, string | number | boolean | undefined | null>,
  first: number
): Promise<{ data: T[]; total?: number }> {
  const items: T[] = [];
  let cursor: string | undefined;
  let total: number | undefined;

  do {
    const data = await helixGet<{
      data: T[];
      pagination?: { cursor?: string };
      total?: number;
    }>(path, accessToken, clientId, { ...query, first, after: cursor });
    items.push(...(data.data || []));
    if (typeof data.total === 'number') total = data.total;
    cursor = data.pagination?.cursor;
  } while (cursor);

  return { data: items, total };
}

interface HelixUserRef {
  user_id: string;
  user_login: string;
  user_name: string;
}

export async function getChatters(
  accessToken: string,
  clientId: string,
  broadcasterId: string,
  moderatorId: string
): Promise<{ chatters: ChatChatter[]; total: number }> {
  const { data, total } = await paginateHelix<HelixUserRef>(
    'chat/chatters',
    accessToken,
    clientId,
    { broadcaster_id: broadcasterId, moderator_id: moderatorId },
    1000
  );
  const chatters: ChatChatter[] = data.map((u) => ({
    userId: u.user_id,
    userLogin: (u.user_login || '').toLowerCase(),
    displayName: u.user_name || u.user_login,
  }));
  return { chatters, total: total ?? chatters.length };
}

export async function tryGetModeratorLogins(
  accessToken: string,
  clientId: string,
  broadcasterId: string
): Promise<{ logins: string[]; fromApi: boolean }> {
  try {
    const { data } = await paginateHelix<HelixUserRef>(
      'moderation/moderators',
      accessToken,
      clientId,
      { broadcaster_id: broadcasterId },
      100
    );
    return {
      logins: data.map((u) => (u.user_login || '').toLowerCase()).filter(Boolean),
      fromApi: true,
    };
  } catch (err) {
    console.warn('Moderatorenliste nicht verfügbar:', err);
    return { logins: [], fromApi: false };
  }
}

export async function tryGetVipLogins(
  accessToken: string,
  clientId: string,
  broadcasterId: string
): Promise<{ logins: string[]; fromApi: boolean }> {
  try {
    const { data } = await paginateHelix<HelixUserRef>(
      'channels/vips',
      accessToken,
      clientId,
      { broadcaster_id: broadcasterId },
      100
    );
    return {
      logins: data.map((u) => (u.user_login || '').toLowerCase()).filter(Boolean),
      fromApi: true,
    };
  } catch (err) {
    console.warn('VIP-Liste nicht verfügbar:', err);
    return { logins: [], fromApi: false };
  }
}
