const listEl = document.getElementById('list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const emptyEl = document.getElementById('empty');
const userNameEl = document.getElementById('userName');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');

let currentUser = null;

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || '';
}

async function loadChannels() {
  showError('');
  loadingEl.hidden = false;
  listEl.hidden = true;
  emptyEl.hidden = true;
  listEl.innerHTML = '';

  try {
    const { channels, user } = await window.twitchMod.listChannels();
    currentUser = user;
    userNameEl.textContent = user.display_name || user.login;
    loadingEl.hidden = true;

    if (!channels.length) {
      emptyEl.hidden = false;
      return;
    }

    listEl.hidden = false;
    for (const ch of channels) {
      const card = document.createElement('article');
      card.className = 'card' + (ch.is_own ? ' own' : '');

      const badge = ch.is_own
        ? '<span class="badge own-badge">Dein Kanal · Broadcaster</span>'
        : '<span class="badge mod-badge">Moderator</span>';

      card.innerHTML = `
        ${badge}
        <h2>${escapeHtml(ch.broadcaster_name)}</h2>
        <div class="login">@${escapeHtml(ch.broadcaster_login)}</div>
        <button type="button">${ch.is_own ? 'Eigenen Kanal öffnen' : 'Kanal öffnen'}</button>
      `;
      card.querySelector('button').addEventListener('click', async () => {
        try {
          await window.twitchMod.openChannel({
            broadcasterId: ch.broadcaster_id,
            broadcasterLogin: ch.broadcaster_login,
            broadcasterName: ch.broadcaster_name,
            // Broadcaster acts as moderator on their own channel (Helix allows this)
            moderatorUserId: currentUser.id,
            moderatorLogin: currentUser.login,
          });
        } catch (err) {
          showError(err.message || String(err));
        }
      });
      listEl.appendChild(card);
    }
  } catch (err) {
    loadingEl.hidden = true;
    showError(err.message || String(err));
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

refreshBtn.addEventListener('click', loadChannels);
logoutBtn.addEventListener('click', async () => {
  await window.twitchMod.logout();
});

loadChannels();

// ---- Hervorgehobene Wörter ----
const hlForm = document.getElementById('hlForm');
const hlInput = document.getElementById('hlInput');
const hlList = document.getElementById('hlList');
const hlEmpty = document.getElementById('hlEmpty');
const hlError = document.getElementById('hlError');
let highlightWords = [];

function showHlError(msg) {
  hlError.hidden = !msg;
  hlError.textContent = msg || '';
}

function renderHighlightWords() {
  while (hlList.firstChild) hlList.removeChild(hlList.firstChild);
  hlEmpty.hidden = highlightWords.length > 0;
  for (const word of highlightWords) {
    const li = document.createElement('li');
    li.className = 'hl-chip';
    const label = document.createElement('span');
    label.textContent = word;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'hl-remove';
    rm.textContent = '×';
    rm.title = `„${word}“ entfernen`;
    rm.setAttribute('aria-label', `${word} entfernen`);
    rm.addEventListener('click', () => {
      saveHighlightWords(highlightWords.filter((w) => w !== word));
    });
    li.appendChild(label);
    li.appendChild(rm);
    hlList.appendChild(li);
  }
}

async function saveHighlightWords(next) {
  showHlError('');
  try {
    highlightWords = await window.twitchMod.setHighlightWords(next);
    renderHighlightWords();
  } catch (err) {
    showHlError(err.message || String(err));
  }
}

hlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = hlInput.value.replace(/\s+/g, ' ').trim();
  if (!word) return;
  const exists = highlightWords.some((w) => w.toLocaleLowerCase() === word.toLocaleLowerCase());
  hlInput.value = '';
  hlInput.focus();
  if (exists) return;
  await saveHighlightWords([...highlightWords, word]);
});

if (typeof window.twitchMod.onHighlightWordsChanged === 'function') {
  window.twitchMod.onHighlightWordsChanged((list) => {
    highlightWords = Array.isArray(list) ? list : [];
    renderHighlightWords();
  });
}

(async function loadHighlightWords() {
  try {
    highlightWords = await window.twitchMod.getHighlightWords();
  } catch (err) {
    showHlError(err.message || String(err));
  }
  renderHighlightWords();
})();
