/**
 * Keeps chat secrets in this browser for the length of a sign-in, each sealed
 * with a secret the server holds (docs/CHAT_SPEC.md, 3.2):
 *
 * - "key": the unlocked private key, so chat stays unlocked across page loads;
 * - "password": the secret derived from the portal password at sign-in, which
 *   with the PIN opens the stored key.
 *
 * A copy on disk is useless without the server's secret, and both are deleted
 * on sign-out, so a shared computer keeps nothing usable.
 */
import { apiClient } from "@/lib/api-client";
import { openWithSecret, sealWithSecret } from "@/lib/chat/crypto";

const DB_NAME = "incel-chat";
const STORE = "keys";

type Slot = "key" | "password";
const RECORD: Record<Slot, string> = { key: "current", password: "password" };

type StoredSecret = {
  userId: number;
  secretId: string;
  box: string;
  nonce: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function readRecord(slot: Slot): Promise<StoredSecret | null> {
  try {
    return ((await withStore("readonly", (store) => store.get(RECORD[slot]))) as StoredSecret | undefined) ?? null;
  } catch {
    return null;
  }
}

async function clearRecord(slot: Slot) {
  try {
    await withStore("readwrite", (store) => store.delete(RECORD[slot]));
  } catch {
    // Storage unavailable (private window): nothing was kept.
  }
}

async function remember(slot: Slot, userId: number, bytes: Uint8Array) {
  try {
    const { data } = await apiClient.post<{ id: string; secret: string }>("/chat/session-secrets");
    const sealed = await sealWithSecret(bytes, data.secret);
    const previous = await readRecord(slot);
    const record: StoredSecret = { userId, secretId: data.id, ...sealed };
    await withStore("readwrite", (store) => store.put(record, RECORD[slot]));
    if (previous) void dropServerSecret(previous.secretId);
  } catch {
    // Not fatal: the user is asked again on the next page load.
  }
}

async function recall(slot: Slot, userId: number): Promise<Uint8Array | null> {
  const record = await readRecord(slot);
  if (!record) return null;
  if (record.userId !== userId) {
    await forget(slot);
    return null;
  }
  try {
    const { data } = await apiClient.get<{ secret: string }>(
      `/chat/session-secrets/${encodeURIComponent(record.secretId)}`,
    );
    return await openWithSecret(record.box, record.nonce, data.secret);
  } catch {
    await clearRecord(slot);
    return null;
  }
}

async function dropServerSecret(secretId: string) {
  try {
    await apiClient.delete(`/chat/session-secrets/${encodeURIComponent(secretId)}`);
  } catch {
    // Already signed out or expired: the secret dies with the session anyway.
  }
}

async function forget(slot: Slot) {
  const record = await readRecord(slot);
  await clearRecord(slot);
  if (record) await dropServerSecret(record.secretId);
}

/** Remember the unlocked key for this sign-in. */
export const rememberKey = (userId: number, privateKey: Uint8Array) => remember("key", userId, privateKey);

/** The remembered key for this user, or null (another user's copy is wiped). */
export const recallKey = (userId: number) => recall("key", userId);

/** Remember the password-derived secret for this sign-in. */
export const rememberPasswordSecret = (userId: number, secret: Uint8Array) => remember("password", userId, secret);

export const recallPasswordSecret = (userId: number) => recall("password", userId);

/** Forget only the password secret (too many wrong PINs). */
export const forgetPasswordSecret = () => forget("password");

/** Forget everything chat keeps in this browser. Call before signing out. */
export async function forgetKey() {
  await Promise.all([forget("key"), forget("password")]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("portal-chat-lock"));
  }
}
