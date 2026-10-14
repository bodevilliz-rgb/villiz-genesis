# Genesis pre-cancellation receipt

Fill every item with timestamp, operator, exact candidate, command/evidence path and outcome. No secret values.

## Import and staging

- [ ] Dump SHA-256 values revalidated against `IMPORT-MANIFEST.json`.
- [ ] All source public-table counts equal Genesis Veebase counts.
- [ ] `auth.users` count and credential-hash aggregate match.
- [ ] Critical organisation/profile/content fingerprints match.
- [ ] Storage bucket metadata/policies match; object count and bytes accounted for.
- [ ] Every target public table has RLS; required RPCs/triggers are present.
- [ ] Full application verification and exact-candidate independent QA pass.

## Runtime and rollback readiness

- [ ] Dedicated Genesis backup schedule exists (not the main-stack cron).
- [ ] Restore drill passes with retained evidence.
- [ ] Cloud rollback environment values remain protected and usable.
- [ ] Rollback rehearsal passes.
- [ ] `[OWNER GO — PRODUCTION ENV FLIP]` recorded.

## Minimum 48-hour soak

- [ ] +1h parity/health probe passes.
- [ ] +6h parity/health probe passes.
- [ ] +24h parity/health/backup probe passes.
- [ ] +48h parity/health/backup probe passes.
- [ ] No unresolved auth, storage, RLS, worker, application or data-integrity errors.

## Final cloud reads before cancellation

- [ ] Cloud project restored only for the bounded final read window.
- [ ] Fresh auth/public/storage exports retained with checksums.
- [ ] Final cloud-to-Veebase counts and fingerprints match or every delta is reconciled.
- [ ] Cloud project returned to `INACTIVE` after the read window.
- [ ] `[OWNER GO — DOWNGRADE/PAUSE CLOUD PROJECT]` recorded and owner billing action completed (management API pause currently returns HTTP 400 until downgrade).
- [ ] Organisation-wide billing blast radius reviewed.
- [ ] `[OWNER GO — CANCEL PAID SUPABASE]` recorded for this exact receipt.
- [ ] Olabode performs the cancellation click last.
