import { readFile, writeFile } from 'node:fs/promises';
import type { TradingDayData } from './types.js';

export interface MarketSnapshot {
  schemaVersion: 1;
  source: 'eastmoney';
  capturedAt: string; // UTC, ISO 8601
  data: TradingDayData;
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasCode(value: Row): boolean {
  return typeof value.code === 'string' && /^\d{6}$/.test(value.code);
}

function isTradingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${iso}T`);
}

function isCaptureTime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validPoolRow(value: unknown): value is Row {
  return isRow(value) && hasCode(value) && nonNegativeInteger(value.market)
    && typeof value.name === 'string' && typeof value.industry === 'string'
    && ['price', 'changePct', 'amount', 'floatMarketCap', 'turnoverRate'].every((key) => finite(value[key]));
}

function validBrokenBoardFields(row: Row): boolean {
  return typeof row.firstSealTime === 'string' && nonNegativeInteger(row.breakCount);
}

function validLimitUpFields(row: Row): boolean {
  return validBrokenBoardFields(row) && typeof row.lastSealTime === 'string'
    && nonNegativeInteger(row.consecutiveBoards) && row.consecutiveBoards > 0
    && nonNegativeInteger(row.statsDays) && nonNegativeInteger(row.statsCount)
    && finite(row.totalMarketCap) && finite(row.sealFund);
}

function validatePool(name: string, value: unknown, validateFields: (row: Row) => boolean): void {
  if (!Array.isArray(value)) throw new Error(`行情快照的 ${name} 必须是数组`);
  const seen = new Set<string>();
  for (const [index, row] of value.entries()) {
    if (!validPoolRow(row) || !validateFields(row)) throw new Error(`行情快照的 ${name}[${index}] 字段无效`);
    const key = `${row.market}.${row.code}`;
    if (seen.has(key)) throw new Error(`行情快照的 ${name} 含重复标的：${key}`);
    seen.add(key);
  }
}

function validateSnapshot(value: unknown): asserts value is MarketSnapshot {
  if (!isRow(value) || value.schemaVersion !== 1) throw new Error('不支持的行情快照版本：需要 schemaVersion=1');
  if (value.source !== 'eastmoney' || !isCaptureTime(value.capturedAt) || !isRow(value.data)) {
    throw new Error('行情快照缺少有效的来源、采集时间或行情数据');
  }
  const { date, prevDate, limitUp, brokenBoard, limitDown, prevDayPerformance, prevDayQuoteWarning } = value.data;
  if (!isTradingDate(date) || (prevDate !== null && (!isTradingDate(prevDate) || prevDate >= date))) {
    throw new Error('行情快照的复盘日或上一交易日无效');
  }
  validatePool('limitUp', limitUp, validLimitUpFields);
  validatePool('brokenBoard', brokenBoard, validBrokenBoardFields);
  validatePool('limitDown', limitDown, () => true);
  if (!Array.isArray(prevDayPerformance) || (prevDate === null && prevDayPerformance.length !== 0)
    || !prevDayPerformance.every((row: unknown) => isRow(row) && hasCode(row) && typeof row.name === 'string'
      && typeof row.promoted === 'boolean' && (row.todayChangePct === null || finite(row.todayChangePct)))
    || (prevDayQuoteWarning !== undefined && typeof prevDayQuoteWarning !== 'string')) {
    throw new Error('行情快照的上一交易日追踪数据无效');
  }
}

export function createMarketSnapshot(data: TradingDayData): MarketSnapshot {
  const snapshot: MarketSnapshot = { schemaVersion: 1, source: 'eastmoney', capturedAt: new Date().toISOString(), data };
  validateSnapshot(snapshot);
  return snapshot;
}

export async function readMarketSnapshot(file: string): Promise<MarketSnapshot> {
  const text = await readFile(file, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`行情快照不是有效的 JSON：${file}`);
  }
  validateSnapshot(value);
  return value;
}

export async function writeMarketSnapshot(file: string, snapshot: MarketSnapshot): Promise<void> {
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
