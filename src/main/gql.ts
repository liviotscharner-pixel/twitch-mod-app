/**
 * Public Twitch GQL helpers for member-list roles.
 *
 * Helix GET moderation/moderators and channels/vips typically only succeed with
 * the broadcaster's own token. GQL `user.mods` is similarly locked
 * ("unauthenticated"). The public web Client-Id can still read:
 *   - user.vips (full channel VIP list, paginated)
 *   - user.isModerator(channelID) per login (works without a user token)
 */

const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const CACHE_TTL_MS = 60_000;
const MOD_BATCH = 50;

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface VipNode {
  login?: string;
  displayName?: string;
}

interface VipConnection {
  edges?: Array<{ cursor?: string; node?: VipNode }>;
  pageInfo?: { hasNextPage?: boolean };
}

const vipCache = new Map<string, { at: number; logins: string[] }>();
const modCache = new Map<string, Map<string, { at: number; isMod: boolean }>>();

function isSafeLogin(login: string): boolean {
  return /^[a-z0-9_]{1,25}$/i.test(login);
}

async function gqlRequest<T>(payload: unknown): Promise<GqlResponse<T>> {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Client-Id': GQL_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`GQL HTTP ${res.status}`);
  }
  return (await res.json()) as GqlResponse<T>;
}

export async function getChannelVipLogins(channelLogin: string): Promise<string[]> {
  const login = (channelLogin || '').toLowerCase().replace(/^#/, '');
  if (!isSafeLogin(login)) return [];

  const cached = vipCache.get(login);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.logins;
  }

  try {
    const logins: string[] = [];
    let cursor: string | undefined;
    const query = `query($login: String!, $first: Int, $after: Cursor) {
      user(login: $login) {
        vips(first: $first, after: $after) {
          edges { cursor node { login } }
          pageInfo { hasNextPage }
        }
      }
    }`;

    do {
      const variables: Record<string, string | number> = { login, first: 100 };
      if (cursor) variables.after = cursor;
      const res = await gqlRequest<{ user?: { vips?: VipConnection } }>({ query, variables });
      const conn = res.data?.user?.vips;
      const edges = conn?.edges || [];
      for (const edge of edges) {
        const name = (edge.node?.login || '').toLowerCase();
        if (name) logins.push(name);
        if (edge.cursor) cursor = edge.cursor;
      }
      if (!conn?.pageInfo?.hasNextPage || !edges.length) break;
    } while (cursor);

    const unique = [...new Set(logins)];
    vipCache.set(login, { at: Date.now(), logins: unique });
    return unique;
  } catch (err) {
    console.warn('GQL VIP-Liste nicht verfügbar:', err);
    return cached?.logins || [];
  }
}

export async function getModeratorLoginsAmong(
  channelId: string,
  logins: string[]
): Promise<string[]> {
  const id = String(channelId || '').trim();
  if (!/^\d+$/.test(id)) return [];

  const unique = [
    ...new Set(logins.map((l) => (l || '').toLowerCase()).filter((l) => isSafeLogin(l))),
  ];
  if (!unique.length) return [];

  let channelCache = modCache.get(id);
  if (!channelCache) {
    channelCache = new Map();
    modCache.set(id, channelCache);
  }

  const now = Date.now();
  const found: string[] = [];
  const toFetch: string[] = [];

  for (const login of unique) {
    const hit = channelCache.get(login);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      if (hit.isMod) found.push(login);
    } else {
      toFetch.push(login);
    }
  }

  try {
    for (let i = 0; i < toFetch.length; i += MOD_BATCH) {
      const batch = toFetch.slice(i, i + MOD_BATCH);
      const fields = batch
        .map((login, idx) => `u${idx}: user(login:"${login}") { login isModerator(channelID:"${id}") }`)
        .join('\n');
      const res = await gqlRequest<Record<string, { login?: string; isModerator?: boolean } | null>>(
        { query: `query { ${fields} }` }
      );
      const data = res.data || {};
      const seenInBatch = new Set<string>();
      for (const val of Object.values(data)) {
        const name = (val?.login || '').toLowerCase();
        if (!name) continue;
        seenInBatch.add(name);
        const isMod = !!val?.isModerator;
        channelCache.set(name, { at: now, isMod });
        if (isMod) found.push(name);
      }
      // Users that resolved to null (deleted/invalid) should not be refetched every cycle
      for (const login of batch) {
        if (!seenInBatch.has(login) && !channelCache.has(login)) {
          channelCache.set(login, { at: now, isMod: false });
        }
      }
    }
  } catch (err) {
    console.warn('GQL Moderator-Check nicht verfügbar:', err);
  }

  return [...new Set(found)];
}
