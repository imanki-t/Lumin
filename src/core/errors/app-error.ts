export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  QUEUE_FULL = 'QUEUE_FULL',
  AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR',
  AI_QUOTA_EXHAUSTED = 'AI_QUOTA_EXHAUSTED',
  MEMORY_LOOKUP_TIMEOUT = 'MEMORY_LOOKUP_TIMEOUT',
  INVALID_INPUT = 'INVALID_INPUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isUserFacing: boolean;
  public readonly userMessage: string;
  public readonly details?: unknown;

  constructor(options: {
    message: string;
    code?: ErrorCode;
    statusCode?: number;
    isUserFacing?: boolean;
    userMessage?: string;
    details?: unknown;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code || ErrorCode.INTERNAL_ERROR;
    this.statusCode = options.statusCode || 500;
    this.isUserFacing = options.isUserFacing ?? true;
    this.userMessage = options.userMessage || options.message;
    this.details = options.details;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  public static isAppError(err: unknown): err is AppError {
    return err instanceof AppError;
  }
}
