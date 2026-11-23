import type { TradingDayData } from '../data/types.js';

export const SYSTEM_PROMPT = `你是一位专业的 A 股短线交易员，专注涨停板复盘。你的读者是短线打板/接力选手。
基于用户提供的盘面数据，输出一份涨停复盘报告，要求：

1. 【市场情绪】用数据说话：涨停/炸板/跌停家数、封板成功率（涨停÷(涨停+炸板)）、昨日涨停今日平均溢价与晋级率，判断情绪周期位置（冰点/修复/发酵/高潮/退潮）并说明依据。
2. 【连板梯队】梳理最高板与梯队结构（如 5板/3板/2板），点评梯队是否完整、有无断层风险。
3. 【主线题材】按行业/概念归纳涨停股，找出涨停家数最多的 1-3 条主线，分析其持续性（梯队支撑、首板补充、封板质量）。
4. 【个股点评】点评最高板、人气核心（封单大、一字板、换手充分等特征），以及风险信号（尾盘回封、多次炸板、缩量加速）。
5. 【明日策略】给出 2-4 条可执行的观察要点与风险提示，明确仓位建议对应的情绪前提。

风格要求：
- 专业、直接、有观点，避免空话套话；每个结论都要引用具体数据或个股。
- 不做收益承诺，结尾加一句风险提示（股市有风险）。
- 用 Markdown 输出，小标题用 ##，正文简洁，全文 800-1500 字。`;

function fmtPct(x: number): string {
  return `${x.toFixed(2)}%`;
}

function fmtAmount(x: number): string {
  if (x >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
  if (x >= 1e4) return `${(x / 1e4).toFixed(0)}万`;
  return `${x.toFixed(0)}`;
}

function fmtCap(x: number): string {
  return `${(x / 1e8).toFixed(1)}亿`;
}

/** 把结构化数据渲染成给 LLM 的盘面摘要（Markdown 表格） */
export function buildMarketSummary(data: TradingDayData): string {
  const { date, prevDate, limitUp, brokenBoard, limitDown, prevDayPerformance } = data;
  const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  const lines: string[] = [`# ${d} 盘面数据\n`];

  // 总览
  const totalBoard = limitUp.length + brokenBoard.length;
  const sealRate = totalBoard > 0 ? (limitUp.length / totalBoard) * 100 : 0;
  lines.push(`## 总览
- 涨停 ${limitUp.length} 家，炸板 ${brokenBoard.length} 家，封板成功率 ${fmtPct(sealRate)}
- 跌停 ${limitDown.length} 家
- 连板股 ${limitUp.filter((s) => s.consecutiveBoards >= 2).length} 家，最高板 ${
    Math.max(0, ...limitUp.map((s) => s.consecutiveBoards))
  } 板`);

  // 昨日涨停表现
  if (prevDate && prevDayPerformance.length > 0) {
    const valid = prevDayPerformance.filter((p) => !Number.isNaN(p.todayChangePct));
    const avg = valid.reduce((a, b) => a + b.todayChangePct, 0) / (valid.length || 1);
    const promoted = prevDayPerformance.filter((p) => p.promoted);
    const pd = `${prevDate.slice(0, 4)}-${prevDate.slice(4, 6)}-${prevDate.slice(6, 8)}`;
    lines.push(`\n## 昨日（${pd}）涨停股今日表现
- 昨日涨停 ${prevDayPerformance.length} 只，今日平均涨幅 ${fmtPct(avg)}
- 晋级（今日再涨停）${promoted.length} 只，晋级率 ${fmtPct(
      (promoted.length / prevDayPerformance.length) * 100,
    )}
- 今日跌幅超 -3%：${valid
      .filter((p) => p.todayChangePct <= -3)
      .map((p) => `${p.name}(${fmtPct(p.todayChangePct)})`)
      .join('、') || '无'}`);
  }

  // 涨停明细（按连板数降序，再按封板时间）
  const sorted = [...limitUp].sort(
    (a, b) => b.consecutiveBoards - a.consecutiveBoards || a.firstSealTime.localeCompare(b.firstSealTime),
  );
  lines.push(`\n## 涨停明细（${limitUp.length} 家）
| 代码 | 名称 | 连板 | 涨停统计 | 首封 | 最后封 | 炸板 | 封单 | 成交额 | 换手 | 流通市值 | 行业 |
|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of sorted) {
    lines.push(
      `| ${s.code} | ${s.name} | ${s.consecutiveBoards} | ${s.statsDays}天${s.statsCount}板 | ${s.firstSealTime} | ${s.lastSealTime} | ${s.breakCount} | ${fmtAmount(s.sealFund)} | ${fmtAmount(s.amount)} | ${fmtPct(s.turnoverRate)} | ${fmtCap(s.floatMarketCap)} | ${s.industry} |`,
    );
  }

  // 炸板明细
  if (brokenBoard.length > 0) {
    lines.push(`\n## 炸板明细（${brokenBoard.length} 家）
| 代码 | 名称 | 涨幅 | 炸板次数 | 成交额 | 换手 | 行业 |
|---|---|---|---|---|---|---|`);
    for (const s of brokenBoard) {
      lines.push(
        `| ${s.code} | ${s.name} | ${fmtPct(s.changePct)} | ${s.breakCount} | ${fmtAmount(s.amount)} | ${fmtPct(s.turnoverRate)} | ${s.industry} |`,
      );
    }
  }

  // 跌停
  if (limitDown.length > 0) {
    lines.push(`\n## 跌停明细（${limitDown.length} 家）`);
    for (const s of limitDown) {
      lines.push(
        `- ${s.name}(${s.code}) ${fmtPct(s.changePct)}，成交 ${fmtAmount(s.amount)}，${s.industry}`,
      );
    }
  }

  return lines.join('\n');
}

export function buildUserPrompt(data: TradingDayData): string {
  return `以下是 ${data.date} 的 A 股涨停复盘原始数据，请按系统设定输出复盘报告。\n\n${buildMarketSummary(data)}`;
}
