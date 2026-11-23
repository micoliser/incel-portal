/**
 * End-to-end encryption for chat (docs/CHAT_SPEC.md, section 3).
 *
 * Everything here runs in the browser with libsodium. The server only ever
 * receives public keys and encrypted values.
 */
import sodiumModule from "libsodium-wrappers-sumo";

type Sodium = typeof sodiumModule;

let sodiumPromise: Promise<Sodium> | null = null;

export function getSodium(): Promise<Sodium> {
  if (!sodiumPromise) {
    sodiumPromise = sodiumModule.ready.then(() => sodiumModule);
  }
  return sodiumPromise;
}

export const KDF_OPS = 3;
export const KDF_MEM = 64 * 1024 * 1024;
export const FILE_CHUNK = 64 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PIN_LENGTH = 6;
// The password layer is derived once per sign-in, so it can be cheaper.
const PASSWORD_KDF_OPS = 2;
const PASSWORD_KDF_MEM = 32 * 1024 * 1024;

export type KeyBackup = {
  box: string;
  nonce: string;
  salt: string;
  ops: number;
  mem: number;
};

/** Two layers: PIN-derived key inside (`inner_nonce`), password-derived secret outside (`nonce`). */
export type PinBackup = KeyBackup & { inner_nonce: string };

export type Identity = { publicKey: Uint8Array; privateKey: Uint8Array };

/** The outer layer did not open: the portal password differs from the one chat was locked with. */
export class PasswordLayerError extends Error {
  constructor() {
    super("Your portal password has changed since chat was locked with it.");
  }
}

/** The inner layer did not open: wrong PIN. */
export class WrongPinError extends Error {
  constructor() {
    super("That PIN is not right.");
  }
}

export function toB64(s: Sodium, bytes: Uint8Array): string {
  return s.to_base64(bytes, s.base64_variants.ORIGINAL);
}

export function fromB64(s: Sodium, text: string): Uint8Array {
  return s.from_base64(text, s.base64_variants.ORIGINAL);
}

