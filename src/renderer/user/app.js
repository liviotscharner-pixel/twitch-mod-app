(function () {
  const params = new URLSearchParams(window.location.search);
  const broadcasterId = params.get('broadcasterId') || '';
  const broadcasterLogin = params.get('broadcasterLogin') || '';
  const broadcasterName = params.get('broadcasterName') || broadcasterLogin;
  const moderatorId = params.get('moderatorUserId') || '';
  const userLogin = (params.get('userLogin') || '').toLowerCase();
  const windowKey = params.get('windowKey') || `${broadcasterId}:${userLogin}`;
  let displayName = params.get('displayName') || userLogin;
  let userId = params.get('userId') || '';

  const chatLog = document.getElementById('chatLog');
  const userTitle = document.getElementById('userTitle');
  const userMeta = document.getElementById('userMeta');
  const targetLabel = document.getElementById('targetLabel');
  const reasonInput = document.getElementById('reason');
  const actionStatus = document.getElementById('actionStatus');
  const rolePill = document.getElementById('rolePill');

  /** @type {Set<string>} */
  const seenIds = new Set();

  const ROLE_LABELS = { mod: 'Mod', vip: 'VIP', sub: 'Sub', normal: 'Chat' };

  function showAction(ok, text) {
    actionStatus.hidden = false;
    actionStatus.className = 'action-status ' + (ok ? 'ok' : 'err');
    actionStatus.textContent = text;
  }

  function resolveChatRole(msg) {
    if (msg.role) return msg.role;
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

  function updateHeader(role) {
    userTitle.textContent = displayName || userLogin;
    userMeta.textContent = `@${userLogin} · #${broadcasterLogin}` + (userId ? ` · ID ${userId}` : '');
    targetLabel.textContent = `${displayName} (@${userLogin})`;
    document.title = `User · ${displayName} · #${broadcasterLogin}`;
    if (role) {
      rolePill.hidden = false;
      rolePill.className = 'role-pill role-' + role;
      rolePill.textContent = ROLE_LABELS[role] || role;
    }
  }

  function clearEmpty() {
    const empty = chatLog.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function showEmptyIfNeeded() {
    if (!chatLog.querySelector('.chat-block') && !chatLog.querySelector('.empty-state')) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = 'Noch keine Nachrichten von diesem User in dieser Session.';
      chatLog.appendChild(p);
    }
  }

  function appendMessage(msg, opts) {
    const login = (msg.user || '').toLowerCase();
    if (login !== userLogin) return;
    if (msg.id && seenIds.has(msg.id)) return;
    if (msg.id) seenIds.add(msg.id);

    clearEmpty();
    if (msg.displayName) displayName = msg.displayName;
    if (msg.userId) userId = msg.userId;

    const role = resolveChatRole(msg);
    updateHeader(role);

    const div = document.createElement('div');
    div.className = `chat-line chat-block role-${role}`;
    div.dataset.messageId = msg.id || '';

    const time = new Date(msg.timestamp || Date.now());
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
    userSpan.textContent = msg.displayName || displayName;

    header.appendChild(timeSpan);
    header.appendChild(badgeSpan);
    header.appendChild(userSpan);

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = (msg.isAction ? '* ' : '') + (msg.message || '');

    div.appendChild(header);
    div.appendChild(body);
    chatLog.appendChild(div);

    if (!opts || opts.scroll !== false) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  function renderHistory(history) {
    const list = Array.isArray(history) ? history : [];
    for (const msg of list) {
      appendMessage(msg, { scroll: false });
    }
    showEmptyIfNeeded();
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function doTimeout(seconds) {
    try {
      await window.twitchMod.timeout({
        broadcasterId,
        moderatorId,
        username: userLogin,
        duration: seconds,
        reason: reasonInput.value.trim() || undefined,
      });
      showAction(true, `Timeout ${seconds}s für ${userLogin}`);
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
    if (!confirm(`Benutzer ${userLogin} permanent bannen?`)) return;
    try {
      await window.twitchMod.ban({
        broadcasterId,
        moderatorId,
        username: userLogin,
        reason: reasonInput.value.trim() || undefined,
      });
      showAction(true, `${userLogin} gebannt`);
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  document.getElementById('unbanBtn').addEventListener('click', async () => {
    try {
      await window.twitchMod.unban({ broadcasterId, moderatorId, username: userLogin });
      showAction(true, `Unban/Untimeout für ${userLogin}`);
    } catch (err) {
      showAction(false, err.message || String(err));
    }
  });

  updateHeader('normal');

  (async function init() {
    try {
      const boot = await window.twitchMod.getUserBootstrap(windowKey);
      if (boot) {
        if (boot.displayName) displayName = boot.displayName;
        if (boot.userId) userId = boot.userId;
        updateHeader('normal');
        renderHistory(boot.history || []);
      } else {
        showEmptyIfNeeded();
      }
    } catch (err) {
      showAction(false, err.message || String(err));
      showEmptyIfNeeded();
    }
  })();

  if (typeof window.twitchMod.onUserChatMessage === 'function') {
    window.twitchMod.onUserChatMessage((msg) => appendMessage(msg));
  }
  if (typeof window.twitchMod.onUserHistoryRefresh === 'function') {
    window.twitchMod.onUserHistoryRefresh((history) => {
      // Merge new history entries without clearing live ones
      renderHistory(history);
    });
  }
})();
