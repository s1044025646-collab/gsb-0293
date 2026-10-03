/** 服务中所有可预期错误使用的稳定错误码，便于 API 与 CLI 精确处理。 */
export type ErrorCode =
  | "SCL_PARSE_ERROR"
  | "SCL_COUNT_MISMATCH"
  | "SCL_INVALID_INTERVAL"
  | "SCL_ZERO_DENOMINATOR"
  | "SCL_NON_POSITIVE"
  | "SCL_NOT_STRICTLY_INCREASING"
  | "SCL_PERIOD_NOT_GREATER_THAN_ONE"
  | "SCL_UNSUPPORTED_SYNTAX"
  | "SCL_EMPTY"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RANGE_TOO_LARGE"
  | "FREQUENCY_OVERFLOW"
  | "FREQUENCY_UNDERFLOW"
  | "FREQUENCY_NON_FINITE"
  | "DB_ERROR"
  | "UNKNOWN_ERROR";

export class ScaleError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ScaleError";
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: unknown
): never {
  throw new ScaleError(code, message, details);
}