export async function generateIdentity(): Promise<Identity> {
  const s = await getSodium();
  const pair = s.crypto_box_keypair();
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

async function deriveKey(secret: string, salt: Uint8Array, ops: number, mem: number) {
  const s = await getSodium();
  return s.crypto_pwhash(
    s.crypto_secretbox_KEYBYTES,
    secret,
    salt,
    ops,
    mem,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * The secret derived from the portal password that forms the PIN copy's outer
 * layer. Made in the browser; neither the password nor this leaves it.
 */
export async function derivePasswordSecret(password: string, userId: number): Promise<Uint8Array> {
  const s = await getSodium();
  const salt = s.crypto_generichash(s.crypto_pwhash_SALTBYTES, `incel-chat-password|${userId}`);
  return s.crypto_pwhash(
    s.crypto_secretbox_KEYBYTES,
    password,
    salt,
    PASSWORD_KDF_OPS,
    PASSWORD_KDF_MEM,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/** Lock the private key with the PIN (inner) and the password secret (outer). */
export async function lockWithPin(privateKey: Uint8Array, pin: string, passwordSecret: Uint8Array): Promise<PinBackup> {
  const s = await getSodium();
  const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
  const innerNonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const pinKey = await deriveKey(pin, salt, KDF_OPS, KDF_MEM);
  const inner = s.crypto_secretbox_easy(privateKey, innerNonce, pinKey);
  s.memzero(pinKey);
  const box = s.crypto_secretbox_easy(inner, nonce, passwordSecret);
  return {
    box: toB64(s, box),
    nonce: toB64(s, nonce),
    inner_nonce: toB64(s, innerNonce),
    salt: toB64(s, salt),
    ops: KDF_OPS,
    mem: KDF_MEM,
  };
}

export async function openWithPin(backup: PinBackup, pin: string, passwordSecret: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium();
  let inner: Uint8Array;
  try {
    inner = s.crypto_secretbox_open_easy(fromB64(s, backup.box), fromB64(s, backup.nonce), passwordSecret);
  } catch {
    throw new PasswordLayerError();
  }
  const pinKey = await deriveKey(pin, fromB64(s, backup.salt), backup.ops, backup.mem);
  try {
    return s.crypto_secretbox_open_easy(inner, fromB64(s, backup.inner_nonce), pinKey);
  } catch {
    throw new WrongPinError();
  } finally {
    s.memzero(pinKey);
  }
}

/** After a password change: swap the outer layer only (no PIN or private key needed). */
export async function replacePasswordLayer(
  backup: PinBackup,
  oldSecret: Uint8Array,
  newSecret: Uint8Array,
): Promise<PinBackup> {
  const s = await getSodium();
  let inner: Uint8Array;
  try {
    inner = s.crypto_secretbox_open_easy(fromB64(s, backup.box), fromB64(s, backup.nonce), oldSecret);
  } catch {
    throw new PasswordLayerError();
  }
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  return { ...backup, box: toB64(s, s.crypto_secretbox_easy(inner, nonce, newSecret)), nonce: toB64(s, nonce) };
}

/** Encrypt the private key with a key derived from the recovery code. */
export async function backUpPrivateKey(privateKey: Uint8Array, secret: string): Promise<KeyBackup> {
  const s = await getSodium();
  const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const key = await deriveKey(secret, salt, KDF_OPS, KDF_MEM);
  const box = s.crypto_secretbox_easy(privateKey, nonce, key);
  s.memzero(key);
  return { box: toB64(s, box), nonce: toB64(s, nonce), salt: toB64(s, salt), ops: KDF_OPS, mem: KDF_MEM };
}

/** Open the recovery copy. Throws if the code is wrong. */
export async function openPrivateKey(backup: KeyBackup, secret: string): Promise<Uint8Array> {
  const s = await getSodium();
  const key = await deriveKey(secret, fromB64(s, backup.salt), backup.ops, backup.mem);
  try {
    return s.crypto_secretbox_open_easy(fromB64(s, backup.box), fromB64(s, backup.nonce), key);
  } finally {
    s.memzero(key);
  }
}

export async function publicKeyMatches(privateKey: Uint8Array, publicKeyB64: string): Promise<boolean> {
  const s = await getSodium();
  return toB64(s, s.crypto_scalarmult_base(privateKey)) === publicKeyB64;
}

// Crockford-style alphabet: no I, L, O or U, so the code reads back cleanly.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 32 characters (160 bits) shown as 8 groups of 4. */
export async function makeRecoveryCode(): Promise<string> {
  const s = await getSodium();
  const bytes = s.randombytes_buf(32);
  let out = "";
  for (let i = 0; i < 32; i += 1) out += CODE_ALPHABET[bytes[i] % 32];
  return out.match(/.{4}/g)!.join("-");
}

export function normaliseRecoveryCode(code: string): string {
  const clean = code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

export async function newSymmetricKey(): Promise<Uint8Array> {
  const s = await getSodium();
  return s.crypto_aead_xchacha20poly1305_ietf_keygen();
}

/** Wrap a conversation key for one participant (crypto_box: sender's private key, recipient's public key). */
export async function wrapKey(key: Uint8Array, recipientPublicKey: string, myPrivateKey: Uint8Array) {
  const s = await getSodium();
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const wrapped = s.crypto_box_easy(key, nonce, fromB64(s, recipientPublicKey), myPrivateKey);
  return { wrapped_key: toB64(s, wrapped), nonce: toB64(s, nonce) };
}

export async function unwrapKey(
  wrappedKey: string,
  nonce: string,
  wrapperPublicKey: string,
  myPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const s = await getSodium();
  return s.crypto_box_open_easy(fromB64(s, wrappedKey), fromB64(s, nonce), fromB64(s, wrapperPublicKey), myPrivateKey);
}

/** Binds a ciphertext to its conversation, id, sender, key and edit revision. */
export function associatedData(conversationId: string, messageId: string, senderId: number, keyVersion: number, revision: number) {
  return `chat-v1|${conversationId}|${messageId}|${senderId}|${keyVersion}|${revision}`;
}

/** Binds an encrypted reaction to its conversation, message, the person reacting and the key. */
export function reactionAssociatedData(conversationId: string, messageId: string, userId: number, keyVersion: number) {
  return `chat-reaction-v1|${conversationId}|${messageId}|${userId}|${keyVersion}`;
}

export async function encryptJson(value: unknown, key: Uint8Array, ad: string) {
  const s = await getSodium();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    JSON.stringify(value),
    ad,
    null,
    nonce,
    key,
  );
  return { nonce: toB64(s, nonce), ciphertext: toB64(s, ciphertext) };
}

export async function decryptJson<T>(ciphertext: string, nonce: string, key: Uint8Array, ad: string): Promise<T> {
  const s = await getSodium();
  const plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(s, ciphertext), ad, fromB64(s, nonce), key);
  return JSON.parse(s.to_string(plain)) as T;
}

/** Encrypt a file in 64 KiB chunks. Returns the encrypted bytes and the key (base64). */
export async function encryptFile(data: ArrayBuffer): Promise<{ bytes: Uint8Array; key: string }> {
  const s = await getSodium();
  const key = s.crypto_secretstream_xchacha20poly1305_keygen();
  const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(key);
  const input = new Uint8Array(data);
  const parts: Uint8Array[] = [header];
  let total = header.length;
  for (let offset = 0; offset < input.length || offset === 0; offset += FILE_CHUNK) {
    const end = Math.min(offset + FILE_CHUNK, input.length);
    const last = end >= input.length;
    const tag = last
      ? s.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      : s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    const chunk = s.crypto_secretstream_xchacha20poly1305_push(state, input.subarray(offset, end), null, tag);
    parts.push(chunk);
    total += chunk.length;
    if (last) break;
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  return { bytes, key: toB64(s, key) };
}

export async function decryptFile(data: ArrayBuffer, keyB64: string): Promise<Uint8Array> {
  const s = await getSodium();
  const input = new Uint8Array(data);
  const headerBytes = s.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  const state = s.crypto_secretstream_xchacha20poly1305_init_pull(input.subarray(0, headerBytes), fromB64(s, keyB64));
  const chunkSize = FILE_CHUNK + s.crypto_secretstream_xchacha20poly1305_ABYTES;
  const parts: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  for (let offset = headerBytes; offset < input.length; offset += chunkSize) {
    const result = s.crypto_secretstream_xchacha20poly1305_pull(state, input.subarray(offset, offset + chunkSize));
    if (!result) throw new Error("The file could not be decrypted.");
    parts.push(result.message);
    total += result.message.length;
    if (result.tag === s.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error("The file is incomplete.");
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** Seal bytes with a 32-byte hex secret (used for the browser's copy of the unlocked key). */
export async function sealWithSecret(bytes: Uint8Array, secretHex: string) {
  const s = await getSodium();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const box = s.crypto_secretbox_easy(bytes, nonce, s.from_hex(secretHex));
  return { box: toB64(s, box), nonce: toB64(s, nonce) };
}

export async function openWithSecret(box: string, nonce: string, secretHex: string): Promise<Uint8Array> {
  const s = await getSodium();
  return s.crypto_secretbox_open_easy(fromB64(s, box), fromB64(s, nonce), s.from_hex(secretHex));
}
