export type GuestyErrorCode =
  | 'token_fetch_failed'
  | 'auth_failed'
  | 'rate_limited'
  | 'upstream_error'
  | 'bad_response'
  | 'timeout'
  | 'retries_exhausted';

export class GuestyError extends Error {
  constructor(
    public code: GuestyErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GuestyError';
  }
}
