export class ImportError extends Error {
  code: string;
  retryAfter: number;
  constructor(code: string, retryAfter = 0) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
