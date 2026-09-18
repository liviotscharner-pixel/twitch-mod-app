const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('loginBtn');
const clientHint = document.getElementById('clientHint');
const redirectUriEl = document.getElementById('redirectUri');

function showStatus(type, text) {
  statusEl.hidden = false;
  statusEl.className = 'status ' + type;
  statusEl.textContent = text;
}

async function init() {
  try {
    const status = await window.twitchMod.getAuthStatus();
    if (status.redirectUri) redirectUriEl.textContent = status.redirectUri;
    if (!status.clientIdConfigured) {
      showStatus(
        'error',
        'Keine Client ID gefunden. Kopiere .env.example nach .env und trage TWITCH_CLIENT_ID ein, dann starte die App neu.'
      );
      loginBtn.disabled = true;
      clientHint.textContent = 'Client ID: nicht konfiguriert';
    } else {
      clientHint.textContent = 'Client ID: konfiguriert ✓';
      if (status.loggedIn && status.user) {
        showStatus('ok', `Bereits angemeldet als ${status.user.display_name}. Lade Kanäle…`);
        // Main process should already route to channels; this is a fallback refresh path
      }
    }
  } catch (err) {
    showStatus('error', err.message || String(err));
  }
}

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true;
  showStatus('info', 'Browser wird geöffnet – bitte bei Twitch anmelden und freigeben…');
  try {
    const result = await window.twitchMod.login();
    showStatus('ok', `Willkommen, ${result.user.display_name}!`);
  } catch (err) {
    showStatus('error', err.message || String(err));
    loginBtn.disabled = false;
  }
});

init();
