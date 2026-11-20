"use client";

/**
 * One chat state for the whole portal: the unlocked key, conversations,
 * decrypted messages and the WebSocket. The full page and the drawer both
 * read from here. Decrypted content lives in memory only.
 */
import axios from "axios";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as api from "@/lib/chat/api";
import type { ChatAccount, Participant, RawConversation, RawKey, RawMessage } from "@/lib/chat/api";
import {
  associatedData,
  backUpPrivateKey,
  derivePasswordSecret,
  lockWithPin,
  openWithPin,
  PasswordLayerError,
  decryptJson,
  encryptJson,
  generateIdentity,
  getSodium,
  makeRecoveryCode,
  newSymmetricKey,
  normaliseRecoveryCode,
  openPrivateKey,
  publicKeyMatches,
  toB64,
  unwrapKey,
  wrapKey,
} from "@/lib/chat/crypto";
import {
  forgetKey,
  forgetPasswordSecret,
  recallKey,
  recallPasswordSecret,
  rememberKey,
  rememberPasswordSecret,
} from "@/lib/chat/keystore";
import { releaseDecryptedFiles, uploadEncrypted, type UploadedAttachment } from "@/lib/chat/media";
import { ChatSocket, type ChatEvent } from "@/lib/chat/socket";

export type ChatStatus = "loading" | "not_set_up" | "locked" | "ready" | "error";

/** `localUrl`: the sender's own copy of a photo or video, shown while it uploads and after. Never sent. */
export type ChatAttachment = UploadedAttachment & { has_thumb: boolean; localUrl?: string };

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: number | null;
  seq: number;
  kind: RawMessage["kind"];
  keyVersion: number | null;
  revision: number;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  text: string;
  replyTo: string | null;
  attachments: ChatAttachment[];
  state: "sent" | "sending" | "failed" | "unreadable";
  systemEvent: string | null;
  systemData: Record<string, unknown>;
};

export type ChatConversation = RawConversation & {
  other: Participant | null;
  preview: string;
};

type Thread = { messages: ChatMessage[]; hasMore: boolean; loading: boolean; loaded: boolean };

type Payload = {
  v: 1;
  text: string;
  reply_to: string | null;
  attachments: UploadedAttachment[];
};

type SendInput = { text: string; files: File[]; replyTo: string | null };

type ChatContextValue = {
  userId: number;
  status: ChatStatus;
  account: ChatAccount | null;
  connected: boolean;
  conversations: ChatConversation[];
  threads: Record<string, Thread>;
  typing: Record<string, number>;
  unreadTotal: number;
  drawer: { open: boolean; conversationId: string | null };
  openDrawer: (conversationId?: string | null) => void;
  closeDrawer: () => void;
  /** True when this sign-in has no password secret: chat asks for the portal password with the PIN. */
  needsPassword: boolean;
  setUp: (pin: string, password?: string) => Promise<string>;
  unlock: (pin: string, password?: string) => Promise<void>;
  /** Checks a recovery code straight away (before a new PIN is chosen). */
  checkRecoveryCode: (code: string) => Promise<boolean>;
  recover: (code: string, newPin: string, password?: string) => Promise<string>;
  changePin: (newPin: string, password?: string) => Promise<void>;
  /** `resetCode`: the code emailed to confirm the reset. */
  startOver: (newPin: string, resetCode: string, password?: string) => Promise<string>;
  lock: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  openWith: (person: api.ChatPerson) => Promise<string>;
  /** Invite someone without chat (again: a reminder). Returns the waiting conversation's id. */
  invite: (personId: number) => Promise<string>;
  loadThread: (conversationId: string, older?: boolean) => Promise<void>;
  send: (conversationId: string, input: SendInput) => Promise<void>;
  retry: (conversationId: string, messageId: string) => Promise<void>;
  edit: (message: ChatMessage, text: string) => Promise<void>;
  deleteForEveryone: (message: ChatMessage) => Promise<void>;
  deleteForMe: (message: ChatMessage) => Promise<void>;
  markSeen: (conversationId: string, newestSeq: number) => void;
  setViewing: (conversationId: string, viewing: boolean) => void;
  sendTyping: (conversationId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const MAX_WRONG_PINS = 5;

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside ChatProvider");
  return value;
}

/** Same as useChat, but returns null outside the provider (the sidebar badge before sign-in). */
export function useOptionalChat() {
  return useContext(ChatContext);
}

function errorType(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const type = (error.response?.data as { error?: { type?: string } } | undefined)?.error?.type;
    return type ?? null;
  }
  return null;
}

function newId() {
  return crypto.randomUUID();
}

