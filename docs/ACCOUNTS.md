# User accounts (built, not enabled)

Lumen is single-owner today: one **passcode** unlocks sync (see `docs/PASSCODES.md`). This document describes real
user accounts — profile, Continue with Google, email + password, magic link, registration with email verification,
sessions — which are **built behind a switch that is OFF**. While it is off, nothing changes for the owner: the
passcode flow, `items`, tokens and devices behave exactly as before.

Design: `docs/design/CLAUDE_DESIGN_UPDATE_05.md` §5.

## Files
| Area | File |
|---|---|
| Switch, routes, session gate, per-user sync | `worker/ext/auth.ts` (registered in `worker/index.ts`: `authGate()` before the passcode account router, `registerAuth()` with the other areas) |
| Crypto + protocol pieces (pure, unit-tested) | `worker/ext/auth-core.ts` |
| Email sending (`Mailer` interface, Resend, dev log) | `worker/ext/auth-mail.ts` |
| Schema | `migrations/0010_users.sql` |
| Client API, config hook, email/Google returns, strength meter | `src/lib/auth.ts` |
| UI | `src/components/auth/` — `SignIn.tsx` (sign in / register / inbox / forgot / reset / link + Google returns), `Profile.tsx`, `AccountSection.tsx` (Settings › Account), `WelcomeAccounts.tsx` (unlock-screen hooks), `auth-ui.tsx` (Google button, password meter, "coming soon" card) |
| Tests | `scripts/auth.test.ts` (`npx tsx scripts/auth.test.ts`) |

## The switch
`accountsEnabled()` in `worker/ext/auth.ts`:
1. Worker var/secret `ACCOUNTS_ENABLED` — if set, it decides: `1`/`true`/`on` = on, anything else (e.g. `0`) = **off, even if D1 says on** (kill switch).
2. Otherwise the D1 `meta` row `accounts_enabled` = `'1'` (cached 30 s per isolate).
3. Otherwise **off** (default).

| | Off (now) | On |
|---|---|---|
| `GET /api/accounts/config` | `{enabled:false, providers:{google:false,email:false,magic:false}}` | `{enabled:true, providers:{google: secrets set, email:true, magic: mailer available}}` |
| `/api/auth/*` | **404** | routes below |
| Request with `Bearer lms_…` | passes untouched → owner `auth` rejects it (401) | gate: `/api/sync` → the user's `user_items`; `/api/access/seen` → session heartbeat; public GETs pass; every other route **403** |
| Unlock screen | passcode flow + quiet "Accounts are coming: sign in with Google, email" line | sign-in screen first, "Use a passcode instead" opens the unchanged passcode screen |
| Settings › Account | local profile (avatar glyph/photo, name, language) + muted "Sign-in and registration · coming soon" card | signed in: profile page; signed out: local profile + "Sign in or create an account" |

Preview of the active screens without a server: `?demo=1&accounts=preview` (demo mode only; canned data, nothing is sent). `?accounts=off` ends it.

## Tables (`migrations/0010_users.sql`)
| Table | Purpose |
|---|---|
| `users` | id, email (unique, lower-case), email_verified, name, avatar (`glyph:…` or small data-URL photo ≤ 300 KB), lang, tz, password_hash (NULL for Google/magic-only), password_changed_at, created/updated |
| `identities` | (provider, subject) → user_id; Google `sub` |
| `sessions` | id = SHA-256 of the bearer token, user_id, device, platform, method, created_at, last_seen, expires_at |
| `email_tokens` | SHA-256 of one-time tokens: `verify` 24 h, `magic` 15 min, `reset` 30 min, `handoff` 2 min (Google return); `used_at` makes them single use |
| `oauth_states` | SHA-256(state) → PKCE verifier, nonce, return path, link_user; 10 min, deleted when read |
| `auth_attempts` | rate limit / lockout rows, keyed by HMACs (never raw IPs or emails) |
| `audit` | sign-in, failures, register, verification, password changes, linking, export, deletion; `client` = truncated HMAC of the IP |
| `user_items` | the per-user synced store: `items` + `uid`, PK (uid, kind, id); cursor `meta.urev` |

