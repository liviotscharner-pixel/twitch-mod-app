const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('loginBtn');
const clientHint = document.getElementById('clientHint');
const authModeHint = document.getElementById('authModeHint');
const redirectUriEl = document.getElementById('redirectUri');
const deviceCodeBox = document.getElementById('deviceCodeBox');
const deviceCodeValue = document.getElementById('deviceCodeValue');

let authMode = 'device';
let unsubscribeDeviceCode = null;

function showStatus(type, text) {
  statusEl.hidden = false;
  statusEl.className = 'status ' + type;
  statusEl.textContent = text;
}

function hideDeviceCode() {
  deviceCodeBox.hidden = true;
  deviceCodeValue.textContent = '';
}

function showDeviceCode(userCode) {
  deviceCodeBox.hidden = false;
  deviceCodeValue.textContent = userCode;
}

async function init() {
  try {
    const status = await window.twitchMod.getAuthStatus();
    if (status.redirectUri) redirectUriEl.textContent = status.redirectUri;
    authMode = status.authMode || 'device';

    if (authMode === 'device') {
      authModeHint.textContent =
        'Modus: Öffentliche App (Device Code) – Browser öffnet sich, Code freigeben.';
    } else {
      authModeHint.textContent =
        'Modus: Confidential (Authorization Code + PKCE) – Browser-Callback auf localhost.';
    }

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
      }
    }
  } catch (err) {
    showStatus('error', err.message || String(err));
  }
}

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true;
  hideDeviceCode();

  if (unsubscribeDeviceCode) {
    unsubscribeDeviceCode();
    unsubscribeDeviceCode = null;
  }

  if (typeof window.twitchMod.onDeviceCode === 'function') {
    unsubscribeDeviceCode = window.twitchMod.onDeviceCode(({ userCode }) => {
      showDeviceCode(userCode);
      showStatus(
        'info',
        `Browser geöffnet – bei Twitch anmelden und freigeben. Code: ${userCode}`
      );
    });
  }

  if (authMode === 'device') {
    showStatus(
      'info',
      'Device-Code-Anmeldung: Browser öffnet sich. Code eingeben / freigeben und warten…'
    );
  } else {
    showStatus('info', 'Browser wird geöffnet – bitte bei Twitch anmelden und freigeben…');
  }

  try {
    const result = await window.twitchMod.login();
    hideDeviceCode();
    showStatus('ok', `Willkommen, ${result.user.display_name}!`);
  } catch (err) {
    hideDeviceCode();
    showStatus('error', err.message || String(err));
    loginBtn.disabled = false;
  } finally {
    if (unsubscribeDeviceCode) {
      unsubscribeDeviceCode();
      unsubscribeDeviceCode = null;
    }
  }
});

init();