/** The words for a system note, from the reader's point of view. */
export function systemText(message: ChatMessage, userId: number): string {
  const data = message.systemData;
  switch (message.systemEvent) {
    case "invite_sent":
      return Number(data.inviter_id) === userId
        ? "Invitation sent"
        : `${String(data.inviter_name ?? "Someone")} invited you to chat`;
    case "invite_accepted":
      return Number(data.user_id) === userId
        ? "You accepted the chat invitation"
        : `${String(data.name ?? "They")} accepted the chat invitation`;
    case "key_reset":
      return Number(data.user_id) === userId
        ? "You reset your chat. Messages before this are not available to you."
        : `${String(data.name ?? "Someone")} reset their chat. Messages before this are not available to them.`;
    default:
      return "Chat updated";
  }
}

function previewOf(message: ChatMessage | null, userId: number): string {
  if (!message) return "No messages yet";
  if (message.deleted) return "This message was deleted";
  // The list row cuts long notes off with "…".
  if (message.kind === "system") return systemText(message, userId);
  if (message.state === "unreadable") return "This message is not available";
  if (message.text) return message.text;
  if (message.attachments.length) {
    const first = message.attachments[0];
    if (first.mime.startsWith("image/")) return "Photo";
    if (first.mime.startsWith("video/")) return "Video";
    return first.name;
  }
  return "Message";
}

