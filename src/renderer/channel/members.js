(function () {
  const STORAGE_PANE = 'twitchy.membersPaneOpen';
  const STORAGE_GROUPS = 'twitchy.membersGroupCollapsed';
  const REFRESH_MS = 60000;

  const GROUPS = [
    { id: 'broadcaster', label: 'Broadcaster' },
    { id: 'moderator', label: 'Moderatoren' },
    { id: 'vip', label: 'VIPs' },
    { id: 'viewer', label: 'Zuschauer' },
  ];

  /** @type {Map<string, { userId?: string, displayName?: string, role?: string, badges?: string[] }>} */
  const seen = new Map();

  function readPaneOpen() {
    const v = localStorage.getItem(STORAGE_PANE);
    return v !== '0';
  }

  function writePaneOpen(open) {
    localStorage.setItem(STORAGE_PANE, open ? '1' : '0');
  }

  function readGroupCollapsed() {
    try {
      const raw = localStorage.getItem(STORAGE_GROUPS);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeGroupCollapsed(map) {
    localStorage.setItem(STORAGE_GROUPS, JSON.stringify(map));
  }

  function badgeSet(badges) {
    return new Set((badges || []).map((b) => String(b).toLowerCase()));
  }

  window.TwitchyMembers = {
    /**
     * Remember role/badges seen in IRC so grouping and colors stay accurate.
     * @param {{ user?: string, userId?: string, displayName?: string, role?: string, badges?: string[] }} msg
     */
    noteUser(msg) {
      const login = String(msg.user || '').toLowerCase();
      if (!login) return false;
      const prev = seen.get(login) || {};
      const next = {
        userId: msg.userId || prev.userId,
        displayName: msg.displayName || prev.displayName,
        role: msg.role || prev.role,
        badges: Array.isArray(msg.badges) && msg.badges.length ? msg.badges : prev.badges,
      };
      const changed =
        prev.userId !== next.userId ||
        prev.displayName !== next.displayName ||
        prev.role !== next.role ||
        JSON.stringify(prev.badges || []) !== JSON.stringify(next.badges || []);
      seen.set(login, next);
      return changed;
    },

    /**
     * @param {{
     *   broadcasterId: string,
     *   broadcasterLogin: string,
     *   moderatorId: string,
     *   onSelect: (user: { userLogin: string, displayName: string, userId?: string }) => void,
     *   onOpen: (user: { userLogin: string, displayName: string, userId?: string }) => void,
     * }} opts
     */
    init(opts) {
      const layout = document.getElementById('layout');
      const pane = document.getElementById('membersPane');
      const toggle = document.getElementById('membersToggle');
      const expand = document.getElementById('membersExpand');
      const refreshBtn = document.getElementById('membersRefresh');
      const countEl = document.getElementById('membersCount');
      const stripCount = document.getElementById('membersStripCount');
      const searchEl = document.getElementById('membersSearch');
      const statusEl = document.getElementById('membersStatus');
      const listEl = document.getElementById('membersList');
      const reloginBox = document.getElementById('membersRelogin');
      const reloginBtn = document.getElementById('membersReloginBtn');

      if (!layout || !pane || !listEl) return;

      const broadcasterLogin = String(opts.broadcasterLogin || '').toLowerCase();
      /** @type {{ userId: string, userLogin: string, displayName: string }[]} */
      let chatters = [];
      /** @type {Set<string>} */
      let modLogins = new Set();
      /** @type {Set<string>} */
      let vipLogins = new Set();
      let loading = false;
      let timer = null;
      let groupCollapsed = readGroupCollapsed();
      let selectedLogin = '';

      function setPaneOpen(open) {
        layout.classList.toggle('members-collapsed', !open);
        pane.classList.toggle('collapsed', !open);
        if (toggle) {
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.title = open ? 'Memberliste zuklappen' : 'Memberliste aufklappen';
        }
        if (expand) expand.setAttribute('aria-expanded', open ? 'true' : 'false');
        writePaneOpen(open);
      }

      function showStatus(kind, text) {
        if (!statusEl) return;
        if (!text) {
          statusEl.hidden = true;
          statusEl.textContent = '';
          statusEl.className = 'members-status';
          return;
        }
        statusEl.hidden = false;
        statusEl.className = 'members-status ' + (kind || '');
        statusEl.textContent = text;
      }

      function setRelogin(visible) {
        if (reloginBox) reloginBox.hidden = !visible;
      }

      function isModFromSeen(login, info) {
        const badges = badgeSet(info && info.badges);
        return (
          badges.has('moderator') ||
          badges.has('mod') ||
          badges.has('broadcaster') ||
          (info && info.role === 'mod')
        );
      }

      function isVipFromSeen(login, info) {
        const badges = badgeSet(info && info.badges);
        return badges.has('vip') || (info && info.role === 'vip');
      }

      function isSubFromSeen(info) {
        const badges = badgeSet(info && info.badges);
        return badges.has('subscriber') || badges.has('founder') || (info && info.role === 'sub');
      }

      function classify(chatter) {
        const login = String(chatter.userLogin || '').toLowerCase();
        const info = seen.get(login) || {};
        const isBroadcaster = login === broadcasterLogin;
        const isMod = isBroadcaster || modLogins.has(login) || isModFromSeen(login, info);
        const isVip = vipLogins.has(login) || isVipFromSeen(login, info);
        const isSub = isSubFromSeen(info);

        let group = 'viewer';
        if (isBroadcaster) group = 'broadcaster';
        else if (isMod) group = 'moderator';
        else if (isVip) group = 'vip';

        let role = 'normal';
        if (isBroadcaster || isMod) role = 'mod';
        else if (isVip) role = 'vip';
        else if (isSub) role = 'sub';

        return {
          userId: chatter.userId || info.userId || '',
          userLogin: login,
          displayName: chatter.displayName || info.displayName || login,
          group,
          role,
        };
      }

      function matchesQuery(entry, q) {
        if (!q) return true;
        return (
          entry.displayName.toLowerCase().includes(q) ||
          entry.userLogin.toLowerCase().includes(q)
        );
      }

      function setCount(n) {
        const label = typeof n === 'number' ? String(n) : '–';
        if (countEl) countEl.textContent = typeof n === 'number' ? `(${n})` : '';
        if (stripCount) stripCount.textContent = label;
      }

      function render() {
        const q = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
        const entries = chatters.map(classify).filter((e) => matchesQuery(e, q));
        entries.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' })
        );

        setCount(chatters.length);

        listEl.innerHTML = '';
        if (!chatters.length && !loading) {
          const empty = document.createElement('p');
          empty.className = 'members-empty';
          empty.textContent = 'Niemand im Chat.';
          listEl.appendChild(empty);
          return;
        }
        if (!entries.length) {
          const empty = document.createElement('p');
          empty.className = 'members-empty';
          empty.textContent = 'Keine Treffer.';
          listEl.appendChild(empty);
          return;
        }

        for (const group of GROUPS) {
          const members = entries.filter((e) => e.group === group.id);
          if (!members.length) continue;

          const section = document.createElement('section');
          section.className = 'members-group';
          section.dataset.group = group.id;

          const collapsed = !!groupCollapsed[group.id];
          const head = document.createElement('button');
          head.type = 'button';
          head.className = 'members-group-head';
          head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          const chev = document.createElement('span');
          chev.className = 'members-chevron';
          chev.textContent = collapsed ? '▸' : '▾';
          const title = document.createElement('span');
          title.textContent = `${group.label} (${members.length})`;
          head.appendChild(chev);
          head.appendChild(title);
          head.addEventListener('click', () => {
            groupCollapsed[group.id] = !groupCollapsed[group.id];
            writeGroupCollapsed(groupCollapsed);
            render();
          });
          section.appendChild(head);

          if (!collapsed) {
            const ul = document.createElement('ul');
            ul.className = 'members-ul';
            for (const m of members) {
              const li = document.createElement('li');
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = `members-user role-${m.role}`;
              btn.dataset.user = m.userLogin;
              if (m.userLogin === selectedLogin) btn.classList.add('selected');
              btn.title = 'Klick: als Ziel · Doppelklick: User-Fenster';
              const name = document.createElement('span');
              name.className = 'members-user-name';
              name.textContent = m.displayName;
              btn.appendChild(name);
              btn.addEventListener('click', () => {
                selectedLogin = m.userLogin;
                listEl.querySelectorAll('.members-user.selected').forEach((el) => {
                  el.classList.remove('selected');
                });
                btn.classList.add('selected');
                opts.onSelect(m);
              });
              btn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                opts.onOpen(m);
              });
              li.appendChild(btn);
              ul.appendChild(li);
            }
            section.appendChild(ul);
          }
          listEl.appendChild(section);
        }
      }

      async function load(manual) {
        if (!opts.broadcasterId || !window.twitchMod.getMemberList) {
          showStatus('err', 'Memberliste nicht verfügbar.');
          return;
        }
        if (loading) return;
        loading = true;
        if (refreshBtn) refreshBtn.disabled = true;
        if (manual || !chatters.length) showStatus('', 'Lade Memberliste…');
        setRelogin(false);

        try {
          const res = await window.twitchMod.getMemberList({
            broadcasterId: opts.broadcasterId,
            moderatorId: opts.moderatorId,
          });
          if (res && res.needsRelogin) {
            chatters = [];
            showStatus('err', res.message || 'Für die Memberliste bitte neu anmelden');
            setRelogin(true);
            setCount(null);
            listEl.innerHTML = '';
            return;
          }
          if (!res || !res.ok) {
            showStatus('err', (res && res.message) || 'Memberliste konnte nicht geladen werden.');
            return;
          }
          chatters = Array.isArray(res.chatters) ? res.chatters : [];
          modLogins = new Set((res.moderatorLogins || []).map((s) => String(s).toLowerCase()));
          vipLogins = new Set((res.vipLogins || []).map((s) => String(s).toLowerCase()));
          showStatus('', '');
          render();
        } catch (err) {
          showStatus('err', err.message || String(err));
        } finally {
          loading = false;
          if (refreshBtn) refreshBtn.disabled = false;
        }
      }

      function schedule() {
        if (timer) clearInterval(timer);
        timer = setInterval(() => load(false), REFRESH_MS);
      }

      setPaneOpen(readPaneOpen());

      if (toggle) {
        toggle.addEventListener('click', () => {
          setPaneOpen(layout.classList.contains('members-collapsed'));
        });
      }
      if (expand) {
        expand.addEventListener('click', () => setPaneOpen(true));
      }
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => load(true));
      }
      if (searchEl) {
        searchEl.addEventListener('input', () => render());
      }
      if (reloginBtn && typeof window.twitchMod.relogin === 'function') {
        reloginBtn.addEventListener('click', async () => {
          reloginBtn.disabled = true;
          try {
            await window.twitchMod.relogin();
            showStatus('', 'Bitte im Hauptfenster neu anmelden. Danach wird die Liste geladen.');
          } catch (err) {
            showStatus('err', err.message || String(err));
          } finally {
            reloginBtn.disabled = false;
          }
        });
      }
      if (typeof window.twitchMod.onSessionUpdated === 'function') {
        window.twitchMod.onSessionUpdated(() => load(true));
      }

      window.TwitchyMembers.refresh = () => render();
      window.addEventListener('beforeunload', () => {
        if (timer) clearInterval(timer);
      });

      load(true);
      schedule();
    },
  };
})();
