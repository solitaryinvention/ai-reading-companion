import type { DetailLevel } from './types';

export const detailLevels = [
  { value: 1, name: '极简', description: '少量文字，直接讲清核心意思。' },
  { value: 2, name: '简明', description: '核心观点与必要解释，适当举例。' },
  { value: 3, name: '标准', description: '交代概念、论证过程与必要背景。' },
  { value: 4, name: '详细', description: '展开论证步骤、例子、前提与局限。' },
  { value: 5, name: '深入', description: '完整授课，细讲背景、概念联系与争议。' },
] as const;

export function normalizeDetail(value: unknown): DetailLevel {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5 ? (value as DetailLevel) : 3;
}

export function detailInstruction(value: unknown) {
  const item = detailLevels[normalizeDetail(value) - 1];
  return `\n本次讲解详略：${item.value}/5（${item.name}）。${item.description} 这控制解释展开程度，不是模型推理强度，不规定固定字数。低档可精炼概述，高档展开完整论证，但不要重复凑字。与 agent.md 的一般详略要求冲突时，以本次档位为准；用户本次明确要求的长度或讲法优先。各档均须忠实原文，不省略影响结论的关键条件，不因深入档位编造未提供的内容；缺少原文须明确说明。\n`;
}
