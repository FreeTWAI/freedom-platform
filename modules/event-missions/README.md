# Private event self-exercises

Optional owner-only personal exercises, NOT organizer tasks. Three persisted slots
are selected only after explicit start. Replace/skip/self-report are voluntary.
There is no free-text input, peer identity, location, public projection, attendance
claim, exchange receipt, Contribution, XP, reward or badge. Existing RSVP, helper,
friend and achievement domains are untouched.

Member-session/Origin/CSRF middleware surrounds the independent API. Every command
checks current authority before receipt replay. GET is no-store and never creates
assignments. A lost acknowledgement retains its exact key/body/version in memory;
only the corresponding ACK settles it, then the UI rereads current state. Clear
removes slots; minimal identity/version tombstone and command ACK remain to prevent
stale writes recreating deleted progress. This is not complete data erasure.

Host approval is not implied: every surface labels these personal self-exercises.
No host enabled policy or audience expansion is added. Inaccessible events reveal
no task contents; owners can still clear their own retained row. Users who lose
membership cannot read it through a stale session.

Stacked on PR1170 at48b5def6, with migration196 reserved after checking all open PR
file pages on2026-10-29. Migration/catalog publication and deployment require their
separate approval. No live configuration is changed by this slice.

Validation: policy/projection tests, real isolated PostgreSQL HTTP tests, browser
lifecycle/mobile tests, full typecheck/build and governance. A missing disposable
TEST_DATABASE_URL or dependency environment is not a pass and must be reported.
