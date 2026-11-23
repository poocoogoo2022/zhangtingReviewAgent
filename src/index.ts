#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  collectTradingDayData,
  resolveTradingDate,
  todayCN,
} from './data/eastmoney.js';
import { createMarketSnapshot, readMarketSnapshot, writeMarketSnapshot } from './data/snapshot.js';
import { DeepSeekClient, loadConfigFromEnv } from './llm/deepseek.js';
import { formatTradingDate } from './agent/facts.js';
import { buildMarketSummary } from './agent/prompt.js';
import { runReview } from './agent/review.js';

const USAGE = `涨停复盘 Agent

用法:
  npm run dev -- [选项]

选项:
  --date YYYYMMDD   指定交易日（默认：今天，非交易日自动回退到最近交易日）
  --snapshot <文件> 从行情快照重跑，不查询东方财富；不能与 --date 一起使用
  --out <目录>      报告与快照的父目录（默认：reports，每次生成独立子目录）
  --no-save         只在终端输出，不保存报告或快照
  --raw             只输出盘面数据摘要，不调用大模型，不保存文件
  -h, --help        显示帮助

示例:
  npm run dev                        # 复盘最近交易日
  npm run dev -- --date 20261120     # 复盘指定交易日
  node dist/index.js --snapshot <文件> --raw  # 完全离线地核对快照
`;

interface CliArgs {
  date?: string;
  snapshot?: string;
  outDir: string;
  save: boolean;
  raw: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { outDir: 'reports', save: true, raw: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--date': {
        const v = argv[++i];
        if (!v || !/^\d{8}$/.test(v)) throw new Error('--date 需要 YYYYMMDD 格式，如 20261120');
        args.date = v;
        break;
      }
      case '--snapshot': {
        const file = argv[++i];
        if (!file || file.startsWith('-')) throw new Error('--snapshot 需要指定行情快照文件');
        args.snapshot = file;
        break;
      }
      case '--out': {
        const dir = argv[++i];
        if (!dir || dir.startsWith('-')) throw new Error('--out 需要指定输出目录');
        args.outDir = dir;
        break;
      }
      case '--no-save':
        args.save = false;
        break;
      case '--raw':
        args.raw = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`未知参数: ${argv[i]}\n\n${USAGE}`);
    }
  }
  if (args.date && args.snapshot) throw new Error('--snapshot 不能与 --date 一起使用');
  return args;
}

async function captureLiveSnapshot(requestedDate: string) {
  console.error('📅 正在确定交易日...');
  const date = await resolveTradingDate(requestedDate);
  if (!date) throw new Error('近 10 天内没有找到有涨停数据的交易日（东财接口只保留近期数据）');
  console.error('⏳ 正在抓取涨停/炸板/跌停数据...');
  return createMarketSnapshot(await collectTradingDayData(date));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = args.snapshot
    ? await readMarketSnapshot(args.snapshot)
    : await captureLiveSnapshot(args.date ?? todayCN());
  const { data, capturedAt, source } = snapshot;
  const { date } = data;
  const sourceNotice = source === 'synthetic'
    ? '> 合成行情演示：个股、行业和数据均为虚构，不代表真实盘面。\n\n'
    : '';
  console.error(`📊 目标交易日: ${formatTradingDate(date)}`);
  if (args.snapshot) console.error(`📂 已载入快照，原始采集时间: ${capturedAt}`);
  console.error(
    `✅ 数据就绪: 涨停 ${data.limitUp.length} / 炸板 ${data.brokenBoard.length} / 跌停 ${data.limitDown.length} / 昨涨停追踪 ${data.prevDayPerformance.length}`,
  );

  // --raw 只打印数据摘要，不调用模型或落盘。
  if (args.raw) {
    console.log(`${sourceNotice}${buildMarketSummary(data)}`);
    return;
  }

  // 调用 DeepSeek 生成复盘报告（流式输出到终端）
  const client = new DeepSeekClient(loadConfigFromEnv());
  console.error('🤖 DeepSeek 生成复盘中...\n');
  if (sourceNotice) process.stdout.write(sourceNotice);
  const { report } = await runReview(client, data, (t) => process.stdout.write(t));

  // 5. 保存 Markdown 报告
  if (args.save) {
    const parent = resolve(args.outDir);
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(resolve(parent, `${date}-`));
    const snapshotFile = resolve(dir, 'market.snapshot.json');
    const reportFile = resolve(dir, `zt-review-${date}.md`);
    await writeMarketSnapshot(snapshotFile, snapshot);
    await writeFile(reportFile, `${sourceNotice}${report}`, 'utf8');
    console.error(`\n💾 报告已保存: ${reportFile}`);
    console.error(`💾 行情快照已保存: ${snapshotFile}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
