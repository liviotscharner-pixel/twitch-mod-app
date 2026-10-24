import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** Highlight words are stored as plain JSON in the Electron userData folder. */
const FILE_NAME = 'highlight-words.json';
const MAX_WORDS = 500;
const MAX_LEN = 100;

let cache: string[] | null = null;

export function highlightWordsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

/** Trim, drop empties, collapse inner whitespace, dedupe case-insensitively (keep first spelling). */
export function normalizeHighlightWords(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(input)) return out;
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const w = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    if (!w) continue;
    const key = w.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

export function getHighlightWords(): string[] {
  if (cache) return [...cache];
  try {
    const raw = fs.readFileSync(highlightWordsPath(), 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    cache = normalizeHighlightWords(Array.isArray(data) ? data : data?.words);
  } catch {
    cache = [];
  }
  return [...cache];
}

export function setHighlightWords(words: unknown): string[] {
  const list = normalizeHighlightWords(words);
  const file = highlightWordsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ words: list }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  cache = list;
  return [...list];
}
