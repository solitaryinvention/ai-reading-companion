import type { DetailLevel } from './types';

export const detailLevels = [
  { value: 1, name: '极简', description: '少量文字，直接讲清核心意思。' },
  { value: 2, name: '简明', description: '核心观点与必要解释，适当举例。' },
  { value: 3, name: '标准', description: '叙事交代必要经过，理论讲清概念与理由。' },
  { value: 4, name: '详细', description: '叙事展开有依据的过程，理论展开论证与例子。' },
  { value: 5, name: '深入', description: '依内容充分展开，保留叙事节奏或理论推理，不强制授课。' },
] as const;

export function normalizeDetail(value: unknown): DetailLevel {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5 ? (value as DetailLevel) : 3;
}

export function detailInstruction(value: unknown) {
  const item = detailLevels[normalizeDetail(value) - 1];
  return `\n本次讲解详略：${item.value}/5（${item.name}）。${item.description} 这控制解释展开程度，不是模型推理强度，不规定固定字数。先根据当前内容选择叙事、理论或混合讲法，档位不把故事变成课堂。低档减少次要细节，保留必要经过或关键推理；高档补足有依据的细节或论证，不增加空泛点评和重复。与 agent.md 的一般详略要求冲突时，以本次档位为准；用户本次明确要求的长度或讲法优先。各档均须忠实原文，不省略影响结论的关键条件，不编造未提供的内容；缺少原文须明确说明。\n`;
}
