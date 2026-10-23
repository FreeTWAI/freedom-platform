# Seven-media local backup and restore drill

`npm run test:media-restore` retains its original owned PostgreSQL 18.6 container, network-none/no-port/tmpfs isolation and 120-second limit. It runs actual exported-snapshot `pg_dump` and `pg_restore`, plus native ephemeral SOURCE, BACKUP, RESTORED and INCOMPLETE R2 buckets. It does not use cloud credentials or real accounts.

The drill now creates eight current variants through delivered original HTTP routes and genuine finite factories: avatar, service cover, event banner, event video, skill submission image using its original upload grant, manual social thumbnail, and both event highlight image/thumb variants. Existing ready/retired avatar references remain, giving ten captured objects. The video is a signature-only 20 MiB synthetic WebM payload; it proves bounded storage, byte hashing and restore, not decoding or playback.

The source application uses a dedicated restricted role with the actual canonical runtime grant generator. The restore compares typed domain pointers, both highlight variants, asset scope/profile metadata and SHA values, as well as the migration ledger. A committed late writer is excluded from the exported snapshot and object manifest. Pins still veto deletion. All captured SOURCE objects are deleted before object restoration; original URLs then return identical bytes from RESTORED, with original DTO and cache behavior. Imported sessions are fenced before new synthetic recovery sessions are issued. Inactive callers and private skill-image reads by another owner are denied. Existing tamper/deletion veto/default-off/target/pool tests remain; a missing native BACKUP object cannot yield a verified restore.

## Restore ACL refusal and repair

A `--no-privileges` dump intentionally omits ACLs. That also omits the PUBLIC EXECUTE revocations on the twenty-four operator-only security-definer functions from migrations 105, 107, 109, 110 and 111. PostgreSQL restores its default PUBLIC EXECUTE authority on these functions. The unchanged canonical runtime grant guard rejects this state; the test verifies the refusal before repair.

Before granting application access, the local drill uses the reusable `lockdownRestoredMediaAcl` operation to read and apply the **seventeen exact `REVOKE ALL ON FUNCTION ... FROM PUBLIC` statements from the reviewed canonical migrations 105 (3 statements, 4 functions), 107 (2 statements, 3 functions), 109 (4 statements, 6 functions), 110 (5 statements, 7 functions) and 111 (3 statements, 4 functions)**, then reruns `deploy/cloudflare/sql/20-runtime-grants.psql` against the restored fixture schema. It verifies that the application cannot execute the operator functions, write the policy consent columns, or change the migration ledger. It does not replay the whole migration, add an operator approval, widen application privileges or dismiss the guard. A real restore procedure must restore this source-defined lockdown when using a dump stripped of ACLs; running the application grant script alone safely refuses. The installed list is `MEDIA_ACL_SIGNATURES` in `packages/media-migration/restore-acl-lockdown.ts`: `lock_media_backfill_operator_approval(text)`, `lock_media_backfill_cover_owner(text,uuid)`, `lock_media_backfill_cover_consent(text)`, `publish_media_backfill_cover(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_video_organizer(text,uuid)`, `lock_media_backfill_video_consent(text)`, `publish_media_backfill_video(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_banner_organizer(text,uuid)`, `lock_media_backfill_banner_consent(text)`, `publish_media_backfill_banner(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_social_author(text,uuid)`, `lock_media_backfill_social_consent(text)`, `publish_media_backfill_social(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_skill_owner(text,uuid)`, `lock_media_backfill_skill_consent(text)`, `publish_media_backfill_skill(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_highlight_uploader(text,uuid)`, `lock_media_backfill_highlight_consent(text)`, `publish_media_backfill_highlight(text,uuid,uuid,bigint,uuid)`, `lock_media_backfill_highlight_bytes(text,uuid)`, `lock_media_backfill_avatar_owner(text,uuid)`, `lock_media_backfill_avatar_consent(text)`, `operator_avatar_intent_admitted(uuid)`, `publish_media_backfill_avatar(text,uuid,uuid,bigint,uuid)`.

This is local synthetic seven-media database/object restore acceptance. Cloud/offsite backup durability, deployed role/configuration correspondence, real video playback and full broker/device external recovery-floor authority remain separate, untested deployment work.

## Operator ACL tool and order before application installation

Use `scripts/media-restore-acl.ts` from the reviewed source release. Its default plan does not read `FREEDOM_MEDIA_DATABASE_URL` or open a database. The plan lists the exact twenty-four signatures, source SQL ledger hashes and seventeen revocations; it does not report deployment readiness. There is no caller-provided SQL, migration path, function list or source-review override.

1. Keep application ingress, broker/device dispatch and migration consumers fenced. Choose the approved restore target and source release, verify the consistent database/object manifest, and preserve current external deletion/revocation/recovery-floor facts. These steps are not performed or authorized by this tool.
2. Restore the database as its dedicated migrator so the restored routines belong to that role. A dump restored with `--no-owner --no-privileges` contains no application grants and loses the PUBLIC function lockdown. Do not install or start the application at this point. Keep the runtime role dedicated, with no memberships, elevated role powers, schema CREATE or connected application clients. Canonical role/schema setup remains `deploy/cloudflare/sql/10-create-roles.psql`; do not rerun its role-creation statements blindly over existing roles.
3. Review the default plan with explicit target and runtime-role arguments. For example, the following names are **local synthetic placeholders**, not a live environment:

   ```sh
   npx tsx scripts/media-restore-acl.ts \
     --environment local --expected-database fp_restore_example \
     --schema fp_restore_example --expected-role postgres \
     --runtime-role fp_restore_example_app \
     --release-sha <reviewed-source-sha>
   ```

   Local mode requires `fp_*` database/schema/runtime names. For staging/public, the tool requires the database, migrator and application role mapping from the existing canonical Cloudflare environment manifest and schema `public`. The release SHA is operator-declared; this report does not verify the running cloud release. Connection secrets are never returned in a report.
