(function () {
  /** Known chat bots — extend here. A bot that is also a mod still goes into Bots. */
  const LOGINS = [
    'streamelements',
    'nightbot',
    'moobot',
    'fossabot',
    'wizebot',
    'streamlabs',
    'soundalerts',
    'sery_bot',
    'commanderroot',
    'botrixoficial',
    'kofistreambot',
  ];
  const SET = new Set(LOGINS);

  window.TwitchyBots = {
    LOGINS,
    isBot(login, badges) {
      const name = String(login || '').toLowerCase();
      if (name && SET.has(name)) return true;
      const set = new Set((badges || []).map((b) => String(b).toLowerCase()));
      return set.has('bot') || set.has('twitchbot');
    },
  };
})();
