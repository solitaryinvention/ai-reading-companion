import { it, expect } from 'vitest';
import { isNextSegment, matchingSegment } from '../src/continue-reading';
it('recognizes standalone continuation requests without hijacking ordinary questions', () => {
  for (const text of ['下一节', '下一段', '继续', '请继续讲解', '下一部分']) expect(isNextSegment(text)).toBe(true);
  for (const text of ['下一节为什么讨论这个问题？', '不要继续', '请解释继续的意思']) expect(isNextSegment(text)).toBe(false);
});
it('matches complete copied segments instead of arbitrary short phrases', () => {
  const text = '完整的原文内容需要足够长，才能确定它对应哪一个实际的分段。';
  expect(matchingSegment([text, '另一个完整的原文内容，需要用来解释第二个具体问题。'], '请讲解：' + text)).toBe(0);
  expect(matchingSegment([text], '完全不同的内容')).toBe(-1);
});