4. Supply the matching migrator connection through the operator's private environment as `FREEDOM_MEDIA_DATABASE_URL`, then run the identical command with **`--execute-lockdown --contact-retention <off|all>`**, explicitly declaring the value configured for that environment. Missing or invalid retention values fail as `invalid_arguments`. Local connections must be loopback/Unix-socket; nonlocal connections require `sslmode=verify-full`. Managed routing usernames may use the documented `<role>.<branch-id>` transport form; the actual SQL `current_user` and `session_user` must still match the expected canonical migrator role.
5. Require success with `execution: public_execute_revoked` and `functionsRevoked: 24`. The operation checks the canonical reviewed migration scan and complete restored migration ledger, actual database/session role/schema, ownership and exact signatures of all twenty-four routines, dedicated runtime-role properties and absence of its connected clients. Unknown security-definer routines in the target schema are rejected, including an unknown routine already denied to PUBLIC. Target, ledger, shape, privilege or live-client mismatches refuse and roll back. It restores only the source-defined PUBLIC revocations in one transaction; it does not install application grants, create an operator approval, move objects, invalidate sessions or enable any feature.
6. Reapply **`deploy/cloudflare/sql/20-runtime-grants.psql`** for that environment as the migrator, then run the canonical **`30-verify-readonly.psql`** readbacks with the appropriate operator/runtime identities. Reapply separately required broker role mappings through their existing grant scripts; this ACL operation does not replace them. The application must remain unable to execute all twenty-four operator ports or write operator approvals, ciphertext, persistence consent or the migration ledger. A refusal is a stop condition, not a reason to remove a guard.
7. Complete current external tombstone/revocation/floor reconciliation, fence imported sessions and unresolved effects, verify the restored media references/bytes and original authorization behavior, then perform the separately approved application installation/start. The local drill's new synthetic recovery sessions demonstrate its member-session boundary only. Full remote broker/device recovery and cloud installation remain `not_run`.

The standard integration drill invokes both this reusable operation and its actual CLI execution against the owned synthetic database. It tests default-plan secret nonaccess, environment/URL/actual-database mismatch, ledger drift, unknown definer, a real connected application role, refusal rollback, and idempotent lockdown before applying canonical application grants. The original 120-second budget and two integration cases remain unchanged.

## Portable recovery handover

The handover drill starts its own producer and consumer containers, so it lives with the other owned-container drills under `tests/integration/` and is not part of `npm run test:media-restore`. The pure bundle and archive checks stay in `tests/runtime/`. Run the handover directly:

```sh
node --import tsx --test --test-concurrency=1 tests/integration/media-recovery-handover.test.ts
```

It needs Docker, the local pinned image `postgres:18-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd`, and a committed clean tree. The pinned hosted `verify` workflow does not run it yet. Adding it there belongs to the separate reviewed workflow (trust-pin) upgrade.

### Commerce 聯絡資料的還原前遮蔽（DC12，2026-10-23）

`media-restore-acl --execute-lockdown --contact-retention <off|all>` 要求操作者聲明該環境設定；缺少或無效值以 `invalid_arguments` 拒絕。`off` 只執行 ACL lockdown，exit 0 並回報 `contactRetention: {status: disabled, deploymentReady: false}`，不做任何遮蔽。`all` 在既有 ACL lockdown 成功後，跑一頁有界聯絡資料遮蔽（每頁最多 200 間店、每店最多 200 contacts 與 customers）。所有 runtime 連線須停止，quarantine 持續有效；這是既有還原隔離流程的前置工作，不能當成開放權限。

啟用模式從不帶 `--after-instance` 開始，每頁沿用同一個 `--contact-retention` 值。尚有續跑頁時 exit code 為 2；不得把它當作成功開放。回報 `contactRetention.status=repeat_page` 時重跑同一輸入游標；`next_page` 時加入回傳的 `after_instance`，直到 `scan_complete`。任何錯誤或中斷都保持隔離，可安全從第一頁重跑。保留本輪所有頁的操作證據；只跑任意後段頁不是全資料庫完成證據。工具的 `deploymentReady` 始終為 false，其他還原條件與 Ted 的正式開放核准仍須完成。

保存開關未設定或 `off` 時，部署不會啟動遮蔽；改回 `off` 不還原已遮蔽資料。contacts 與同單 shipment 參考在同交易清空，不能因備份還原再次向買賣雙方曝光。規則見 EC-SPEC-09 §3。

Ted 於 2026-10-23「不要再設什麼30天規則」，沒有訂單參照的 contact 保留；移除例外、付款、退款、provider 事件及庫存的延後條件。只有每張參照訂單都有履約／取消起點且全部滿 180 天，才遮蔽 contact；顧客須有已遮蔽的 checkout／order 顧客連結且沒有 live contact 連結。Email 修改後仍 live 的舊 contact 會永久保護該 checkout 的顧客。沒有起點的訂單保留資料，人工個資請求由店主處理，平台不建流程；備份保存 30 天（Ted 同日「好」）。「all, all」指定 staging／production 保存開關均為 `all`，由發布操作者設定；預設仍為 `off`，舊值 `orders` 是 `invalid_arguments`。這不改任何隔離、ACL 或重新開放條件。
