import { ScaleError, fail } from "./errors.js";
import { centsToRatio } from "./mathUtil.js";

/** 声明数量的硬上下限。 */
export const MIN_COUNT = 1;
export const MAX_COUNT = 128;

export interface ParsedInterval {
  /** 原始词法文本（区间行的首个 token）。 */
  token: string;
  /** 规范化后的双精度频率比（相对隐含首级 1/1）。 */
  ratio: number;
  /** 该比值对应的音分值。 */
  cents: number;
  /** 解释方式：纯整数、分数或音分小数。 */
  kind: "integer" | "fraction" | "cents";
}

export interface ParsedScale {
  description: string;
  /** 声明行数 N（含完整周期，不含隐含首级 1/1）。 */
  count: number;
  /** 长度 N：前 N-1 项为周期内音程，末项为完整周期。 */
  intervals: ParsedInterval[];
  /** 周期比值（恒等于最后一个声明音程，且大于 1）。 */
  period: number;
  /** 长度 N+1：degree 0 为隐含 1/1，其后是前 N-1 个声明音程，末位补 1*period 便于跨周期对齐。 */
  degreeRatios: number[];
}

const INTEGER_RE = /^\+?\d+$/;
const SIGNED_INT_RE = /^\+?\d+$/;

/**
 * 解析单个音程 token：
 * - 含小数点：按音分换算 2^(cents/1200)
 * - 含 '/'：必须恰为两个正整数的分数
 * - 纯整数：按频率比解释（2 即 2/1）
 * 任何其它形式（指数、多个斜杠、负号、非法字符等）明确拒绝。
 */
function parseIntervalToken(token: string, lineNo: number): ParsedInterval {
  const here = { line: lineNo, token };

  if (token.includes("/")) {
    const parts = token.split("/");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      fail("SCL_UNSUPPORTED_SYNTAX", `第 ${lineNo} 行分数格式非法：${token}`, here);
    }
    const [numStr, denStr] = parts;
    if (!SIGNED_INT_RE.test(numStr) || !SIGNED_INT_RE.test(denStr)) {
      fail("SCL_UNSUPPORTED_SYNTAX", `第 ${lineNo} 行分数必须是两个整数：${token}`, here);
    }
    const den = Number(denStr);
    if (den === 0) {
      fail("SCL_ZERO_DENOMINATOR", `第 ${lineNo} 行分母为零：${token}`, here);
    }
    const num = Number(numStr);
    const ratio = num / den;
    if (!(num > 0) || !(ratio > 0)) {
      fail("SCL_NON_POSITIVE", `第 ${lineNo} 行比值必须为正：${token}`, here);
    }
    if (!Number.isFinite(ratio)) {
      fail("SCL_INVALID_INTERVAL", `第 ${lineNo} 行比值不是有限数：${token}`, here);
    }
    return { token, ratio, cents: 1200 * (Math.log(ratio) / Math.LN2), kind: "fraction" };
  }

  if (token.includes(".")) {
    if (!/^[+-]?\d*\.?\d+$|^[+-]?\d+\.?\d*$/.test(token)) {
      fail("SCL_UNSUPPORTED_SYNTAX", `第 ${lineNo} 行音分数字格式非法：${token}`, here);
    }
    const cents = Number(token);
    if (!Number.isFinite(cents)) {
      fail("SCL_INVALID_INTERVAL", `第 ${lineNo} 行音分不是有限数：${token}`, here);
    }
    const ratio = centsToRatio(cents);
    if (!(ratio > 0)) {
      fail("SCL_NON_POSITIVE", `第 ${lineNo} 行音分必须为正：${token}`, here);
    }
    return { token, ratio, cents, kind: "cents" };
  }

  if (INTEGER_RE.test(token)) {
    const value = Number(token);
    if (!(value > 0)) {
      fail("SCL_NON_POSITIVE", `第 ${lineNo} 行整数比值必须为正：${token}`, here);
    }
    return { token, ratio: value, cents: 1200 * (Math.log(value) / Math.LN2), kind: "integer" };
  }

  fail(
    "SCL_UNSUPPORTED_SYNTAX",
    `第 ${lineNo} 行包含无法支持的语法：${token}（仅支持正整数、分数与小数音分）`,
    here
  );
}

