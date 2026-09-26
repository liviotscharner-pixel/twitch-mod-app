import http from 'http';
import { URL } from 'url';
import { BrowserWindow, shell } from 'electron';
import {
  OAUTH_CALLBACK_PORT,
  OAUTH_REDIRECT_URI,
  TWITCH_AUTH_URL,
  TWITCH_DEVICE_URL,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
} from '../shared/constants';
import { OAUTH_SCOPES, type AuthTokens, type TwitchUser } from '../shared/types';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { getTokens, setTokens, setUser, clearSession } from './store';
import { helixGet } from './helix';

let callbackServer: http.Server | null = null;

export type AuthMode = 'device' | 'pkce';

export function getClientId(): string {
  return (process.env.TWITCH_CLIENT_ID || '').replace(/^\uFEFF/, '').trim();
}

export function getRedirectUri(): string {
  return (process.env.TWITCH_REDIRECT_URI || OAUTH_REDIRECT_URI).trim();
}

export function getClientSecret(): string | undefined {
  const s = (process.env.TWITCH_CLIENT_SECRET || '').replace(/^\uFEFF/, '').trim();
  return s || undefined;
}

/** Public apps (no secret) use Device Code; Confidential apps use auth-code + PKCE. */
export function getAuthMode(): AuthMode {
  return getClientSecret() ? 'pkce' : 'device';
}

function scopesParam(): string {
  return OAUTH_SCOPES.join(' ');
}

function formatTokenError(status: number, text: string): Error {
  const lower = text.toLowerCase();
  if (
    status === 400 &&
    (lower.includes('invalid client') ||
      lower.includes('invalid client credentials') ||
      lower.includes('client credentials'))
  ) {
    return new Error(
      'Ungültige Client-Credentials (HTTP 400). Öffentliche Twitch-Apps haben kein Client Secret – ' +
        'die App nutzt dann automatisch den Device-Code-Flow (kein Secret in .env). ' +
        'Alternativ: App in der Twitch Developer Console auf „Confidential“ umstellen und ' +
        'TWITCH_CLIENT_SECRET in .env setzen. Details: ' +
        text
    );
  }
  return new Error(`Token-Austausch fehlgeschlagen (${status}): ${text}`);
}

function htmlPage(title: string, message: string, ok: boolean): string {
  const color = ok ? '#F28C28' : '#E47767';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#171411;color:#FFF1DE;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#241D18;padding:2rem 2.5rem;border-radius:14px;border:1px solid #4A382B;max-width:420px;text-align:center}
h1{color:${color};font-size:1.25rem;margin:0 0 .75rem}p{margin:0;color:#B9A28D;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function notifyDeviceCode(userCode: string, verificationUri: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('auth:device-code', {
        userCode,
        verificationUri,
      });
    }
  }
}

function parseTokenResponse(data: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
  token_type?: string;
}): AuthTokens {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scopes: data.scope,
    token_type: data.token_type,
  };
}

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
  clientId: string
): Promise<AuthTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const secret = getClientSecret();
  if (secret) body.set('client_secret', secret);

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw formatTokenError(res.status, text);
  }

  return parseTokenResponse(
    (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string[];
      token_type?: string;
    }
  );
}

export async function fetchCurrentUser(accessToken: string, clientId: string): Promise<TwitchUser> {
  const data = await helixGet<{ data: TwitchUser[] }>('users', accessToken, clientId);
  const user = data.data?.[0];
  if (!user) throw new Error('Benutzerdaten konnten nicht geladen werden.');
  return user;
}

export async function validateToken(accessToken: string): Promise<{
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[];
  expires_in: number;
} | null> {
  const res = await fetch(TWITCH_VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    client_id: string;
    login: string;
    user_id: string;
    scopes: string[];
    expires_in: number;
  };
}

export async function refreshAccessToken(): Promise<AuthTokens | null> {
  const tokens = getTokens();
  const clientId = getClientId();
  if (!tokens?.refresh_token || !clientId) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  const secret = getClientSecret();
  if (secret) body.set('client_secret', secret);

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string[];
    token_type?: string;
  };

  const next: AuthTokens = {
    access_token: data.access_token,
    // DCF refresh tokens are one-time use; always prefer the new one when present
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scopes: data.scope,
    token_type: data.token_type,
  };
  setTokens(next);
  return next;
}

export async function ensureValidToken(): Promise<string> {
  const tokens = getTokens();
  if (!tokens?.access_token) throw new Error('Nicht angemeldet.');

  const valid = await validateToken(tokens.access_token);
  if (valid) return tokens.access_token;

  const refreshed = await refreshAccessToken();
  if (refreshed?.access_token) return refreshed.access_token;

  clearSession();
  throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
}

