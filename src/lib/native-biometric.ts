import { Capacitor } from "@capacitor/core";
import { t } from "./i18n";

/**
 * Fingerprint / face unlock inside the Android app (Capacitor 6 + @capgo/capacitor-native-biometric 6).
 * WebAuthn isn't available in the Capacitor WebView, so the APK uses the system BiometricPrompt instead.
 * On the web these return false and callers fall back to WebAuthn / passcode.
 */
type Plugin = typeof import("@capgo/capacitor-native-biometric")["NativeBiometric"];
let plugin: Promise<Plugin | null> | null = null;
const load = () => (plugin ??= Capacitor.isNativePlatform() ? import("@capgo/capacitor-native-biometric").then((m) => m.NativeBiometric).catch(() => null) : Promise.resolve(null));

/** True on a native build whose device has enrolled biometrics (or a device credential as fallback). */
export async function isNativeBiometricAvailable(): Promise<boolean> {
  const p = await load();
  if (!p) return false;
  try { return (await p.isAvailable({ useFallback: true })).isAvailable; } catch { return false; }
}

/** Show the system biometric prompt. Resolves true when the user is verified, false when cancelled or failed. */
export async function nativeBiometricVerify(reason = t("Unlock Lumen")): Promise<boolean> {
  const p = await load();
  if (!p) return false;
  try {
    await p.verifyIdentity({ reason, title: t("Unlock Lumen"), subtitle: reason, negativeButtonText: t("Use passcode"), useFallback: true, maxAttempts: 3 });
    return true;
  } catch { return false; }
}
