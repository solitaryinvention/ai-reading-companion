/** Count Unicode characters, excluding whitespace; punctuation counts, not tokens. */
export const textCount = (text: string) => Array.from(text.replace(/\s/gu, '')).length;
