import { contextBridge, ipcRenderer } from 'electron';
import type { ChannelWindowData, ChatSettings, ModeratedChannel, TwitchUser } from '../shared/types';

export interface TwitchModApi {
  getAuthStatus: () => Promise<{
    loggedIn: boolean;
    user: TwitchUser | null;
    clientIdConfigured: boolean;
    storePath?: string;
    redirectUri?: string;
    authMode?: 'device' | 'pkce';
  }>;
  login: () => Promise<{ user: TwitchUser }>;
  onDeviceCode: (
    callback: (payload: { userCode: string; verificationUri: string }) => void
  ) => () => void;
  logout: () => Promise<{ ok: boolean }>;
  listChannels: () => Promise<{ channels: ModeratedChannel[]; user: TwitchUser }>;
  openChannel: (data: ChannelWindowData) => Promise<{ ok: boolean }>;
  getChatCredentials: () => Promise<{ login: string; accessToken: string; clientId: string }>;
  timeout: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
    duration: number;
    reason?: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  ban: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
    reason?: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  unban: (payload: {
    broadcasterId: string;
    moderatorId: string;
    username: string;
  }) => Promise<{ ok: boolean; userId: string }>;
  deleteMessage: (payload: {
    broadcasterId: string;
    moderatorId: string;
    messageId: string;
  }) => Promise<{ ok: boolean }>;
  clearChat: (payload: {
    broadcasterId: string;
    moderatorId: string;
  }) => Promise<{ ok: boolean }>;
  getChatSettings: (payload: {
    broadcasterId: string;
    moderatorId: string;
  }) => Promise<ChatSettings>;
  updateChatSettings: (payload: {
    broadcasterId: string;
    moderatorId: string;
    settings: Partial<ChatSettings>;
  }) => Promise<ChatSettings>;
}

const api: TwitchModApi = {
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  login: () => ipcRenderer.invoke('auth:login'),
  onDeviceCode: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { userCode: string; verificationUri: string }
    ) => callback(payload);
    ipcRenderer.on('auth:device-code', handler);
    return () => {
      ipcRenderer.removeListener('auth:device-code', handler);
    };
  },
  logout: () => ipcRenderer.invoke('auth:logout'),
  listChannels: () => ipcRenderer.invoke('channels:list'),
  openChannel: (data) => ipcRenderer.invoke('channels:open', data),
  getChatCredentials: () => ipcRenderer.invoke('session:get-chat-credentials'),
  timeout: (payload) => ipcRenderer.invoke('mod:timeout', payload),
  ban: (payload) => ipcRenderer.invoke('mod:ban', payload),
  unban: (payload) => ipcRenderer.invoke('mod:unban', payload),
  deleteMessage: (payload) => ipcRenderer.invoke('mod:delete-message', payload),
  clearChat: (payload) => ipcRenderer.invoke('mod:clear-chat', payload),
  getChatSettings: (payload) => ipcRenderer.invoke('mod:get-chat-settings', payload),
  updateChatSettings: (payload) => ipcRenderer.invoke('mod:update-chat-settings', payload),
};

contextBridge.exposeInMainWorld('twitchMod', api);
