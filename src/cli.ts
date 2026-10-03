import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as core from './core';
import { FREQ_REL_TOL, CENTS_TOL, MAX_COUNT, MAX_SPAN, MAX_ABS_KEY } from './constants';

function print(x: unknown): void {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
}

function argMap(args: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) m.set(args[i].slice(2), args[i + 1] ?? '');
  }
  return m;
}

function need(m: Map<string, string>, k: string): string {
  const v = m.get(k);
  if (v === undefined || v === '') throw new Error(`缺少参数 --${k}`);
  return v;
}

export const TET12_SCL = `! 十二平均律（音分表示）
12-TET equal temperament
12
!
100.0
200.0
300.0
400.0
500.0
600.0
700.0
800.0
900.0
1000.0
1100.0
1200.0
`;

export const DEMO_MICRO_SCL = `! 示例微分音音阶：五度 + 周期 2/1
two-degree 3/2 scale
2
!
3/2
2/1
`;

export function runCli(db: DatabaseSync, argv: string[]): number {
  const [cmd, ...rest] = argv;
  const m = argMap(rest);
  switch (cmd) {
    case 'validate': {
      const text = m.has('text') ? need(m, 'text') : fs.readFileSync(need(m, 'file'), 'utf8');
      const p = core.validateScale(text);
      print({ ok: true, description: p.description, count: p.count, period: p.period, ratios: p.ratios });
      return 0;
    }
    case 'import': {
      const text = m.has('text') ? need(m, 'text') : fs.readFileSync(need(m, 'file'), 'utf8');
      print(core.importScale(db, need(m, 'name'), text));
      return 0;
    }
    case 'scales':
      print(core.listScales(db));
      return 0;
    case 'mkconfig':
      print(
        core.createConfig(
          db,
          Number(need(m, 'scale')),
          Number(m.get('k') ?? '0'),
          Number(m.get('r') ?? '0'),
          Number(need(m, 'hz'))
        )
      );
      return 0;
    case 'configs':
      print(core.listConfigs(db));
      return 0;
    case 'pitch':
      print(core.pitch(db, Number(need(m, 'config')), Number(need(m, 'key'))));
      return 0;
    case 'range':
      print(core.pitchRange(db, Number(need(m, 'config')), Number(need(m, 'from')), Number(need(m, 'to'))));
      return 0;
    case 'explain': {
      const p = core.pitch(db, Number(need(m, 'config')), Number(need(m, 'key')));
      print(`键 ${p.key}: 周期 ${p.periodIndex}, 级数 ${p.degree}, 比值 ${p.ratio}, 频率 ${p.frequency} Hz`);
      return 0;
    }
    case 'compare':
      print(
        core.compareConfigs(
          db,
          Number(need(m, 'a')),
          Number(need(m, 'b')),
          Number(need(m, 'from')),
          Number(need(m, 'to'))
        ).map((r) => ({ key: r.key, aHz: r.a.frequency, bHz: r.b.frequency, centsDiff: r.centsDiff }))
      );
      return 0;
    case 'export':
      process.stdout.write(
        core.exportTuningTable(db, Number(need(m, 'config')), Number(need(m, 'from')), Number(need(m, 'to')))
      );
      return 0;
    case 'demo': {
      const tet = core.importScale(db, '12-TET', TET12_SCL);
      const micro = core.importScale(db, 'demo-3/2', DEMO_MICRO_SCL);
      const c1 = core.createConfig(db, tet.id, 0, 0, 440);
      const c2 = core.createConfig(db, micro.id, 0, 0, 440);
      console.log(`音阶 #${tet.id} (12-TET) 配置 #${c1.id}；音阶 #${micro.id} (3/2,2/1) 配置 #${c2.id}`);
      console.log('key | 12-TET Hz | 微分音 Hz | 音分差');
      for (const row of core.compareConfigs(db, c1.id, c2.id, -4, 8)) {
        console.log(
          `${row.key}\t${row.a.frequency.toFixed(3)}\t${row.b.frequency.toFixed(3)}\t${row.centsDiff.toFixed(2)}`
        );
      }
      console.log('（数据已写入 SQLite，重启进程后可用 scales/configs/pitch 命令再次读取）');
      return 0;
    }
    case 'limits':
      print({ FREQ_REL_TOL, CENTS_TOL, MAX_COUNT, MAX_SPAN, MAX_ABS_KEY });
      return 0;
    default:
      console.log(`用法: node dist/src/index.js <命令> [参数]
命令:
  serve [--port N]                 启动 HTTP API（默认端口 0 = 自动选空闲端口）
  validate --file f.scl            校验 SCL 文本（或用 --text）
  import --name 名 --file f.scl    导入音阶
  scales                           列出音阶
  mkconfig --scale ID --k K --r R --hz 440   创建映射配置（生成新版本）
  configs                          列出配置
  pitch --config ID --key K        查询单键
  range --config ID --from A --to B          查询键区间
  explain --config ID --key K      周期/级数解释
  compare --a ID --b ID --from A --to B      比较两套配置
  export --config ID --from A --to B         导出 CSV 调律表
  demo                             12-TET 与微分音对比演示
  limits                           查看容限与上限常量`);
      return cmd ? 1 : 0;
  }
}
