import { hideBookNotes } from './epub-assets';

/** Chinese and Latin characters including punctuation; whitespace and semantic notes excluded. */
export const countCharacters = (text: string) => Array.from(text.replace(/\s/g, '')).length;
export function countChapterRange(doc: Document, startId?: string, endId?: string) {
  const range = doc.createRange();
  range.selectNodeContents(doc.body || doc.documentElement);
  const start = startId ? doc.getElementById(startId) : null;
  const end = endId ? doc.getElementById(endId) : null;
  if (start) range.setStartBefore(start);
  if (end) range.setEndBefore(end);
  const fragment = range.cloneContents();
  hideBookNotes(fragment);
  fragment
    .querySelectorAll('head,script,style,nav,[data-reader-note],[hidden],[aria-hidden="true"]')
    .forEach((n) => n.remove());
  return countCharacters(fragment.textContent || '');
}
