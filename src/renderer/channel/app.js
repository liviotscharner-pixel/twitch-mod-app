(function () {
  const params = new URLSearchParams(window.location.search);
  const broadcasterId = params.get('broadcasterId') || '';
  const broadcasterLogin = params.get('broadcasterLogin') || '';
  const broadcasterName = params.get('broadcasterName') || broadcasterLogin;
  const moderatorId = params.get('moderatorUserId') || '';
  const moderatorLogin = params.get('moderatorLogin') || '';

  document.title = `Mod · ${broadcasterName}`;
  document.getElementById('channelTitle').textContent = broadcasterName;
  document.getElementById('channelMeta').textContent = `#${broadcasterLogin} · Mod: ${moderatorLogin}`;

  const chatLog = document.getElementById('chatLog');
  const connStatus = document.getElementById('connStatus');
  const targetUser = document.getElementById('targetUser');
  const reasonInput = document.getElementById('reason');
  const actionStatus = document.getElementById('actionStatus');
  const selectedMsgEl = document.getElementById('selectedMsg');
  const selectedMsgText = document.getElementById('selectedMsgText');

  let selectedMessageId = null;
  let chatSettings = null;
  const irc = new window.TwitchIrc();

  /** Ring buffer of chat messages seen in this channel session. */
  const MESSAGE_BUFFER_MAX = 1000;
  /** @type {Array<object>} */
  const messageBuffer = [];

  function pushToBuffer(msg) {
    messageBuffer.push(msg);
    if (messageBuffer.length > MESSAGE_BUFFER_MAX) {
      messageBuffer.splice(0, messageBuffer.length - MESSAGE_BUFFER_MAX);
    }
  }

  function historyForUser(userLogin) {
    const login = String(userLogin || '').toLowerCase();
    return messageBuffer.filter((m) => (m.user || '').toLowerCase() === login);
  }

  async function openUserWindowFor(msg) {
    const userLogin = (msg.user || '').toLowerCase();
    if (!userLogin) return;
    try {
      await window.twitchMod.openUserWindow({
        broadcasterId,
        broadcasterLogin,
        broadcasterName,
        moderatorUserId: moderatorId,
        moderatorLogin,
        userLogin,
        userId: msg.userId || '',
        displayName: msg.displayName || userLogin,
        history: historyForUser(userLogin),
      });
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  }

  function setConn(state, text) {
    connStatus.className = 'conn ' + (state === 'ok' ? 'ok' : state === 'err' ? 'err' : '');
    connStatus.textContent = text;
  }

  function showAction(ok, text) {
    actionStatus.hidden = false;
    actionStatus.className = 'action-status ' + (ok ? 'ok' : 'err');
    actionStatus.textContent = text;
  }

  /**
   * Role priority: Mod/Broadcaster > VIP > Sub > Normal
   * @returns {'mod'|'vip'|'sub'|'normal'}
   */
  function resolveChatRole(msg) {
    const badges = Array.isArray(msg.badges) ? msg.badges.map((b) => String(b).toLowerCase()) : [];
    const set = new Set(badges);
    const isBroadcaster =
      set.has('broadcaster') ||
      (msg.user && broadcasterLogin && msg.user.toLowerCase() === broadcasterLogin.toLowerCase());
    if (isBroadcaster || set.has('moderator') || set.has('mod')) return 'mod';
    if (set.has('vip')) return 'vip';
    if (set.has('subscriber') || set.has('founder')) return 'sub';
    return 'normal';
  }

  const ROLE_LABELS = {
    mod: 'Mod',
    vip: 'VIP',
    sub: 'Sub',
    normal: 'Chat',
  };

  function appendSystem(text) {
    const div = document.createElement('div');
    div.className = 'chat-line chat-block system';
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendMessage(msg) {
    const role = resolveChatRole(msg);
    msg.role = role;
    pushToBuffer(msg);

    if (typeof window.twitchMod.forwardChatMessage === 'function') {
      window.twitchMod.forwardChatMessage({ broadcasterId, message: msg }).catch(() => {});
    }

    const div = document.createElement('div');
    div.className = `chat-line chat-block role-${role}`;
    div.dataset.messageId = msg.id;
    div.dataset.user = msg.user;
    div.dataset.role = role;

    const time = new Date(msg.timestamp);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');

    const header = document.createElement('div');
    header.className = 'chat-block-header';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = `${hh}:${mm}`;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'role-badge';
    badgeSpan.textContent = ROLE_LABELS[role] || 'Chat';

    const userSpan = document.createElement('span');
    userSpan.className = 'user';
    userSpan.style.color = msg.color || '#efeff1';
    userSpan.textContent = msg.displayName;
    userSpan.title = 'Klick: als Ziel · Doppelklick: User-Fenster';
    userSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      targetUser.value = msg.user;
      showAction(true, `Ziel: ${msg.displayName}`);
    });
    userSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openUserWindowFor(msg);
    });

    header.appendChild(timeSpan);
    header.appendChild(badgeSpan);
    header.appendChild(userSpan);

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = (msg.isAction ? '* ' : '') + msg.message;

    div.appendChild(header);
    div.appendChild(body);

    div.addEventListener('click', () => {
      document.querySelectorAll('.chat-line.selected').forEach((el) => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedMessageId = msg.id;
      selectedMsgEl.hidden = false;
      selectedMsgText.textContent = `${msg.displayName}: ${msg.message}`;
      targetUser.value = msg.user;
    });

    div.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openUserWindowFor(msg);
    });

    chatLog.appendChild(div);
    while (chatLog.children.length > 500) {
      chatLog.removeChild(chatLog.firstChild);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  irc.onMessage = appendMessage;
  irc.onSystem = appendSystem;
  irc.onConnection = setConn;

  async function connectIrc() {
    try {
      setConn('', 'Verbinde…');
      const creds = await window.twitchMod.getChatCredentials();
      irc.connect({
        login: creds.login,
        accessToken: creds.accessToken,
        channelLogin: broadcasterLogin,
      });
    } catch (err) {
      setConn('err', 'Fehler');
      appendSystem(err.message || String(err));
    }
  }

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    try {
      irc.sendChat(text);
      appendMessage({
        id: `local-${Date.now()}`,
        channel: broadcasterLogin,
        user: moderatorLogin.toLowerCase(),
        displayName: moderatorLogin,
        message: text,
        color: '#9147ff',
        badges: ['moderator'],
        timestamp: Date.now(),
      });
      input.value = '';
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  document.getElementById('clearSelectedMsg').addEventListener('click', () => {
    selectedMessageId = null;
    selectedMsgEl.hidden = true;
    document.querySelectorAll('.chat-line.selected').forEach((el) => el.classList.remove('selected'));
  });

  function requireTarget() {
    const u = targetUser.value.trim().replace(/^@/, '');
    if (!u) {
      showAction(false, 'Bitte einen Benutzernamen wählen.');
      return null;
    }
    return u;
  }

  async function doTimeout(seconds) {
    const username = requireTarget();
    if (!username) return;
    try {
      await window.twitchMod.timeout({
        broadcasterId,
        moderatorId,
        username,
        duration: seconds,
        reason: reasonInput.value.trim() || undefined,
      });
      showAction(true, `Timeout ${seconds}s für ${username}`);
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  }

  document.querySelectorAll('.btn-timeout[data-seconds]').forEach((btn) => {
    btn.addEventListener('click', () => doTimeout(Number(btn.dataset.seconds)));
  });

  document.getElementById('customTimeoutBtn').addEventListener('click', () => {
    const sec = Number(document.getElementById('customSeconds').value);
    if (!sec || sec < 1) {
      showAction(false, 'Ungültige Custom-Dauer');
      return;
    }
    doTimeout(sec);
  });

  document.getElementById('banBtn').addEventListener('click', async () => {
    const username = requireTarget();
    if (!username) return;
    if (!confirm(`Benutzer ${username} permanent bannen?`)) return;
    try {
      await window.twitchMod.ban({
        broadcasterId,
        moderatorId,
        username,
        reason: reasonInput.value.trim() || undefined,
      });
      showAction(true, `${username} gebannt`);
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  document.getElementById('unbanBtn').addEventListener('click', async () => {
    const username = requireTarget();
    if (!username) return;
    try {
      await window.twitchMod.unban({ broadcasterId, moderatorId, username });
      showAction(true, `Unban/Untimeout für ${username}`);
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  document.getElementById('deleteMsgBtn').addEventListener('click', async () => {
    if (!selectedMessageId || selectedMessageId.startsWith('local-')) {
      showAction(false, 'Bitte eine Chat-Nachricht auswählen (mit Message-ID).');
      return;
    }
    try {
      await window.twitchMod.deleteMessage({
        broadcasterId,
        moderatorId,
        messageId: selectedMessageId,
      });
      showAction(true, 'Nachricht gelöscht');
      selectedMessageId = null;
      selectedMsgEl.hidden = true;
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  document.getElementById('clearChatBtn').addEventListener('click', async () => {
    if (!confirm('Gesamten Chat leeren?')) return;
    try {
      await window.twitchMod.clearChat({ broadcasterId, moderatorId });
      showAction(true, 'Chat geleert');
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  function renderModes() {
    if (!chatSettings) return;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      const mode = btn.dataset.mode;
      const on = !!chatSettings[mode];
      btn.classList.toggle('on', on);
      if (!btn.dataset.label) {
        btn.dataset.label = btn.textContent.replace(/ ✓$/, '');
      }
      btn.textContent = on ? btn.dataset.label + ' ✓' : btn.dataset.label;
    });
  }

  async function loadSettings() {
    try {
      chatSettings = await window.twitchMod.getChatSettings({ broadcasterId, moderatorId });
      renderModes();
    } catch (err) {
      showAction(false, 'Chat-Einstellungen: ' + (err.message || String(err)));
    }
  }

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.dataset.label = btn.textContent;
    btn.addEventListener('click', async () => {
      if (!chatSettings) await loadSettings();
      const mode = btn.dataset.mode;
      const next = !chatSettings[mode];
      const settings = {};

      if (mode === 'slow_mode') {
        settings.slow_mode = next;
        settings.slow_mode_wait_time = next ? 30 : null;
      } else if (mode === 'follower_mode') {
        settings.follower_mode = next;
        settings.follower_mode_duration = next ? 0 : null;
      } else if (mode === 'emote_mode') {
        settings.emote_mode = next;
      } else if (mode === 'subscriber_mode') {
        settings.subscriber_mode = next;
      } else if (mode === 'unique_chat_mode') {
        settings.unique_chat_mode = next;
      }

      try {
        chatSettings = await window.twitchMod.updateChatSettings({
          broadcasterId,
          moderatorId,
          settings,
        });
        renderModes();
        showAction(true, `${btn.dataset.label}: ${next ? 'an' : 'aus'}`);
      } catch (err) {
        showAction(false, err.message || String(err));
      }
    });
  });

  connectIrc();
  loadSettings();

  window.addEventListener('beforeunload', () => irc.disconnect());
})();
