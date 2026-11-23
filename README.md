# zhangtingReviewAgent

A 股涨停复盘 Agent：抓取东方财富涨停/炸板/跌停数据，调用 DeepSeek 大模型生成每日涨停复盘报告（Markdown）。

数据来自东方财富 push2ex 公开接口（与 akshare 同源），无需数据权限；TypeScript 实现，零运行时依赖。

## 功能

- **涨停池**：连板数、涨停统计（N 天 M 板）、首封/最后封板时间、封单资金、炸板次数、换手率、流通市值、所属行业
- **炸板池 / 跌停池**：当日摸板未封与跌停个股
- **昨日涨停今日表现**：平均溢价、晋级率（晋级 = 昨日涨停今日再涨停）、大面股追踪
- **AI 复盘报告**：情绪周期判断、连板梯队结构、主线题材归纳、个股点评、明日策略（DeepSeek 生成）

## 快速开始

```bash
# 要求 Node.js >= 20
npm install

# 配置 DeepSeek API Key（https://platform.deepseek.com/api_keys）
cp .env.example .env   # 然后编辑 .env 填入 key

# 复盘最近交易日（非交易日自动回退）
npm run dev

# 复盘指定交易日
npm run dev -- --date 20261120

# 只看盘面数据、不调大模型（免 key 调试）
npm run dev -- --raw
```

生成的报告默认保存到 `reports/zt-review-YYYYMMDD.md`。

### 全部参数

| 参数 | 说明 |
|---|---|
| `--date YYYYMMDD` | 指定交易日（默认今天，自动回退到最近交易日） |
| `--out <目录>` | 报告输出目录（默认 `reports/`） |
| `--no-save` | 只在终端流式输出，不保存文件 |
| `--raw` | 只输出盘面数据摘要，不调用大模型 |

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | （必填） | DeepSeek API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 接口地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型（也可填 `deepseek-reasoner`） |

## 架构

```
src/
├── index.ts            # CLI 入口：参数解析、流程编排、报告落盘
├── data/
│   ├── types.ts        # 归一化后的领域类型
│   └── eastmoney.ts    # 东财接口客户端（涨停/炸板/跌停池、批量行情、交易日回退、重试）
├── llm/
│   └── deepseek.ts     # DeepSeek 客户端（OpenAI 兼容协议，支持 SSE 流式）
└── agent/
    ├── prompt.ts       # 盘面数据 → Markdown 摘要 + system prompt
    └── review.ts       # 复盘流程：数据 → LLM → 报告
```

## 数据源说明与限制

- 接口为东财**当日/近期**数据，过老的日期会返回空池，适合"每个交易日收盘后跑一次"的用法
- 建议在收盘后（15:00 后）运行，盘中运行得到的是动态中间结果
- 东财对高频并发会重置连接，客户端已做串行抓取 + 抖动退避重试

## 免责声明

本项目仅供学习与技术研究，不构成任何投资建议。股市有风险，投资需谨慎。

## License

MIT
