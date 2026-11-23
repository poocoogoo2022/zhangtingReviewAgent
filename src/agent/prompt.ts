import type { TradingDayData } from '../data/types.js';
import { buildMarketFacts, formatPct, formatTradingDate } from './facts.js';

export const SYSTEM_PROMPT = `你是 A 股盘面复盘助手，负责解读给定数据。程序会在报告中直接展示总览、连板梯队和行业分布；你只写解读，不输出报告标题、统计表或重复列举行业家数与连板家数。需要引用数字时，以已给出的统计为准，不根据明细重新计数。

1. 【市场情绪】基于封板、跌停及晋级情况解读盘面，区分数据和判断。单日数据不能证明情绪周期或资金流向时，明确说明。
2. 【梯队与行业】解读梯队有无断层，分析领先行业是否有高板和首板支撑。东方财富行业标签不是概念题材，不能据此推断概念归属或上涨原因。
3. 【个股表现】引用可核对的封板时间、炸板次数、成交额、封单或换手率。没有开盘及盘中价格数据，不能仅凭首封时间和零炸板认定一字板；没有历史成交量时，不判断放量或缩量。
4. 【下一交易日观察】提出待验证的观察点和风险，不给出具体买卖、仓位或收益建议，不将推测写成事实。

数据缺失时明确注明，不将缺失值视为零，不推测未提供的涨跌幅或平均涨幅。用 Markdown 输出，分节用三级标题（###），结尾加上风险提示。`;

function fmtAmount(x: number): string {
  if (x >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
  if (x >= 1e4) return `${(x / 1e4).toFixed(0)}万`;
  return `${x.toFixed(0)}`;
}

function fmtCap(x: number): string {
  return `${(x / 1e8).toFixed(1)}亿`;
}

/** 把结构化数据渲染成给 LLM 的盘面摘要（Markdown 表格） */
export function buildMarketSummary(data: TradingDayData, facts = buildMarketFacts(data)): string {
  const { date, limitUp, brokenBoard, limitDown } = data;
  const lines = [`# ${formatTradingDate(date)} 盘面数据\n`, facts];

  // 涨停明细（按连板数降序，再按封板时间）
  const sorted = [...limitUp].sort(
    (a, b) => b.consecutiveBoards - a.consecutiveBoards || a.firstSealTime.localeCompare(b.firstSealTime),
  );
  lines.push(`\n## 涨停明细（${limitUp.length} 家）
| 代码 | 名称 | 连板 | 涨停统计 | 首封 | 最后封 | 炸板 | 封单 | 成交额 | 换手 | 流通市值 | 行业 |
|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of sorted) {
    lines.push(
      `| ${s.code} | ${s.name} | ${s.consecutiveBoards} | ${s.statsDays}天${s.statsCount}板 | ${s.firstSealTime} | ${s.lastSealTime} | ${s.breakCount} | ${fmtAmount(s.sealFund)} | ${fmtAmount(s.amount)} | ${formatPct(s.turnoverRate)} | ${fmtCap(s.floatMarketCap)} | ${s.industry} |`,
    );
  }

  // 炸板明细
  if (brokenBoard.length > 0) {
    lines.push(`\n## 炸板明细（${brokenBoard.length} 家）
| 代码 | 名称 | 涨幅 | 炸板次数 | 成交额 | 换手 | 行业 |
|---|---|---|---|---|---|---|`);
    for (const s of brokenBoard) {
      lines.push(
        `| ${s.code} | ${s.name} | ${formatPct(s.changePct)} | ${s.breakCount} | ${fmtAmount(s.amount)} | ${formatPct(s.turnoverRate)} | ${s.industry} |`,
      );
    }
  }

  // 跌停
  if (limitDown.length > 0) {
    lines.push(`\n## 跌停明细（${limitDown.length} 家）`);
    for (const s of limitDown) {
      lines.push(
        `- ${s.name}(${s.code}) ${formatPct(s.changePct)}，成交 ${fmtAmount(s.amount)}，${s.industry}`,
      );
    }
  }

  return lines.join('\n');
}

export function buildUserPrompt(data: TradingDayData, facts = buildMarketFacts(data)): string {
  return `以下是 ${formatTradingDate(data.date)} 的 A 股复盘统计和明细。请仅撰写解读部分。\n\n${buildMarketSummary(data, facts)}`;
}
