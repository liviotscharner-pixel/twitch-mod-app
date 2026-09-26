# Twitch Mod App

Desktop-App für Twitch-Moderatoren (Electron + TypeScript). Nach dem Login siehst du alle Kanäle, auf denen du Moderator bist, und kannst jeden Kanal in einem **eigenen Fenster** mit Live-Chat und Mod-Aktionen öffnen.

## Features

- **Twitch-OAuth** in zwei Modi:
  - **Public** (kein Secret): **Device Code Grant Flow**
  - **Confidential** (mit Secret): Authorization Code + PKCE, Callback `http://localhost:3847/callback`
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
2. **Client-Typ** wählen:
   - **Public / Öffentlich** (empfohlen für Desktop): **kein** Client Secret. Die App startet den **Device-Code-Flow** (Browser öffnet sich, Code eingeben / freigeben). Redirect-URI ist dafür nicht nötig.
   - **Confidential**: Client Secret erzeugen und als `TWITCH_CLIENT_SECRET` in `.env` setzen. Dann nutzt die App Authorization Code + PKCE. Redirect URI genau so eintragen:

     ```
     http://localhost:3847/callback
     ```

3. Die **Client ID** kopieren.

> Twitch verlangt für den Authorization-Code-Grant ein `client_secret`. Öffentliche Apps ohne Secret erhalten sonst `Invalid client credentials` – deshalb schaltet diese App ohne Secret automatisch auf Device Code um.

## Installation

```bash
cd twitch-mod-app
cp .env.example .env
# .env bearbeiten: TWITCH_CLIENT_ID=...
# Optional nur bei Confidential: TWITCH_CLIENT_SECRET=...
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
| `TWITCH_REDIRECT_URI` | nein | Standard: `http://localhost:3847/callback` (nur PKCE) |
| `TWITCH_CLIENT_SECRET` | nein | Wenn gesetzt → Confidential/PKCE; wenn leer → Device Code |

## Anmeldung

### Public (kein Secret) – Device Code

1. **Mit Twitch anmelden** klicken.
2. Die App öffnet `twitch.tv/activate` im System-Browser und zeigt den **User-Code**.
3. Bei Twitch einloggen und freigeben; die App pollt im Hintergrund bis zum Token.
4. Danach erscheint die Liste der moderierten Kanäle.

### Confidential (mit Secret) – PKCE

1. **Mit Twitch anmelden** klicken.
2. Browser öffnet die Twitch-Authorize-Seite; nach Freigabe landet der Callback auf `localhost:3847`.
3. Fenster schließen und zur App zurückkehren.

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

1. App starten → **Mit Twitch anmelden**.
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
