export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const ERR = {
  SCL_EMPTY: 'SCL_EMPTY',
  SCL_BAD_COUNT: 'SCL_BAD_COUNT',
  SCL_COUNT_MISMATCH: 'SCL_COUNT_MISMATCH',
  SCL_BAD_INTERVAL: 'SCL_BAD_INTERVAL',
  SCL_UNSUPPORTED_SYNTAX: 'SCL_UNSUPPORTED_SYNTAX',
  SCL_NOT_POSITIVE: 'SCL_NOT_POSITIVE',
  SCL_NOT_INCREASING: 'SCL_NOT_INCREASING',
  SCL_BAD_PERIOD: 'SCL_BAD_PERIOD',
  SCALE_NOT_FOUND: 'SCALE_NOT_FOUND',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  BAD_PARAM: 'BAD_PARAM',
  KEY_OUT_OF_RANGE: 'KEY_OUT_OF_RANGE',
  RANGE_TOO_LARGE: 'RANGE_TOO_LARGE',
  FREQ_NOT_FINITE: 'FREQ_NOT_FINITE',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL'
} as const;
