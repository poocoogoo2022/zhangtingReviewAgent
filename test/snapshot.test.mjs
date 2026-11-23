import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMarketSnapshot } from '../dist/data/snapshot.js';
import { buildMarketSummary } from '../dist/agent/prompt.js';

const mockFetch = `
  const stock = { c: '000001', m: 0, n: '模拟样本', p: 11000, zdp: 10, amount: 100000,
    ltsz: 2000000, tshare: 3000000, hs: 2, lbc: 2, fbt: 93000, lbt: 93000, hybk: '模拟行业' };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.origin === 'https://push2ex.eastmoney.com' && process.env.SNAPSHOT_TEST_MODE === 'capture') {
      const pool = url.pathname === '/getTopicZTPool' ? [stock] : [];
      return Response.json({ rc: 0, data: { tc: pool.length, pool } });
    }
    if (url.href === 'https://api.deepseek.com/chat/completions' && process.env.SNAPSHOT_TEST_MODE !== 'offline') {
      const { messages, stream } = JSON.parse(init.body);
      if (!stream || !messages[1].content.includes('| 模拟行业 | 1 |')) throw Error('模型输入缺少预期统计');
      const chunk = { choices: [{ delta: { content: '### 模拟解读' }, finish_reason: null }] };
      return new Response('data: ' + JSON.stringify(chunk) + '\\n\\ndata: [DONE]\\n\\n');
    }
    process.stderr.write('UNEXPECTED_FETCH: ' + url.origin);
    throw Error('测试禁止外部请求');
  };
`;

function cli(mode, ...args) {
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mockFetch)}`, 'dist/index.js', ...args], {
    env: { SNAPSHOT_TEST_MODE: mode, ...(mode === 'offline' ? {} : { DEEPSEEK_API_KEY: 'test-only' }) },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_FETCH/);
}

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zt-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('完整 CLI 保存快照；离线统计和模型重跑共用同一份输入，不覆盖旧报告', async (t) => {
  const dir = await tempDir(t);
  const captured = cli('capture', '--date', '20261120', '--out', dir);
  success(captured);
  const [original] = await readdir(dir);
  assert.match(original, /^20261120-/);
  const snapshotFile = join(dir, original, 'market.snapshot.json');
  const reportName = 'zt-review-20261120.md';
  const savedSnapshot = await readFile(snapshotFile, 'utf8');
  const snapshot = await readMarketSnapshot(snapshotFile);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.source, 'eastmoney');
  assert.equal(snapshot.data.prevDayPerformance[0].todayChangePct, null);
  assert.doesNotMatch(savedSnapshot, /test-only|DEEPSEEK_API_KEY/);
  assert.equal(await readFile(join(dir, original, reportName), 'utf8'), captured.stdout);

  const raw = cli('offline', '--snapshot', snapshotFile, '--raw', '--out', dir);
  success(raw);
  assert.equal(raw.stdout, `${buildMarketSummary(snapshot.data)}\n`);
  assert.deepEqual(await readdir(dir), [original]);

  const replay = cli('replay', '--snapshot', snapshotFile, '--out', dir);
  success(replay);
  assert.equal(replay.stdout, captured.stdout);
  const entries = await readdir(dir);
  assert.equal(entries.length, 2);
  const rerun = entries.find((entry) => entry !== original);
  assert.equal(await readFile(join(dir, rerun, 'market.snapshot.json'), 'utf8'), savedSnapshot);
  assert.equal(await readFile(join(dir, rerun, reportName), 'utf8'), replay.stdout);
  assert.equal(await readFile(join(dir, original, reportName), 'utf8'), captured.stdout);

  success(cli('replay', '--snapshot', snapshotFile, '--no-save', '--out', dir));
  assert.deepEqual(await readdir(dir), entries);
});

test('仓库合成样本可离线运行，并明确标记为虚构行情', () => {
  const file = fileURLToPath(new URL('../examples/synthetic-market.snapshot.json', import.meta.url));
  const result = cli('offline', '--snapshot', file, '--raw');
  success(result);
  assert.match(result.stdout, /^> 合成行情演示：.*不代表真实盘面/);
  assert.match(result.stdout, /涨停 3 家，炸板 1 家，封板成功率 75\.00%/);
  assert.match(result.stdout, /跌停 1 家/);
  assert.match(result.stdout, /\| 3 板 \| 1 \|/);
  assert.match(result.stdout, /\| 示例元件 \| 2 \|/);
  assert.match(result.stdout, /晋级率 33\.33%/);
  assert.match(result.stdout, /涨跌幅行情覆盖 2\/3 只/);
});

test('未知版本、无效行情与冲突参数在任何网络请求前被拒绝', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'invalid.snapshot.json');
  const snapshot = {
    schemaVersion: 1,
    source: 'eastmoney',
    capturedAt: '2026-11-23T08:00:00.000Z',
    data: { date: '20261120', prevDate: null, limitUp: [], brokenBoard: [], limitDown: [], prevDayPerformance: [] },
  };
  for (const [value, error] of [
    [{ ...snapshot, schemaVersion: 2 }, /不支持的行情快照版本/],
    [{ ...snapshot, data: { ...snapshot.data, date: '20261131' } }, /交易日无效/],
    [{ ...snapshot, data: { ...snapshot.data, limitUp: [{}] } }, /limitUp\[0\] 字段无效/],
  ]) {
    await writeFile(file, JSON.stringify(value));
    const result = cli('offline', '--snapshot', file);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_FETCH/);
  }
  const conflict = cli('offline', '--snapshot', file, '--date', '20261120');
  assert.ifError(conflict.error);
  assert.equal(conflict.status, 1, conflict.stderr);
  assert.match(conflict.stderr, /--snapshot 不能与 --date 一起使用/);
});
