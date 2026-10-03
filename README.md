# 微分音音阶映射后端（TypeScript + Node.js + SQLite）

离线的 Scala SCL 微分音音阶服务：导入受限 `.scl` 文本，把整数键号按“音阶周期”映射为频率，
并解释该键落在哪个**周期**与**级数**。仅提供 HTTP API 与 CLI。

- 不读取 MIDI 乐曲、不合成音频、不连接乐器；
- 不处理节拍、音符时长、力度或配器；
- 只计算音高关系，内部全程使用双精度浮点（IEEE-754 `number`）；
- 不把键号固定解释成十二平均律——键号只是音阶级数的整数索引；
- 完全离线，无 Docker、无 WSL、无外部在线服务、无付费依赖。

## 环境要求

- Windows 本地安装 **Node.js ≥ 22.5**（开发与验证使用 Node 25，内置 `node:sqlite`）。
- 无任何原生编译模块；数据库使用 Node 自带的同步 SQLite（`node:sqlite`）。
- 数据默认保存在项目内 `data/microtonal.sqlite`（自动创建目录）。

## 快速开始

```powershell
npm install        # 安装 TypeScript / tsx / vitest
npm run build      # 类型检查并编译到 dist/
npm test           # 运行 vitest（34 个用例）
npm run demo       # 运行内置离线演示（41 项断言，含“重启读取”）
npm start          # 启动 HTTP API，默认自动选择空闲端口
```

指定端口或数据库：

```powershell
node dist/cli.js serve --port 4321
node dist/cli.js demo --db data/other.sqlite
```

> Node 25 会对实验性 `node:sqlite` 打印一条 `ExperimentalWarning`，不影响功能；
> 如不希望看到，可设置环境变量 `$env:NODE_NO_WARNINGS=1` 后再运行。

## 核心概念

### SCL 数值语法（受限子集）

按 Scala 规范的基本结构，文件由三部分组成：

1. **描述行**：第一条非注释文本；
2. **计数行**：一个整数 `N`（声明音程行数）；
3. **N 个音程行**：每行首个空白分隔 token 为数值，其后可附名称（忽略）。

`!` 起为注释（整行或行尾均可），空行忽略。数值只支持三种形式：

| 写法 | 含义 | 示例 |
| --- | --- | --- |
| 纯整数 | 频率比“整数比一” | `2` 表示 **2/1（八度）**，不是 2 音分 |
| 分数 `a/b` | 两个正整数的频率比，`b ≠ 0` | `3/2` 为纯五度 |
| 含小数点 | **音分值**，换算为 `2^(cents/1200)` | `1200.0` 等于 2/1 |

明确拒绝的形式：指数记法（`2^3`）、多个斜杠（`1/2/3`）、非数字字符、
零分母、非正比值、计数与实际行数不符、音程非严格递增、周期不大于 1，
以及 `N` 不在 `1..128`。这些情况返回稳定错误码（见下文），不会写入数据库。

### 隐含首级与周期

声明的 `N` 行中：

- **首级 1/1 是隐含的，不出现在文件里**；
- 前 `N-1` 项是一个周期之内的中间音程；
- **末项是完整周期**（周期比值 `P`，严格大于 1，**不必等于 2/1**）。

因此内部“级数”数组长度为 `N`：`degree[0] = 1`，`degree[1..N-1]` 为前 `N-1` 个声明比值。
例如 `N=2`、`3/2`、`2/1` 时，级数比值是 `[1, 3/2]`，周期 `P=2`。

### 周期起点 K 与参考键 R

- **周期起点键 `K`**：该键落在 `degree 0`（隐含 1/1）。它只是级数网格的原点。
- **参考键 `R` 与参考频率 `Hz`**：已知 `freq(R)=Hz`，用于给整张网格标定绝对音高。
- `K` 与 `R` **相互独立**：参考键可以是任意键，不会被强行当作 1/1。

### 键 → 频率的映射（负向周期用向下取整）

对任意整数键 `k`：

```
d = k - K
q = floor(d / N)          # 周期序号，负数时向负无穷取整（不是朝零截断）
r = d - q*N               # 0 <= r < N，永远是非负可直接索引的级数
ratio(k) = P^q * degree[r]
freq(k)  = Hz * ratio(k) / ratio(R)
```

关键点：负数必须用 **floor 除法**。例如 `N=2`、`d=-1`：
`q=-1, r=1`（而不是朝零截断得到的 `q=0, r=-1`）。
最后的除以 `ratio(R)` 即“按参考键同一比值归一”，因此更换 `Hz` 只会整体等比缩放。

## 容限与数值诊断

服务公开统一容限（`GET /health` 也会返回）：

- 频率相对误差 `frequencyRelEps = 1e-9`
- 音分绝对误差 `centsAbsEps = 1e-6`
- 比值判定间隔 `ratioEps = 1e-12`

当周期幂或最终频率上溢为 `Infinity`、下溢为 `0`、出现 `NaN` 或负值时，
返回错误码 `FREQUENCY_OVERFLOW / FREQUENCY_UNDERFLOW / FREQUENCY_NON_FINITE`，
**绝不返回 200 与看似正常的数值**。区间查询单次最多 `100000` 个键（`RANGE_TOO_LARGE`）。

## HTTP API

