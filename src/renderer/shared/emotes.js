/**
 * Twitch IRC + BetterTTV emote rendering for chat messages.
 * Uses DOM APIs only (no innerHTML) to avoid XSS.
 */
(function (global) {
  const TWITCH_CDN = (id) =>
    `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/1.0`;
  const BTTV_CDN = (id) => `https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/1x`;
  const BTTV_GLOBAL_URL = 'https://api.betterttv.net/3/cached/emotes/global';
  const BTTV_CHANNEL_URL = (twitchUserId) =>
    `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(twitchUserId)}`;

  /** @type {Promise<Map<string, {id:string,url:string}>>|null} */
  let globalPromise = null;
  /** @type {Map<string, Promise<Map<string, {id:string,url:string}>>>} */
  const channelPromises = new Map();

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Parse Twitch IRC emotes tag: "25:0-4,12-16/1902:6-10"
   * Ranges are inclusive character indices into the message body.
   * @returns {{id:string,start:number,end:number}[]}
   */
  function parseTwitchEmotesTag(emotesTag) {
    const ranges = [];
    if (!emotesTag || emotesTag === true) return ranges;
    for (const part of String(emotesTag).split('/')) {
      if (!part) continue;
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const id = part.slice(0, colon);
      const positions = part.slice(colon + 1);
      if (!id || !positions) continue;
      for (const pos of positions.split(',')) {
        const dash = pos.indexOf('-');
        if (dash === -1) continue;
        const start = Number(pos.slice(0, dash));
        const end = Number(pos.slice(dash + 1));
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start) {
          ranges.push({ id, start, end });
        }
      }
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    return ranges;
  }

  function emoteFromBttv(entry) {
    return {
      id: String(entry.id),
      url: BTTV_CDN(entry.id),
      animated: !!entry.animated,
    };
  }

  function mapFromBttvList(list) {
    const map = new Map();
    if (!Array.isArray(list)) return map;
    for (const entry of list) {
      if (!entry || !entry.id || !entry.code) continue;
      map.set(String(entry.code), emoteFromBttv(entry));
    }
    return map;
  }

  async function loadGlobalBttv() {
    if (!globalPromise) {
      globalPromise = fetch(BTTV_GLOBAL_URL)
        .then((res) => {
          if (!res.ok) throw new Error(`BTTV global HTTP ${res.status}`);
          return res.json();
        })
        .then((list) => mapFromBttvList(list))
        .catch((err) => {
          console.warn('[emotes] BTTV global load failed', err);
          globalPromise = null;
          return new Map();
        });
    }
    return globalPromise;
  }

  async function loadChannelBttv(twitchUserId) {
    const id = String(twitchUserId || '').trim();
    if (!id) return new Map();
    if (channelPromises.has(id)) return channelPromises.get(id);

    const p = fetch(BTTV_CHANNEL_URL(id))
      .then((res) => {
        if (res.status === 404) return { channelEmotes: [], sharedEmotes: [] };
        if (!res.ok) throw new Error(`BTTV channel HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const map = new Map();
        for (const entry of [...(data.channelEmotes || []), ...(data.sharedEmotes || [])]) {
          if (!entry || !entry.id || !entry.code) continue;
          map.set(String(entry.code), emoteFromBttv(entry));
        }
        return map;
      })
      .catch((err) => {
        console.warn('[emotes] BTTV channel load failed', id, err);
        channelPromises.delete(id);
        return new Map();
      });

    channelPromises.set(id, p);
    return p;
  }

  /**
   * Merged BTTV map: global + channel (+ shared). Channel codes override global.
   * @param {string} twitchUserId broadcaster Twitch user id
   * @returns {Promise<Map<string, {id:string,url:string,animated?:boolean}>>}
   */
  async function getBttvMap(twitchUserId) {
    const [globalMap, channelMap] = await Promise.all([
      loadGlobalBttv(),
      loadChannelBttv(twitchUserId),
    ]);
    const merged = new Map(globalMap);
    for (const [code, emote] of channelMap) {
      merged.set(code, emote);
    }
    return merged;
  }

  /** Drop cached channel set so the next open reloads (e.g. new channel window). */
  function invalidateChannelBttv(twitchUserId) {
    const id = String(twitchUserId || '').trim();
    if (id) channelPromises.delete(id);
  }

  function createEmoteImg(src, code) {
    const img = document.createElement('img');
    img.className = 'chat-emote';
    img.src = src;
    img.alt = code;
    img.title = code;
    img.loading = 'lazy';
    img.draggable = false;
    return img;
  }

  /**
   * Append plain text with BTTV code replacement (whitespace-delimited tokens).
   * @param {ParentNode} parent
   * @param {string} text
   * @param {Map<string, {id:string,url:string}>|null|undefined} bttvMap
   */
  function appendTextWithBttv(parent, text, bttvMap) {
    if (!text) return;
    if (!bttvMap || bttvMap.size === 0) {
      parent.appendChild(document.createTextNode(text));
      return;
    }
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        parent.appendChild(document.createTextNode(part));
        continue;
      }
      const emote = bttvMap.get(part);
      if (emote) {
        parent.appendChild(createEmoteImg(emote.url, part));
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  /**
   * Fill a message body element with Twitch + BTTV emote images.
   * @param {HTMLElement} el
   * @param {string} messageText raw chat text (without ACTION markers)
   * @param {{ emotesTag?: string, bttvMap?: Map<string,{id:string,url:string}>, isAction?: boolean }} [opts]
   */
  function fillMessageBody(el, messageText, opts) {
    const text = String(messageText || '');
    const emotesTag = opts && opts.emotesTag;
    const bttvMap = opts && opts.bttvMap;
    const isAction = opts && opts.isAction;

    while (el.firstChild) el.removeChild(el.firstChild);

    if (isAction) {
      el.appendChild(document.createTextNode('* '));
    }

    const ranges = parseTwitchEmotesTag(emotesTag);
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      if (range.end >= text.length) continue;
      if (range.start > cursor) {
        appendTextWithBttv(el, text.slice(cursor, range.start), bttvMap);
      }
      const code = text.slice(range.start, range.end + 1);
      el.appendChild(createEmoteImg(TWITCH_CDN(range.id), code));
      cursor = range.end + 1;
    }
    if (cursor < text.length) {
      appendTextWithBttv(el, text.slice(cursor), bttvMap);
    } else if (cursor === 0 && text.length === 0 && !isAction) {
      // keep empty
    }
  }

  global.TwitchyEmotes = {
    parseTwitchEmotesTag,
    getBttvMap,
    loadGlobalBttv,
    loadChannelBttv,
    invalidateChannelBttv,
    fillMessageBody,
    TWITCH_CDN,
    BTTV_CDN,
    // unused helper kept for tests/debug
    escapeRegex,
  };
})(window);
