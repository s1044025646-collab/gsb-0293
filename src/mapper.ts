import { fail } from "./errors.js";
import { floorDiv, ratioToCents } from "./mathUtil.js";
import type { ParsedScale } from "./scl.js";

/** 单次区间查询允许的最大键数（防止无界查询与内存膨胀）。 */
export const MAX_RANGE_KEYS = 100_000;

export interface MappingConfig {
  /** 周期起点键 K：该键处落入 degree 0（隐含 1/1）。 */
  originKey: number;
  /** 参考键 R：其频率已知。 */
  referenceKey: number;
  /** 参考键频率 Hz（正数）。 */
  referenceHz: number;
}

export interface KeyPosition {
  key: number;
  /** 相对周期起点的键差 d = k - K。 */
  delta: number;
  /** 周期序号 q = floor(d / N)，可为负。 */
  periodIndex: number;
  /** 周期内级数 r，0 <= r < N。 */
  degree: number;
  /** 该键相对周期起点 K 的纯比值 P^q * degreeRatio[r]。 */
  ratioFromOrigin: number;
  /** 该比值相对完整周期的音分（含跨周期）。 */
  centsFromOrigin: number;
}

export interface KeyResult extends KeyPosition {
  /** 归一参考键后的最终频率 Hz。 */
  frequency: number;
  /** 相对参考键的音分差。 */
  centsFromReference: number;
}

function assertIntKey(key: number, name: string): void {
  if (!Number.isInteger(key)) {
    fail("VALIDATION_ERROR", `${name} 必须是整数键号`, { received: key });
  }
}

export function validateConfig(config: MappingConfig): void {
  assertIntKey(config.originKey, "周期起点键 K");
  assertIntKey(config.referenceKey, "参考键 R");
  if (
    typeof config.referenceHz !== "number" ||
    !Number.isFinite(config.referenceHz) ||
    config.referenceHz <= 0
  ) {
    fail("VALIDATION_ERROR", "参考频率 Hz 必须是正的有限数", {
      received: config.referenceHz
    });
  }
}

/**
 * 计算任意键相对周期起点的位置。
 * d = k - K；q = floor(d/N)；r = d - qN（0 <= r < N）。
 */
export function positionOf(parsed: ParsedScale, key: number, originKey: number): KeyPosition {
  assertIntKey(key, "查询键");
  const delta = key - originKey;
  const { q, r } = floorDiv(delta, parsed.count);
  const degreeRatio = parsed.degreeRatios[r];
  const periodPower = Math.pow(parsed.period, q);
  if (periodPower === Infinity) {
    fail("FREQUENCY_OVERFLOW", `键 ${key} 的周期幂 P^${q} 上溢为无穷`, {
      key,
      periodIndex: q
    });
  }
  if (periodPower === 0) {
    fail("FREQUENCY_UNDERFLOW", `键 ${key} 的周期幂 P^${q} 下溢为零`, {
      key,
      periodIndex: q
    });
  }
  if (!Number.isFinite(periodPower) || periodPower < 0) {
    fail("FREQUENCY_NON_FINITE", `键 ${key} 的周期幂 P^${q} 不是正有限数`, {
      key,
      periodIndex: q
    });
  }
  const ratioFromOrigin = periodPower * degreeRatio;
  if (!Number.isFinite(ratioFromOrigin) || ratioFromOrigin <= 0) {
    fail("FREQUENCY_NON_FINITE", `键 ${key} 相对周期起点的比值不是正有限数`, {
      key,
      periodIndex: q,
      degree: r
    });
  }
  return {
    key,
    delta,
    periodIndex: q,
    degree: r,
    ratioFromOrigin,
    centsFromOrigin: ratioToCents(ratioFromOrigin)
  };
}

/** 计算单键的最终频率及周期/级数解释。 */
export function frequencyOf(
  parsed: ParsedScale,
  config: MappingConfig,
  key: number
): KeyResult {
  validateConfig(config);
  const target = positionOf(parsed, key, config.originKey);
  const ref = positionOf(parsed, config.referenceKey, config.originKey);
  const scale = target.ratioFromOrigin / ref.ratioFromOrigin;
  if (!Number.isFinite(scale) || scale <= 0) {
    fail("FREQUENCY_NON_FINITE", `键 ${key} 相对参考键的归一系数无效`, { key });
  }
  const frequency = config.referenceHz * scale;
  if (!Number.isFinite(frequency)) {
    fail("FREQUENCY_OVERFLOW", `键 ${key} 的频率超出双精度范围`, { key, frequency });
  }
  if (frequency === 0) {
    fail("FREQUENCY_UNDERFLOW", `键 ${key} 的频率下溢为零`, { key });
  }
  if (frequency < 0) {
    fail("FREQUENCY_NON_FINITE", `键 ${key} 的频率为负`, { key, frequency });
  }
  return {
    ...target,
    frequency,
    centsFromReference: ratioToCents(scale)
  };
}

export interface RangeResult {
  from: number;
  to: number;
  count: number;
  results: KeyResult[];
}

/** 查询闭区间 [from, to]，步长恒为 1 个键。 */
export function frequencyRange(
  parsed: ParsedScale,
  config: MappingConfig,
  from: number,
  to: number
): RangeResult {
  assertIntKey(from, "区间起点");
  assertIntKey(to, "区间终点");
  if (from > to) {
    fail("VALIDATION_ERROR", `区间起点 ${from} 不得大于终点 ${to}`);
  }
  const count = to - from + 1;
  if (count > MAX_RANGE_KEYS) {
    fail("RANGE_TOO_LARGE", `区间键数 ${count} 超过上限 ${MAX_RANGE_KEYS}`, {
      count,
      max: MAX_RANGE_KEYS
    });
  }
  const results: KeyResult[] = [];
  for (let key = from; key <= to; key++) {
    results.push(frequencyOf(parsed, config, key));
  }
  return { from, to, count, results };
}

/** 导出调律表：某键区间逐条的周期、级数、比值与频率。 */
export function tuningTable(
  parsed: ParsedScale,
  config: MappingConfig,
  from: number,
  to: number
) {
  const range = frequencyRange(parsed, config, from, to);
  return {
    scaleCount: parsed.count,
    period: parsed.period,
    originKey: config.originKey,
    referenceKey: config.referenceKey,
    referenceHz: config.referenceHz,
    rows: range.results.map((row) => ({
      key: row.key,
      periodIndex: row.periodIndex,
      degree: row.degree,
      ratioFromOrigin: row.ratioFromOrigin,
      centsFromReference: row.centsFromReference,
      frequency: row.frequency
    }))
  };
}

/** 比较两套（音阶 + 配置）在同一键区间上的频率差。 */
export function compareScales(
  left: { name: string; parsed: ParsedScale; config: MappingConfig },
  right: { name: string; parsed: ParsedScale; config: MappingConfig },
  from: number,
  to: number
) {
  const a = frequencyRange(left.parsed, left.config, from, to);
  const b = frequencyRange(right.parsed, right.config, from, to);
  return {
    left: { name: left.name, period: left.parsed.period, count: left.parsed.count },
    right: { name: right.name, period: right.parsed.period, count: right.parsed.count },
    from,
    to,
    rows: a.results.map((ra, i) => {
      const rb = b.results[i];
      const ratio = ra.frequency / rb.frequency;
      return {
        key: ra.key,
        leftHz: ra.frequency,
        rightHz: rb.frequency,
        ratio,
        centsDifference: ratioToCents(ratio)
      };
    })
  };
}
