import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain, nativeImage, session } from 'electron';
import dotenv from 'dotenv';
import {
  login,
  logout,
  ensureValidToken,
  getClientId,
  getAuthMode,
  validateToken,
  fetchCurrentUser,
} from './auth';
import {
  getModeratedChannels,
  withOwnChannel,
  banOrTimeoutUser,
  unbanUser,
  deleteChatMessage,
  clearChat,
  getChatSettings,
  updateChatSettings,
  resolveUserId,
  getChatters,
  tryGetModeratorLogins,
  tryGetVipLogins,
  isMissingScopeError,
} from './helix';
import { getChannelVipLogins, getModeratorLoginsAmong } from './gql';
import { getTokens, getUser, setUser, getStorePath } from './store';
import { getHighlightWords, setHighlightWords } from './highlights';
import type {
  ChannelWindowData,
  ChatMessage,
  ChatSettings,
  MemberListResult,
  OpenUserWindowPayload,
  UserWindowData,
} from '../shared/types';
import { CHATTERS_SCOPE } from '../shared/types';

// Load .env from project root (cwd when npm start) and next to packaged app
function loadEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) break;
  }
  // Strip UTF-8 BOM / whitespace from credentials (Windows editors often add BOM)
  for (const key of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_REDIRECT_URI']) {
    const v = process.env[key];
    if (typeof v === 'string') {
      process.env[key] = v.replace(/^\uFEFF/, '').trim();
    }
  }
}
loadEnv();

let mainWindow: BrowserWindow | null = null;
const channelWindows = new Map<string, BrowserWindow>();
const userWindows = new Map<string, BrowserWindow>();
/** Bootstrap payload (incl. history) until the user window fetches it. */
const userWindowBootstraps = new Map<string, OpenUserWindowPayload>();

function userWindowKey(broadcasterId: string, userLogin: string): string {
  return `${broadcasterId}:${userLogin.toLowerCase()}`;
}

function preloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

function rendererHtml(...parts: string[]): string {
  return path.join(__dirname, '..', 'renderer', ...parts);
}

