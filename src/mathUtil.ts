/** 对外公开并在内部统一使用的双精度容限。 */
export const TOLERANCE = {
  /** 频率相对误差容限（约 1e-9）。 */
  frequencyRelEps: 1e-9,
  /** 音分误差容限（cent）。 */
  centsAbsEps: 1e-6,
  /** 判断音程严格大于 1（周期）与严格递增时使用的最小间隔。 */
  ratioEps: 1e-12
} as const;

/** 两个双精度频率是否在相对容限内相等。 */
export function freqClose(a: number, b: number, eps = TOLERANCE.frequencyRelEps): boolean {
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= eps * scale;
}

/** 音分差是否在绝对音分容限内。 */
export function centsClose(a: number, b: number, eps = TOLERANCE.centsAbsEps): boolean {
  return Math.abs(a - b) <= eps;
}

/** 比值 -> 音分：1200 * log2(r)。 */
export function ratioToCents(r: number): number {
  return 1200 * (Math.log(r) / Math.LN2);
}

/** 音分 -> 比值：2^(cents/1200)。 */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/**
 * 欧几里得向下取整除法（floor division）。
 * q = floor(a / n)，r = a - q*n，保证 0 <= r < n（n 为正）。
 * 对负的 a 也成立，绝不朝零截断。
 */
export function floorDiv(a: number, n: number): { q: number; r: number } {
  const q = Math.floor(a / n);
  const r = a - q * n;
  return { q, r };
}
