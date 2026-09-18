import http from 'http';
import { URL } from 'url';
import { shell } from 'electron';
import {
  OAUTH_CALLBACK_PORT,
  OAUTH_REDIRECT_URI,
  TWITCH_AUTH_URL,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
} from '../shared/constants';
import { OAUTH_SCOPES, type AuthTokens, type TwitchUser } from '../shared/types';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { getTokens, setTokens, setUser, clearSession } from './store';
import { helixGet } from './helix';

let callbackServer: http.Server | null = null;

export function getClientId(): string {
  return (process.env.TWITCH_CLIENT_ID || '').trim();
}

export function getRedirectUri(): string {
  return (process.env.TWITCH_REDIRECT_URI || OAUTH_REDIRECT_URI).trim();
}

export function getClientSecret(): string | undefined {
  const s = (process.env.TWITCH_CLIENT_SECRET || '').trim();
  return s || undefined;
}

function htmlPage(title: string, message: string, ok: boolean): string {
  const color = ok ? '#9147ff' : '#eb0400';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Inter,Segoe UI,sans-serif;background:#0e0e10;color:#efeff1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#18181b;padding:2rem 2.5rem;border-radius:12px;border:1px solid #2a2a2d;max-width:420px;text-align:center}
h1{color:${color};font-size:1.25rem;margin:0 0 .75rem}p{margin:0;opacity:.9;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
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
    throw new Error(`Token-Austausch fehlgeschlagen (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string[];
    token_type?: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scopes: data.scope,
    token_type: data.token_type,
  };
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
  authUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));
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
