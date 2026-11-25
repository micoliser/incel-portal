/**
 * The portal password is one of chat's two locks (with the PIN). These run
 * where the password is typed anyway: signing in, and changing it.
 */
import { apiClient } from "@/lib/api-client";
import { getAccount, updateBackups } from "@/lib/chat/api";
import { derivePasswordSecret, replacePasswordLayer } from "@/lib/chat/crypto";
import { forgetUnlockedKey, rememberPasswordSecret } from "@/lib/chat/keystore";

async function currentUserId(): Promise<number | null> {
  try {
    const { data } = await apiClient.get<{ id?: number }>("/me");
    return typeof data.id === "number" ? data.id : null;
  } catch {
    return null;
  }
}

/**
 * After a successful sign-in: chat starts locked (the PIN is asked for again),
 * and the password-derived secret is kept for this sign-in.
 */
export async function keepPasswordForChat(password: string) {
  await forgetUnlockedKey().catch(() => undefined);
  try {
    const userId = await currentUserId();
    if (userId === null) return;
    await rememberPasswordSecret(userId, await derivePasswordSecret(password, userId));
  } catch {
    // Chat will ask for the password when it is first opened.
  }
}

/**
 * After the password is changed in the portal: re-lock the outer layer of the
 * chat key with the new password, so the PIN keeps working.
 */
export async function movePasswordLayer(oldPassword: string, newPassword: string) {
  try {
    const userId = await currentUserId();
    if (userId === null) return;
    const [oldSecret, newSecret] = await Promise.all([
      derivePasswordSecret(oldPassword, userId),
      derivePasswordSecret(newPassword, userId),
    ]);
    const { account } = await getAccount();
    if (account) {
      await updateBackups({ pin: await replacePasswordLayer(account.pin, oldSecret, newSecret) });
    }
    await rememberPasswordSecret(userId, newSecret);
  } catch {
    // If the old layer no longer matched, the recovery code is needed once.
  }
}
