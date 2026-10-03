# SCL 微分音音阶与键盘周期音高映射服务

离线、本地运行的后端服务（TypeScript + Node.js + SQLite），导入受限 Scala SCL 文本，
按音阶周期把整数键号映射为频率，并解释每个键落在哪个周期、哪个级数。

本服务**只计算音高关系**：不读取 MIDI 乐曲、不合成音频、不连接乐器，不处理节拍、
音符时长与配器。键号不被固定解释为十二平均律。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite`，无需原生编译）
- 不依赖 Docker / WSL / 付费服务 / 外部在线 API

## 快速开始

```powershell
npm install        # 仅安装开发依赖 typescript / @types/node
npm run build      # 编译 TypeScript 到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 HTTP API（默认自动选择空闲端口）
npm run demo       # 12-TET 与微分音音阶对比演示（写入项目内 data/ 目录）
```

指定端口：`node dist/src/index.js serve --port 8080`，或设置环境变量 `PORT`。
数据目录默认为项目内 `data/`，可用环境变量 `SCL_DATA_DIR` 覆盖。

## SCL 数值语法（受限子集）

- `!` 开头的行为注释，空行忽略。
- 第一条非注释行是**描述行**，第二条是**计数行**（整数 N，1 ≤ N ≤ 128）。
- 之后恰好 N 行**音程行**（行尾可附说明文字，取首个空白分隔的 token）：
  - 含小数点的数（如 `701.955`）按**音分**解释，换算为 `2^(cents/1200)`；
  - 整数（如 `2`）与分数（如 `3/2`）按**频率比**解释——`2` 是二比一，不是两音分；
  - 分母为零、非正值、非严格递增的音程、周期 ≤ 1 均被拒绝；
  - 其他写法（如 `2^(1/1)`、`1,5`）属于不支持的扩展语法，明确报错。
- **隐含首级**：1/1 不写在文件里。声明的 N 行中，前 N-1 项是周期内音程，
  第 N 项是完整周期比值（不必等于 2/1）。解析后规范比值表为
  `ratios[0]=1, ratios[1..N-1]=周期内音程, ratios[N]=周期`。

## 音高映射规则

配置包含：周期起点键 `K`、参考键 `R`、参考频率 `refHz`（正数）。

对任意键 `k`：令 `d = k - K`，`q = floor(d / N)`（**向下取整**，负键差同样适用），
`r = d - q*N`（恒为非负），则

```
ratio(k) = ratios[r] * period^q
freq(k)  = refHz * ratio(k) / ratio(R)
```

参考键 `R` 不必等于 `K`，也不会被强行当作隐含 1/1；它只是“该键频率已知”的锚点。
修改参考频率会生成新配置（版本号递增），旧配置保留在 SQLite 中仍可查询。

## 容限与上限

全部计算使用双精度浮点。公开常量（`limits` 命令可查）：

- 频率相对误差容限 `1e-9`，音分绝对容限 `1e-6`；
- 键号范围 `|k| ≤ 1,000,000`；区间查询一次最多 4096 个键；
- 频率溢出 / 下溢为零 / 非有限值返回错误码 `FREQ_NOT_FINITE`，不返回正常值。

## HTTP API

错误统一为 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/scales` | 导入音阶 `{name, text}`；校验失败不落库 |
| POST | `/scales/validate` | 仅校验 `{text}` |
| GET | `/scales`、`/scales/:id` | 列出 / 查看音阶（含原始文本与规范比值） |
| POST | `/configs` | 创建配置 `{scaleId, periodKey, refKey, refHz}`，版本递增 |
| GET | `/configs`、`/configs/:id` | 列出 / 查看配置 |
| GET | `/configs/:id/pitch?key=` | 单键频率 |
| GET | `/configs/:id/pitches?from=&to=` | 键区间 |
| GET | `/configs/:id/explain?key=` | 周期 / 级数解释 |
| GET | `/configs/:id/export?from=&to=` | 导出 CSV 调律表 |
| GET | `/compare?a=&b=&from=&to=` | 比较两套配置的音分差 |

主要错误码：`SCL_EMPTY`、`SCL_BAD_COUNT`、`SCL_COUNT_MISMATCH`、`SCL_BAD_INTERVAL`、
`SCL_UNSUPPORTED_SYNTAX`、`SCL_NOT_POSITIVE`、`SCL_NOT_INCREASING`、`SCL_BAD_PERIOD`、
`SCALE_NOT_FOUND`、`CONFIG_NOT_FOUND`、`BAD_PARAM`、`KEY_OUT_OF_RANGE`、
`RANGE_TOO_LARGE`、`FREQ_NOT_FINITE`。

## CLI

```
node dist/src/index.js <命令>
  serve [--port N]                启动 HTTP API（默认端口 0 = 自动选空闲端口）
  validate --file f.scl           校验 SCL（或用 --text）
  import --name 名 --file f.scl   导入音阶
  scales / configs                列出音阶 / 配置
  mkconfig --scale ID --k K --r R --hz 440
  pitch --config ID --key K
  range --config ID --from A --to B
  explain --config ID --key K
  compare --a ID --b ID --from A --to B
  export --config ID --from A --to B
  demo / limits
```

## 已知限制

- 仅支持上述 SCL 子集，不支持 Scala 的扩展语法（如混合数、表达式）。
- 音程行行尾说明文字会被忽略（取首个 token）。
- 单进程服务，无鉴权，面向本机离线使用。