/**
 * 解析受限 Scala SCL 文本。
 * 结构：描述行、计数行、N 个音程行；支持 '!' 整行/行尾注释与空行。
 */
export function parseScale(rawText: string): ParsedScale {
  if (rawText == null || rawText.trim() === "") {
    fail("SCL_EMPTY", "SCL 文本为空");
  }

  const rawLines = rawText.split(/\r\n|\r|\n/);
  const content: { text: string; lineNo: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    let line = rawLines[i];
    const bang = line.indexOf("!");
    if (bang >= 0) line = line.slice(0, bang); // 行尾注释（含整行注释）
    line = line.trim();
    if (line !== "") content.push({ text: line, lineNo });
  }

  if (content.length < 2) {
    fail("SCL_PARSE_ERROR", "SCL 至少需要描述行与计数行");
  }

  const description = content[0].text;
  const countLine = content[1];
  if (!/^\d+$/.test(countLine.text)) {
    fail("SCL_PARSE_ERROR", `计数行必须是非负整数字面量：${countLine.text}`, {
      line: countLine.lineNo
    });
  }
  const declared = Number(countLine.text);

  if (declared < MIN_COUNT || declared > MAX_COUNT) {
    fail(
      "VALIDATION_ERROR",
      `声明音程数量 N=${declared} 超出允许范围 [${MIN_COUNT}, ${MAX_COUNT}]`,
      { line: countLine.lineNo, declared }
    );
  }

  const intervalLines = content.slice(2);
  if (intervalLines.length !== declared) {
    fail(
      "SCL_COUNT_MISMATCH",
      `计数行声明 ${declared} 个音程，实际存在 ${intervalLines.length} 行`,
      { declared, actual: intervalLines.length }
    );
  }

  const intervals: ParsedInterval[] = intervalLines.map((entry) => {
    // Scala 音程行：首个空白分隔 token 为数值，其后可附带名称（忽略）。
    const token = entry.text.split(/\s+/)[0];
    return parseIntervalToken(token, entry.lineNo);
  });

  // 严格递增 + 正值 + 周期大于 1。
  for (let i = 0; i < intervals.length; i++) {
    if (!(intervals[i].ratio > 0)) {
      fail("SCL_NON_POSITIVE", `第 ${i + 1} 个音程比值非正`, intervals[i].token);
    }
    if (i > 0) {
      if (!(intervals[i].ratio > intervals[i - 1].ratio)) {
        fail(
          "SCL_NOT_STRICTLY_INCREASING",
          `音程必须严格递增：第 ${i} 项 ${intervals[i - 1].token} 不小于第 ${
            i + 1
          } 项 ${intervals[i].token}`,
          { previous: intervals[i - 1].token, current: intervals[i].token }
        );
      }
    }
  }

  const period = intervals[intervals.length - 1].ratio;
  if (!(period > 1)) {
    fail("SCL_PERIOD_NOT_GREATER_THAN_ONE", `周期比值必须大于 1，实际为 ${period}`, {
      period
    });
  }

  // degree 0 为隐含 1/1；degree 1..N-1 为周期内音程。
  const innerRatios = intervals.slice(0, declared - 1).map((iv) => iv.ratio);
  const degreeRatios = [1, ...innerRatios];

  return { description, count: declared, intervals, period, degreeRatios };
}

/** 仅做语法/语义校验，返回解析摘要或抛出 ScaleError。 */
export function validateScale(rawText: string): {
  ok: true;
  count: number;
  period: number;
  description: string;
  intervals: { token: string; ratio: number; cents: number; kind: string }[];
} {
  const parsed = parseScale(rawText);
  return {
    ok: true,
    count: parsed.count,
    period: parsed.period,
    description: parsed.description,
    intervals: parsed.intervals.map((iv) => ({
      token: iv.token,
      ratio: iv.ratio,
      cents: iv.cents,
      kind: iv.kind
    }))
  };
}

export function errorSummary(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof ScaleError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return { code: "UNKNOWN_ERROR", message: err instanceof Error ? err.message : String(err) };
}
