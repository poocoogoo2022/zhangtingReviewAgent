import type { TradingDayData } from '../data/types.js';
import type { DeepSeekClient } from '../llm/deepseek.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

export interface ReviewResult {
  date: string;
  report: string; // Markdown 复盘报告
}

/**
 * 涨停复盘 Agent：盘面数据 → DeepSeek → Markdown 复盘报告
 * onDelta 传入时走流式输出（CLI 实时打印）。
 */
export async function runReview(
  client: DeepSeekClient,
  data: TradingDayData,
  onDelta?: (text: string) => void,
): Promise<ReviewResult> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(data) },
  ];
  const report = onDelta
    ? await client.chatStream(messages, onDelta)
    : await client.chat(messages);
  return { date: data.date, report };
}
