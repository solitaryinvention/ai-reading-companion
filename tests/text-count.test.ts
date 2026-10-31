import { expect, it } from 'vitest';
import { textCount } from '../src/text-count';
it('counts pasted Unicode text without whitespace, including punctuation', () => {
  expect(textCount('你好，世界！\n abc 😀')).toBe(10);
  expect(textCount(' \n\t')).toBe(0);
  expect(textCount('中'.repeat(6000))).toBe(6000);
});
