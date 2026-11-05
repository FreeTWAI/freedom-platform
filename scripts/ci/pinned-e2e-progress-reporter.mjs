import { resolve } from 'node:path';

// Scheduling only: the JSON reports and exact inventory union still determine
// success. A missing/failed native completion keeps peers queued until exit.
export default class NativeProgressReporter {
  pending = new Set();
  failed = false;
  released = false;

  onBegin(_config, suite) {
    const native = resolve(process.env.FREEDOM_PINNED_E2E_ROOT, 'tests/e2e/absurd-daily.spec.ts');
    this.pending = new Set(suite.allTests().filter(test => resolve(test.location.file) === native).map(test => test.id));
    this.release();
  }

  onTestEnd(test, result) {
    if (!this.pending.delete(test.id)) return;
    if (result.status !== 'passed') this.failed = true;
    this.release();
  }

  release() {
    if (this.released || this.failed || this.pending.size) return;
    this.released = true;
    process.send?.({ type: 'freedom.e2e.native-complete' });
  }
}