export function logout(): void {
  clearSession();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDeviceCode(clientId: string): Promise<{
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
}> {
  const body = new URLSearchParams({
    client_id: clientId,
    scopes: scopesParam(),
  });

  const res = await fetch(TWITCH_DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw formatTokenError(res.status, text);
  }

  return (await res.json()) as {
    device_code: string;
    expires_in: number;
    interval: number;
    user_code: string;
    verification_uri: string;
  };
}

async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  intervalSec: number,
  expiresInSec: number
): Promise<AuthTokens> {
  let intervalMs = Math.max(intervalSec, 1) * 1000;
  const deadline = Date.now() + expiresInSec * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const body = new URLSearchParams({
      client_id: clientId,
      scopes: scopesParam(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    const res = await fetch(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON */
    }

    if (res.ok && typeof json.access_token === 'string') {
      return parseTokenResponse(
        json as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string[];
          token_type?: string;
        }
      );
    }

    const message = String(json.message || json.error || text || '').toLowerCase();

    if (message.includes('authorization_pending')) {
      continue;
    }
    if (message.includes('slow_down')) {
      intervalMs += 1000;
      continue;
    }
    if (message.includes('expired_token') || message.includes('expired')) {
      throw new Error('Device-Code abgelaufen. Bitte erneut anmelden.');
    }
    if (message.includes('access_denied')) {
      throw new Error('Anmeldung abgelehnt. Bitte erneut versuchen.');
    }
    if (message.includes('invalid device code')) {
      throw new Error('Ungültiger Device-Code. Bitte erneut anmelden.');
    }

    throw formatTokenError(res.status, text);
  }

  throw new Error('Device-Code-Timeout. Bitte erneut anmelden.');
}

export async function loginWithDeviceCode(): Promise<{ user: TwitchUser; tokens: AuthTokens }> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'TWITCH_CLIENT_ID fehlt. Lege eine .env-Datei an (siehe .env.example) und trage deine Client ID ein.'
    );
  }

  const device = await requestDeviceCode(clientId);
  notifyDeviceCode(device.user_code, device.verification_uri);

  try {
    await shell.openExternal(device.verification_uri);
  } catch (err) {
    throw new Error(
      `Browser konnte nicht geöffnet werden. Öffne manuell: ${device.verification_uri} und gib den Code ${device.user_code} ein. (${err})`
    );
  }

  const tokens = await pollDeviceToken(
    clientId,
    device.device_code,
    device.interval || 5,
    device.expires_in || 1800
  );
  setTokens(tokens);
  const user = await fetchCurrentUser(tokens.access_token, clientId);
  setUser(user);
  return { user, tokens };
}

function listenForCode(expectedState: string, authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (callbackServer) {
      try {
        callbackServer.close();
      } catch {
        /* ignore */
      }
      callbackServer = null;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('OAuth-Timeout (5 Min.). Bitte erneut versuchen.')));
    }, 5 * 60 * 1000);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (callbackServer) {
        callbackServer.close();
        callbackServer = null;
      }
      fn();
    };

    callbackServer = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          const desc = url.searchParams.get('error_description') || error;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('Anmeldung fehlgeschlagen', desc, false));
          finish(() => reject(new Error(desc)));
          return;
        }

        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        if (!code || returnedState !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('Ungültige Antwort', 'State oder Code ungültig.', false));
          finish(() => reject(new Error('Ungültiger OAuth-Callback.')));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          htmlPage(
            'Anmeldung erfolgreich',
            'Du kannst dieses Fenster schließen und zur App zurückkehren.',
            true
          )
        );
        finish(() => resolve(code));
      } catch (err) {
        finish(() => reject(err));
      }
    });

    callbackServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        finish(() =>
          reject(
            new Error(
              `Port ${OAUTH_CALLBACK_PORT} ist belegt. Bitte anderen Prozess beenden oder Redirect-Port anpassen.`
            )
          )
        );
      } else {
        finish(() => reject(err));
      }
    });

    callbackServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl).catch((err) => {
        finish(() => reject(err));
      });
    });
  });
}

export async function loginWithPkce(): Promise<{ user: TwitchUser; tokens: AuthTokens }> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'TWITCH_CLIENT_ID fehlt. Lege eine .env-Datei an (siehe .env.example) und trage deine Client ID ein.'
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();
  const redirectUri = getRedirectUri();

  const authUrl = new URL(TWITCH_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopesParam());
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const code = await listenForCode(state, authUrl.toString());
  const tokens = await exchangeCode(code, verifier, redirectUri, clientId);
  setTokens(tokens);
  const user = await fetchCurrentUser(tokens.access_token, clientId);
  setUser(user);
  return { user, tokens };
}

/** Chooses Device Code (public) or Authorization Code + PKCE (confidential). */
export async function login(): Promise<{ user: TwitchUser; tokens: AuthTokens }> {
  if (getAuthMode() === 'device') {
    return loginWithDeviceCode();
  }
  return loginWithPkce();
}
