import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketSummary } from '../dist/agent/prompt.js';
import { collectTradingDayData, fetchPool, todayCN } from '../dist/data/eastmoney.js';

const LIMIT_UP = '/getTopicZTPool';
const BROKEN = '/getTopicZBPool';
const LIMIT_DOWN = '/getTopicDTPool';
const QUOTES = '/api/qt/ulist.np/get';

function stock(code, name) {
  return { c: code, n: name, m: 0, p: 11000, zdp: 10, amount: 100000, ltsz: 2000000,
    tshare: 3000000, hs: 1, lbc: 1, fbt: 93000, hybk: '示例行业' };
}

function pool(rows, count = rows.length) {
  return Response.json({ rc: 0, data: { tc: count, pool: rows } });
}

function mockFetch(t, handler) {
  return t.mock.method(globalThis, 'fetch', async (input) => handler(new URL(input)));
}

const first = stock('000001', '示例甲');
const second = stock('000002', '示例乙');

test('跌停池使用 fund 排序，保留有效明细', async (t) => {
  const fetch = mockFetch(t, (url) => {
    if (url.pathname === LIMIT_DOWN && url.searchParams.get('sort') === 'fund:asc') {
      return pool([{ ...first, zdp: -10 }]);
    }
    return pool([], 1);
  });
  const rows = await fetchPool('dt', '20261120');
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].changePct, -10);
});

test('总数与明细不一致时明确报错，不当成零家', async (t) => {
  mockFetch(t, () => pool([], 58));
  await assert.rejects(fetchPool('dt', '20261120'), /跌停池.*总数 58，收到 0 条明细/);
});

test('总数与条数相同但出现重复标的时拒绝整池，不静默去重', async (t) => {
  mockFetch(t, () => pool([first, { ...first, hybk: '另一行业' }, second]));
  await assert.rejects(fetchPool('zt', '20261120'), /涨停池.*总数 3，仅 2 个唯一标的；重复代码 0\.000001/);
});

test('无法识别明细的股票身份时拒绝整池', async (t) => {
  mockFetch(t, () => pool([{ ...first, c: '' }]));
  await assert.rejects(fetchPool('dt', '20261120'), /跌停池.*第 1 条明细缺少有效的市场或股票代码/);
});

test('接口业务错误与合法空池是两种结果', async (t) => {
  mockFetch(t, (url) => url.pathname === BROKEN
    ? Response.json({ rc: 1, data: null })
    : pool([]));
  await assert.rejects(fetchPool('zb', '20261120'), /炸板池.*响应无效.*rc=1/);
  assert.deepEqual(await fetchPool('dt', '20261120'), []);
});

test('历史复盘不请求实时行情，只按涨停池计算晋级', async (t) => {
  const date = '20261120';
  const fetch = mockFetch(t, (url) => {
    if (url.pathname === LIMIT_UP) return pool(url.searchParams.get('date') === date ? [first] : [first, second]);
    if ([BROKEN, LIMIT_DOWN].includes(url.pathname)) return pool([]);
    return Response.json({ rc: 0, data: { diff: [{ f12: first.c, f3: 10 }] } });
  });
  const data = await collectTradingDayData(date);
  assert.equal(fetch.mock.calls.some(({ arguments: [input] }) => new URL(input).pathname === QUOTES), false);
  assert.equal(data.prevDate, '20261119');
  assert.deepEqual(data.prevDayPerformance.map(({ promoted, todayChangePct }) => [promoted, todayChangePct]), [
    [true, null], [false, null],
  ]);
  const summary = buildMarketSummary(data);
  assert.match(summary, /晋级率 50\.00%/);
  assert.match(summary, /涨跌幅行情覆盖 0\/2 只/);
  assert.match(summary, /历史复盘不使用实时行情/);
  assert.doesNotMatch(summary, /有行情样本的平均涨跌幅：/);
});

test('当日行情部分缺失时，只用有效样本计算均值', async (t) => {
  const date = todayCN();
  mockFetch(t, (url) => {
    if (url.pathname === LIMIT_UP) return pool([first, second]);
    if (url.pathname === QUOTES) {
      return Response.json({ rc: 0, data: { diff: [{ f12: first.c, f3: -4 }, { f12: second.c, f3: '-' }] } });
    }
    return pool([]);
  });
  const summary = buildMarketSummary(await collectTradingDayData(date));
  assert.match(summary, /涨跌幅行情覆盖 1\/2 只/);
  assert.match(summary, /有行情样本的平均涨跌幅：-4\.00%/);
  assert.match(summary, /示例甲\(-4\.00%\)/);
  assert.doesNotMatch(summary, /NaN/);
});

test('当日实时行情异常时仍保留晋级结果并注明原因', async (t) => {
  mockFetch(t, (url) => {
    if (url.pathname === LIMIT_UP) return pool([first]);
    if (url.pathname === QUOTES) return Response.json({ rc: 1, data: null });
    return pool([]);
  });
  const summary = buildMarketSummary(await collectTradingDayData(todayCN()));
  assert.match(summary, /晋级率 100\.00%/);
  assert.match(summary, /复盘日实时行情不可用/);
  assert.match(summary, /无法计算平均涨跌幅/);
});
