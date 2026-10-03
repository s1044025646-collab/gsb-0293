import { ApiError, ERR } from './errors';
import { MAX_ABS_KEY } from './constants';

export interface MappingConfig {
  /** 周期起点键 K */
  periodKey: number;
  /** 参考键 R */
  refKey: number;
  /** 参考键频率 Hz（正数） */
  refHz: number;
}

export interface DegreeInfo {
  /** 周期序号 q = floor(d/N)，可为负 */
  periodIndex: number;
  /** 周期内级数 r，0 表示隐含 1/1 */
  degree: number;
  /** 相对周期起点键的比值 */
  ratio: number;
}

function checkKey(key: number): void {
  if (!Number.isInteger(key) || Math.abs(key) > MAX_ABS_KEY) {
    throw new ApiError(ERR.KEY_OUT_OF_RANGE, `键号必须是绝对值不超过 ${MAX_ABS_KEY} 的整数: ${key}`);
  }
}

/** 计算键 k 相对周期起点 K 的周期序号、级数与比值。负键差使用向下取整。 */
export function degreeInfo(ratios: number[], period: number, n: number, periodKey: number, key: number): DegreeInfo {
  checkKey(key);
  const d = key - periodKey;
  const q = Math.floor(d / n);
  const r = d - q * n; // 0 <= r < n，永不为负
  const ratio = ratios[r] * Math.pow(period, q);
  return { periodIndex: q, degree: r, ratio };
}

export interface PitchResult extends DegreeInfo {
  key: number;
  frequency: number;
  /** 相对参考键的音分 */
  centsFromRef: number;
}

/**
 * 计算键 k 的频率。
 * 最终频率 = refHz * ratio(k) / ratio(R)，参考键不必是周期起点，
 * 也不会被强行当作隐含 1/1。
 */
export function pitchForKey(
  ratios: number[],
  period: number,
  n: number,
  cfg: MappingConfig,
  key: number
): PitchResult {
  checkKey(cfg.refKey);
  const info = degreeInfo(ratios, period, n, cfg.periodKey, key);
  const ref = degreeInfo(ratios, period, n, cfg.periodKey, cfg.refKey);
  const frequency = (cfg.refHz * info.ratio) / ref.ratio;
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new ApiError(
      ERR.FREQ_NOT_FINITE,
      `键 ${key} 的频率溢出/下溢为非有限值或非正值`,
      422
    );
  }
  return {
    key,
    periodIndex: info.periodIndex,
    degree: info.degree,
    ratio: info.ratio,
    frequency,
    centsFromRef: 1200 * Math.log2(info.ratio / ref.ratio)
  };
}
