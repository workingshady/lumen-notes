// Welcome / unlock hooks for accounts. Off (now, 27A/27C): the passcode screen as before, plus one quiet
// "Accounts are coming" line. On (27E/27O): the sign-in screen first, "Use a passcode instead" opens the unchanged
// passcode screen.
import { useState, type ReactNode } from "react";
import { peekAuthReturn, useAccountsConfig } from "../../lib/auth";
import { AccountsComingLine } from "./auth-ui";
import { AuthFlow } from "./SignIn";

/** Wraps the passcode screen. `children` is rendered unchanged unless accounts are on. */
export function AuthWelcome({ children }: { children: ReactNode }) {
  const cfg = useAccountsConfig();
  const [passcode, setPasscode] = useState(false);
  if (!cfg.enabled || (passcode && !peekAuthReturn())) return <>{children}</>;
  return <AuthFlow onPasscode={() => setPasscode(true)} />;
}

/** Under the passcode flow: only while accounts are off (no buttons that do nothing). */
export function AccountsComing({ className }: { className?: string }) {
  const cfg = useAccountsConfig();
  return cfg.enabled ? null : <AccountsComingLine className={className} />;
}
