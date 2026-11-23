import { setDefaultResultOrder } from 'node:dns';
import type {
  BrokenBoardStock,
  LimitDownStock,
  LimitUpStock,
  PrevDayPerformance,
  RawPoolItem,
  RawPoolResponse,
  RawQuoteResponse,
  TradingDayData,
} from './types.js';

const POOL_BASE = 'https://push2ex.eastmoney.com';
const QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
/** 东财公开 token（akshare 同款） */
const UT = '7eea3edcaed734bea9cbfc24409ed989';
const PAGE_SIZE = 500;
const MAX_LOOKBACK_DAYS = 10;

const ENDPOINTS = {
  zt: 'getTopicZTPool', // 涨停池
  zb: 'getTopicZBPool', // 炸板池
  dt: 'getTopicDTPool', // 跌停池
} as const;

// 东财部分 IPv6 节点不稳定（偶发 socket reset），优先走 IPv4
setDefaultResultOrder('ipv4first');

type PoolKind = keyof typeof ENDPOINTS;

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'zhangtingReviewAgent/0.1',
          Referer: 'https://quote.eastmoney.com/',
          Connection: 'close', // 东财偶发重置复用连接，禁用 keep-alive
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < 4) {
        await sleep(attempt * 800 + Math.random() * 400); // 抖动退避
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** HHMMSS 数字 → "HH:MM:SS" */
function fmtTime(t?: number): string {
  if (!t) return '';
  const s = String(t).padStart(6, '0');
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

function toLimitUp(x: RawPoolItem): LimitUpStock {
  return {
    code: x.c,
    market: x.m,
    name: x.n,
    price: x.p / 1000,
    changePct: x.zdp,
    amount: x.amount,
    floatMarketCap: x.ltsz,
    totalMarketCap: x.tshare,
    turnoverRate: x.hs,
    consecutiveBoards: x.lbc ?? 1,
    firstSealTime: fmtTime(x.fbt),
    lastSealTime: fmtTime(x.lbt),
    sealFund: x.fund ?? 0,
    breakCount: x.zbc ?? 0,
    industry: x.hybk,
    statsDays: x.zttj?.days ?? 0,
    statsCount: x.zttj?.ct ?? 0,
  };
}

function toBrokenBoard(x: RawPoolItem): BrokenBoardStock {
  return {
    code: x.c,
    market: x.m,
    name: x.n,
    price: x.p / 1000,
    changePct: x.zdp,
    amount: x.amount,
    floatMarketCap: x.ltsz,
    turnoverRate: x.hs,
    firstSealTime: fmtTime(x.fbt),
    breakCount: x.zbc ?? 0,
    industry: x.hybk,
  };
}

function toLimitDown(x: RawPoolItem): LimitDownStock {
  return {
    code: x.c,
    market: x.m,
    name: x.n,
    price: x.p / 1000,
    changePct: x.zdp,
    amount: x.amount,
    floatMarketCap: x.ltsz,
    turnoverRate: x.hs,
    industry: x.hybk,
  };
}

/**
 * 拉取某日的涨停/炸板/跌停池。
 * 注意：push2ex 只保留近期数据，过老的日期会返回空池。
 */
export async function fetchPool<T extends PoolKind>(
  kind: T,
  date: string,
): Promise<
  T extends 'zt' ? LimitUpStock[] : T extends 'zb' ? BrokenBoardStock[] : LimitDownStock[]
> {
  const url =
    `${POOL_BASE}/${ENDPOINTS[kind]}?ut=${UT}&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=${PAGE_SIZE}&sort=fbt%3Aasc&date=${date}`;
  const json = await fetchJson<RawPoolResponse>(url);
  const pool = json.data?.pool ?? [];
  if (kind === 'zt') return pool.map(toLimitUp) as never;
  if (kind === 'zb') return pool.map(toBrokenBoard) as never;
  return pool.map(toLimitDown) as never;
}

/** 批量实时行情：code+market → 涨跌幅 */
export async function fetchQuotes(
  stocks: { code: string; market: number }[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const CHUNK = 80; // ulist 接口单批上限附近
  for (let i = 0; i < stocks.length; i += CHUNK) {
    const secids = stocks
      .slice(i, i + CHUNK)
      .map((s) => `${s.market}.${s.code}`)
      .join(',');
    const url = `${QUOTE_URL}?fltt=2&invt=2&fields=f12,f14,f2,f3&secids=${secids}`;
    const json = await fetchJson<RawQuoteResponse>(url);
    for (const q of json.data?.diff ?? []) {
      result.set(q.f12, q.f3);
    }
  }
  return result;
}

/** 日期加减（按自然日），YYYYMMDD 字符串互转 */
function shiftDate(date: string, days: number): string {
  const d = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

/** 北京时间今日 YYYYMMDD */
export function todayCN(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * 找到最近一个有涨停池数据的交易日（含 date 当天）。
 * 用于周末/节假日自动回退；最长回退 MAX_LOOKBACK_DAYS 天。
 */
export async function resolveTradingDate(date: string): Promise<string | null> {
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const d = shiftDate(date, -i);
    const pool = await fetchPool('zt', d);
    if (pool.length > 0) return d;
  }
  return null;
}

/**
 * 汇总一个交易日的复盘数据：
 * 涨停池 + 炸板池 + 跌停池 + 昨日涨停股今日表现（晋级率/溢价）。
 */
export async function collectTradingDayData(date: string): Promise<TradingDayData> {
  // 串行抓取：东财对高频并发连接会重置 socket
  const limitUp = await fetchPool('zt', date);
  await sleep(300);
  const brokenBoard = await fetchPool('zb', date);
  await sleep(300);
  const limitDown = await fetchPool('dt', date);

  // 找上一交易日（有涨停池数据即视为交易日）
  let prevDate: string | null = null;
  let prevPool: LimitUpStock[] = [];
  for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
    await sleep(300);
    const d = shiftDate(date, -i);
    const pool = await fetchPool('zt', d);
    if (pool.length > 0) {
      prevDate = d;
      prevPool = pool;
      break;
    }
  }

  const todaySet = new Set(limitUp.map((s) => s.code));
  let prevDayPerformance: PrevDayPerformance[] = [];
  if (prevPool.length > 0) {
    const quotes = await fetchQuotes(prevPool.map((s) => ({ code: s.code, market: s.market })));
    prevDayPerformance = prevPool.map((s) => ({
      code: s.code,
      name: s.name,
      todayChangePct: quotes.get(s.code) ?? Number.NaN,
      promoted: todaySet.has(s.code),
    }));
  }

  return { date, prevDate, limitUp, brokenBoard, limitDown, prevDayPerformance };
}