The migration only adds tables (and the `urev` meta row). It changes nothing while the switch is off and is safe to apply to both D1 databases.

## Flows
- **Register** `POST /api/auth/register {email, password, name, terms:true, lang, tz}` → user (unverified) + verify email → "Check your inbox". Same answer for known emails (no enumeration; an unverified one gets the link again).
- **Verify** link `/?auth=verify&token=…` → app posts `POST /api/auth/verify/confirm` → email verified + signed in. Resend: `POST /api/auth/verify/resend`.
- **Login** `POST /api/auth/login {email, password}` → `{token, user}`; unverified → 403 `{needsVerification}`.
- **Magic link** `POST /api/auth/magic {email}` → link `/?auth=magic&token=…` → `POST /api/auth/magic/confirm` (also proves the email).
- **Forgot / reset** `POST /api/auth/forgot` → link `/?auth=reset&token=…` → `POST /api/auth/reset {token, password}` (all other sessions signed out).
- **Google** `POST /api/auth/google/start {return, link?}` → `{url}` + HttpOnly `__Host-lumen_oauth` state cookie → Google consent → `GET /api/auth/google/callback` → checks state (cookie + server row, single use, 10 min), exchanges the code with the PKCE verifier, verifies the ID token → redirects to `/?auth=google&code=<2-min hand-off>` → `POST /api/auth/exchange` → session. Errors come back as `/?auth=google-error&reason=cancelled|state-*|exchange|token|email-unverified|already-linked|not-configured`. With `link:true` (profile "Connect Google", session required) the identity is added and the app gets `?auth=google-linked`.
- **Signed in**: `GET/PUT /api/auth/me`, `POST /api/auth/password {current, next}` (other sessions signed out), `DELETE /api/auth/identities/google` (only if a password exists), `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/signout`, `POST /api/auth/signout-all`, `GET /api/auth/export` (JSON file), `POST /api/auth/delete {confirm: email}`.
- The client strips `auth`, `token`, `code`, `reason` from the address bar as soon as the page loads (`src/lib/auth.ts`).

