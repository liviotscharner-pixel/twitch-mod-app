import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChannelWindowData,
  ChatMessage,
  ChatSettings,
  MemberListResult,
  ModeratedChannel,
  OpenUserWindowPayload,
  TwitchUser,
} from '../shared/types';

export interface TwitchModApi {
  getAuthStatus: () => Promise<{
    loggedIn: boolean;
    user: TwitchUser | null;
    clientIdConfigured: boolean;
    storePath?: string;
    redirectUri?: string;
    authMode?: 'device' | 'pkce';
    scopes?: string[];
    needsChattersScope?: boolean;
  }>;
  login: () => Promise<{ user: TwitchUser }>;
  relogin: () => Promise<{ ok: boolean }>;
  onSessionUpdated: (callback: () => void) => () => void;
  onDeviceCode: (
    callback: (payload: { userCode: string; verificationUri: string }) => void
  ) => () => void;
  logout: () => Promise<{ ok: boolean }>;
  listChannels: () => Promise<{ channels: ModeratedChannel[]; user: TwitchUser }>;
  openChannel: (data: ChannelWindowData) => Promise<{ ok: boolean }>;
  openUserWindow: (payload: OpenUserWindowPayload) => Promise<{ ok: boolean }>;
  getUserBootstrap: (windowKey: string) => Promise<OpenUserWindowPayload | null>;
  forwardChatMessage: (payload: {
    broadcasterId: string;
    message: ChatMessage;
  }) => Promise<{ ok: boolean }>;
  onUserChatMessage: (callback: (message: ChatMessage) => void) => () => void;
  onUserHistoryRefresh: (callback: (history: ChatMessage[]) => void) => () => void;
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
  getHighlightWords: () => Promise<string[]>;
  setHighlightWords: (words: string[]) => Promise<string[]>;
  onHighlightWordsChanged: (callback: (words: string[]) => void) => () => void;
  getMemberList: (payload: {
    broadcasterId: string;
    moderatorId: string;
  }) => Promise<MemberListResult>;
}

const api: TwitchModApi = {
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  login: () => ipcRenderer.invoke('auth:login'),
  relogin: () => ipcRenderer.invoke('auth:relogin'),
  onSessionUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('auth:session-updated', handler);
    return () => {
      ipcRenderer.removeListener('auth:session-updated', handler);
    };
  },
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
  openUserWindow: (payload) => ipcRenderer.invoke('users:open', payload),
  getUserBootstrap: (windowKey) => ipcRenderer.invoke('users:get-bootstrap', windowKey),
  forwardChatMessage: (payload) => ipcRenderer.invoke('chat:forward-message', payload),
  onUserChatMessage: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: ChatMessage) => callback(message);
    ipcRenderer.on('user:chat-message', handler);
    return () => {
      ipcRenderer.removeListener('user:chat-message', handler);
    };
  },
  onUserHistoryRefresh: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, history: ChatMessage[]) =>
      callback(history);
    ipcRenderer.on('user:history-refresh', handler);
    return () => {
      ipcRenderer.removeListener('user:history-refresh', handler);
    };
  },
  getChatCredentials: () => ipcRenderer.invoke('session:get-chat-credentials'),
  timeout: (payload) => ipcRenderer.invoke('mod:timeout', payload),
  ban: (payload) => ipcRenderer.invoke('mod:ban', payload),
  unban: (payload) => ipcRenderer.invoke('mod:unban', payload),
  deleteMessage: (payload) => ipcRenderer.invoke('mod:delete-message', payload),
  clearChat: (payload) => ipcRenderer.invoke('mod:clear-chat', payload),
  getChatSettings: (payload) => ipcRenderer.invoke('mod:get-chat-settings', payload),
  updateChatSettings: (payload) => ipcRenderer.invoke('mod:update-chat-settings', payload),
  getHighlightWords: () => ipcRenderer.invoke('highlights:get'),
  setHighlightWords: (words) => ipcRenderer.invoke('highlights:set', words),
  onHighlightWordsChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, words: string[]) => callback(words);
    ipcRenderer.on('highlights:changed', handler);
    return () => {
      ipcRenderer.removeListener('highlights:changed', handler);
    };
  },
  getMemberList: (payload) => ipcRenderer.invoke('members:list', payload),
};

contextBridge.exposeInMainWorld('twitchMod', api);
