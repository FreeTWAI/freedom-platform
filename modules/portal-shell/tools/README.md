# Manual route readiness measurement

Opt-in diagnostic, **not a CI test, SLO, speed fix or benchmark verdict**. Nothing
runs without an explicit target, output and operator acknowledgement. This tool
is not wired into Playwright discovery, `runtime.full`, npm scripts or CI.

From the repository root (existing Node / `@playwright/test` dependencies and
installed Chromium required):

```sh
node modules/portal-shell/tools/measure-route-readiness.mjs --help
node modules/portal-shell/tools/measure-route-readiness.mjs \
  --base-url http://127.0.0.1:4311 --output /private/new-cold-sample.json --authorized
```

The example assumes an **already running, operator-authorized** environment.
The script does not start a server, install a browser, infer production, use an
environment-variable target or bypass restricted sockets. HTTPS origins or HTTP
loopback origins only; no userinfo, path, query or fragment. `--authorized` records
operator intent; it does not grant an agent permission to operate a deployment.
Never run against a service/account without its owner's authorization.

The default creates a fresh ephemeral Chromium context and records **one cold
anonymous** navigation through the Traditional Chinese login heading and enabled
form. It does not sign up, sign in, create posts, call write APIs or use a saved
profile. It cannot measure cold authenticated deep links. Report creation uses
exclusive creation (`wx`, mode `0600`), requires an existing writable parent,
and never overwrites an existing file. Keep the output out of source control.

For optional warm measurement, add `--warm-interactive` in a real terminal. The
browser is headed; **you** sign in with an authorized test account, select
Traditional Chinese, open member home and close chat, then press Enter within
five minutes. Do not paste credentials into the terminal. Login/setup is not
timed. The script uses visible menu/search buttons to navigate exactly
home → social → home → social, one sample per route, stopping on first failure.
There is no repeat/load loop or automatic retry. The script itself performs no
business writes; real UI reads may still produce normal server access/session
activity. No authentication state, screenshots, traces or network dumps are saved.

Cold starts at browser navigation start; warm starts at the actual destination
button click (menu/search preparation excluded). Heading and data readiness are
separate: warm requires feed busy=false, no alert, and a visible post or explicit
empty state. Two animation frames allow a rendering opportunity, **not proof of
physical display presentation**. Timings include Playwright polling/round trips.
They are not exact first paint, real-user distributions, p95 or evidence of a
product improvement. Browser/locale/viewport are fixed; network, server state,
build and hardware are operator-controlled and must be matched for comparisons.

The local JSON retains only fixed enums, counts and finite nonnegative timing
scalars (null where unavailable). URLs, credentials, storage state, DOM content,
member IDs, resource names, request/response payloads and raw errors are omitted.
Failed/timeout attempts remain in the report; warm setup failure is separate and
also makes overall outcome failed. A measurement has a 30-second diagnostic
limit, not a performance budget. Cleanup is best effort and cannot turn a ready
sample into a failure. Reports are written **before** browser cleanup and are
not discarded by the CI artifact cleaner. Exit 0 means observed readiness only;
1 means failed measurement/setup; 2 means invocation/output unavailable. A
write failure or forced process termination cannot promise a complete report;
an empty/partial file is never success. Browser startup failure is a counted cold
failure if the output was successfully reserved.

The measurement deadline uses `Promise.race`; it **does not cancel** an in-flight
browser command. After a failed sample the script starts no further navigation
and attempts to close its owned browser/context, without retries. The bounded
wait for `browser.close()` does not guarantee OS-process termination; this tool
does not promise a strictly bounded whole-process runtime. If interrupted or a
browser process is stuck, the operator must inspect and close only that owned
process. No machine-wide process kill is performed.

Small pure checks (no browser/network/DB, no global suite registration):

```sh
node --test modules/portal-shell/tools/measure-route-readiness.test.mjs
```

Actual browser/live invocation remains **not_run** for this revision. The prior
automated candidate's successful CI run did not retain scalar attachments and
does not validate this manual replacement or establish latency improvements.
