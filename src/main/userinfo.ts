import { getClientId, ensureValidToken, validateToken } from './auth';
import { getTokens } from './store';
import {
  getHelixUser,
  getChannelInfo,
  getStreamInfo,
  tryGetFollowerTotal,
  tryGetFollowsChannel,
} from './helix';
import { getPublicUserProfile } from './gql';
import { FOLLOWERS_SCOPE, type UserInfo, type UserInfoRequest } from '../shared/types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; info: UserInfo }>();

function cacheKey(req: UserInfoRequest): string {
  return `${req.broadcasterId}:${(req.userLogin || '').toLowerCase()}`;
}

function broadcasterTypeFrom(helixType?: string, gql?: { isPartner?: boolean; isAffiliate?: boolean }): string {
  const t = (helixType || '').toLowerCase();
  if (t === 'partner' || t === 'affiliate') return t;
  if (gql?.isPartner) return 'partner';
  if (gql?.isAffiliate) return 'affiliate';
  return t || '';
}

export async function getUserInfo(req: UserInfoRequest): Promise<UserInfo> {
  const login = (req.userLogin || '').toLowerCase().replace(/^@/, '').trim();
  if (!login) {
    return { ok: false, message: 'Kein Benutzer angegeben.', userId: '', login: '', displayName: '' };
  }

  const key = cacheKey({ ...req, userLogin: login });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.info;
  }

  const token = await ensureValidToken();
  const clientId = getClientId();

  let helixUser: Awaited<ReturnType<typeof getHelixUser>> = null;
  let gql: Awaited<ReturnType<typeof getPublicUserProfile>> = null;

  const results = await Promise.allSettled([
    getHelixUser(token, clientId, { id: req.userId || undefined, login: req.userId ? undefined : login }),
    getPublicUserProfile(login),
  ]);
  if (results[0].status === 'fulfilled') helixUser = results[0].value;
  else console.warn('Helix User nicht verfügbar:', results[0].reason);
  if (results[1].status === 'fulfilled') gql = results[1].value;
  else console.warn('GQL User nicht verfügbar:', results[1].reason);

  const userId = helixUser?.id || gql?.id || req.userId || '';
  const displayName = helixUser?.display_name || gql?.displayName || login;

  if (!userId && !gql) {
    return { ok: false, message: `Benutzer „${login}“ nicht gefunden.`, userId: '', login, displayName };
  }

  const extra: {
    channel: { title: string; game_name: string } | null;
    stream: { title: string; game_name: string; viewer_count: number } | null;
  } = { channel: null, stream: null };
  let followers: number | null = gql?.followers ?? null;
  let followsChannel: boolean | null = null;
  let followedAt: string | null = null;
  let followsNeedsScope = false;

  const extras: Promise<void>[] = [];

  if (userId) {
    extras.push(
      getChannelInfo(token, clientId, userId)
        .then((v) => {
          extra.channel = v;
        })
        .catch((err) => console.warn('Helix Channel nicht verfügbar:', err))
    );
    extras.push(
      getStreamInfo(token, clientId, userId)
        .then((v) => {
          extra.stream = v;
        })
        .catch((err) => console.warn('Helix Stream nicht verfügbar:', err))
    );
    if (followers == null) {
      extras.push(
        tryGetFollowerTotal(token, clientId, userId).then((v) => {
          if (v != null) followers = v;
        })
      );
    }
    if (req.broadcasterId && userId !== req.broadcasterId) {
      extras.push(
        (async () => {
          const tokens = getTokens();
          const validated = await validateToken(token);
          const scopes = validated?.scopes || tokens?.scopes || [];
          if (!scopes.includes(FOLLOWERS_SCOPE)) {
            followsNeedsScope = true;
            return;
          }
          const rel = await tryGetFollowsChannel(token, clientId, req.broadcasterId, userId);
          if (rel.status === 'needs_scope') {
            followsNeedsScope = true;
          } else if (rel.status === 'ok') {
            followsChannel = rel.follows;
            followedAt = rel.followedAt;
          }
        })()
      );
    } else if (userId && userId === req.broadcasterId) {
      // Broadcaster does not follow their own channel in a meaningful way
      followsChannel = null;
    }
  }

  await Promise.all(extras);

  const isLive = !!extra.stream || !!gql?.isLive;
  const info: UserInfo = {
    ok: true,
    userId,
    login: (helixUser?.login || gql?.login || login).toLowerCase(),
    displayName,
    profileImageUrl: helixUser?.profile_image_url || gql?.profileImageUrl || undefined,
    createdAt: helixUser?.created_at || gql?.createdAt || undefined,
    broadcasterType: broadcasterTypeFrom(helixUser?.broadcaster_type, gql || undefined),
    description: (helixUser?.description || gql?.description || '').trim(),
    followers,
    followsChannel,
    followedAt,
    followsNeedsScope,
    isLive,
    streamTitle: extra.stream?.title || gql?.streamTitle || null,
    streamGame: extra.stream?.game_name || gql?.streamGame || null,
    viewerCount: extra.stream ? extra.stream.viewer_count : gql?.viewerCount ?? null,
    lastTitle: extra.channel?.title || gql?.lastTitle || null,
    lastGame: extra.channel?.game_name || gql?.lastGame || null,
  };

  cache.set(key, { at: Date.now(), info });
  return info;
}
