import { HELIX_BASE } from '../shared/constants';
import type { ChatSettings, ModeratedChannel, TwitchUser } from '../shared/types';

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
    throw new Error(msg);
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
