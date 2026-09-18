import Store from 'electron-store';
import type { AuthTokens, TwitchUser } from '../shared/types';

interface StoreSchema {
  tokens: AuthTokens | null;
  user: TwitchUser | null;
  clientId: string;
}

const store = new Store<StoreSchema>({
  name: 'twitch-mod-config',
  encryptionKey: 'twitch-mod-app-local-v1',
  defaults: {
    tokens: null,
    user: null,
    clientId: '',
  },
});

export function getTokens(): AuthTokens | null {
  return store.get('tokens');
}

export function setTokens(tokens: AuthTokens | null): void {
  store.set('tokens', tokens);
}

export function getUser(): TwitchUser | null {
  return store.get('user');
}

export function setUser(user: TwitchUser | null): void {
  store.set('user', user);
}

export function getStoredClientId(): string {
  return store.get('clientId') || '';
}

export function setStoredClientId(id: string): void {
  store.set('clientId', id);
}

export function clearSession(): void {
  store.set('tokens', null);
  store.set('user', null);
}

export function getStorePath(): string {
  return store.path;
}
