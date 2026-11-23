import type { TradingDayData } from '../data/types.js';
import type { DeepSeekClient } from '../llm/deepseek.js';
import { buildMarketFacts, formatTradingDate } from './facts.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

export interface ReviewResult {
  date: string;
  report: string; // Markdown 复盘报告
}

/** 程序渲染事实区，模型只生成解读区；onDelta 输出整份报告。 */
export async function runReview(
  client: Pick<DeepSeekClient, 'chat' | 'chatStream'>,
  data: TradingDayData,
  onDelta?: (text: string) => void,
): Promise<ReviewResult> {
  const facts = buildMarketFacts(data);
  const prefix = `# ${formatTradingDate(data.date)} 涨停复盘\n\n${facts}\n\n## DeepSeek 解读\n\n`;
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(data, facts) },
  ];
  if (onDelta) onDelta(prefix);
  const analysis = onDelta
    ? await client.chatStream(messages, onDelta)
    : await client.chat(messages);
  if (!analysis.trim()) throw new Error('DeepSeek 返回空解读');
  if (onDelta) onDelta('\n');
  return { date: data.date, report: `${prefix}${analysis}\n` };
}