## Security notes
- **Passwords**: PBKDF2-SHA256, 16-byte random salt per hash, **100 000 iterations** — the maximum Cloudflare Workers' WebCrypto allows for PBKDF2 (OWASP suggests 600k for SHA-256; the stored format carries the count, and `verifyPassword` reports `rehash`, so it can be raised if Workers lifts the cap or a different KDF is added). Unknown emails still run a full PBKDF2 (no timing signal). Min 10 chars, max 256, NFC-normalised. Constant-time compares everywhere.
- **Rate limiting** (same policy as `/api/unlock`): 5 misses → lockout 1 min, doubling to 24 h, a quiet day forgets. Login counts per network *and* per email; email-sending routes (register, magic, forgot, resend) per network and per email; password change per user. 429 + `Retry-After`.
- **Tokens**: 256-bit random; only SHA-256 stored; one-time tokens are single use even under races (`UPDATE … WHERE used_at IS NULL`) and are void if the user's email changed. Session tokens are never put in URLs (Google uses a 2-minute hand-off code).
- **Sessions**: bearer tokens `lms_…` (consistent with the current app and the Android build, which call the API cross-origin), 30-day sliding expiry, 180-day absolute; stored in `lumen.token` like the owner token; each user gets its own local Dexie DB (`lumen-u-<id>`).
- **Google**: Authorization Code + PKCE S256 + state (HttpOnly Secure SameSite=Lax cookie bound to the browser + server row) + nonce. ID token: RS256 only, signature against Google's JWKS (cached per `Cache-Control`, refetched at most once a minute for an unknown `kid`), `iss` ∈ accounts.google.com, `aud` = client id (`azp` checked with several audiences), `exp`/`iat` with 5 min skew, nonce. Linking by email needs `email_verified`. **Pre-registration hijack defence**: if an unverified password account exists for that email, its password and sessions are dropped when Google proves the mailbox. `return` paths are same-site only (no open redirect).
- **Isolation**: a session can only reach its own `user_items`, its own profile/sessions, and public reads; owner routes answer 403 (not 401, so the client doesn't drop the token). The owner's `items` are never read or written for a session. Auth routes always use the main DB (captured before the passcode account router can swap it), or `USERS_DB` if bound.
- **Email**: no provider configured → on localhost the message is printed as `[auth] would send …` (dev only); anywhere else the routes answer 503 "Email isn't set up" and nothing is logged. Provider errors never log addresses.
- **Secrets** are read from env only: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, optional `AUTH_SECRET` (HMAC key for rate-limit/audit keys; derived from `APP_PASSCODE` when unset). Nothing is set by this change.

## Per-user data plan
- **Now (built)**: signed-in users sync through the same `POST /api/sync` (same request/response shape) and the gate scopes it to `user_items WHERE uid = <user>`. The owner keeps `items` and the passcode: no data migration is needed and no existing row changes owner.
- **Enabling** is therefore a config change + migration step (below). Users start with an empty notebook; the owner is unaffected.
- **Not yet scoped for users** (they answer 403 for sessions): attachments (`/api/att` PUT), notes/canvas/whiteboard REST, AI, transcribe, API tokens, devices list, share links, blog publishing. Each needs a `uid` column or prefix before it is opened to users (`file_meta`/`file_parts` → `uid`; share/blog queries → `user_items`). The owner's blog stays the only public blog.
- **Optional later**: let the owner sign in with an account too — e.g. a `users.role = 'owner'` row whose session the owner `auth` middleware accepts — so the passcode can eventually be retired. Not built on purpose (it would widen the owner's attack surface).

## How to turn it on (later — don't do it before launch)
1. Apply the migration (both DBs get the tables; harmless):
   `npx wrangler d1 migrations apply lumen-notes --remote` (and `lumen-roadmap` if wanted).
2. Email: create a Resend API key and a verified sender, then
   `npx wrangler secret put RESEND_API_KEY` and add `"MAIL_FROM": "Lumen <hello@your-domain>"` to `vars` in `wrangler.jsonc`.
3. Google (optional): Google Cloud Console → OAuth client (Web application), authorised redirect URI `https://<your host>/api/auth/google/callback` (and `http://localhost:5330/api/auth/google/callback` for dev), then
   `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
   Set `APP_ORIGIN` (var) if the public origin differs from the request origin.
4. Optional: `npx wrangler secret put AUTH_SECRET` (random 32+ bytes) so rate-limit keys don't depend on the passcode.
5. Flip the switch — either `"ACCOUNTS_ENABLED": "1"` in `vars` (deploy), or without a deploy:
   `npx wrangler d1 execute lumen-notes --remote --command "INSERT OR REPLACE INTO meta (k, v) VALUES ('accounts_enabled', '1')"`.
   Off again: set the var to `0` (overrides D1) or delete the meta row.
6. Add real `/terms` and `/privacy` pages (the register form links to them).

Local dev with the switch on (never production): add `ACCOUNTS_ENABLED=1` to your local vars, or insert the meta row with `--local`; emails print as "would send" in the dev server console.

## Limits / to do before launch
- Android (Capacitor): Google sign-in needs a custom-tab / deep-link return (the redirect goes to the web origin); email links open the website. Password and magic-link sign-in work.
- An email or Google return that lands on a device already holding the owner token is not handled (the welcome screen isn't shown there); sign out first.
- No CAPTCHA/Turnstile on registration; rate limits only. No account email change flow yet. No 2FA/passkeys for accounts (the device app lock still works).
- PBKDF2 is capped at 100k iterations on Workers (see above).
- Per-user attachments, sharing, blog and AI are not scoped yet (403 for sessions).
- Language/time zone are stored on the profile; applying them to the UI on sign-in is left to the i18n layer (`setLang`).
