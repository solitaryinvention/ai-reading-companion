export const isNextSegment = (text: string) => /^(?:请|帮我|麻烦)?\s*(?:继续(?:讲解|概述|讲|读)?(?:下一[节段部分]+)?|下一(?:节|段|部分)(?:的内容)?)(?:吧|，?请(?:概述|讲解))?[。！!？?\s]*$/u.test(text.trim());
export const compactText = (text: string) => text.replace(/\s/gu, '');
export function matchingSegment(texts: string[], previous: string) {
  const input = compactText(previous);
  if (!input) return -1;
  // A pasted original may contain a question before/after it; never match only a tiny phrase.
  const found = texts.map((text, i) => ({ text: compactText(text), i })).filter(item => item.text.length >= 20 && input.includes(item.text));
  return found.length ? found.at(-1)!.i : -1;
}
