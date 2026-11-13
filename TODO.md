# Account-creation authentication fix

- [x] Main Admin account creation accepts the configured Supabase secret key or legacy service-role key on the server without exposing it to browser code. An authenticated Main Admin remains required; inactive profiles are rejected.
- [x] Missing or expired user sessions refresh safely or request sign-in. Invalid server configuration is not mistaken for an expired user token.
- [x] Save the Supabase Auth account and its matching profile before displaying the new-user success popup. Prevent repeated submissions while saving. Default new accounts to Admin; Member and inactive accounts do not receive a misleading sign-in confirmation.
- [x] Twenty-four regression tests passed for authentication, authorization, key-header compatibility, profile persistence, rollback, token refresh, separate Auth Admin credentials, unchanged Save user wording, display_name metadata, and migration safety checks. These are mocked/static tests; no production test users were created or live migrations applied.
- [ ] Verify the deployed version and perform an authenticated account-creation test using the Main Admin's session. The agent has no Main Admin credentials, so only unauthenticated live protection checks can be performed here.
- [x] Auth Admin requests now reach the database after the user's credential change. Supplied Auth log at 2026-11-12 23:02:47 reports SQLSTATE 42703: column display_name of relation profiles does not exist. Credentials must remain private.
- [x] User applied the display_name repair and confirmed account creation works on 2026-11-12. The migration adds only the missing nullable text column; no existing records or policies are changed. Preparing or pushing SQL alone does not apply it to Supabase.
- [x] Keep the Save user button text unchanged during submission and remove Saving to Supabase wording. Keep duplicate-click protection and show the new-user notification only after success.
- [x] User confirmed account creation is working after the display_name repair on 2026-11-12.
- [x] Stop automatic page reloads on startup, save, reconnect, and tab/phone visibility changes. Refresh synchronized screens in place; preserve the current page, filters, scroll position, and open forms. Store renderers reread synchronized data; focused inputs/dialogs/new-edit routes/settings and inline offering drafts defer UI refresh; attendance overlays unsaved marks on cloud data.
- [x] Break stale-session login/dashboard redirect loops. Restore valid persisted Supabase sessions on reopened tabs, verify active profile roles, and preserve the requested dashboard route after sign-in without trusting invalid cached roles. Cloud profiles are authoritative; disallowed caches are removed instead of re-forwarded; explicit logout never resumes automatically.
- [x] All 49 dependency-free regression tests and JavaScript syntax checks passed. The suite includes 24 account tests and 25 session/sync tests with mocked Auth/database/DOM; no production test records were created. Independent review found and corrected attendance-draft, service-picker, and inline-editor issues.
- [ ] Confirm the live deployment serves refresh1 scripts and have the user verify behavior on their actual phone/computer. Physical-device authenticated testing is not available to the agent.
- [x] Repair existing-account profile lookup without restoring unsafe metadata-based Admin defaults. Use a verified caller's server-side profile lookup by its own Auth ID; preserve existing roles/statuses and bootstrap only the already designated, confirmed Foster owner when its profile is absent. Do not copy permissions from email-matched profiles or request/user metadata. A profile tied to another Auth ID is a conflict, not an automatic relink; concurrent blocked profiles are never overwritten.
- [x] All 61 dependency-free mocked/static regression tests passed, including protected profile lookup, owner-only recovery, confirmed-email requirements, identity conflicts, blocked-state preservation, and browser fallback identity matching. No live profiles were created during testing; recovery occurs only on the user's verified sign-in request.

## Implementation reference

Official Supabase documentation states that `sb_secret_...` keys are not JWTs and must travel in the `apikey` header, not `Authorization: Bearer`. Legacy service-role JWTs retain bearer compatibility. User access tokens remain bearer tokens.

Sources:
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://github.com/orgs/supabase/discussions/29260 — hosted backwards-compatibility exception permits Authorization when it exactly matches apikey.
- https://github.com/supabase/auth/issues/2204 — Auth Admin-route JWT/header compatibility reports; does not prove the deployment's configured key is valid.

Run all regression tests with `node --test tests/*.test.cjs`.
