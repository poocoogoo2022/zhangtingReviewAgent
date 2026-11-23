#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  collectTradingDayData,
  resolveTradingDate,
  todayCN,
} from './data/eastmoney.js';
import { DeepSeekClient, loadConfigFromEnv } from './llm/deepseek.js';
import { runReview } from './agent/review.js';

const USAGE = `涨停复盘 Agent

用法:
  npm run dev -- [选项]

选项:
  --date YYYYMMDD   指定交易日（默认：今天，非交易日自动回退到最近交易日）
  --out <目录>      报告输出目录（默认：reports）
  --no-save         只在终端输出，不保存文件
  --raw             只输出盘面数据摘要，不调用大模型（免 API key 调试）
  -h, --help        显示帮助

示例:
  npm run dev                        # 复盘最近交易日
  npm run dev -- --date 20261120     # 复盘指定交易日
  npm run dev -- --raw               # 只看数据，不调 LLM
`;

interface CliArgs {
  date?: string;
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
      case '--out':
        args.outDir = argv[++i] ?? args.outDir;
        break;
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
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. 确定交易日
  console.error('📅 正在确定交易日...');
  const date = await resolveTradingDate(args.date ?? todayCN());
  if (!date) {
    console.error('❌ 近 10 天内没有找到有涨停数据的交易日（东财接口只保留近期数据）');
    process.exit(1);
  }
  const dateFmt = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  console.error(`📊 目标交易日: ${dateFmt}`);

  // 2. 采集数据
  console.error('⏳ 正在抓取涨停/炸板/跌停数据...');
  const data = await collectTradingDayData(date);
  console.error(
    `✅ 数据就绪: 涨停 ${data.limitUp.length} / 炸板 ${data.brokenBoard.length} / 跌停 ${data.limitDown.length} / 昨涨停追踪 ${data.prevDayPerformance.length}`,
  );

  // 3. --raw 模式：只打印数据摘要
  if (args.raw) {
    const { buildMarketSummary } = await import('./agent/prompt.js');
    console.log(buildMarketSummary(data));
    return;
  }

  // 4. 调用 DeepSeek 生成复盘报告（流式输出到终端）
  const client = new DeepSeekClient(loadConfigFromEnv());
  console.error('🤖 DeepSeek 生成复盘中...\n');
  const { report } = await runReview(client, data, (t) => process.stdout.write(t));

  // 5. 保存 Markdown 报告
  if (args.save) {
    const dir = resolve(args.outDir);
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `zt-review-${date}.md`);
    await writeFile(file, report, 'utf8');
    console.error(`\n\n💾 报告已保存: ${file}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
