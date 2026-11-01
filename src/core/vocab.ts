// Local word list. Stays on this browser. Nothing is uploaded.

import { t } from './i18n';

export interface VocabDict {
  pos: string;
  terms: string[];
}

export interface VocabEntry {
  id: string;
  word: string;
  translation: string;
  pos: string;
  meanings: string;
  dict: VocabDict[];
  context: string;
  contextZh: string;
  title: string;
  url: string;
  savedAt: number;
}

const KEY = 'ibt_vocab';

function wordId(word: string): string {
  return word.trim().toLowerCase();
}

export async function listVocab(): Promise<VocabEntry[]> {
  const raw = await chrome.storage.local.get(KEY);
  const list = raw?.[KEY];
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item.word === 'string') as VocabEntry[];
}

export async function findVocab(word: string): Promise<VocabEntry | null> {
  const id = wordId(word);
  const list = await listVocab();
  return list.find((item) => item.id === id) || null;
}

export async function saveVocab(entry: Omit<VocabEntry, 'id' | 'savedAt'> & { savedAt?: number }): Promise<VocabEntry> {
  const list = await listVocab();
  const next: VocabEntry = {
    ...entry,
    id: wordId(entry.word),
    word: entry.word.trim(),
    savedAt: entry.savedAt || Date.now(),
  };
  const rest = list.filter((item) => item.id !== next.id);
  rest.unshift(next);
  await chrome.storage.local.set({ [KEY]: rest });
  return next;
}

export async function removeVocab(id: string): Promise<void> {
  const list = await listVocab();
  await chrome.storage.local.set({ [KEY]: list.filter((item) => item.id !== id) });
}

export async function clearVocab(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] });
}

function csvCell(value: string): string {
  const text = value.replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${text}"`;
}

export function vocabToCsv(list: VocabEntry[]): string {
  const header = [t('csvWord'), t('csvTrans'), t('csvPos'), t('csvMeaning'), t('csvExample'), t('csvExampleTr'), t('csvPage'), t('csvUrl'), t('csvDate')];
  const rows = list.map((item) => [
    item.word,
    item.translation,
    item.pos,
    item.meanings,
    item.context,
    item.contextZh || '',
    item.title,
    item.url,
    new Date(item.savedAt).toISOString().slice(0, 10),
  ].map(csvCell).join(','));
  return `\uFEFF${header.join(',')}\n${rows.join('\n')}\n`;
}

export function vocabToTxt(list: VocabEntry[]): string {
  return list.map((item) => {
    const when = new Date(item.savedAt).toISOString().slice(0, 10);
    const sense = [item.pos, item.meanings].filter(Boolean).join(' ');
    return [
      item.word,
      item.translation,
      sense,
      item.context,
      item.contextZh || '',
      [item.title, item.url].filter(Boolean).join(' '),
      when,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
