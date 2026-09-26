import path from 'path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
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
} from './helix';
import { getTokens, getUser, setUser, getStorePath } from './store';
import type { ChannelWindowData, ChatSettings } from '../shared/types';

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

function preloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

function rendererHtml(...parts: string[]): string {
  return path.join(__dirname, '..', 'renderer', ...parts);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0e0e10',
    title: 'Twitch Mod App',
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
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0e0e10',
    title: `Mod · ${data.broadcasterName}`,
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

function registerIpc(): void {
  ipcMain.handle('auth:get-status', async () => {
    const clientId = getClientId();
    const tokens = getTokens();
    const user = getUser();
    let valid = false;
    if (tokens?.access_token && clientId) {
      const v = await validateToken(tokens.access_token);
      valid = !!v;
      if (valid && !user) {
        try {
          const u = await fetchCurrentUser(tokens.access_token, clientId);
          setUser(u);
          return { loggedIn: true, user: u, clientIdConfigured: !!clientId, storePath: getStorePath(), authMode: getAuthMode() };
        } catch {
          /* ignore */
        }
      }
    }
    return {
      loggedIn: valid && !!user,
      user: valid ? getUser() : null,
      clientIdConfigured: !!clientId,
      storePath: getStorePath(),
      redirectUri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3847/callback',
      authMode: getAuthMode(),
    };
  });

  ipcMain.handle('auth:login', async () => {
    const result = await login();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(rendererHtml('channels', 'index.html'));
    }
    return { user: result.user };
  });

  ipcMain.handle('auth:logout', async () => {
    logout();
    for (const win of channelWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    channelWindows.clear();
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