export function ChatProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const [status, setStatus] = useState<ChatStatus>("loading");
  const [account, setAccount] = useState<ChatAccount | null>(null);
  const [connected, setConnected] = useState(false);
  const [rawConversations, setRawConversations] = useState<RawConversation[]>([]);
  const [previews, setPreviews] = useState<Record<string, ChatMessage | null>>({});
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [serverUnread, setServerUnread] = useState(0);
  const [drawer, setDrawer] = useState<{ open: boolean; conversationId: string | null }>({
    open: false,
    conversationId: null,
  });

  const privateKeyRef = useRef<Uint8Array | null>(null);
  const accountRef = useRef<ChatAccount | null>(null);
  const keysRef = useRef(new Map<string, Map<number, Uint8Array>>());
  const keyLoads = useRef(new Map<string, Promise<Map<number, Uint8Array>>>());
  const socketRef = useRef<ChatSocket | null>(null);
  const viewingRef = useRef(new Map<string, number>());
  const pendingSends = useRef(
    new Map<string, SendInput & { uploaded?: UploadedAttachment[]; localUrls: (string | undefined)[] }>(),
  );
  const threadsRef = useRef(threads);
  const conversationsRef = useRef(rawConversations);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  useEffect(() => {
    conversationsRef.current = rawConversations;
  }, [rawConversations]);

  // --- Keys ---------------------------------------------------------------

  const unwrapRows = useCallback(async (rows: RawKey[]) => {
    const map = new Map<number, Uint8Array>();
    const me = accountRef.current;
    const privateKey = privateKeyRef.current;
    if (!me || !privateKey) return map;
    for (const row of rows) {
      if (row.recipient_key_id !== me.key_id) continue; // made for an earlier key of mine
      try {
        map.set(row.version, await unwrapKey(row.wrapped_key, row.nonce, row.wrapper_public_key, privateKey));
      } catch {
        // Not openable: leave the version out; its messages show as unavailable.
      }
    }
    return map;
  }, []);

  const conversationKeys = useCallback(
    (conversationId: string, refresh = false) => {
      if (!refresh) {
        const known = keysRef.current.get(conversationId);
        if (known) return Promise.resolve(known);
        const loading = keyLoads.current.get(conversationId);
        if (loading) return loading;
      }
      const load = api
        .getKeys(conversationId)
        .then(unwrapRows)
        .then((map) => {
          keysRef.current.set(conversationId, map);
          return map;
        })
        .finally(() => keyLoads.current.delete(conversationId));
      keyLoads.current.set(conversationId, load);
      return load;
    },
    [unwrapRows],
  );

  const wrapForMembers = useCallback(async (key: Uint8Array, members: Participant[]) => {
    const privateKey = privateKeyRef.current!;
    return Promise.all(
      members.map(async (member) => ({
        recipient_id: member.id,
        recipient_key_id: member.key_id!,
        ...(await wrapKey(key, member.public_key!, privateKey)),
      })),
    );
  }, []);

  /** Make a new key version for everyone currently in the conversation. */
  const rotateKey = useCallback(
    async (conversationId: string): Promise<{ version: number; key: Uint8Array }> => {
      const fresh = await api.getConversation(conversationId);
      setRawConversations((list) => list.map((c) => (c.id === fresh.id ? fresh : c)));
      const members = fresh.participants.filter((p) => !p.left);
      if (members.some((m) => !m.public_key || !m.key_id)) {
        throw new Error("Someone in this chat has not set up secure chat.");
      }
      const key = await newSymmetricKey();
      const version = fresh.latest_key_version + 1;
      try {
        await api.addKeyVersion(conversationId, version, await wrapForMembers(key, members));
        const map = keysRef.current.get(conversationId) ?? new Map();
        map.set(version, key);
        keysRef.current.set(conversationId, map);
        return { version, key };
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          // Someone else made the new version first: use theirs.
          const map = await conversationKeys(conversationId, true);
          const latest = Math.max(0, ...map.keys());
          if (latest >= version) return { version: latest, key: map.get(latest)! };
        }
        throw error;
      }
    },
    [conversationKeys, wrapForMembers],
  );

  const currentKey = useCallback(
    async (conversationId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId);
      const map = await conversationKeys(conversationId);
      const latest = conversation?.latest_key_version ?? Math.max(0, ...map.keys());
      const key = map.get(latest);
      if (key) return { version: latest, key };
      return rotateKey(conversationId);
    },
    [conversationKeys, rotateKey],
  );

  // --- Decryption ---------------------------------------------------------

  const decrypt = useCallback(
    async (raw: RawMessage): Promise<ChatMessage> => {
      const base: ChatMessage = {
        id: raw.id,
        conversationId: raw.conversation_id,
        senderId: raw.sender_id,
        seq: raw.seq,
        kind: raw.kind,
        keyVersion: raw.key_version,
        revision: raw.revision,
        createdAt: raw.created_at,
        editedAt: raw.edited_at,
        deleted: raw.deleted,
        text: "",
        replyTo: null,
        attachments: [],
        state: "sent",
        systemEvent: raw.system_event,
        systemData: raw.system_data ?? {},
      };
      if (raw.deleted || raw.kind === "system" || !raw.ciphertext || !raw.nonce || raw.key_version == null) {
        return base;
      }
      try {
        const map = await conversationKeys(raw.conversation_id);
        let key = map.get(raw.key_version);
        if (!key) key = (await conversationKeys(raw.conversation_id, true)).get(raw.key_version);
        if (!key) return { ...base, state: "unreadable" };
        const payload = await decryptJson<Payload>(
          raw.ciphertext,
          raw.nonce,
          key,
          associatedData(raw.conversation_id, raw.id, raw.sender_id ?? 0, raw.key_version, raw.revision),
        );
        const thumbs = new Map(raw.attachments.map((a) => [a.id, a.has_thumb]));
        return {
          ...base,
          text: payload.text ?? "",
          replyTo: payload.reply_to ?? null,
          attachments: (payload.attachments ?? [])
            .filter((a) => thumbs.has(a.id))
            .map((a) => ({ ...a, has_thumb: Boolean(thumbs.get(a.id) && a.thumb_key) })),
        };
      } catch {
        return { ...base, state: "unreadable" };
      }
    },
    [conversationKeys],
  );

  const updatePreview = useCallback(
    async (conversation: RawConversation) => {
      const message = conversation.last_message ? await decrypt(conversation.last_message) : null;
      setPreviews((current) => ({ ...current, [conversation.id]: message }));
    },
    [decrypt],
  );

  // --- Loading ------------------------------------------------------------

  const refreshConversations = useCallback(async () => {
    const list = await api.listConversations();
    setRawConversations(list);
    await Promise.all(list.map(updatePreview));
  }, [updatePreview]);

  const loadThread = useCallback(
    async (conversationId: string, older = false) => {
      const existing = threadsRef.current[conversationId];
      if (existing?.loading) return;
      if (existing?.loaded && !older) return;
      setThreads((t) => ({
        ...t,
        [conversationId]: { ...(t[conversationId] ?? { messages: [], hasMore: false, loaded: false }), loading: true },
      }));
      try {
        const oldest = older ? existing?.messages.find((m) => m.state !== "sending" && m.state !== "failed")?.seq : undefined;
        const page = await api.getMessages(conversationId, { before_seq: oldest, limit: 50 });
        const decrypted = await Promise.all(page.results.map(decrypt));
        setThreads((t) => {
          const current = t[conversationId]?.messages ?? [];
          const known = new Set(current.map((m) => m.id));
          const merged = [...decrypted.filter((m) => !known.has(m.id)), ...current].sort(bySeq);
          return { ...t, [conversationId]: { messages: merged, hasMore: page.has_more, loading: false, loaded: true } };
        });
      } catch {
        setThreads((t) => ({
          ...t,
          [conversationId]: { ...(t[conversationId] ?? { messages: [], hasMore: false }), loading: false, loaded: true },
        }));
      }
    },
    [decrypt],
  );

  const catchUp = useCallback(async () => {
    await refreshConversations().catch(() => undefined);
    for (const [conversationId, thread] of Object.entries(threadsRef.current)) {
      if (!thread.loaded) continue;
      const newest = Math.max(0, ...thread.messages.filter((m) => m.state === "sent" || m.state === "unreadable").map((m) => m.seq));
      try {
        const page = await api.getMessages(conversationId, { after_seq: newest, limit: 100 });
        const decrypted = await Promise.all(page.results.map(decrypt));
        upsertMessages(setThreads, conversationId, decrypted);
      } catch {
        // Next reconnect will try again.
      }
    }
  }, [decrypt, refreshConversations]);

  // --- Unlocking ----------------------------------------------------------

  const becomeReady = useCallback(
    async (me: ChatAccount, privateKey: Uint8Array) => {
      privateKeyRef.current = privateKey;
      accountRef.current = me;
      setAccount(me);
      setStatus("ready");
      await refreshConversations().catch(() => undefined);
    },
    [refreshConversations],
  );

  // The key opened by a checked recovery code, kept only until the new PIN is set.
  const recoveredKey = useRef<{ code: string; key: Uint8Array } | null>(null);

  const clearMemory = useCallback(() => {
    recoveredKey.current = null;
    socketRef.current?.stop();
    socketRef.current = null;
    privateKeyRef.current = null;
    keysRef.current.clear();
    keyLoads.current.clear();
    pendingSends.current.clear();
    releaseDecryptedFiles();
    for (const thread of Object.values(threadsRef.current)) {
      for (const message of thread.messages) {
        for (const attachment of message.attachments) {
          if (attachment.localUrl) URL.revokeObjectURL(attachment.localUrl);
        }
      }
    }
    setThreads({});
    setPreviews({});
    setRawConversations([]);
    setConnected(false);
  }, []);

  // The password-derived secret for this sign-in (made at sign-in, or from
  // the password typed into chat). With the PIN it opens the stored key.
  const passwordSecretRef = useRef<Uint8Array | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const wrongPins = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ set_up, account: me }, unread] = await Promise.all([
          api.getAccount(),
          api.getUnreadCount().catch(() => 0),
        ]);
        if (cancelled) return;
        setServerUnread(unread);
        if (set_up && me) {
          accountRef.current = me;
          setAccount(me);
          const remembered = await recallKey(userId);
          if (cancelled) return;
          if (remembered && (await publicKeyMatches(remembered, me.public_key))) {
            await becomeReady(me, remembered);
            return;
          }
        }
        passwordSecretRef.current = await recallPasswordSecret(userId);
        if (cancelled) return;
        setNeedsPassword(!passwordSecretRef.current);
        setStatus(set_up && me ? "locked" : "not_set_up");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, becomeReady]);

  useEffect(() => {
    const onLock = () => {
      clearMemory();
      passwordSecretRef.current = null;
      setNeedsPassword(true);
      setStatus((s) => (s === "ready" ? "locked" : s));
    };
    window.addEventListener("portal-chat-lock", onLock);
    return () => window.removeEventListener("portal-chat-lock", onLock);
  }, [clearMemory]);

  /** The password secret, from this sign-in or from the password just typed (checked with the server). */
  const passwordSecret = useCallback(
    async (password?: string) => {
      if (password) {
        try {
          await api.checkPassword(password);
        } catch {
          throw new Error("That is not your portal password.");
        }
        const secret = await derivePasswordSecret(password, userId);
        passwordSecretRef.current = secret;
        setNeedsPassword(false);
        void rememberPasswordSecret(userId, secret);
        return secret;
      }
      if (passwordSecretRef.current) return passwordSecretRef.current;
      setNeedsPassword(true);
      throw new Error("Enter your portal password first.");
    },
    [userId],
  );

  const freshBackups = useCallback(async (privateKey: Uint8Array, pin: string, secret: Uint8Array) => {
    const code = await makeRecoveryCode();
    return {
      code,
      pin: await lockWithPin(privateKey, pin, secret),
      recovery: await backUpPrivateKey(privateKey, normaliseRecoveryCode(code)),
    };
  }, []);

  const setUp = useCallback(
    async (pin: string, password?: string) => {
      const secret = await passwordSecret(password);
      const identity = await generateIdentity();
      const s = await getSodium();
      const { code, ...backups } = await freshBackups(identity.privateKey, pin, secret);
      const me = await api.createAccount({ public_key: toB64(s, identity.publicKey), ...backups });
      await rememberKey(userId, identity.privateKey);
      await becomeReady(me, identity.privateKey);
      return code;
    },
    [becomeReady, freshBackups, passwordSecret, userId],
  );

  const unlock = useCallback(
    async (pin: string, password?: string) => {
      const secret = await passwordSecret(password);
      const me = accountRef.current ?? (await api.getAccount()).account;
      if (!me) throw new Error("Chat is not set up.");
      let privateKey: Uint8Array;
      try {
        privateKey = await openWithPin(me.pin, pin, secret);
      } catch (error) {
        if (error instanceof PasswordLayerError) {
          throw new Error(
            "Your portal password has changed since you set up chat (for example after a reset link). Use your recovery code once to unlock it.",
          );
        }
        wrongPins.current += 1;
        if (wrongPins.current >= MAX_WRONG_PINS) {
          wrongPins.current = 0;
          passwordSecretRef.current = null;
          setNeedsPassword(true);
          void forgetPasswordSecret();
          throw new Error("Too many wrong PINs. Enter your portal password, then your PIN.");
        }
        const left = MAX_WRONG_PINS - wrongPins.current;
        throw new Error(`That PIN is not right. ${left} ${left === 1 ? "try" : "tries"} left before you need your portal password.`);
      }
      wrongPins.current = 0;
      await rememberKey(userId, privateKey);
      await becomeReady(me, privateKey);
    },
    [becomeReady, passwordSecret, userId],
  );

  const openWithRecoveryCode = useCallback(async (code: string) => {
    const normalised = normaliseRecoveryCode(code);
    if (recoveredKey.current?.code === normalised) return recoveredKey.current.key;
    const me = accountRef.current ?? (await api.getAccount()).account;
    if (!me) throw new Error("Chat is not set up.");
    let privateKey: Uint8Array;
    try {
      privateKey = await openPrivateKey(me.recovery, normalised);
    } catch {
      throw new Error("That recovery code is not right.");
    }
    recoveredKey.current = { code: normalised, key: privateKey };
    return privateKey;
  }, []);

  const checkRecoveryCode = useCallback(
    async (code: string) => {
      try {
        await openWithRecoveryCode(code);
        return true;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("That recovery code")) return false;
        throw error;
      }
    },
    [openWithRecoveryCode],
  );

  const recover = useCallback(
    async (code: string, newPin: string, password?: string) => {
      const secret = await passwordSecret(password);
      const privateKey = await openWithRecoveryCode(code);
      const { code: nextCode, ...backups } = await freshBackups(privateKey, newPin, secret);
      const updated = await api.updateBackups(backups);
      wrongPins.current = 0;
      await rememberKey(userId, privateKey);
      recoveredKey.current = null;
      await becomeReady(updated, privateKey);
      return nextCode;
    },
    [becomeReady, freshBackups, openWithRecoveryCode, passwordSecret, userId],
  );

  const changePin = useCallback(
    async (newPin: string, password?: string) => {
      const privateKey = privateKeyRef.current;
      if (!privateKey) throw new Error("Unlock chat first.");
      const secret = await passwordSecret(password);
      const updated = await api.updateBackups({ pin: await lockWithPin(privateKey, newPin, secret) });
      accountRef.current = updated;
      setAccount(updated);
    },
    [passwordSecret],
  );

  const startOver = useCallback(
    async (newPin: string, resetCode: string, password?: string) => {
      const secret = await passwordSecret(password);
      const identity = await generateIdentity();
      const s = await getSodium();
      const { code, ...backups } = await freshBackups(identity.privateKey, newPin, secret);
      const me = await api.resetAccount({ public_key: toB64(s, identity.publicKey), ...backups, code: resetCode });
      clearMemory();
      wrongPins.current = 0;
      await rememberKey(userId, identity.privateKey);
      await becomeReady(me, identity.privateKey);
      return code;
    },
    [becomeReady, clearMemory, freshBackups, passwordSecret, userId],
  );

  const lock = useCallback(async () => {
    await forgetKey(); // also fires portal-chat-lock, which clears memory
  }, []);

  // --- Live events ----------------------------------------------------------

  const handleEvent = useCallback(
    async ({ event, data }: ChatEvent) => {
      const conversationId = String(data.conversation_id ?? "");
      switch (event) {
        case "message.new": {
          const raw = data.message as RawMessage;
          const known = conversationsRef.current.some((c) => c.id === raw.conversation_id);
          if (!known) {
            await refreshConversations().catch(() => undefined);
            return;
          }
          if (raw.kind === "system") keysRef.current.delete(raw.conversation_id);
          const message = await decrypt(raw);
          upsertMessages(setThreads, raw.conversation_id, [message]);
          setPreviews((p) => ({ ...p, [raw.conversation_id]: message }));
          const viewing = (viewingRef.current.get(raw.conversation_id) ?? 0) > 0 && document.visibilityState === "visible";
          setRawConversations((list) =>
            sortConversations(
              list.map((c) =>
                c.id !== raw.conversation_id
                  ? c
                  : (c.last_message?.seq ?? 0) >= raw.seq
                    ? // A list fetched after this message was saved already counts it.
                      c
                    : {
                        ...c,
                        last_message: raw,
                        last_message_at: raw.created_at,
                        unread_count:
                          raw.sender_id !== userId && raw.kind !== "system" && !viewing ? c.unread_count + 1 : c.unread_count,
                      },
              ),
            ),
          );
          if (raw.sender_id !== userId) {
            setTyping((t) => {
              const next = { ...t };
              delete next[raw.conversation_id];
              return next;
            });
          }
          return;
        }
        case "message.edited": {
          const thread = threadsRef.current[conversationId];
          const existing = thread?.messages.find((m) => m.id === data.message_id);
          if (!existing) return;
          const message = await decrypt({
            id: existing.id,
            conversation_id: conversationId,
            sender_id: existing.senderId,
            seq: existing.seq,
            kind: existing.kind,
            key_version: existing.keyVersion,
            nonce: String(data.nonce),
            ciphertext: String(data.ciphertext),
            revision: Number(data.revision),
            system_event: null,
            system_data: {},
            created_at: existing.createdAt,
            edited_at: String(data.edited_at),
            deleted: false,
            deleted_at: null,
            attachments: existing.attachments.map((a) => ({ id: a.id, size: a.size, has_thumb: a.has_thumb })),
          });
          upsertMessages(setThreads, conversationId, [message]);
          setPreviews((p) => (p[conversationId]?.id === message.id ? { ...p, [conversationId]: message } : p));
          return;
        }
        case "message.deleted": {
          setThreads((t) => mapMessage(t, conversationId, String(data.message_id), (m) => ({
            ...m,
            deleted: true,
            text: "",
            attachments: [],
          })));
          setPreviews((p) =>
            p[conversationId]?.id === data.message_id
              ? { ...p, [conversationId]: { ...p[conversationId]!, deleted: true, text: "", attachments: [] } }
              : p,
          );
          return;
        }
        case "message.hidden": {
          setThreads((t) => {
            const thread = t[conversationId];
            if (!thread) return t;
            return { ...t, [conversationId]: { ...thread, messages: thread.messages.filter((m) => m.id !== data.message_id) } };
          });
          return;
        }
        case "read.updated": {
          const readerId = Number(data.user_id);
          const seq = Number(data.last_read_seq);
          setRawConversations((list) =>
            list.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    last_read_seq: readerId === userId ? Math.max(c.last_read_seq, seq) : c.last_read_seq,
                    unread_count: readerId === userId ? 0 : c.unread_count,
                    participants: c.participants.map((p) =>
                      p.id === readerId ? { ...p, last_read_seq: Math.max(p.last_read_seq, seq) } : p,
                    ),
                  },
            ),
          );
          return;
        }
        case "conversation.new":
          await refreshConversations().catch(() => undefined);
          return;
        case "key.changed":
          keysRef.current.delete(conversationId);
          try {
            const fresh = await api.getConversation(conversationId);
            setRawConversations((list) => list.map((c) => (c.id === fresh.id ? fresh : c)));
          } catch {
            // Picked up on the next refresh.
          }
          return;
        case "presence": {
          const personId = Number(data.user_id);
          const online = Boolean(data.online);
          const lastSeen = (data.last_seen_at as string | null | undefined) ?? null;
          setRawConversations((list) =>
            list.map((c) =>
              c.participants.some((p) => p.id === personId)
                ? {
                    ...c,
                    participants: c.participants.map((p) =>
                      p.id === personId ? { ...p, online, last_seen_at: lastSeen ?? p.last_seen_at } : p,
                    ),
                  }
                : c,
            ),
          );
          return;
        }
        case "typing": {
          if (Number(data.user_id) === userId) return;
          setTyping((t) => ({ ...t, [conversationId]: Date.now() + 4000 }));
          return;
        }
        default:
          return;
      }
    },
    [decrypt, refreshConversations, userId],
  );

  const handleEventRef = useRef(handleEvent);
  const catchUpRef = useRef(catchUp);
  useEffect(() => {
    handleEventRef.current = handleEvent;
    catchUpRef.current = catchUp;
  }, [handleEvent, catchUp]);

  useEffect(() => {
    if (status !== "ready") return;
    const socket = new ChatSocket(
      (event) => void handleEventRef.current(event),
      (isOpen) => {
        setConnected(isOpen);
        // Anything sent between loading the list and the socket opening (or
        // while it was down) is fetched now, so nothing is missed.
        if (isOpen) void catchUpRef.current();
      },
    );
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [status]);

  // Presence is pushed live, but a browser that dies without closing its
  // socket only drops offline when its presence lapses on the server, so
  // the list (online dots and "last seen") is refreshed every minute too.
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshConversations().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [status, refreshConversations]);

  // Typing indicators expire on their own.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTyping((t) => {
        const next = Object.fromEntries(Object.entries(t).filter(([, until]) => until > now));
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typing]);

  // Without the key, keep the sidebar badge roughly current.
  useEffect(() => {
    if (status === "ready") return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        api.getUnreadCount().then(setServerUnread).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [status]);

  // --- Actions --------------------------------------------------------------

  const openWith = useCallback(
    async (person: api.ChatPerson) => {
      const existing = conversationsRef.current.find(
        (c) => c.kind === "direct" && c.participants.some((p) => p.id === person.id),
      );
      if (existing) return existing.id;
      const me = accountRef.current!;
      const key = await newSymmetricKey();
      const self: Participant = {
        id: userId,
        name: "",
        email: "",
        department: null,
        is_active: true,
        chat_ready: true,
        key_id: me.key_id,
        public_key: me.public_key,
        last_seen_at: null,
        last_read_seq: 0,
        left: false,
      };
      const keys = await wrapForMembers(key, [self, { ...person, last_read_seq: 0, left: false }]);
      const conversation = await api.startConversation(person.id, keys);
      // A new chat stored the key just made; an existing one (the other person
      // started it first) has its own. Either way, read what the server holds.
      await conversationKeys(conversation.id, true);
      setRawConversations((list) => sortConversations([conversation, ...list.filter((c) => c.id !== conversation.id)]));
      void updatePreview(conversation);
      return conversation.id;
    },
    [conversationKeys, updatePreview, userId, wrapForMembers],
  );

  const invite = useCallback(
    async (personId: number) => {
      const conversation = await api.invitePerson(personId);
      setRawConversations((list) => sortConversations([conversation, ...list.filter((c) => c.id !== conversation.id)]));
      void updatePreview(conversation);
      // Reload the thread so the "Invitation sent" note shows.
      setThreads((t) => {
        const next = { ...t };
        delete next[conversation.id];
        return next;
      });
      return conversation.id;
    },
    [updatePreview],
  );

  const deliver = useCallback(
    async (conversationId: string, messageId: string) => {
      const pending = pendingSends.current.get(messageId);
      if (!pending) return;
      const localUrls = pending.localUrls;
      setThreads((t) => mapMessage(t, conversationId, messageId, (m) => ({ ...m, state: "sending" })));
      try {
        if (!pending.uploaded) {
          pending.uploaded = [];
          for (const file of pending.files) {
            pending.uploaded.push(await uploadEncrypted(conversationId, file));
          }
        }
        const payload: Payload = { v: 1, text: pending.text, reply_to: pending.replyTo, attachments: pending.uploaded };
        const kind = pending.uploaded.length ? "attachment" : "text";
        const attempt = async (version: number, key: Uint8Array) => {
          const encrypted = await encryptJson(payload, key, associatedData(conversationId, messageId, userId, version, 0));
          return api.postMessage(conversationId, {
            id: messageId,
            kind,
            key_version: version,
            ...encrypted,
            attachment_ids: pending.uploaded!.map((a) => a.id),
          });
        };
        let { version, key } = await currentKey(conversationId);
        let raw: RawMessage;
        try {
          raw = await attempt(version, key);
        } catch (error) {
          if (errorType(error) !== "key_outdated") throw error;
          ({ version, key } = await rotateKey(conversationId));
          raw = await attempt(version, key);
        }
        pendingSends.current.delete(messageId);
        const sent: ChatMessage = {
          ...(await decrypt(raw)),
          text: payload.text,
          replyTo: payload.reply_to,
          attachments: payload.attachments.map((a, index) => ({
            ...a,
            has_thumb: Boolean(a.thumb_key && raw.attachments.find((x) => x.id === a.id)?.has_thumb),
            localUrl: localUrls[index],
          })),
          state: "sent",
        };
        upsertMessages(setThreads, conversationId, [sent]);
        setPreviews((p) => ({ ...p, [conversationId]: sent }));
        setRawConversations((list) =>
          sortConversations(
            list.map((c) =>
              c.id === conversationId
                ? { ...c, last_message: raw, last_message_at: raw.created_at, latest_key_version: Math.max(c.latest_key_version, version) }
                : c,
            ),
          ),
        );
      } catch (error) {
        setThreads((t) => mapMessage(t, conversationId, messageId, (m) => ({ ...m, state: "failed" })));
        throw error;
      }
    },
    [currentKey, decrypt, rotateKey, userId],
  );

  const send = useCallback(
    async (conversationId: string, input: SendInput) => {
      const id = newId();
      const localUrls = input.files.map((f) =>
        f.type.startsWith("image/") || f.type.startsWith("video/") ? URL.createObjectURL(f) : undefined,
      );
      pendingSends.current.set(id, { ...input, localUrls });
      const optimistic: ChatMessage = {
        id,
        conversationId,
        senderId: userId,
        seq: Number.MAX_SAFE_INTEGER,
        kind: input.files.length ? "attachment" : "text",
        keyVersion: null,
        revision: 0,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
        text: input.text,
        replyTo: input.replyTo,
        attachments: input.files.map((f, index) => ({
          id: `local-${index}-${f.name}-${f.size}`,
          name: f.name,
          mime: f.type || "application/octet-stream",
          size: f.size,
          file_key: "",
          has_thumb: false,
          localUrl: localUrls[index],
        })),
        state: "sending",
        systemEvent: null,
        systemData: {},
      };
      upsertMessages(setThreads, conversationId, [optimistic]);
      await deliver(conversationId, id);
    },
    [deliver, userId],
  );

  const retry = useCallback((conversationId: string, messageId: string) => deliver(conversationId, messageId), [deliver]);

  const edit = useCallback(
    async (message: ChatMessage, text: string) => {
      if (message.keyVersion == null) return;
      const map = await conversationKeys(message.conversationId);
      const key = map.get(message.keyVersion);
      if (!key) throw new Error("This message can no longer be edited.");
      const revision = message.revision + 1;
      const payload: Payload = {
        v: 1,
        text,
        reply_to: message.replyTo,
        attachments: message.attachments.map((a) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { has_thumb, localUrl, ...rest } = a;
          return rest;
        }),
      };
      const encrypted = await encryptJson(
        payload,
        key,
        associatedData(message.conversationId, message.id, userId, message.keyVersion, revision),
      );
      const raw = await api.patchMessage(message.id, { revision, ...encrypted });
      const updated: ChatMessage = { ...message, text, revision, editedAt: raw.edited_at };
      upsertMessages(setThreads, message.conversationId, [updated]);
    },
    [conversationKeys, userId],
  );

  const deleteForEveryone = useCallback(async (message: ChatMessage) => {
    await api.deleteMessage(message.id, "everyone");
    setThreads((t) => mapMessage(t, message.conversationId, message.id, (m) => ({ ...m, deleted: true, text: "", attachments: [] })));
  }, []);

  const deleteForMe = useCallback(async (message: ChatMessage) => {
    if (message.state === "failed") {
      pendingSends.current.delete(message.id);
    } else {
      await api.deleteMessage(message.id, "me");
    }
    setThreads((t) => {
      const thread = t[message.conversationId];
      if (!thread) return t;
      return {
        ...t,
        [message.conversationId]: { ...thread, messages: thread.messages.filter((m) => m.id !== message.id) },
      };
    });
  }, []);

  // The highest position this browser has reported as read, per conversation.
  const reportedRead = useRef(new Map<string, number>());
  const markSeen = useCallback((conversationId: string, newestSeq: number) => {
    if (!newestSeq) return;
    setRawConversations((list) =>
      list.map((c) =>
        c.id === conversationId && (c.unread_count || newestSeq > c.last_read_seq)
          ? { ...c, unread_count: 0, last_read_seq: Math.max(c.last_read_seq, newestSeq) }
          : c,
      ),
    );
    const known = conversationsRef.current.find((c) => c.id === conversationId)?.last_read_seq ?? 0;
    const reported = Math.max(known, reportedRead.current.get(conversationId) ?? 0);
    if (newestSeq > reported) {
      reportedRead.current.set(conversationId, newestSeq);
      api.markRead(conversationId, newestSeq).catch(() => reportedRead.current.delete(conversationId));
    }
  }, []);

  const setViewing = useCallback((conversationId: string, viewing: boolean) => {
    const count = viewingRef.current.get(conversationId) ?? 0;
    viewingRef.current.set(conversationId, Math.max(0, count + (viewing ? 1 : -1)));
  }, []);

  const lastTypingSent = useRef(0);
  const sendTyping = useCallback((conversationId: string) => {
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    socketRef.current?.send({ type: "typing", conversation_id: conversationId });
  }, []);

  const openDrawer = useCallback((conversationId: string | null = null) => {
    setDrawer({ open: true, conversationId });
  }, []);
  const closeDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);

  const conversations = useMemo<ChatConversation[]>(
    () =>
      rawConversations.map((c) => ({
        ...c,
        other: c.participants.find((p) => p.id !== userId) ?? null,
        preview: previewOf(previews[c.id] ?? null, userId),
      })),
    [previews, rawConversations, userId],
  );

  const unreadTotal =
    status === "ready" ? rawConversations.reduce((sum, c) => sum + c.unread_count, 0) : serverUnread;

  const value: ChatContextValue = {
    userId,
    status,
    account,
    connected,
    conversations,
    threads,
    typing,
    unreadTotal,
    drawer,
    openDrawer,
    closeDrawer,
    needsPassword,
    setUp,
    unlock,
    checkRecoveryCode,
    recover,
    changePin,
    startOver,
    lock,
    refreshConversations,
    openWith,
    invite,
    loadThread,
    send,
    retry,
    edit,
    deleteForEveryone,
    deleteForMe,
    markSeen,
    setViewing,
    sendTyping,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// --- Pure helpers -------------------------------------------------------------

function bySeq(a: ChatMessage, b: ChatMessage) {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.createdAt.localeCompare(b.createdAt);
}

function sortConversations(list: RawConversation[]) {
  return [...list].sort((a, b) =>
    (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
  );
}

function upsertMessages(
  setThreads: React.Dispatch<React.SetStateAction<Record<string, Thread>>>,
  conversationId: string,
  messages: ChatMessage[],
) {
  setThreads((t) => {
    const thread = t[conversationId];
    if (!thread) return t; // not open: it will load fresh when opened
    const byId = new Map(thread.messages.map((m) => [m.id, m]));
    for (const message of messages) byId.set(message.id, message);
    return { ...t, [conversationId]: { ...thread, messages: [...byId.values()].sort(bySeq) } };
  });
}

function mapMessage(
  threads: Record<string, Thread>,
  conversationId: string,
  messageId: string,
  change: (m: ChatMessage) => ChatMessage,
) {
  const thread = threads[conversationId];
  if (!thread) return threads;
  return {
    ...threads,
    [conversationId]: { ...thread, messages: thread.messages.map((m) => (m.id === messageId ? change(m) : m)) },
  };
}
