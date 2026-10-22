/** Transient reads only. Never use this queue to send or retry a business command. */
export type ConsoleReadContext = {signal: AbortSignal; isCurrent: () => boolean};
type Flight = {
  resource: string;
  abort: AbortController;
  promise: Promise<boolean>;
  cancel: () => void;
};

/** One in-flight read per slot, with no completed-response cache or polling. */
export function createConsoleReadRequests() {
  const flights = new Map<string, Flight>();
  function cancel(key: string) {
    const flight = flights.get(key);
    if (!flight) return;
    // Invalidate before abort listeners run, so an old completion cannot own the slot.
    flights.delete(key);
    flight.cancel();
  }
  function run(key: string, resource: string, read: (context: ConsoleReadContext) => Promise<boolean>,
    options: {replace?: boolean} = {}): Promise<boolean> {
    const pending = flights.get(key);
    if (pending?.resource === resource && !options.replace) return pending.promise;
    cancel(key);
    const abort = new AbortController();
    let resolve!: (value: boolean) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<boolean>((yes, no) => {resolve = yes; reject = no;});
    const flight: Flight = {resource, abort, promise, cancel: () => {resolve(false); abort.abort();}};
    const isCurrent = () => !abort.signal.aborted && flights.get(key) === flight;
    flights.set(key, flight);
    // A synchronously replaced/unmounted view does not send a request at all.
    void Promise.resolve().then(() => isCurrent() ? read({signal: abort.signal, isCurrent}) : false).then(
      value => {const current = isCurrent(); if (current) flights.delete(key); resolve(current && value);},
      cause => {if (isCurrent()) {flights.delete(key); reject(cause);} else resolve(false);},
    );
    return promise;
  }
  function cancelAll() {
    const pending = [...flights.values()];
    flights.clear();
    for (const flight of pending) flight.cancel();
  }
  return {run, cancel, cancelAll};
}
