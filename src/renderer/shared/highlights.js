/**
 * Highlight user-defined words/phrases in chat message bodies with a red frame.
 * Works on text nodes only (emote <img>s are never touched) and builds DOM
 * nodes via textContent – no innerHTML with chat or user text.
 */
(function (global) {
  const HL_CLASS = 'hl-word';
  const WORD_CHAR = /[\p{L}\p{N}_]/u;

  /** @type {RegExp|null} */
  let regex = null;
  /** @type {string[]} */
  let words = [];

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  }

  function buildRegex(list) {
    const clean = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      if (typeof raw !== 'string') continue;
      const w = raw.replace(/\s+/g, ' ').trim();
      if (!w) continue;
      const key = w.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(w);
    }
    if (!clean.length) return null;
    // Longest first so phrases win over contained single words.
    clean.sort((a, b) => b.length - a.length);
    const parts = clean.map((w) => {
      // Whitespace inside a phrase matches any run of whitespace.
      let src = w.split(' ').map(escapeRegex).join('\\s+');
      // Unicode-aware whole-word boundaries (umlauts count as letters),
      // only on edges that are themselves word characters.
      const first = Array.from(w)[0];
      const last = Array.from(w).pop();
      if (WORD_CHAR.test(first)) src = '(?<![\\p{L}\\p{N}_])' + src;
      if (WORD_CHAR.test(last)) src = src + '(?![\\p{L}\\p{N}_])';
      return src;
    });
    try {
      return new RegExp(parts.join('|'), 'giu');
    } catch (err) {
      console.warn('[highlights] regex build failed', err);
      return null;
    }
  }

  function setWords(list) {
    words = Array.isArray(list) ? list.slice() : [];
    regex = buildRegex(words);
  }

  function getWords() {
    return words.slice();
  }

  /** Remove existing highlight spans inside el (restore plain text). */
  function clear(el) {
    const spans = el.querySelectorAll('span.' + HL_CLASS);
    for (const span of spans) {
      const text = document.createTextNode(span.textContent || '');
      span.replaceWith(text);
    }
    el.normalize();
  }

  /** Wrap matches in text nodes of el with <span class="hl-word">. */
  function apply(el) {
    if (!el) return;
    clear(el);
    if (!regex) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const node of nodes) {
      const text = node.nodeValue || '';
      if (!text) continue;
      regex.lastIndex = 0;
      let m;
      let cursor = 0;
      let frag = null;
      while ((m = regex.exec(text))) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (!frag) frag = document.createDocumentFragment();
        if (m.index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
        }
        const span = document.createElement('span');
        span.className = HL_CLASS;
        span.textContent = m[0];
        frag.appendChild(span);
        cursor = m.index + m[0].length;
      }
      if (!frag) continue;
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      node.parentNode.replaceChild(frag, node);
    }
  }

  /** Re-apply to all message bodies under root (e.g. after the list changed). */
  function applyAll(root, selector) {
    if (!root) return;
    const bodies = root.querySelectorAll(selector || '.chat-line .body');
    for (const body of bodies) apply(body);
  }

  global.TwitchyHighlights = {
    setWords,
    getWords,
    apply,
    applyAll,
    clear,
    buildRegex,
    escapeRegex,
  };
})(window);
