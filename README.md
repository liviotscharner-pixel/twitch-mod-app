# Twitch Mod App

Desktop-App für Twitch-Moderatoren (Electron + TypeScript). Nach dem Login siehst du alle Kanäle, auf denen du Moderator bist, und kannst jeden Kanal in einem **eigenen Fenster** mit Live-Chat und Mod-Aktionen öffnen.

## Features

- **Twitch-OAuth** (Authorization Code + PKCE), Callback über `http://localhost:3847/callback`
- Liste der **moderierten Kanäle** (Helix `Get Moderated Channels`)
- **Mehrere Kanal-Fenster** (je ein Electron-`BrowserWindow`)
- Live-Chat über Twitch IRC WebSocket (`wss://irc-ws.chat.twitch.tv:443`)
- **Timeout** (grün): 10s, 1m, 10m, 1h + Custom
- **Ban** (rot), Unban/Untimeout
- Nachricht löschen, Chat leeren
- Chat-Modi: Slow-Mode, Emote-only, Followers-only, Subs-only, Unique Chat
- Token-Speicherung lokal mit **electron-store** (Secrets bleiben auf dem Rechner)

## Voraussetzungen

- Node.js 18+ (empfohlen: 20+)
- npm
- Eine Twitch-App in der [Twitch Developer Console](https://dev.twitch.tv/console/apps)

## Twitch Developer Console einrichten

1. Unter [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) eine neue Anwendung erstellen.
2. **OAuth Redirect URLs** genau so eintragen:

   ```
   http://localhost:3847/callback
   ```

3. **Client-Typ**
   - **Public** (empfohlen für Desktop + PKCE): kein Client Secret nötig.
   - **Confidential**: optional `TWITCH_CLIENT_SECRET` in `.env` setzen (App unterstützt beides).
4. Die **Client ID** kopieren.

## Installation

```bash
cd twitch-mod-app
cp .env.example .env
# .env bearbeiten: TWITCH_CLIENT_ID=...
npm install
npm start
```

Entwicklung mit Logging:

```bash
npm run dev
```

Nur TypeScript bauen:

```bash
npm run build
```

## Umgebungsvariablen (`.env`)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `TWITCH_CLIENT_ID` | ja | Client ID aus der Developer Console |
| `TWITCH_REDIRECT_URI` | nein | Standard: `http://localhost:3847/callback` |
| `TWITCH_CLIENT_SECRET` | nein | Nur bei Confidential Client |

## OAuth-Scopes

Die App fordert folgende Scopes an:

| Scope | Zweck |
|-------|--------|
| `user:read:email` | Basis-Userinfo |
| `user:read:moderated_channels` | Moderierte Kanäle auflisten |
| `moderator:manage:banned_users` | Timeout, Ban, Unban |
| `moderator:manage:chat_messages` | Nachricht löschen / Chat leeren |
| `moderator:manage:chat_settings` | Chat-Modi ändern |
| `moderator:read:chat_settings` | Chat-Einstellungen lesen |
| `chat:read` | IRC Chat lesen |
| `chat:edit` | IRC Chat schreiben |

## Sicherheit / Token-Speicherung

Access- und Refresh-Token werden lokal mit **electron-store** (leichte Verschlüsselung) gespeichert. Secrets verlassen den Rechner nicht über diese App hinaus (außer zu den offiziellen Twitch-APIs). Lege **keine** `.env` mit Secrets ins öffentliche Repo – `.env` ist in `.gitignore`.

Speicherort der Config (ungefähr):

- Linux: `~/.config/twitch-mod-app/` (electron-store Pfad je nach Electron-App-Name)
- macOS: `~/Library/Application Support/twitch-mod-app/`
- Windows: `%APPDATA%/twitch-mod-app/`

## Bedienung

1. App starten → **Mit Twitch anmelden** (Browser öffnet sich).
2. Nach erfolgreichem Login erscheint die Liste der moderierten Kanäle.
3. **Kanal öffnen** → eigenes Fenster mit Chat und Mod-Panel.
4. Chat-User anklicken = Mod-Ziel; Nachricht anklicken = für „Nachricht löschen“.
5. Timeout = grüne Buttons, Ban = roter Button.

## Helix-Endpunkte (Auszug)

- `GET /helix/moderation/channels` – moderierte Kanäle
- `POST /helix/moderation/bans` – Ban / Timeout (`duration`)
- `DELETE /helix/moderation/bans` – Unban / Untimeout
- `DELETE /helix/moderation/chat` – Nachricht löschen / Chat leeren
- `GET` / `PATCH /helix/chat/settings` – Chat-Modi

## Projektstruktur

```
src/
  main/          Electron Main (OAuth, Helix, Fenster)
  preload/       contextBridge / IPC
  renderer/      Login, Kanalliste, Kanal-Fenster (HTML/CSS/JS)
  shared/        Typen & Konstanten
```

## Lizenz

MIT
