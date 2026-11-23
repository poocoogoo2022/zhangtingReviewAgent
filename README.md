# zhangtingReviewAgent

A 股涨停复盘 Agent：抓取东方财富涨停/炸板/跌停数据，调用 DeepSeek 大模型生成每日涨停复盘报告（Markdown）。

数据来自东方财富 push2ex 公开接口（与 akshare 同源），无需数据权限；TypeScript 实现，零运行时依赖。

## 功能

- **涨停池**：连板数、涨停统计（N 天 M 板）、首封/最后封板时间、封单资金、炸板次数、换手率、流通市值、所属行业
- **炸板池 / 跌停池**：当日摸板未封与跌停个股
- **上一交易日涨停股追踪**：按两个交易日的涨停池计算晋级率；有复盘日行情时，另列样本平均涨跌幅和明显下跌的个股
- **复盘报告**：TypeScript 计算并直接渲染总览、连板梯队、行业涨停分布和晋级统计；DeepSeek 在独立章节解读盘面、个股表现及下一交易日的观察点。行业采用东方财富的分类，不等同于概念题材。

## 快速开始：免 Key 演示

要求 Node.js 20 或更高版本。在仓库根目录运行：

```bash
npm ci
npm run demo
```

安装依赖后，`npm run demo` 会编译 TypeScript 并读取仓库内的[合成行情快照](examples/synthetic-market.snapshot.json)。它不需要 `.env`，不访问东方财富或 DeepSeek，也不保存报告。终端会显示 **3 家涨停、1 家炸板、1 家跌停**，以及行业分布、连板梯队和 **33.33%（1/3）** 的晋级率。样本中的个股、行业和数值均为虚构。

## 生成真实复盘报告

```bash
# 用编辑器在项目根目录创建 .env，填入 DEEPSEEK_API_KEY=你的密钥
# 申请地址：https://platform.deepseek.com/api_keys；不要提交 .env

# 复盘最近交易日（非交易日自动回退）
npm run dev

# 复盘指定交易日
npm run dev -- --date 20261120

# 不配置 .env 也能查看盘面摘要，不调用 DeepSeek
npm run build
node dist/index.js --raw
```

### 保存和重跑

每次生成报告，CLI 都会在 `reports/`（或 `--out` 指定的目录）下创建独立的 `YYYYMMDD-<随机后缀>/` 子目录，不覆盖旧结果。目录中有两个文件：

- `zt-review-YYYYMMDD.md`：复盘报告。
- `market.snapshot.json`：带 `schemaVersion`、数据来源、UTC 采集时间和归一化行情的 JSON，不包含 API Key。

把下方路径换成 CLI 输出的实际快照路径：

```bash
# 完全离线：查看同一份行情统计，无须 .env
node dist/index.js --snapshot reports/20261120-abc123/market.snapshot.json --raw

# 不重新采集行情，调用 DeepSeek 生成新版解读；旧报告和快照保留
npm run dev -- --snapshot reports/20261120-abc123/market.snapshot.json
```

快照固定的是行情输入，不保证模型逐字复现原报告。重跑会保留原始采集时间；不支持的快照版本或无效字段会在调用模型前报错。

### 全部参数

| 参数 | 说明 |
|---|---|
| `--date YYYYMMDD` | 指定交易日（默认今天，自动回退到最近交易日） |
| `--snapshot <文件>` | 从本地快照重跑，不访问东方财富；不能与 `--date` 同用 |
| `--out <目录>` | 报告和快照的父目录（默认 `reports/`） |
| `--no-save` | 只在终端流式输出，不保存报告或快照 |
| `--raw` | 只输出盘面数据摘要，不调用大模型、不保存文件 |

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | （必填） | DeepSeek API Key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型（也可填 `deepseek-reasoner`） |

客户端只请求 DeepSeek 官方 HTTPS 端点 `https://api.deepseek.com/chat/completions`，且不跟随重定向。旧配置中的 `DEEPSEEK_BASE_URL` 不再生效，可从 `.env` 删除。

## 架构

```
src/
├── index.ts            # CLI 入口：参数解析、流程编排、报告落盘
├── data/
│   ├── types.ts        # 归一化后的领域类型
│   ├── eastmoney.ts    # 东财接口客户端（涨停/炸板/跌停池、批量行情、交易日回退、重试）
│   └── snapshot.ts     # 带版本号的行情快照读写和校验
├── llm/
│   └── deepseek.ts     # DeepSeek 客户端（OpenAI 兼容协议，支持 SSE 流式）
└── agent/
    ├── facts.ts        # 计算并渲染确定性统计
    ├── prompt.ts       # 统计和个股明细 → 模型输入
    └── review.ts       # 组合程序统计和 DeepSeek 解读
```

## 数据源说明与限制

- 接口为东财**当日/近期**数据，过老的日期会返回空池，适合"每个交易日收盘后跑一次"的用法
- 建议在北京时间收盘后（15:00 后）运行，盘中结果会变化。
- 历史复盘不会用最新行情补算历史涨跌幅。实时行情不可用时，仍会给出两日涨停池的晋级率，并在报告中注明行情缺失。
- 涨停、炸板和跌停池的总数与明细不一致，或同一个池内出现重复标的（市场 + 股票代码）时，CLI 会报错并停止生成报告。不会把异常当成零家，也不会静默去重：重复记录可能掩盖了缺失的个股。
- 东方财富接口偶发断连，客户端使用串行请求和退避重试。

## 开发验证

运行 `npm test` 可离线验证数据口径，无须行情接口或 DeepSeek API Key。

## 免责声明

本项目仅供学习与技术研究，不构成任何投资建议。股市有风险，投资需谨慎。

## License

MIT
