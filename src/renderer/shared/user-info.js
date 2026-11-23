(function () {
  const TYPE_LABELS = { partner: 'Partner', affiliate: 'Affiliate' };
  const ROLE_CLASS = {
    Broadcaster: 'role-broadcaster',
    Mod: 'role-mod',
    VIP: 'role-vip',
    Sub: 'role-sub',
    Bot: 'role-bot',
  };

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('de-CH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  }

  function formatAge(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    let months = now.getMonth() - d.getMonth();
    let days = now.getDate() - d.getDate();
    if (days < 0) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years >= 1) return years === 1 ? 'vor 1 Jahr' : `vor ${years} Jahren`;
    if (months >= 1) return months === 1 ? 'vor 1 Monat' : `vor ${months} Monaten`;
    const diffDays = Math.max(0, Math.round((now.getTime() - d.getTime()) / 86400000));
    if (diffDays <= 0) return 'heute';
    if (diffDays === 1) return 'vor 1 Tag';
    return `vor ${diffDays} Tagen`;
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return new Intl.NumberFormat('de-CH').format(n);
  }

  function collectRoles(opts) {
    const login = String(opts.userLogin || opts.user || '').toLowerCase();
    const badges = Array.isArray(opts.badges) ? opts.badges : [];
    const set = new Set(badges.map((b) => String(b).toLowerCase()));
    const group = opts.group || '';
    const role = opts.role || '';
    const broadcasterLogin = String(opts.broadcasterLogin || '').toLowerCase();
    const roles = [];
    const isBroadcaster =
      group === 'broadcaster' ||
      set.has('broadcaster') ||
      (!!login && !!broadcasterLogin && login === broadcasterLogin);
    if (isBroadcaster) roles.push('Broadcaster');
    const isBot =
      group === 'bot' ||
      (window.TwitchyBots && window.TwitchyBots.isBot(login, badges));
    if (isBot) roles.push('Bot');
    if (!isBroadcaster && (group === 'moderator' || role === 'mod' || set.has('moderator') || set.has('mod'))) {
      roles.push('Mod');
    }
    if (group === 'vip' || role === 'vip' || set.has('vip')) roles.push('VIP');
    if (role === 'sub' || set.has('subscriber') || set.has('founder')) roles.push('Sub');
    return roles;
  }

  function twitchUrl(login) {
    return 'https://www.twitch.tv/' + encodeURIComponent(String(login || '').toLowerCase());
  }

  function setRow(dl, key, label, valueNode) {
    let dt = dl.querySelector('dt[data-k="' + key + '"]');
    let dd = dl.querySelector('dd[data-k="' + key + '"]');
    if (!valueNode) {
      if (dt) dt.remove();
      if (dd) dd.remove();
      return;
    }
    if (!dt) {
      dt = el('dt');
      dt.dataset.k = key;
      dd = el('dd');
      dd.dataset.k = key;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    dt.textContent = label;
    dd.innerHTML = '';
    if (typeof valueNode === 'string') dd.textContent = valueNode;
    else dd.appendChild(valueNode);
  }

  function renderCard(container, state, opts) {
    container.innerHTML = '';
    const card = el('article', 'user-info-card' + (state.loading ? ' loading' : ''));
    if (opts.closable) {
      const close = el('button', 'user-info-close', '×');
      close.type = 'button';
      close.title = 'Schliessen';
      close.addEventListener('click', () => {
        container.hidden = true;
        container.innerHTML = '';
        if (typeof opts.onClose === 'function') opts.onClose();
      });
      card.appendChild(close);
    }

    const info = state.info || {};
    const login = info.login || state.userLogin || '';
    const displayName = info.displayName || state.displayName || login;

    const head = el('div', 'user-info-head');
    const img = el('img', 'user-info-avatar' + (info.profileImageUrl ? '' : ' placeholder'));
    img.alt = '';
    img.width = 64;
    img.height = 64;
    if (info.profileImageUrl) img.src = info.profileImageUrl;
    head.appendChild(img);

    const meta = el('div');
    meta.appendChild(el('div', 'user-info-name', displayName));
    meta.appendChild(el('div', 'user-info-login', login ? '@' + login : ''));
    const rolesWrap = el('div', 'user-info-roles');
    const roles = state.roles || [];
    for (const r of roles) {
      rolesWrap.appendChild(el('span', 'user-info-role ' + (ROLE_CLASS[r] || ''), r));
    }
    if (roles.length) meta.appendChild(rolesWrap);
    head.appendChild(meta);
    card.appendChild(head);

    const body = el('div', 'user-info-body');
    if (state.loading && !info.ok) {
      body.appendChild(el('p', 'user-info-status', 'Lade Infos…'));
    } else if (state.error) {
      body.appendChild(el('p', 'user-info-status err', state.error));
    } else {
      const dl = el('dl', 'user-info-dl');
      if (info.createdAt) {
        const created = formatDate(info.createdAt);
        const age = formatAge(info.createdAt);
        setRow(dl, 'created', 'Konto erstellt', age ? `${created} (${age})` : created);
      }
      const typeLabel = TYPE_LABELS[(info.broadcasterType || '').toLowerCase()] || '—';
      setRow(dl, 'type', 'Art', typeLabel);
      if (typeof info.followers === 'number') {
        setRow(dl, 'followers', 'Follower', formatNumber(info.followers));
      }
      if (info.followsNeedsScope) {
        const hint = el('span');
        hint.appendChild(document.createTextNode('Für diese Info bitte neu anmelden'));
        if (typeof window.twitchMod.relogin === 'function') {
          const btn = el('button', '', 'Neu anmelden');
          btn.type = 'button';
          btn.addEventListener('click', async () => {
            try {
              await window.twitchMod.relogin();
            } catch (err) {
              /* ignore, main window handles it */
            }
          });
          hint.appendChild(btn);
        }
        setRow(dl, 'follows', 'Folgt diesem Kanal', hint);
      } else if (info.followsChannel === true) {
        const since = info.followedAt ? formatDate(info.followedAt) : '';
        setRow(dl, 'follows', 'Folgt diesem Kanal', since ? `Ja, seit ${since}` : 'Ja');
      } else if (info.followsChannel === false) {
        setRow(dl, 'follows', 'Folgt diesem Kanal', 'Nein');
      }
      if (info.isLive) {
        const live = el('span', 'user-info-live');
        live.appendChild(el('span', 'user-info-live-dot'));
        const parts = ['Live'];
        if (info.streamGame) parts.push(info.streamGame);
        if (info.streamTitle) parts.push(info.streamTitle);
        if (typeof info.viewerCount === 'number') {
          parts.push(formatNumber(info.viewerCount) + ' Zuschauer');
        }
        live.appendChild(document.createTextNode(parts.join(' · ')));
        setRow(dl, 'stream', 'Stream', live);
      } else if (info.lastGame || info.lastTitle) {
        const parts = [];
        if (info.lastGame) parts.push(info.lastGame);
        if (info.lastTitle) parts.push(info.lastTitle);
        setRow(dl, 'stream', 'Zuletzt', parts.join(' · '));
      }
      body.appendChild(dl);
      if (info.description) body.appendChild(el('p', 'user-info-bio', info.description));
    }

    if (login) {
      const openBtn = el('button', 'user-info-open', 'Kanal auf Twitch öffnen');
      openBtn.type = 'button';
      openBtn.addEventListener('click', async () => {
        const url = twitchUrl(login);
        try {
          if (typeof window.twitchMod.openExternal === 'function') {
            await window.twitchMod.openExternal(url);
          } else {
            window.open(url, '_blank', 'noopener');
          }
        } catch (err) {
          window.open(url, '_blank', 'noopener');
        }
      });
      body.appendChild(openBtn);
    }

    card.appendChild(body);
    container.appendChild(card);
    container.hidden = false;
  }

  window.TwitchyUserInfo = {
    collectRoles,
    /**
     * @param {HTMLElement} container
     * @param {{ closable?: boolean, onClose?: function }} [opts]
     */
    mount(container, opts) {
      const options = opts || {};
      let currentLogin = '';
      let seq = 0;

      return {
        hide() {
          currentLogin = '';
          container.hidden = true;
          container.innerHTML = '';
        },
        /**
         * @param {{
         *   userLogin: string,
         *   userId?: string,
         *   displayName?: string,
         *   badges?: string[],
         *   role?: string,
         *   group?: string,
         *   broadcasterId: string,
         *   broadcasterLogin: string,
         * }} target
         */
        async show(target) {
          const userLogin = String(target.userLogin || target.user || '').toLowerCase();
          if (!userLogin) return;
          currentLogin = userLogin;
          const mySeq = ++seq;
          const roles = collectRoles(target);
          const state = {
            loading: true,
            userLogin,
            displayName: target.displayName || userLogin,
            roles,
            info: { login: userLogin, displayName: target.displayName || userLogin },
          };
          renderCard(container, state, options);
          try {
            const info = await window.twitchMod.getUserInfo({
              userLogin,
              userId: target.userId || '',
              broadcasterId: target.broadcasterId,
              broadcasterLogin: target.broadcasterLogin,
            });
            if (mySeq !== seq || currentLogin !== userLogin) return;
            state.loading = false;
            if (!info || !info.ok) {
              state.error = (info && info.message) || 'Infos konnten nicht geladen werden.';
              state.info = { login: userLogin, displayName: state.displayName };
            } else {
              state.info = info;
            }
            renderCard(container, state, options);
          } catch (err) {
            if (mySeq !== seq || currentLogin !== userLogin) return;
            state.loading = false;
            state.error = err.message || String(err);
            renderCard(container, state, options);
          }
        },
      };
    },
  };
})();
