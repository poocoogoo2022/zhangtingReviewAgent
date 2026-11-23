import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketFacts } from '../dist/agent/facts.js';
import { buildMarketSummary } from '../dist/agent/prompt.js';
import { runReview } from '../dist/agent/review.js';

function stock(code, name, consecutiveBoards, industry) {
  return {
    code, name, consecutiveBoards, industry, market: 0,
    price: 11, changePct: 10, amount: 100_000, floatMarketCap: 2_000_000,
    totalMarketCap: 3_000_000, turnoverRate: 1, firstSealTime: '09:30:00',
    lastSealTime: '09:30:00', sealFund: 10_000, breakCount: 0,
    statsDays: consecutiveBoards, statsCount: consecutiveBoards,
  };
}

// 上次真实报告把元件行业的六只涨停股写成了五家。
const components = [
  stock('002579', '中京电子', 2, '元件'),
  stock('002199', '东晶电子', 1, '元件'),
  stock('000823', '超声电子', 1, '元件'),
  stock('605058', '澳弘电子', 1, '元件'),
  stock('603386', '骏亚科技', 1, '元件'),
  stock('301132', '满坤科技', 1, '元件'),
];
const data = {
  date: '20261120',
  prevDate: '20261119',
  limitUp: [stock('002771', '真视通', 4, 'IT服务Ⅱ'), ...components],
  brokenBoard: [],
  limitDown: [],
  prevDayPerformance: [{ code: '002771', name: '真视通', promoted: true, todayChangePct: null }],
};

test('元件行业统计为六家，梯队按板数排列且不补出三板', () => {
  const facts = buildMarketFacts(data);
  const industryRow = facts.split('\n').find((line) => line.startsWith('| 元件 |'));
  assert.equal(industryRow, `| 元件 | 6 | ${components.map(({ name, code }) => `${name}（${code}）`).join('、')} |`);
  assert.match(facts, /\| 4 板 \| 1 \|\n\| 2 板 \| 1 \|\n\| 1 板 \| 5 \|/);
  assert.match(facts, /连板股 2 家，最高板 4 板/);
  assert.match(facts, /涨跌幅行情覆盖 0\/1 只/);
  assert.ok(buildMarketSummary(data).includes(facts));
});

test('无涨停样本不造梯队；未提供行业的个股计入未分类', () => {
  const empty = buildMarketFacts({ ...data, limitUp: [], prevDate: null, prevDayPerformance: [] });
  assert.match(empty, /封板成功率 不适用/);
  assert.match(empty, /连板梯队（含首板）\n无涨停样本/);
  assert.match(empty, /无法计算晋级率/);
  const uncategorized = buildMarketFacts({ ...data, limitUp: [stock('000001', '示例甲', 1, '  ')] });
  assert.match(uncategorized, /\| 未分类 \| 1 \| 示例甲（000001） \|/);
});

test('模型收到同一份统计；流式输出与最终 Markdown 内容一致', async () => {
  const facts = buildMarketFacts(data);
  const chunks = [];
  const analysis = '### 梯队观察\n\n四板和二板之间存在断层。';
  const client = {
    async chatStream(messages, emit) {
      assert.ok(messages[1].content.includes(facts));
      emit('### 梯队观察\n\n');
      emit('四板和二板之间存在断层。');
      return analysis;
    },
    async chat() { return analysis; },
  };
  const result = await runReview(client, data, (chunk) => chunks.push(chunk));
  assert.equal(result.date, data.date);
  assert.equal(result.report, `# 2026-11-20 涨停复盘\n\n${facts}\n\n## DeepSeek 解读\n\n${analysis}\n`);
  assert.equal(chunks.join(''), result.report);
  assert.deepEqual(await runReview(client, data), result);
});

test('流式响应未生成有效解读时不返回成功报告', async () => {
  await assert.rejects(runReview({ async chatStream() { return ' '; } }, data, () => {}), /DeepSeek 返回空解读/);
});
