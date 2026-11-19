# Passcodes & access guide

Lumen is single-owner. There are no accounts: one **passcode** unlocks sync on each device. The real values are in the git-ignored `SETUP.md`; never commit them.

## Which passcode where
| You're using | Passcode | Set by |
|---|---|---|
| Live site + Android app | the owner passphrase | Cloudflare secret `APP_PASSCODE` (`npx wrangler secret put APP_PASSCODE`) |
| Local dev (`npm run dev`) | the dev passphrase | `.dev.vars` → `APP_PASSCODE=…` |
| Demo / dev mode (`?demo=1`) | none: "Continue offline" | demo data never syncs |

## How it works
- Unlocking sends the passcode once over HTTPS to `/api/unlock`; the device keeps a **token** (an HMAC of the passcode), never the passcode itself.
- Wrong passcodes: 5 tries, then a lockout that doubles (1 min → 24 h max), tracked per network in D1 (`unlock_attempts`).
- Changing `APP_PASSCODE` invalidates every device's token, so all devices sign out.
- **App lock / fingerprint** (optional): WebAuthn on this device only. It gates opening the app; the passcode is the fallback.
- **API tokens** (Settings → Developer): named tokens for scripts/agents; only a hash is stored; revocable; last-used time recorded.
- **Share links** need no passcode: anyone with the link can view (read-only) until you turn the link off.

## Recover
- Forgot the passcode → set a new one with `wrangler secret put APP_PASSCODE`. No notes are lost.
- Locked out → wait, or clear `unlock_attempts` in D1 (`npx wrangler d1 execute lumen-notes --remote --command "DELETE FROM unlock_attempts"`).
