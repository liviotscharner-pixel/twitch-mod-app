/**
 * Minimal Twitch IRC over WebSocket (wss://irc-ws.chat.twitch.tv:443)
 */
(function (global) {
  const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

  function parseTags(raw) {
    const tags = {};
    if (!raw) return tags;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) tags[part] = true;
      else tags[part.slice(0, eq)] = part.slice(eq + 1);
    }
    return tags;
  }

  /** @returns {string[]} badge names, e.g. ["broadcaster","subscriber"] */
  function parseBadgeList(raw) {
    if (!raw || raw === true) return [];
    return String(raw)
      .split(',')
      .map((part) => part.split('/')[0].trim().toLowerCase())
      .filter(Boolean);
  }

  function parseIrcLine(line) {
    let rest = line;
    let tags = {};
    if (rest.startsWith('@')) {
      const sp = rest.indexOf(' ');
      tags = parseTags(rest.slice(1, sp));
      rest = rest.slice(sp + 1);
    }
    let prefix = '';
    if (rest.startsWith(':')) {
      const sp = rest.indexOf(' ');
      prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }
    const sp = rest.indexOf(' ');
    const command = sp === -1 ? rest : rest.slice(0, sp);
    rest = sp === -1 ? '' : rest.slice(sp + 1);
    let trailing = '';
    const trailIdx = rest.indexOf(' :');
    let params = [];
    if (trailIdx !== -1) {
      params = rest.slice(0, trailIdx).split(' ').filter(Boolean);
      trailing = rest.slice(trailIdx + 2);
    } else if (rest.startsWith(':')) {
      trailing = rest.slice(1);
    } else {
      params = rest.split(' ').filter(Boolean);
    }
    return { tags, prefix, command, params, trailing };
  }

  class TwitchIrc {
    constructor() {
      this.ws = null;
      this.channel = null;
      this.login = null;
      this.onMessage = null;
      this.onSystem = null;
      this.onConnection = null;
      this._pingTimer = null;
    }

    connect({ login, accessToken, channelLogin }) {
      this.disconnect();
      this.login = login.toLowerCase();
      this.channel = channelLogin.toLowerCase().replace(/^#/, '');
      this.ws = new WebSocket(IRC_URL);

      this.ws.onopen = () => {
        this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        this.ws.send(`PASS oauth:${accessToken}`);
        this.ws.send(`NICK ${this.login}`);
        this.ws.send(`JOIN #${this.channel}`);
        if (this.onConnection) this.onConnection('ok', 'Verbunden');
        if (this.onSystem) this.onSystem(`Beigetreten #${this.channel}`);
      };

      this.ws.onmessage = (ev) => {
        const raw = String(ev.data || '');
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          this._handleLine(line);
        }
      };

      this.ws.onerror = () => {
        if (this.onConnection) this.onConnection('err', 'WebSocket-Fehler');
      };

      this.ws.onclose = () => {
        if (this.onConnection) this.onConnection('err', 'Getrennt');
        this._clearPing();
      };
    }

    _clearPing() {
      if (this._pingTimer) {
        clearInterval(this._pingTimer);
        this._pingTimer = null;
      }
    }

    _handleLine(line) {
      const msg = parseIrcLine(line);

      if (msg.command === 'PING') {
        this.ws.send(`PONG :${msg.trailing || msg.params[0] || ''}`);
        return;
      }

      if (msg.command === 'PRIVMSG') {
        const channel = (msg.params[0] || '').replace(/^#/, '');
        const nick = (msg.prefix.split('!')[0] || '').toLowerCase();
        const displayName = msg.tags['display-name'] || nick;
        const color = msg.tags.color || '#efeff1';
        const id = msg.tags.id || `${Date.now()}-${Math.random()}`;
        const userId = msg.tags['user-id'] || '';
        const isAction =
          msg.trailing.startsWith('\u0001ACTION ') && msg.trailing.endsWith('\u0001');
        let text = msg.trailing;
        if (isAction) text = text.slice(8, -1);

        const badges = parseBadgeList(msg.tags.badges);
        // Twitch also sets boolean-ish tags; keep them in the list for role detection
        if (msg.tags.mod === '1' && !badges.includes('moderator')) badges.push('moderator');
        if (msg.tags.subscriber === '1' && !badges.includes('subscriber')) badges.push('subscriber');
        if (msg.tags.vip === '1' && !badges.includes('vip')) badges.push('vip');

        if (this.onMessage) {
          this.onMessage({
            id,
            channel,
            user: nick,
            displayName,
            userId,
            message: text,
            color,
            badges,
            timestamp: Number(msg.tags['tmi-sent-ts']) || Date.now(),
            isAction,
          });
        }
        return;
      }

      if (msg.command === 'NOTICE' || msg.command === 'USERNOTICE') {
        if (this.onSystem) this.onSystem(msg.trailing || msg.command);
        return;
      }

      if (msg.command === 'CLEARCHAT') {
        const target = msg.trailing || '';
        if (this.onSystem) {
          this.onSystem(target ? `${target} wurde getimeoutet/gebannt` : 'Chat wurde geleert');
        }
        return;
      }

      if (msg.command === 'CLEARMSG') {
        if (this.onSystem) this.onSystem('Nachricht gelöscht');
        return;
      }

      if (msg.command === '001' || msg.command === '376' || msg.command === 'JOIN') {
        return;
      }

      if (msg.command === 'RECONNECT') {
        if (this.onSystem) this.onSystem('Server fordert Reconnect…');
      }
    }

    sendChat(text) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('IRC nicht verbunden');
      }
      const clean = String(text || '').trim();
      if (!clean) return;
      this.ws.send(`PRIVMSG #${this.channel} :${clean}`);
    }

    disconnect() {
      this._clearPing();
      if (this.ws) {
        try {
          this.ws.close();
        } catch (_) {
          /* ignore */
        }
        this.ws = null;
      }
    }
  }

  global.TwitchIrc = TwitchIrc;
})(window);
