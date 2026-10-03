import { ApiError, ERR } from './errors';
import { MAX_COUNT } from './constants';

export interface ParsedScale {
  description: string;
  /** 声明的音程行数 N（含周期，不含隐含 1/1） */
  count: number;
  /**
   * 规范比值表，长度 N+1：
   * ratios[0] = 1（隐含首级），ratios[1..N-1] 为周期内音程，ratios[N] 为周期比值。
   */
  ratios: number[];
  /** 周期比值 = ratios[N]，必须 > 1 */
  period: number;
}

const CENTS_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+\.\d+)([eE][+-]?\d+)?$/;
const FRACTION_RE = /^(\d+)\/(\d+)$/;
const INTEGER_RE = /^\d+$/;

function parseIntervalToken(token: string, lineNo: number): number {
  if (CENTS_RE.test(token)) {
    const cents = Number(token);
    if (!Number.isFinite(cents)) {
      throw new ApiError(ERR.SCL_BAD_INTERVAL, `第 ${lineNo} 行：音分数值无效: ${token}`);
    }
    return Math.pow(2, cents / 1200);
  }
  const frac = FRACTION_RE.exec(token);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) {
      throw new ApiError(ERR.SCL_BAD_INTERVAL, `第 ${lineNo} 行：分数分母为零: ${token}`);
    }
    return num / den;
  }
  if (INTEGER_RE.test(token)) {
    // 整数按频率比解释：2 表示 2/1，而不是 2 音分
    return Number(token);
  }
  // 明确拒绝不支持的扩展语法（如小数点逗号、混合数、函数表达式等）
  throw new ApiError(
    ERR.SCL_UNSUPPORTED_SYNTAX,
    `第 ${lineNo} 行：无法支持的音程语法: ${token}`
  );
}

/**
 * 解析受限 Scala SCL 文本。
 * 支持：! 注释行、空行、描述行、计数行、音程行（音分 / 整数比 / 分数比）。
 * 音程行允许行尾附加说明文字（取首个空白分隔的 token）。
 */
export function parseScl(text: string): ParsedScale {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ApiError(ERR.SCL_EMPTY, 'SCL 文本为空');
  }
  let description: string | undefined;
  let count: number | undefined;
  const declared: number[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === '' || line.startsWith('!')) continue;
    if (description === undefined) {
      description = line;
      continue;
    }
    if (count === undefined) {
      if (!INTEGER_RE.test(line)) {
        throw new ApiError(ERR.SCL_BAD_COUNT, `第 ${lineNo} 行：计数行必须是整数: ${line}`);
      }
      count = Number(line);
      if (count < 1 || count > MAX_COUNT) {
        throw new ApiError(
          ERR.SCL_BAD_COUNT,
          `第 ${lineNo} 行：音程数 N 必须在 1..${MAX_COUNT} 之间，得到 ${count}`
        );
      }
      continue;
    }
    const token = line.split(/\s+/)[0];
    declared.push(parseIntervalToken(token, lineNo));
  }

  if (description === undefined) {
    throw new ApiError(ERR.SCL_EMPTY, 'SCL 缺少描述行');
  }
  if (count === undefined) {
    throw new ApiError(ERR.SCL_BAD_COUNT, 'SCL 缺少计数行');
  }
  if (declared.length !== count) {
    throw new ApiError(
      ERR.SCL_COUNT_MISMATCH,
      `计数行声明 ${count} 个音程，实际解析到 ${declared.length} 个`
    );
  }

  const ratios = [1, ...declared];
  for (let i = 0; i < ratios.length; i++) {
    const v = ratios[i];
    if (!Number.isFinite(v) || v <= 0) {
      throw new ApiError(ERR.SCL_NOT_POSITIVE, `第 ${i} 个比值必须为正且有限，得到 ${v}`);
    }
    if (i > 0 && !(v > ratios[i - 1])) {
      throw new ApiError(
        ERR.SCL_NOT_INCREASING,
        `音程必须严格递增：第 ${i} 项 ${v} 不大于前一项 ${ratios[i - 1]}`
      );
    }
  }
  const period = ratios[ratios.length - 1];
  if (!(period > 1)) {
    throw new ApiError(ERR.SCL_BAD_PERIOD, `周期比值必须大于 1，得到 ${period}`);
  }
  return { description, count, ratios, period };
}
