export class MailSendTimeoutError extends Error {
  readonly code = 'mail_send_timeout' as const;
  constructor(ms: number) {
    super(`Mail send timed out after ${ms}ms`);
    this.name = 'MailSendTimeoutError';
  }
}

/** Bound an outbound email call so a stalled provider rejects rather than hanging the request or worker. */
export function withSendLimit<Args extends unknown[], R>(
  send: (...args: Args) => Promise<R>,
  ms = 10_000,
): (...args: Args) => Promise<R> {
  return (...args: Args) =>
    new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => reject(new MailSendTimeoutError(ms)), ms);
      Promise.resolve()
        .then(() => send(...args))
        .then(
          value => {
            clearTimeout(timer);
            resolve(value);
          },
          error => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
}