/** App icon: prefer .ico on Windows, else PNG from project build/. */
function appIconPath(): string {
  const root = path.join(__dirname, '..', '..');
  const ico = path.join(root, 'build', 'icon.ico');
  const png = path.join(root, 'build', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return png;
}

function windowIconOptions(): { icon?: string } {
  const icon = appIconPath();
  return fs.existsSync(icon) ? { icon } : {};
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#171411',
    title: 'Twitchy',
    ...windowIconOptions(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const user = getUser();
  const tokens = getTokens();
  if (user && tokens?.access_token) {
    mainWindow.loadFile(rendererHtml('channels', 'index.html'));
  } else {
    mainWindow.loadFile(rendererHtml('login', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openChannelWindow(data: ChannelWindowData): void {
  const key = data.broadcasterId;
  const existing = channelWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#171411',
    title: `Twitchy · ${data.broadcasterName}`,
    ...windowIconOptions(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  channelWindows.set(key, win);
  win.loadFile(rendererHtml('channel', 'index.html'), {
    query: {
      broadcasterId: data.broadcasterId,
      broadcasterLogin: data.broadcasterLogin,
      broadcasterName: data.broadcasterName,
      moderatorUserId: data.moderatorUserId,
      moderatorLogin: data.moderatorLogin,
    },
  });

  win.on('closed', () => {
    channelWindows.delete(key);
  });
}

function openUserWindow(payload: OpenUserWindowPayload): void {
  const login = (payload.userLogin || '').toLowerCase();
  if (!login) return;

  const key = userWindowKey(payload.broadcasterId, login);
  const existing = userWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    // Refresh history bootstrap and notify live window
    userWindowBootstraps.set(key, { ...payload, userLogin: login });
    existing.webContents.send('user:history-refresh', payload.history || []);
    existing.focus();
    return;
  }

  const data: UserWindowData = {
    broadcasterId: payload.broadcasterId,
    broadcasterLogin: payload.broadcasterLogin,
    broadcasterName: payload.broadcasterName,
    moderatorUserId: payload.moderatorUserId,
    moderatorLogin: payload.moderatorLogin,
    userLogin: login,
    userId: payload.userId,
    displayName: payload.displayName || login,
  };

  userWindowBootstraps.set(key, { ...payload, userLogin: login });

  const win = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 400,
    minHeight: 480,
    backgroundColor: '#171411',
    title: `Twitchy · ${data.displayName} · #${data.broadcasterLogin}`,
    ...windowIconOptions(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  userWindows.set(key, win);
  win.loadFile(rendererHtml('user', 'index.html'), {
    query: {
      broadcasterId: data.broadcasterId,
      broadcasterLogin: data.broadcasterLogin,
      broadcasterName: data.broadcasterName,
      moderatorUserId: data.moderatorUserId,
      moderatorLogin: data.moderatorLogin,
      userLogin: data.userLogin,
      userId: data.userId || '',
      displayName: data.displayName || data.userLogin,
      windowKey: key,
    },
  });

  win.on('closed', () => {
    userWindows.delete(key);
    userWindowBootstraps.delete(key);
  });
}

function forwardChatToUserWindows(broadcasterId: string, message: ChatMessage): void {
  const login = (message.user || '').toLowerCase();
  if (!login) return;
  const key = userWindowKey(broadcasterId, login);
  const win = userWindows.get(key);
  if (win && !win.isDestroyed()) {
    win.webContents.send('user:chat-message', message);
  }
}


function broadcastHighlightWords(words: string[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('highlights:changed', words);
  }
}

function registerIpc(): void {
  ipcMain.handle('highlights:get', async () => getHighlightWords());

  ipcMain.handle('highlights:set', async (_e, words: unknown) => {
    const list = setHighlightWords(words);
    broadcastHighlightWords(list);
    return list;
  });

  ipcMain.handle('auth:get-status', async () => {
    const clientId = getClientId();
    const tokens = getTokens();
    const user = getUser();
    let valid = false;
    let v: Awaited<ReturnType<typeof validateToken>> = null;
    if (tokens?.access_token && clientId) {
      v = await validateToken(tokens.access_token);
      valid = !!v;
      if (valid && !user) {
        try {
          const u = await fetchCurrentUser(tokens.access_token, clientId);
          setUser(u);
          return {
            loggedIn: true,
            user: u,
            clientIdConfigured: !!clientId,
            storePath: getStorePath(),
            authMode: getAuthMode(),
            scopes: v?.scopes || [],
            needsChattersScope: !(v?.scopes || []).includes(CHATTERS_SCOPE),
          };
        } catch {
          /* ignore */
        }
      }
    }
    const scopes = valid && v ? v.scopes || [] : [];
    return {
      loggedIn: valid && !!user,
      user: valid ? getUser() : null,
      clientIdConfigured: !!clientId,
      storePath: getStorePath(),
      redirectUri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3847/callback',
      authMode: getAuthMode(),
      scopes,
      needsChattersScope: !scopes.includes(CHATTERS_SCOPE),
    };
  });

  ipcMain.handle('auth:login', async () => {
    const result = await login();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(rendererHtml('channels', 'index.html'));
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('auth:session-updated');
    }
    return { user: result.user };
  });

  ipcMain.handle('auth:relogin', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(rendererHtml('login', 'index.html'), {
        query: { autologin: '1' },
      });
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('auth:logout', async () => {
    logout();
    for (const win of channelWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    channelWindows.clear();
    for (const win of userWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    userWindows.clear();
    userWindowBootstraps.clear();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(rendererHtml('login', 'index.html'));
    }
    return { ok: true };
  });

  ipcMain.handle('channels:list', async () => {
    const token = await ensureValidToken();
    const clientId = getClientId();
    const user = getUser();
    if (!user) throw new Error('Nicht angemeldet.');
    const moderated = await getModeratedChannels(token, clientId, user.id);
    const channels = withOwnChannel(user, moderated);
    return { channels, user };
  });

  ipcMain.handle('channels:open', async (_e, data: ChannelWindowData) => {
    openChannelWindow(data);
    return { ok: true };
  });

  ipcMain.handle(
    'members:list',
    async (
      _e,
      payload: { broadcasterId: string; moderatorId: string; broadcasterLogin?: string }
    ): Promise<MemberListResult> => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      const tokens = getTokens();
      const validated = await validateToken(token);
      const scopes = validated?.scopes || tokens?.scopes || [];

      if (!scopes.includes(CHATTERS_SCOPE)) {
        return {
          ok: false,
          needsRelogin: true,
          message: 'Für die Memberliste bitte neu anmelden',
        };
      }

      try {
        const [chattersRes, modsRes, vipsRes] = await Promise.all([
          getChatters(token, clientId, payload.broadcasterId, payload.moderatorId),
          tryGetModeratorLogins(token, clientId, payload.broadcasterId),
          tryGetVipLogins(token, clientId, payload.broadcasterId),
        ]);

        const modSet = new Set(modsRes.logins || []);
        const vipSet = new Set(vipsRes.logins || []);

        // Helix mods/VIPs often only work with the broadcaster token.
        // Merge public GQL sources so a moderator still gets complete groups.
        const chatterLogins = (chattersRes.chatters || []).map((c) => c.userLogin);
        const gqlVipPromise = payload.broadcasterLogin
          ? getChannelVipLogins(payload.broadcasterLogin)
          : Promise.resolve([] as string[]);
        try {
          const [gqlVips, gqlMods] = await Promise.all([
            gqlVipPromise,
            getModeratorLoginsAmong(payload.broadcasterId, chatterLogins),
          ]);
          for (const login of gqlVips) vipSet.add(login);
          for (const login of gqlMods) modSet.add(login);
        } catch (err) {
          console.warn('GQL Rollenquelle fehlgeschlagen:', err);
        }

        return {
          ok: true,
          total: chattersRes.total,
          chatters: chattersRes.chatters,
          moderatorLogins: [...modSet],
          vipLogins: [...vipSet],
          modsFromApi: modsRes.fromApi || modSet.size > 0,
          vipsFromApi: vipsRes.fromApi || vipSet.size > 0,
        };
      } catch (err) {
        if (isMissingScopeError(err)) {
          return {
            ok: false,
            needsRelogin: true,
            message: 'Für die Memberliste bitte neu anmelden',
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, message: `Memberliste: ${message}` };
      }
    }
  );

  ipcMain.handle('users:open', async (_e, payload: OpenUserWindowPayload) => {
    openUserWindow(payload);
    return { ok: true };
  });

  ipcMain.handle('users:get-bootstrap', async (_e, windowKey: string) => {
    return userWindowBootstraps.get(windowKey) || null;
  });

  ipcMain.handle(
    'chat:forward-message',
    async (_e, payload: { broadcasterId: string; message: ChatMessage }) => {
      if (payload?.broadcasterId && payload.message) {
        forwardChatToUserWindows(payload.broadcasterId, payload.message);
      }
      return { ok: true };
    }
  );

  ipcMain.handle('session:get-chat-credentials', async () => {
    const token = await ensureValidToken();
    const user = getUser();
    if (!user) throw new Error('Nicht angemeldet.');
    return {
      login: user.login,
      accessToken: token,
      clientId: getClientId(),
    };
  });

  ipcMain.handle(
    'mod:timeout',
    async (
      _e,
      payload: {
        broadcasterId: string;
        moderatorId: string;
        username: string;
        duration: number;
        reason?: string;
      }
    ) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      const userId = await resolveUserId(token, clientId, payload.username);
      await banOrTimeoutUser(
        token,
        clientId,
        payload.broadcasterId,
        payload.moderatorId,
        userId,
        payload.duration,
        payload.reason
      );
      return { ok: true, userId };
    }
  );

  ipcMain.handle(
    'mod:ban',
    async (
      _e,
      payload: {
        broadcasterId: string;
        moderatorId: string;
        username: string;
        reason?: string;
      }
    ) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      const userId = await resolveUserId(token, clientId, payload.username);
      await banOrTimeoutUser(
        token,
        clientId,
        payload.broadcasterId,
        payload.moderatorId,
        userId,
        undefined,
        payload.reason
      );
      return { ok: true, userId };
    }
  );

  ipcMain.handle(
    'mod:unban',
    async (
      _e,
      payload: { broadcasterId: string; moderatorId: string; username: string }
    ) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      const userId = await resolveUserId(token, clientId, payload.username);
      await unbanUser(token, clientId, payload.broadcasterId, payload.moderatorId, userId);
      return { ok: true, userId };
    }
  );

  ipcMain.handle(
    'mod:delete-message',
    async (
      _e,
      payload: { broadcasterId: string; moderatorId: string; messageId: string }
    ) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      await deleteChatMessage(
        token,
        clientId,
        payload.broadcasterId,
        payload.moderatorId,
        payload.messageId
      );
      return { ok: true };
    }
  );

  ipcMain.handle(
    'mod:clear-chat',
    async (_e, payload: { broadcasterId: string; moderatorId: string }) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      await clearChat(token, clientId, payload.broadcasterId, payload.moderatorId);
      return { ok: true };
    }
  );

  ipcMain.handle(
    'mod:get-chat-settings',
    async (_e, payload: { broadcasterId: string; moderatorId: string }) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      return getChatSettings(token, clientId, payload.broadcasterId, payload.moderatorId);
    }
  );

  ipcMain.handle(
    'mod:update-chat-settings',
    async (
      _e,
      payload: {
        broadcasterId: string;
        moderatorId: string;
        settings: Partial<ChatSettings>;
      }
    ) => {
      const token = await ensureValidToken();
      const clientId = getClientId();
      return updateChatSettings(
        token,
        clientId,
        payload.broadcasterId,
        payload.moderatorId,
        payload.settings
      );
    }
  );
}

// Stabilität auf Linux/headless (kein GPU nötig für Mod-UI)
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  // Taskbar / dock identity + icon (Windows AppUserModelId groups the shortcut)
  app.setAppUserModelId('com.liviotscharner.twitchy');
  const iconPath = appIconPath();
  if (fs.existsSync(iconPath)) {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  // Allow Twitch OAuth / Helix / IRC
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });

  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
