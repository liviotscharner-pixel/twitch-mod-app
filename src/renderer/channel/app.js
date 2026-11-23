(function () {
  const params = new URLSearchParams(window.location.search);
  const broadcasterId = params.get('broadcasterId') || '';
  const broadcasterLogin = params.get('broadcasterLogin') || '';
  const broadcasterName = params.get('broadcasterName') || broadcasterLogin;
  const moderatorId = params.get('moderatorUserId') || '';
  const moderatorLogin = params.get('moderatorLogin') || '';

  document.title = `Twitchy · ${broadcasterName}`;
  document.getElementById('channelTitle').textContent = broadcasterName;
  document.getElementById('channelMeta').textContent = `#${broadcasterLogin} · Mod: ${moderatorLogin}`;

  const chatLog = document.getElementById('chatLog');
  const connStatus = document.getElementById('connStatus');

  /** Sticky-scroll: auto-follow newest messages only when near bottom. */
  const STICK_THRESHOLD_PX = 80;
  let stickToBottom = true;

  function isNearBottom() {
    return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight <= STICK_THRESHOLD_PX;
  }

  function scrollChatIfSticky() {
    if (stickToBottom) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  chatLog.addEventListener('scroll', () => {
    stickToBottom = isNearBottom();
  });
  const targetUser = document.getElementById('targetUser');
  const reasonInput = document.getElementById('reason');
  const actionStatus = document.getElementById('actionStatus');
  const selectedMsgEl = document.getElementById('selectedMsg');
  const selectedMsgText = document.getElementById('selectedMsgText');

  let selectedMessageId = null;
  let chatSettings = null;
  const irc = new window.TwitchIrc();
  /** @type {Map<string, {id:string,url:string}>} */
  let bttvMap = new Map();

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

  const userInfoMount = document.getElementById('userInfoMount');
  const userInfoCard =
    userInfoMount && window.TwitchyUserInfo
      ? window.TwitchyUserInfo.mount(userInfoMount, { closable: true })
      : null;

  function showUserCard(user) {
    if (!userInfoCard) return;
    const login = (user.userLogin || user.user || '').toLowerCase();
    if (!login) return;
    userInfoCard.show({
      userLogin: login,
      userId: user.userId || '',
      displayName: user.displayName || login,
      badges: user.badges || [],
      role: user.role || '',
      group: user.group || '',
      broadcasterId,
      broadcasterLogin,
    });
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
    scrollChatIfSticky();
  }

  function appendMessage(msg) {
    const role = resolveChatRole(msg);
    msg.role = role;
    pushToBuffer(msg);
    if (window.TwitchyMembers && window.TwitchyMembers.noteUser) {
      const changed = window.TwitchyMembers.noteUser(msg);
      if (changed && typeof window.TwitchyMembers.refresh === 'function') {
        window.TwitchyMembers.refresh();
      }
    }

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
      showUserCard(msg);
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
    window.TwitchyEmotes.fillMessageBody(body, msg.message || '', {
      emotesTag: msg.emotes || '',
      bttvMap,
      isAction: !!msg.isAction,
    });
    if (window.TwitchyHighlights) window.TwitchyHighlights.apply(body);

    div.appendChild(header);
    div.appendChild(body);

    div.addEventListener('click', () => {
      document.querySelectorAll('.chat-line.selected').forEach((el) => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedMessageId = msg.id;
      selectedMsgEl.hidden = false;
      selectedMsgText.textContent = `${msg.displayName}: ${msg.message}`;
      targetUser.value = msg.user;
      showUserCard(msg);
    });

    div.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openUserWindowFor(msg);
    });

    chatLog.appendChild(div);
    while (chatLog.children.length > 500) {
      chatLog.removeChild(chatLog.firstChild);
    }
    scrollChatIfSticky();
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
        color: '#F28C28',
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

  async function loadEmotes() {
    try {
      if (broadcasterId && window.TwitchyEmotes) {
        window.TwitchyEmotes.invalidateChannelBttv(broadcasterId);
        bttvMap = await window.TwitchyEmotes.getBttvMap(broadcasterId);
      } else if (window.TwitchyEmotes) {
        bttvMap = await window.TwitchyEmotes.getBttvMap('');
      }
    } catch (err) {
      console.warn('BTTV Emotes laden fehlgeschlagen', err);
      bttvMap = new Map();
    }
  }

  /** Hervorgehobene Wörter: initial laden + live Updates aus dem Hauptfenster. */
  async function loadHighlights() {
    if (!window.TwitchyHighlights || !window.twitchMod.getHighlightWords) return;
    try {
      window.TwitchyHighlights.setWords(await window.twitchMod.getHighlightWords());
    } catch (err) {
      console.warn('Hervorgehobene Wörter laden fehlgeschlagen', err);
    }
  }

  if (window.TwitchyHighlights && typeof window.twitchMod.onHighlightWordsChanged === 'function') {
    window.twitchMod.onHighlightWordsChanged((list) => {
      window.TwitchyHighlights.setWords(list);
      window.TwitchyHighlights.applyAll(chatLog);
      scrollChatIfSticky();
    });
  }

  if (window.TwitchyMembers && typeof window.TwitchyMembers.init === 'function') {
    window.TwitchyMembers.init({
      broadcasterId,
      broadcasterLogin,
      moderatorId,
      moderatorLogin,
      onSelect: (user) => {
        targetUser.value = user.userLogin;
        showAction(true, `Ziel: ${user.displayName}`);
        showUserCard(user);
      },
      onOpen: (user) => {
        openUserWindowFor({
          user: user.userLogin,
          userId: user.userId || '',
          displayName: user.displayName || user.userLogin,
        });
      },
    });
  }


  const streamInfoEl = document.getElementById('streamInfo');
  const titleDialog = document.getElementById('titleDialog');
  const titleInput = document.getElementById('titleInput');
  const titleCount = document.getElementById('titleCount');
  const categoryInput = document.getElementById('categoryInput');
  const categoryResults = document.getElementById('categoryResults');
  const titleDialogHint = document.getElementById('titleDialogHint');
  const titleDialogStatus = document.getElementById('titleDialogStatus');
  const titleSave = document.getElementById('titleSave');
  const titleCancel = document.getElementById('titleCancel');
  const titleOpenDash = document.getElementById('titleOpenDash');
  const titleRelogin = document.getElementById('titleRelogin');
  const editTitleBtn = document.getElementById('editTitleBtn');

  let broadcastInfo = {
    title: '',
    gameName: '',
    gameId: '',
    canEdit: false,
    needsBroadcastScope: false,
  };
  let pickedGameId = '';
  let searchTimer = null;
  let searchSeq = 0;

  function renderStreamInfo(info) {
    if (!streamInfoEl) return;
    const title = (info && info.title) || '';
    const game = (info && info.gameName) || '';
    if (!title && !game) {
      streamInfoEl.hidden = true;
      streamInfoEl.textContent = '';
      return;
    }
    streamInfoEl.hidden = false;
    streamInfoEl.innerHTML = '';
    if (game) {
      const g = document.createElement('span');
      g.className = 'stream-game';
      g.textContent = game;
      streamInfoEl.appendChild(g);
      if (title) streamInfoEl.appendChild(document.createTextNode(' · '));
    }
    if (title) streamInfoEl.appendChild(document.createTextNode(title));
    streamInfoEl.title = [game, title].filter(Boolean).join(' · ');
  }

  async function loadBroadcastInfo() {
    if (!broadcasterId || typeof window.twitchMod.getChannelBroadcast !== 'function') return;
    try {
      const info = await window.twitchMod.getChannelBroadcast({ broadcasterId });
      broadcastInfo = info;
      renderStreamInfo(info);
    } catch (err) {
      console.warn('Kanalinfos laden fehlgeschlagen', err);
    }
  }

  function updateTitleCount() {
    if (!titleCount || !titleInput) return;
    const n = titleInput.value.length;
    titleCount.textContent = n + ' / 140';
    titleCount.classList.toggle('warn', n >= 130);
  }

  function setDialogStatus(kind, text) {
    if (!titleDialogStatus) return;
    if (!text) {
      titleDialogStatus.hidden = true;
      titleDialogStatus.textContent = '';
      titleDialogStatus.className = 'title-dialog-status';
      return;
    }
    titleDialogStatus.hidden = false;
    titleDialogStatus.className = 'title-dialog-status ' + (kind || '');
    titleDialogStatus.textContent = text;
  }

  function setDialogHint(text) {
    if (!titleDialogHint) return;
    titleDialogHint.hidden = !text;
    titleDialogHint.textContent = text || '';
  }

  function applyPermissionUi() {
    const isOwn = !!broadcastInfo.canEdit;
    const needsScope = !!broadcastInfo.needsBroadcastScope;
    if (titleOpenDash) titleOpenDash.hidden = isOwn;
    if (titleRelogin) titleRelogin.hidden = !(isOwn && needsScope);
    if (titleSave) {
      titleSave.hidden = !isOwn;
      titleSave.disabled = isOwn && needsScope;
    }
    if (!isOwn) {
      setDialogHint(
        'Twitch erlaubt das Ändern des Titels nur dem Streamer selbst oder Editoren über twitch.tv'
      );
    } else if (needsScope) {
      setDialogHint('Für das Ändern des Titels bitte neu anmelden');
    } else {
      setDialogHint('');
    }
  }

  async function openTitleDialog() {
    await loadBroadcastInfo();
    if (titleInput) titleInput.value = broadcastInfo.title || '';
    if (categoryInput) categoryInput.value = broadcastInfo.gameName || '';
    pickedGameId = broadcastInfo.gameId || '';
    updateTitleCount();
    setDialogStatus('', '');
    if (categoryResults) {
      categoryResults.hidden = true;
      categoryResults.innerHTML = '';
    }
    applyPermissionUi();
    if (titleDialog) titleDialog.hidden = false;
    if (titleInput) titleInput.focus();
  }

  function closeTitleDialog() {
    if (titleDialog) titleDialog.hidden = true;
    if (categoryResults) {
      categoryResults.hidden = true;
      categoryResults.innerHTML = '';
    }
  }

  function renderCategoryResults(list) {
    if (!categoryResults) return;
    categoryResults.innerHTML = '';
    if (!list || !list.length) {
      categoryResults.hidden = true;
      return;
    }
    categoryResults.hidden = false;
    list.forEach((cat) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (cat.boxArtUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = String(cat.boxArtUrl).replace('{width}', '52').replace('{height}', '72');
        btn.appendChild(img);
      }
      btn.appendChild(document.createTextNode(cat.name));
      btn.addEventListener('click', () => {
        pickedGameId = cat.id;
        if (categoryInput) categoryInput.value = cat.name;
        categoryResults.hidden = true;
        categoryResults.innerHTML = '';
      });
      li.appendChild(btn);
      categoryResults.appendChild(li);
    });
  }

  async function searchCats(query) {
    const q = String(query || '').trim();
    if (q.length < 2 || typeof window.twitchMod.searchCategories !== 'function') {
      renderCategoryResults([]);
      return;
    }
    const seq = ++searchSeq;
    try {
      const res = await window.twitchMod.searchCategories({ query: q });
      if (seq !== searchSeq) return;
      renderCategoryResults((res && res.categories) || []);
    } catch (err) {
      if (seq !== searchSeq) return;
      renderCategoryResults([]);
      setDialogStatus('err', err.message || String(err));
    }
  }

  if (editTitleBtn) editTitleBtn.addEventListener('click', () => openTitleDialog());
  if (titleCancel) titleCancel.addEventListener('click', () => closeTitleDialog());
  if (titleDialog) {
    titleDialog.addEventListener('click', (e) => {
      if (e.target && e.target.getAttribute('data-close') === '1') closeTitleDialog();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && titleDialog && !titleDialog.hidden) closeTitleDialog();
  });
  if (titleInput) titleInput.addEventListener('input', updateTitleCount);
  if (categoryInput) {
    categoryInput.addEventListener('input', () => {
      if (categoryInput.value.trim() !== (broadcastInfo.gameName || '').trim()) {
        pickedGameId = '';
      }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchCats(categoryInput.value), 280);
    });
  }
  if (titleOpenDash) {
    titleOpenDash.addEventListener('click', async () => {
      const url = 'https://dashboard.twitch.tv/u/' + encodeURIComponent(broadcasterLogin) + '/stream-manager';
      try {
        if (typeof window.twitchMod.openExternal === 'function') {
          await window.twitchMod.openExternal(url);
        } else {
          window.open(url, '_blank', 'noopener');
        }
      } catch (err) {
        setDialogStatus('err', err.message || String(err));
      }
    });
  }
  if (titleRelogin && typeof window.twitchMod.relogin === 'function') {
    titleRelogin.addEventListener('click', async () => {
      try {
        await window.twitchMod.relogin();
      } catch (err) {
        setDialogStatus('err', err.message || String(err));
      }
    });
  }
  if (titleSave) {
    titleSave.addEventListener('click', async () => {
      const title = (titleInput && titleInput.value ? titleInput.value : '').trim();
      if (!title) {
        setDialogStatus('err', 'Der Titel darf nicht leer sein.');
        return;
      }
      titleSave.disabled = true;
      setDialogStatus('', 'Speichere…');
      try {
        const payload = { broadcasterId, title };
        if (pickedGameId) payload.gameId = pickedGameId;
        const res = await window.twitchMod.updateChannelBroadcast(payload);
        if (!res || !res.ok) {
          setDialogStatus('err', (res && res.message) || 'Titel konnte nicht gespeichert werden.');
          if (res && res.needsRelogin) {
            broadcastInfo.needsBroadcastScope = true;
            applyPermissionUi();
          }
          return;
        }
        broadcastInfo.title = res.title || title;
        if (res.gameName != null) broadcastInfo.gameName = res.gameName;
        if (res.gameId != null) broadcastInfo.gameId = res.gameId;
        renderStreamInfo(broadcastInfo);
        setDialogStatus('ok', res.message || 'Titel gespeichert.');
        setTimeout(() => closeTitleDialog(), 700);
      } catch (err) {
        setDialogStatus('err', err.message || String(err));
      } finally {
        titleSave.disabled = !!broadcastInfo.needsBroadcastScope;
      }
    });
  }
  if (typeof window.twitchMod.onSessionUpdated === 'function') {
    window.twitchMod.onSessionUpdated(() => {
      loadBroadcastInfo();
    });
  }

  (async function boot() {
    await Promise.all([loadEmotes(), loadHighlights(), loadBroadcastInfo()]);
    connectIrc();
    loadSettings();
  })();

  window.addEventListener('beforeunload', () => irc.disconnect());
})();
