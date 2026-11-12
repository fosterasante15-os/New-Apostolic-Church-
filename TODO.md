# Account-creation authentication fix

- [x] Main Admin account creation accepts the configured Supabase secret key or legacy service-role key on the server without exposing it to browser code. An authenticated Main Admin remains required; inactive profiles are rejected.
- [x] Missing or expired user sessions refresh safely or request sign-in. Invalid server configuration is not mistaken for an expired user token.
- [x] Save the Supabase Auth account and its matching profile before displaying the new-user success popup. Prevent repeated submissions while saving. Default new accounts to Admin; Member and inactive accounts do not receive a misleading sign-in confirmation.
- [x] Twenty-four regression tests passed for authentication, authorization, key-header compatibility, profile persistence, rollback, token refresh, separate Auth Admin credentials, unchanged Save user wording, display_name metadata, and migration safety checks. These are mocked/static tests; no production test users were created or live migrations applied.
- [ ] Verify the deployed version and perform an authenticated account-creation test using the Main Admin's session. The agent has no Main Admin credentials, so only unauthenticated live protection checks can be performed here.
- [x] Auth Admin requests now reach the database after the user's credential change. Supplied Auth log at 2026-11-12 23:02:47 reports SQLSTATE 42703: column display_name of relation profiles does not exist. Credentials must remain private.
- [ ] Apply fix-profile-display-name.sql in the live Supabase project, then verify a Main Admin can create an account. The migration adds only the missing nullable text column; no existing records or policies are changed. Preparing or pushing SQL does not apply it to Supabase.
- [x] Keep the Save user button text unchanged during submission and remove Saving to Supabase wording. Keep duplicate-click protection and show the new-user notification only after success.

## Implementation reference

Official Supabase documentation states that `sb_secret_...` keys are not JWTs and must travel in the `apikey` header, not `Authorization: Bearer`. Legacy service-role JWTs retain bearer compatibility. User access tokens remain bearer tokens.

Sources:
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://github.com/orgs/supabase/discussions/29260 — hosted backwards-compatibility exception permits Authorization when it exactly matches apikey.
- https://github.com/supabase/auth/issues/2204 — Auth Admin-route JWT/header compatibility reports; does not prove the deployment's configured key is valid.

Run the regression suite with `node --test tests/admin-create-user.test.cjs`.
