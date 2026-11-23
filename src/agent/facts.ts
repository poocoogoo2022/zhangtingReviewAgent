import type { TradingDayData } from '../data/types.js';

export function formatTradingDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
}

/** 同一份确定性统计用于原始摘要、模型输入和最终报告。 */
export function buildMarketFacts(data: TradingDayData): string {
  const { prevDate, limitUp, brokenBoard, limitDown, prevDayPerformance } = data;
  const ladder = new Map<number, number>();
  const industries = new Map<string, string[]>();
  for (const stock of limitUp) {
    const boards = stock.consecutiveBoards;
    ladder.set(boards, (ladder.get(boards) ?? 0) + 1);
    const industry = stock.industry?.trim() || '未分类';
    const member = `${tableCell(stock.name)}（${stock.code}）`;
    const members = industries.get(industry);
    if (members) members.push(member);
    else industries.set(industry, [member]);
  }

  const tiers = [...ladder].sort(([a], [b]) => b - a);
  const consecutiveCount = tiers.reduce((sum, [boards, count]) => sum + (boards >= 2 ? count : 0), 0);
  const rankedIndustries = [...industries].sort(([a, stocksA], [b, stocksB]) =>
    stocksB.length - stocksA.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  const totalTouched = limitUp.length + brokenBoard.length;
  const sealRate = totalTouched > 0
    ? formatPct((limitUp.length / totalTouched) * 100)
    : '不适用（无摸板样本）';
  const lines = [
    '## 总览',
    `- 涨停 ${limitUp.length} 家，炸板 ${brokenBoard.length} 家，封板成功率 ${sealRate}`,
    `- 跌停 ${limitDown.length} 家`,
    `- 连板股 ${consecutiveCount} 家，最高板 ${tiers[0]?.[0] ?? 0} 板`,
    '',
    '## 连板梯队（含首板）',
  ];
  if (tiers.length > 0) {
    lines.push('| 板数 | 家数 |', '|---|---:|');
    for (const [boards, count] of tiers) lines.push(`| ${boards} 板 | ${count} |`);
  } else {
    lines.push('无涨停样本。');
  }

  lines.push('', '## 行业涨停分布（按数据源行业标签，非概念题材）');
  if (rankedIndustries.length > 0) {
    lines.push('| 行业 | 涨停家数 | 涨停个股 |', '|---|---:|---|');
    for (const [industry, members] of rankedIndustries) {
      lines.push(`| ${tableCell(industry)} | ${members.length} | ${members.join('、')} |`);
    }
  } else {
    lines.push('无涨停样本。');
  }

  if (prevDate && prevDayPerformance.length > 0) {
    const valid = prevDayPerformance.flatMap(({ name, todayChangePct }) =>
      todayChangePct !== null && Number.isFinite(todayChangePct) ? [{ name, change: todayChangePct }] : [],
    );
    const total = prevDayPerformance.length;
    const promoted = prevDayPerformance.filter((p) => p.promoted).length;
    lines.push(
      '',
      `## 上一交易日（${formatTradingDate(prevDate)}）涨停股在复盘日的表现`,
      `- 上一交易日涨停 ${total} 只，复盘日再涨停 ${promoted} 只，晋级率 ${formatPct((promoted / total) * 100)}`,
      `- 涨跌幅行情覆盖 ${valid.length}/${total} 只`,
    );
    if (data.prevDayQuoteWarning) lines.push(`- 行情说明：${data.prevDayQuoteWarning}`);
    if (valid.length > 0) {
      const avg = valid.reduce((sum, p) => sum + p.change, 0) / valid.length;
      const losers = valid.filter((p) => p.change <= -3).map((p) => `${p.name}(${formatPct(p.change)})`);
      lines.push(`- 有行情样本的平均涨跌幅：${formatPct(avg)}`);
      lines.push(`- 有行情样本中涨跌幅 ≤ -3%：${losers.join('、') || '无'}`);
    } else {
      lines.push('- 缺少复盘日涨跌幅，无法计算平均涨跌幅或列出下跌个股');
    }
  } else {
    lines.push('', '## 上一交易日涨停股追踪', '无可用的上一交易日涨停样本，无法计算晋级率或平均涨跌幅。');
  }
  return lines.join('\n');
}
