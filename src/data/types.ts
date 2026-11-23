/**
 * 东方财富 push2ex 涨停池原始数据（JSON 字段为简写）
 * 参考：https://push2ex.eastmoney.com/getTopicZTPool
 */
export interface RawPoolItem {
  c: string; // 代码
  m: number; // 市场 0=深/北 1=沪
  n: string; // 名称
  p: number; // 最新价（×1000）
  zdp: number; // 涨跌幅 %
  amount: number; // 成交额（元）
  ltsz: number; // 流通市值（元）
  tshare: number; // 总市值（元）
  hs: number; // 换手率 %
  lbc?: number; // 连板数（涨停池）
  fbt?: number; // 首次封板时间 HHMMSS
  lbt?: number; // 最后封板时间 HHMMSS
  fund?: number; // 封板资金（元）
  zbc?: number; // 炸板次数
  hybk: string; // 所属行业
  zttj?: { days: number; ct: number }; // 涨停统计 days 天内 ct 次
}

export interface RawPoolResponse {
  rc: number;
  data: {
    tc: number; // 总数
    qdate: number; // 服务端当前日期
    pool: RawPoolItem[];
  } | null;
}

/** 归一化后的涨停个股 */
export interface LimitUpStock {
  code: string;
  market: number;
  name: string;
  price: number; // 最新价（元）
  changePct: number; // 涨跌幅 %
  amount: number; // 成交额（元）
  floatMarketCap: number; // 流通市值（元）
  totalMarketCap: number; // 总市值（元）
  turnoverRate: number; // 换手率 %
  consecutiveBoards: number; // 连板数，首板=1
  firstSealTime: string; // 首次封板 "HH:MM:SS"，无则空串
  lastSealTime: string; // 最后封板 "HH:MM:SS"
  sealFund: number; // 封板资金（元）
  breakCount: number; // 炸板次数
  industry: string; // 所属行业
  statsDays: number; // 涨停统计：days 天
  statsCount: number; // 涨停统计：ct 次
}

/** 炸板股（盘中摸板未封住） */
export interface BrokenBoardStock {
  code: string;
  market: number;
  name: string;
  price: number;
  changePct: number;
  amount: number;
  floatMarketCap: number;
  turnoverRate: number;
  firstSealTime: string;
  breakCount: number;
  industry: string;
}

/** 跌停股 */
export interface LimitDownStock {
  code: string;
  market: number;
  name: string;
  price: number;
  changePct: number;
  amount: number;
  floatMarketCap: number;
  turnoverRate: number;
  industry: string;
}

/** 昨日涨停股今日表现 */
export interface PrevDayPerformance {
  code: string;
  name: string;
  todayChangePct: number; // 今日涨跌幅 %
  promoted: boolean; // 今日是否再度涨停（晋级）
}

/** 一个交易日的完整复盘数据 */
export interface TradingDayData {
  date: string; // YYYYMMDD
  prevDate: string | null; // 上一交易日
  limitUp: LimitUpStock[];
  brokenBoard: BrokenBoardStock[];
  limitDown: LimitDownStock[];
  prevDayPerformance: PrevDayPerformance[]; // 昨日涨停今日表现
}

/** 批量行情（push2 ulist） */
export interface RawQuoteResponse {
  rc: number;
  data: {
    total: number;
    diff: { f12: string; f14: string; f2: number; f3: number }[];
  } | null;
}