请求/响应均为 JSON（`Content-Type: application/json`），错误体形如
`{"error":{"code","message","details"}}`。

| 方法与路径 | 说明 | 主要参数 |
| --- | --- | --- |
| `GET /health` | 健康检查、容限与结果版本 | — |
| `POST /scales/validate` | 只校验不入库 | `scl` |
| `POST /scales` | 导入音阶（解析成功才入库） | `name`, `scl` |
| `GET /scales` | 列出音阶 | — |
| `POST /configs` | 创建映射配置（新版本） | `scaleId`/`scaleName`, `name`, `originKey`, `referenceKey`, `referenceHz` |
| `GET /configs` | 列出配置 | `?scaleId=` |
| `POST /keys/one` | 查询单键 | `configId` 或音阶+`originKey/referenceKey/referenceHz`，`key` |
| `POST /keys/range` | 查询闭区间 | 同上，`from`, `to` |
| `POST /keys/explain` | 周期/级数文字解释 | 同单键 |
| `POST /tuning-table` | 导出调律表 | 同上，`from`, `to` |
| `POST /compare` | 比较两套音阶 | `left{...}`, `right{...}`, `from`, `to` |

查询类端点也接受 `GET`，参数走 query string（`?configId=1&key=-1`）。

PowerShell 调用示例：

```powershell
Invoke-RestMethod http://localhost:4321/health
$b = @{ configId = 1; key = -1 } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:4321/keys/one `
  -ContentType 'application/json' -Body $b
```

## CLI 示例

```powershell
node dist/cli.js validate --file scales/pythagorean.scl
node dist/cli.js import   --name pyth --file scales/pythagorean.scl
node dist/cli.js config   --name p440 --scale pyth --origin 0 --reference 0 --hz 440
node dist/cli.js key      --config p440 --k -1
node dist/cli.js explain  --config p440 --k -3
node dist/cli.js range    --config p440 --from -2 --to 3
node dist/cli.js table    --config p440 --from 0 --to 12 --out data/table.json
node dist/cli.js compare  --left-config tet440 --right-config just440 --from 0 --to 12
node dist/cli.js list --configs
node dist/cli.js serve --port 4321
```

## 错误码

`VALIDATION_ERROR`、`SCL_PARSE_ERROR`、`SCL_COUNT_MISMATCH`、`SCL_INVALID_INTERVAL`、
`SCL_ZERO_DENOMINATOR`、`SCL_NON_POSITIVE`、`SCL_NOT_STRICTLY_INCREASING`、
`SCL_PERIOD_NOT_GREATER_THAN_ONE`、`SCL_UNSUPPORTED_SYNTAX`、`SCL_EMPTY`、
`NOT_FOUND`、`CONFLICT`、`RANGE_TOO_LARGE`、`FREQUENCY_OVERFLOW`、
`FREQUENCY_UNDERFLOW`、`FREQUENCY_NON_FINITE`、`DB_ERROR`。

## 持久化与版本

- `scales` 表保存：原始 SCL 文本、描述、计数、周期、**规范比值 JSON**、`result_version`。
- `configs` 表保存：`K / R / Hz` 与 `result_version`。
- 导入采用“先完整解析、再事务写入”：解析失败零副作用，不会留下数量不足却标为可用的音阶。
- 修改参考频率请**新建配置**（新行），旧配置与旧调律表仍然可查询；不会原地覆盖。
- 计算时以原始 SCL 文本为事实来源重新解析，保证存储与计算一致。

## 示例音阶

- `scales/pythagorean.scl`：`N=2`，`3/2` 与 `2/1`（题目基准用例）。
- `scales/tripling.scl` / `scales/cents-equivalent.scl`：`N=1`、周期 `3/1` 的分数与音分等价写法。
- `scales/equal12.scl`：十二平均律（11 个中间音分 + 1200 音分周期）。
- `scales/just12.scl`：用于对比的微分/纯律音阶。

以 `K=R=0、440Hz` 的基准用例：

| 键 | 周期 q | 级数 r | 频率 |
| --- | --- | --- | --- |
| -1 | -1 | 1 | 330 Hz |
| 0 | 0 | 0 | 440 Hz |
| 1 | 0 | 1 | 660 Hz |
| 2 | 1 | 0 | 880 Hz |
| -3 | -2 | 1 | 165 Hz |

## 项目结构

```
src/
  scl.ts       SCL 词法/语义解析与校验
  mapper.ts    周期/级数映射、区间、调律表、比较与数值诊断
  mathUtil.ts  floor 除法、音分换算与容限
  db.ts        node:sqlite 模式、原子导入、配置版本
  server.ts    HTTP JSON API（默认空闲端口）
  cli.ts       命令行入口
  demo.ts      内置离线演示
test/          vitest：解析、映射负周期、持久化
scales/        示例 .scl
data/          运行后生成的 SQLite（已 gitignore）
```

## 已知限制

- 仅支持上述三种数值写法，不支持 Scala 的扩展关键字、MIDI 映射文件（`.kbm`）、负数行等。
- 音程行后名称一律忽略；不保存按名称的微调。
- 键号限定为安全整数范围且单次区间 ≤ 100000；极端键号由溢出/下溢诊断拦截。
- `node:sqlite` 在当前 Node 版本标记为实验性（API 稳定后仅需升级 Node）。
