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
import type { ChatAccount, Participant, RawConversation, RawKey, RawMessage, RawReaction } from "@/lib/chat/api";
import {
  associatedData,
  decryptFile,
  encryptFile,
  groupInfoAssociatedData,
  reactionAssociatedData,
  backUpPrivateKey,
  derivePasswordSecret,
  lockWithPin,
  openWithPin,
  PasswordLayerError,
  decryptJson,
  encryptJson,
  generateIdentity,
  getSodium,
  groupInfoDigest,
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
  writePushConfig,
} from "@/lib/chat/keystore";
import { releaseDecryptedFiles, safeObjectUrl, uploadEncrypted, type UploadedAttachment } from "@/lib/chat/media";
import { parseMessagePayload } from "@/lib/chat/payload";
import { formatDuration } from "@/lib/chat/voice";
import { PROFILE_CHANGED_EVENT } from "@/lib/profile-photo";
import { firstLink, type LinkPreview } from "@/components/chat/link-preview";
import { getApiBaseUrl } from "@/lib/auth";
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
  /** One per person, already decrypted. */
  reactions: MessageReaction[];
  /** Who and what is quoted, kept in the reply itself so the quote shows even when the original is not loaded. */
  replyPreview: { senderId: number | null; text: string } | null;
  /** How many times this message has been forwarded to get here (0: not forwarded). */
  forwarded: number;
  /** The preview of its first link, made when it was sent. */
  linkPreview: LinkPreview | null;
};

export type MessageReaction = { userId: number; emoji: string };

/** The newest reaction in a conversation, for the list preview. */
type ReactionPreview = { userId: number; emoji: string; target: ChatMessage; at: string };

export type ChatConversation = RawConversation & {
  /** Direct chats: the other person. Null in groups. */
  other: Participant | null;
  preview: string;
  isGroup: boolean;
  /** The other person's name, or the group's name. */
  title: string;
  /** Profile picture, or the group photo (decrypted). */
  photoUrl: string | null;
  /** Current members, including pending ones (not people who left). */
  members: Participant[];
  /** Decrypted group details (null for direct chats, or until they open). */
  group: GroupInfo | null;
  /** Whether you are an admin (or the owner) of this group. */
  isAdmin: boolean;
  /** Whether you own this group. */
  isOwner: boolean;
  /** No notifications from this chat right now. */
  isMuted: boolean;
};

/** A group's name, description and photo key, as decrypted in the browser. */
export type GroupInfo = {
  name: string;
  description: string;
  photo: { file_key: string } | null;
  /**
   * The details exactly as encrypted (with their random value). A new key
   * re-locks this unchanged, so it still matches the fingerprint admins set.
   */
  sealed?: Record<string, unknown>;
};

/** New details (an admin's change): a fresh random value, so the fingerprint says nothing about them. */
async function sealGroupInfo(value: GroupInfo): Promise<GroupInfo> {
  const s = await getSodium();
  const sealed = {
    v: 1,
    name: value.name,
    description: value.description,
    photo: value.photo,
    salt: toB64(s, s.randombytes_buf(16)),
  };
  return { name: value.name, description: value.description, photo: value.photo, sealed };
}

type Thread = { messages: ChatMessage[]; hasMore: boolean; loading: boolean; loaded: boolean };

type Payload = {
  v: 1;
  text: string;
  reply_to: string | null;
  reply_preview?: { sender_id: number | null; text: string } | null;
  attachments: UploadedAttachment[];
  /** Forward count, set by the forwarding browser; absent on ordinary messages. */
  forwarded?: number;
  link_preview?: LinkPreview | null;
};

type ReactionPayload = { v: 1; emoji: string };

/** `voice`: the single file is a recorded voice note. */
type SendInput = {
  text: string;
  files: File[];
  replyTo: string | null;
  voice?: { duration: number; waveform: number[]; url?: string };
  /** Files already in this chat's storage (forwarding), sent instead of uploading `files`. */
  prepared?: UploadedAttachment[];
  /** Forward count for a forwarded message. */
  forwarded?: number;
  /** The preview for the first link in `text`, if any. */
  linkPreview?: LinkPreview | null;
};

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
  /** True while older conversations remain to be loaded. */
  conversationsHaveMore: boolean;
  loadingMoreConversations: boolean;
  loadMoreConversations: () => Promise<void>;
  /** Make sure a conversation is in the list (e.g. opened from a link). False if it does not exist for this user. */
  ensureConversation: (conversationId: string) => Promise<boolean>;
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
  /** Set your reaction; the same emoji again (or null) removes it. */
  react: (message: ChatMessage, emoji: string | null) => Promise<void>;
  /** Create a group with you as admin; returns its id. `photo` is optional. */
  createGroup: (input: { name: string; description: string; people: api.ChatPerson[]; photo?: File | null }) => Promise<string>;
  /** Change a group's name, description or photo (photo: File to replace, null to remove, undefined to keep). */
  updateGroup: (conversationId: string, change: { name?: string; description?: string; photo?: File | null }) => Promise<void>;
  addGroupMembers: (conversationId: string, people: api.ChatPerson[]) => Promise<void>;
  removeGroupMember: (conversationId: string, userId: number) => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  setGroupAdmin: (conversationId: string, userId: number, admin: boolean) => Promise<void>;
  /** The owner hands the group to another member. */
  transferOwnership: (conversationId: string, userId: number) => Promise<void>;
  /** Your own settings for a chat. `until`: when muting ends (null to unmute). */
  muteConversation: (conversationId: string, until: Date | null) => Promise<void>;
  archiveConversation: (conversationId: string, archived: boolean) => Promise<void>;
  /** Out of your list until a new message arrives. */
  hideConversation: (conversationId: string, hidden: boolean) => Promise<void>;
  /** People typing in each conversation (user ids). */
  typingPeople: Record<string, number[]>;
  /** Forward a message to other chats (at most 5), each followed by `note` if given. */
  forward: (message: ChatMessage, conversationIds: string[], note: string) => Promise<void>;
  /** Load older pages until the message is in the thread. False if it is not there (deleted for you, or too far back). */
  findMessage: (conversationId: string, messageId: string) => Promise<boolean>;
  setViewing: (conversationId: string, viewing: boolean) => void;
  sendTyping: (conversationId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const MAX_WRONG_PINS = 5;
// After a long disconnection, at most this many pages of 100 are fetched per open chat.
const CATCH_UP_PAGES = 10;
const MAX_FORWARD_TARGETS = 5;
// Jumping to a quoted message loads at most this many older pages (of 50) to find it.
const JUMP_PAGES = 40;

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
export function systemText(message: ChatMessage, userId: number, nameOf: (id: number) => string = () => "Someone"): string {
  const data = message.systemData;
  const who = (id: unknown) => (Number(id) === userId ? "You" : nameOf(Number(id)));
  const whom = (id: unknown) => (Number(id) === userId ? "you" : nameOf(Number(id)));
  switch (message.systemEvent) {
    case "group_created":
      return `${who(data.user_id)} created the group`;
    case "member_added":
      return `${who(data.user_id)} added ${whom(data.target_id)}`;
    case "member_removed":
      return `${who(data.user_id)} removed ${whom(data.target_id)}`;
    case "member_left":
      return `${who(data.user_id)} left`;
    case "member_joined":
      return Number(data.user_id) === userId ? "You joined the group" : `${nameOf(Number(data.user_id))} joined`;
    case "info_changed": {
      const fields = Array.isArray(data.fields) ? (data.fields as string[]) : [];
      const what =
        fields.length === 1
          ? { name: "the group name", description: "the group description", photo: "the group photo" }[fields[0]] ?? "the group details"
          : "the group details";
      return `${who(data.user_id)} changed ${what}`;
    }
    case "admin_granted":
      return data.user_id == null
        ? `${Number(data.target_id) === userId ? "You are" : `${nameOf(Number(data.target_id))} is`} now an admin`
        : `${who(data.user_id)} made ${whom(data.target_id)} an admin`;
    case "admin_revoked":
      return `${who(data.user_id)} removed ${whom(data.target_id)} as admin`;
    case "owner_transferred":
      return data.user_id == null
        ? `${Number(data.target_id) === userId ? "You are" : `${nameOf(Number(data.target_id))} is`} now the group owner`
        : `${who(data.user_id)} made ${whom(data.target_id)} the group owner`;
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

/** One line describing a message: its text, or what it carries. */
export function messageSummary(message: ChatMessage): string {
  if (message.deleted) return "This message was deleted";
  if (message.text) return message.text;
  const first = message.attachments[0];
  if (!first) return "Message";
  if (first.voice) return `Voice message (${formatDuration(first.duration ?? 0)})`;
  if (first.mime.startsWith("image/")) return "Photo";
  if (first.mime.startsWith("video/")) return "Video";
  return first.name;
}

function shorten(text: string, length = 40) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

function reactionPreviewText(preview: ReactionPreview, conversation: RawConversation, userId: number) {
  const person = conversation.participants.find((p) => p.id === preview.userId);
  const who = preview.userId === userId ? "You" : (person?.name ?? "Someone").split(" ")[0];
  return `${who} reacted ${preview.emoji} to "${shorten(messageSummary(preview.target))}"`;
}

/** How a conversation names its people: "You", or their name (first name in previews). */
export function nameLookup(conversation: RawConversation, userId: number, first = false) {
  return (id: number) => {
    if (id === userId) return "You";
    const name = conversation.participants.find((p) => p.id === id)?.name ?? "Someone";
    return first ? name.split(" ")[0] : name;
  };
}

function previewOf(message: ChatMessage | null, userId: number, conversation?: RawConversation): string {
  if (!message) return "No messages yet";
  if (message.deleted) return "This message was deleted";
  const nameOf = conversation ? nameLookup(conversation, userId) : undefined;
  // The list row cuts long notes off with "…".
  if (message.kind === "system") return systemText(message, userId, nameOf);
  // In a group, say who wrote it: "Ada: …", "You: …".
  if (conversation?.kind === "group" && message.senderId != null) {
    const who = nameLookup(conversation, userId, true)(message.senderId);
    return `${who}: ${previewOf(message, userId)}`;
  }
  if (message.state === "unreadable") return "This message is not available";
  if (message.text) return message.text;
  if (message.attachments.length) {
    const first = message.attachments[0];
    if (first.voice) return `Voice message (${formatDuration(first.duration ?? 0)})`;
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
  const [reactionPreviews, setReactionPreviews] = useState<Record<string, ReactionPreview>>({});
  const [groupInfos, setGroupInfos] = useState<Record<string, GroupInfo | null>>({});
  // Read by actions straight after a change, so it is updated at once, not after the next render.
  const groupInfosRef = useRef(groupInfos);
  const rememberGroupInfo = useCallback((conversationId: string, info: GroupInfo | null) => {
    groupInfosRef.current = { ...groupInfosRef.current, [conversationId]: info };
    setGroupInfos((g) => ({ ...g, [conversationId]: info }));
  }, []);
  // Decrypted group photos, by the photo's file key.
  const [groupPhotos, setGroupPhotos] = useState<Record<string, string>>({});
  const groupPhotosRef = useRef<Record<string, string>>({});
  const [typingPeople, setTypingPeople] = useState<Record<string, Record<number, number>>>({});
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [serverUnread, setServerUnread] = useState(0);
  // Unread messages in conversations not loaded into the list yet.
  const [unreadElsewhere, setUnreadElsewhere] = useState(0);
  const [listPaging, setListPaging] = useState({ hasMore: false, loadingMore: false });
  const pagingRef = useRef<{ next: string | null; loading: boolean }>({ next: null, loading: false });
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
    new Map<
      string,
      SendInput & {
        uploaded?: UploadedAttachment[];
        localUrls: (string | undefined)[];
        replyPreview: ChatMessage["replyPreview"];
      }
    >(),
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

  /**
   * Lock group details with a key version. `fresh`: new details from an admin,
   * sent with their fingerprint; otherwise the same details re-locked.
   */
  const encryptGroupInfo = useCallback(
    async (conversationId: string, version: number, key: Uint8Array, value: GroupInfo, fresh = false) => {
      const sealed = value.sealed ?? { v: 1, name: value.name, description: value.description, photo: value.photo };
      const encrypted = await encryptJson(sealed, key, groupInfoAssociatedData(conversationId, version));
      return { key_version: version, ...encrypted, ...(fresh ? { digest: await groupInfoDigest(sealed) } : {}) };
    },
    [],
  );

  /** Make a new key version for everyone currently in the conversation. */
  const rotateKey = useCallback(
    async (conversationId: string): Promise<{ version: number; key: Uint8Array }> => {
      const fresh = await api.getConversation(conversationId);
      setRawConversations((list) => list.map((c) => (c.id === fresh.id ? fresh : c)));
      // Pending group members have no chat key yet: they are added when they join.
      const members = fresh.participants.filter((p) => !p.left && !p.pending);
      if (members.some((m) => !m.public_key || !m.key_id)) {
        throw new Error("Someone in this chat has not set up secure chat.");
      }
      const key = await newSymmetricKey();
      const version = fresh.latest_key_version + 1;
      try {
        // A group's details move to the new key too, so later members can read them.
        const current = groupInfosRef.current[conversationId];
        const info = fresh.kind === "group" && current ? await encryptGroupInfo(conversationId, version, key, current) : null;
        await api.addKeyVersion(conversationId, version, await wrapForMembers(key, members), info);
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
    [conversationKeys, encryptGroupInfo, wrapForMembers],
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

  /** Open each person's encrypted emoji; ones that do not open are left out. */
  const decryptReactions = useCallback(
    async (conversationId: string, messageId: string, rows: RawReaction[]): Promise<MessageReaction[]> => {
      if (!rows.length) return [];
      let map = await conversationKeys(conversationId);
      if (rows.some((row) => !map.has(row.key_version))) map = await conversationKeys(conversationId, true);
      const out: MessageReaction[] = [];
      for (const row of rows) {
        const key = map.get(row.key_version);
        if (!key) continue;
        try {
          const payload = await decryptJson<ReactionPayload>(
            row.ciphertext,
            row.nonce,
            key,
            reactionAssociatedData(conversationId, messageId, row.user_id, row.key_version),
          );
          if (typeof payload.emoji === "string" && payload.emoji.length <= 32) {
            out.push({ userId: row.user_id, emoji: payload.emoji });
          }
        } catch {
          // Tampered with or made with a key this browser no longer has.
        }
      }
      return out;
    },
    [conversationKeys],
  );

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
        reactions: [],
        replyPreview: null,
        forwarded: 0,
        linkPreview: null,
      };
      if (raw.deleted || raw.kind === "system" || !raw.ciphertext || !raw.nonce || raw.key_version == null) {
        return base;
      }
      try {
        const map = await conversationKeys(raw.conversation_id);
        let key = map.get(raw.key_version);
        if (!key) key = (await conversationKeys(raw.conversation_id, true)).get(raw.key_version);
        if (!key) return { ...base, state: "unreadable" };
        const payload = await decryptJson<unknown>(
          raw.ciphertext,
          raw.nonce,
          key,
          associatedData(raw.conversation_id, raw.id, raw.sender_id ?? 0, raw.key_version, raw.revision),
        );
        // Anything the portal would not have sent makes the whole message unavailable.
        const contents = parseMessagePayload(payload);
        if (!contents) return { ...base, state: "unreadable" };
        const thumbs = new Map(raw.attachments.map((a) => [a.id, a.has_thumb]));
        return {
          ...base,
          text: contents.text,
          replyTo: contents.replyTo,
          replyPreview: contents.replyPreview,
          reactions: await decryptReactions(raw.conversation_id, raw.id, raw.reactions ?? []),
          linkPreview: contents.linkPreview,
          forwarded: contents.forwarded,
          // Files the server has no record of (never uploaded, or cleaned up) cannot be shown.
          attachments: contents.attachments
            .filter((a) => thumbs.has(a.id))
            .map((a) => ({ ...a, has_thumb: Boolean(thumbs.get(a.id) && a.thumb_key) })),
        };
      } catch {
        return { ...base, state: "unreadable" };
      }
    },
    [conversationKeys, decryptReactions],
  );

  const relocking = useRef(new Set<string>());
  const relockGroupInfo = useCallback(
    async (conversationId: string, version: number, info: GroupInfo) => {
      const job = `${conversationId}:${version}`;
      if (relocking.current.has(job)) return;
      relocking.current.add(job);
      try {
        let map = await conversationKeys(conversationId);
        if (!map.has(version)) map = await conversationKeys(conversationId, true);
        const key = map.get(version);
        if (!key) return;
        const sealed = info.sealed ?? { v: 1, name: info.name, description: info.description, photo: info.photo };
        const encrypted = await encryptJson(sealed, key, groupInfoAssociatedData(conversationId, version));
        await api.updateGroupInfo(conversationId, { info: { key_version: version, ...encrypted }, changed: [] });
      } catch {
        // Another member may have done it first, or a newer key appeared; the next load tries again.
      } finally {
        relocking.current.delete(job);
      }
    },
    [conversationKeys],
  );

  /** Open a group's encrypted details, and its photo if it has one. */
  const loadGroupInfo = useCallback(
    async (conversation: RawConversation) => {
      const raw = conversation.info;
      if (!raw) {
        rememberGroupInfo(conversation.id, null);
        return;
      }
      let info: GroupInfo | null = null;
      try {
        let map = await conversationKeys(conversation.id);
        if (!map.has(raw.key_version)) map = await conversationKeys(conversation.id, true);
        const key = map.get(raw.key_version);
        if (key) {
          const value = await decryptJson<Record<string, unknown>>(
            raw.ciphertext,
            raw.nonce,
            key,
            groupInfoAssociatedData(conversation.id, raw.key_version),
          );
          // Only details an admin set: a member re-locking them with a new key cannot change them.
          const genuine = !raw.digest || (await groupInfoDigest(value)) === raw.digest;
          const photo = value.photo as { file_key?: unknown } | null | undefined;
          if (genuine && value && typeof value === "object") {
            info = {
              name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 80) : "Group",
              description: typeof value.description === "string" ? value.description.slice(0, 500) : "",
              photo: photo && typeof photo.file_key === "string" ? { file_key: photo.file_key } : null,
              sealed: value,
            };
          }
        }
      } catch {
        info = null;
      }
      if (info) rememberGroupInfo(conversation.id, info);
      else if (!(conversation.id in groupInfosRef.current)) rememberGroupInfo(conversation.id, null);
      // Details still locked with an older key (someone who could not read them made the newest
      // key, for example a member who just joined): re-lock them with the newest key, so everyone
      // in the group, including new members, can read them.
      if (info && raw.key_version < conversation.latest_key_version) {
        void relockGroupInfo(conversation.id, conversation.latest_key_version, info);
      }
      const fileKey = info?.photo?.file_key;
      if (fileKey && conversation.has_photo && !groupPhotosRef.current[fileKey]) {
        groupPhotosRef.current[fileKey] = "loading";
        try {
          const response = await fetch(await api.groupPhotoUrl(conversation.id));
          if (!response.ok) throw new Error("Download failed.");
          const plain = await decryptFile(await response.arrayBuffer(), fileKey);
          const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: "image/jpeg" }));
          groupPhotosRef.current[fileKey] = url;
          setGroupPhotos((p) => ({ ...p, [fileKey]: url }));
        } catch {
          delete groupPhotosRef.current[fileKey];
        }
      }
    },
    [conversationKeys, rememberGroupInfo, relockGroupInfo],
  );

  const updatePreview = useCallback(
    async (conversation: RawConversation) => {
      if (conversation.kind === "group") void loadGroupInfo(conversation);
      const message = conversation.last_message ? await decrypt(conversation.last_message) : null;
      setPreviews((current) => ({ ...current, [conversation.id]: message }));
      const last = conversation.last_reaction;
      const [reaction] = last ? await decryptReactions(conversation.id, last.message.id, [last]) : [];
      const target = last && reaction ? await decrypt(last.message) : null;
      setReactionPreviews((current) => {
        const next = { ...current };
        if (last && reaction && target) next[conversation.id] = { ...reaction, target, at: last.updated_at };
        else delete next[conversation.id];
        return next;
      });
    },
    [decrypt, decryptReactions, loadGroupInfo],
  );

  // --- Loading ------------------------------------------------------------

  /** Reload the list from the top, keeping as many conversations as are loaded now (up to 100). */
  const refreshConversations = useCallback(async () => {
    const loaded = conversationsRef.current.length;
    const page = await api.listConversations({ limit: Math.min(100, Math.max(api.CONVERSATION_PAGE_SIZE, loaded)) });
    setRawConversations(page.results);
    pagingRef.current.next = page.next;
    setListPaging((p) => ({ ...p, hasMore: page.has_more }));
    setUnreadElsewhere(Math.max(0, page.unread_total - unreadIn(page.results)));
    await Promise.all(page.results.map(updatePreview));
  }, [updatePreview]);

  /** Load the next page of older conversations. */
  const loadMoreConversations = useCallback(async () => {
    const cursor = pagingRef.current.next;
    if (pagingRef.current.loading || !cursor) return;
    pagingRef.current.loading = true;
    setListPaging((p) => ({ ...p, loadingMore: true }));
    try {
      const page = await api.listConversations({ before: cursor });
      const known = new Set(conversationsRef.current.map((c) => c.id));
      const added = page.results.filter((c) => !known.has(c.id));
      setRawConversations((list) => {
        const ids = new Set(list.map((c) => c.id));
        return [...list, ...page.results.filter((c) => !ids.has(c.id))];
      });
      pagingRef.current.next = page.next;
      setListPaging({ hasMore: page.has_more, loadingMore: false });
      setUnreadElsewhere((u) => Math.max(0, u - unreadIn(added)));
      await Promise.all(added.map(updatePreview));
    } catch {
      setListPaging((p) => ({ ...p, loadingMore: false }));
    } finally {
      pagingRef.current.loading = false;
    }
  }, [updatePreview]);

  const ensureConversation = useCallback(
    async (conversationId: string) => {
      if (conversationsRef.current.some((c) => c.id === conversationId)) return true;
      try {
        const conversation = await api.getConversation(conversationId);
        setRawConversations((list) =>
          list.some((c) => c.id === conversation.id) ? list : sortConversations([...list, conversation]),
        );
        // Its unread messages were counted "elsewhere"; they are in the list now.
        setUnreadElsewhere((u) => Math.max(0, u - conversation.unread_count));
        void updatePreview(conversation);
        return true;
      } catch {
        return false;
      }
    },
    [updatePreview],
  );

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
      let after = Math.max(0, ...thread.messages.filter((m) => m.state === "sent" || m.state === "unreadable").map((m) => m.seq));
      try {
        // Page through everything that arrived while the connection was down.
        let caughtUp = false;
        for (let pages = 0; pages < CATCH_UP_PAGES; pages += 1) {
          const page = await api.getMessages(conversationId, { after_seq: after, limit: 100 });
          upsertMessages(setThreads, conversationId, await Promise.all(page.results.map(decrypt)));
          if (!page.has_more || page.results.length === 0) {
            caughtUp = true;
            break;
          }
          after = page.results[page.results.length - 1].seq;
        }
        if (!caughtUp) {
          // Too far behind to fill the gap: start this thread again from the newest
          // messages (older ones load on scroll), keeping anything still sending.
          const latest = await api.getMessages(conversationId, { limit: 50 });
          const decrypted = await Promise.all(latest.results.map(decrypt));
          setThreads((t) => {
            const unsent = (t[conversationId]?.messages ?? []).filter((m) => m.state === "sending" || m.state === "failed");
            return {
              ...t,
              [conversationId]: { messages: [...decrypted, ...unsent].sort(bySeq), hasMore: latest.has_more, loading: false, loaded: true },
            };
          });
        }
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
    pagingRef.current = { next: null, loading: false };
    setListPaging({ hasMore: false, loadingMore: false });
    setUnreadElsewhere(0);
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

  /** Drop a conversation you are no longer in (left, or removed from a group). */
  const forgetConversation = useCallback((conversationId: string) => {
    setRawConversations((list) => list.filter((c) => c.id !== conversationId));
    setThreads((t) => {
      const next = { ...t };
      delete next[conversationId];
      return next;
    });
    keysRef.current.delete(conversationId);
    setDrawer((d) => (d.conversationId === conversationId ? { ...d, conversationId: null } : d));
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
          // Someone who was pending just joined a group: make the key that includes them now
          // (with the details re-locked), so they can read the name and photo straight away.
          if (raw.system_event === "member_joined" && Number(raw.system_data?.user_id) !== userId) {
            void rotateKey(raw.conversation_id).catch(() => undefined);
          }
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
                        // A hidden chat comes back with its next message.
                        hidden: false,
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
          // An edit changes the text only; reactions stay.
          upsertMessages(setThreads, conversationId, [{ ...message, reactions: existing.reactions }]);
          setPreviews((p) => (p[conversationId]?.id === message.id ? { ...p, [conversationId]: message } : p));
          return;
        }
        case "message.deleted": {
          setThreads((t) => mapMessage(t, conversationId, String(data.message_id), (m) => ({
            ...m,
            deleted: true,
            text: "",
            attachments: [],
            reactions: [],
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
            // A group's details may now be on an older key than the newest: reload (and re-lock) them.
            if (fresh.kind === "group") void updatePreview(fresh);
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
        case "reaction.updated": {
          const messageId = String(data.message_id ?? "");
          const row = data.reaction as RawReaction | undefined;
          const removedUserId = data.removed_user_id != null ? Number(data.removed_user_id) : null;
          const [decoded] = row ? await decryptReactions(conversationId, messageId, [row]) : [];
          const who = removedUserId ?? row?.user_id;
          setThreads((t) =>
            mapMessage(t, conversationId, messageId, (m) => ({
              ...m,
              reactions: [...m.reactions.filter((r) => r.userId !== who), ...(decoded ? [decoded] : [])],
            })),
          );
          if (decoded && row && data.message) {
            const target = await decrypt(data.message as RawMessage);
            setReactionPreviews((p) => ({ ...p, [conversationId]: { ...decoded, target, at: row.updated_at } }));
          } else if (removedUserId != null) {
            setReactionPreviews((p) => {
              const current = p[conversationId];
              if (!current || current.userId !== removedUserId || current.target.id !== messageId) return p;
              const next = { ...p };
              delete next[conversationId];
              return next;
            });
          }
          return;
        }
        case "typing": {
          const typist = Number(data.user_id);
          if (typist === userId) return;
          const until = Date.now() + 4000;
          setTyping((t) => ({ ...t, [conversationId]: until }));
          setTypingPeople((t) => ({ ...t, [conversationId]: { ...(t[conversationId] ?? {}), [typist]: until } }));
          return;
        }
        case "conversation.updated": {
          // Members, roles or group details changed.
          try {
            const fresh = await api.getConversation(conversationId);
            setRawConversations((list) =>
              list.some((c) => c.id === fresh.id) ? list.map((c) => (c.id === fresh.id ? fresh : c)) : list,
            );
            void updatePreview(fresh);
          } catch {
            // Picked up on the next refresh.
          }
          return;
        }
        case "conversation.removed":
          forgetConversation(conversationId);
          return;
        default:
          return;
      }
    },
    [decrypt, decryptReactions, forgetConversation, refreshConversations, rotateKey, updatePreview, userId],
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

  // Tell the service worker where the API is, so it can decrypt notification previews.
  useEffect(() => {
    if (status === "ready") void writePushConfig({ apiBase: getApiBaseUrl() });
  }, [status]);

  // A new profile picture shows in chat straight away (yours, in every chat you are in).
  useEffect(() => {
    if (status !== "ready") return;
    const onProfileChange = () => void refreshConversations().catch(() => undefined);
    window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChange);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChange);
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
      setTypingPeople((t) => {
        const next: Record<string, Record<number, number>> = {};
        for (const [conversation, people] of Object.entries(t)) {
          const still = Object.fromEntries(Object.entries(people).filter(([, until]) => until > now));
          if (Object.keys(still).length) next[conversation] = still;
        }
        return next;
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

  const self = useCallback((): Participant => {
    const me = accountRef.current!;
    return {
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
  }, [userId]);

  const replaceConversation = useCallback(
    (conversation: RawConversation) => {
      setRawConversations((list) => sortConversations([conversation, ...list.filter((c) => c.id !== conversation.id)]));
      void updatePreview(conversation);
    },
    [updatePreview],
  );

  /** Encrypt and upload a group photo; returns where it is stored and its key. */
  const uploadGroupPhoto = useCallback(async (conversationId: string, photo: File) => {
    const encrypted = await encryptFile(await photo.arrayBuffer());
    const reserved = await api.reserveGroupPhoto(conversationId, encrypted.bytes.length);
    const response = await fetch(reserved.upload_url, {
      method: "PUT",
      headers: { "Content-Type": reserved.content_type },
      body: encrypted.bytes as BlobPart,
    });
    if (!response.ok) throw new Error("The photo could not be uploaded.");
    const url = URL.createObjectURL(photo);
    groupPhotosRef.current[encrypted.key] = url;
    setGroupPhotos((p) => ({ ...p, [encrypted.key]: url }));
    return { objectKey: reserved.object_key, fileKey: encrypted.key };
  }, []);

  const updateGroup = useCallback(
    async (conversationId: string, change: { name?: string; description?: string; photo?: File | null }) => {
      const current = groupInfosRef.current[conversationId] ?? { name: "Group", description: "", photo: null };
      const next: GroupInfo = {
        name: change.name?.trim() || current.name,
        description: change.description !== undefined ? change.description.trim() : current.description,
        photo: current.photo,
      };
      const changed: ("name" | "description" | "photo")[] = [];
      if (next.name !== current.name) changed.push("name");
      if (next.description !== current.description) changed.push("description");
      let photoObjectKey: string | null | undefined;
      if (change.photo !== undefined) {
        changed.push("photo");
        if (change.photo) {
          const uploaded = await uploadGroupPhoto(conversationId, change.photo);
          next.photo = { file_key: uploaded.fileKey };
          photoObjectKey = uploaded.objectKey;
        } else {
          next.photo = null;
          photoObjectKey = null;
        }
      }
      if (!changed.length) return;
      const { version, key } = await currentKey(conversationId);
      const sealedNext = await sealGroupInfo(next);
      const info = await encryptGroupInfo(conversationId, version, key, sealedNext, true);
      const fresh = await api.updateGroupInfo(conversationId, {
        info,
        changed,
        ...(photoObjectKey !== undefined ? { photo_object_key: photoObjectKey } : {}),
      });
      rememberGroupInfo(conversationId, sealedNext);
      replaceConversation(fresh);
    },
    [currentKey, encryptGroupInfo, rememberGroupInfo, replaceConversation, uploadGroupPhoto],
  );

  const createGroup = useCallback(
    async (input: { name: string; description: string; people: api.ChatPerson[]; photo?: File | null }) => {
      if (!input.name.trim()) throw new Error("Give the group a name.");
      // The id is made here, like message ids, so the encrypted details can be bound to it.
      const id = newId();
      const key = await newSymmetricKey();
      const ready = input.people.filter((p) => p.chat_ready && p.public_key && p.key_id);
      const keys = await wrapForMembers(key, [self(), ...ready.map((p) => ({ ...p, last_read_seq: 0, left: false }))]);
      const value = await sealGroupInfo({ name: input.name.trim(), description: input.description.trim(), photo: null });
      const created = await api.createGroup({
        id,
        member_ids: input.people.map((p) => p.id),
        keys,
        info: await encryptGroupInfo(id, 1, key, value, true),
      });
      keysRef.current.set(created.id, new Map([[1, key]]));
      rememberGroupInfo(created.id, value);
      replaceConversation(created);
      if (input.photo) {
        try {
          await updateGroup(created.id, { photo: input.photo });
        } catch {
          // The group exists; the photo can be added from the group info.
        }
      }
      return created.id;
    },
    [encryptGroupInfo, rememberGroupInfo, replaceConversation, self, updateGroup, wrapForMembers],
  );

  const addGroupMembers = useCallback(
    async (conversationId: string, people: api.ChatPerson[]) => {
      const fresh = await api.getConversation(conversationId);
      const version = fresh.latest_key_version + 1;
      const key = await newSymmetricKey();
      const current = fresh.participants.filter((p) => !p.left && !p.pending);
      const ready = people.filter((p) => p.chat_ready && p.public_key && p.key_id);
      const keys = await wrapForMembers(key, [...current, ...ready.map((p) => ({ ...p, last_read_seq: 0, left: false }))]);
      const value = groupInfosRef.current[conversationId];
      const info = value ? await encryptGroupInfo(conversationId, version, key, value) : null;
      const updated = await api.addGroupMembers(conversationId, {
        member_ids: people.map((p) => p.id),
        version,
        keys,
        info,
      });
      const map = keysRef.current.get(conversationId) ?? new Map<number, Uint8Array>();
      map.set(version, key);
      keysRef.current.set(conversationId, map);
      replaceConversation(updated);
    },
    [encryptGroupInfo, replaceConversation, wrapForMembers],
  );

  const removeGroupMember = useCallback(
    async (conversationId: string, memberId: number) => {
      await api.removeGroupMember(conversationId, memberId);
      if (memberId === userId) {
        forgetConversation(conversationId);
        return;
      }
      replaceConversation(await api.getConversation(conversationId));
    },
    [forgetConversation, replaceConversation, userId],
  );

  const leaveGroup = useCallback(
    (conversationId: string) => removeGroupMember(conversationId, userId),
    [removeGroupMember, userId],
  );

  const setGroupAdmin = useCallback(
    async (conversationId: string, memberId: number, admin: boolean) => {
      await api.setGroupAdmin(conversationId, memberId, admin);
      replaceConversation(await api.getConversation(conversationId));
    },
    [replaceConversation],
  );

  const transferOwnership = useCallback(
    async (conversationId: string, memberId: number) => {
      await api.transferGroupOwner(conversationId, memberId);
      replaceConversation(await api.getConversation(conversationId));
    },
    [replaceConversation],
  );

  const changeSettings = useCallback(
    async (conversationId: string, input: Parameters<typeof api.updateConversation>[1]) => {
      const fresh = await api.updateConversation(conversationId, input);
      setRawConversations((list) => list.map((c) => (c.id === fresh.id ? fresh : c)));
    },
    [],
  );
  const muteConversation = useCallback(
    (conversationId: string, until: Date | null) =>
      changeSettings(conversationId, { muted_until: until ? until.toISOString() : null }),
    [changeSettings],
  );
  const archiveConversation = useCallback(
    (conversationId: string, archived: boolean) => changeSettings(conversationId, { archived }),
    [changeSettings],
  );
  const hideConversation = useCallback(
    (conversationId: string, hidden: boolean) => changeSettings(conversationId, { hidden }),
    [changeSettings],
  );

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
            const extra = pending.voice
              ? { voice: true, duration: pending.voice.duration, waveform: pending.voice.waveform }
              : undefined;
            pending.uploaded.push(await uploadEncrypted(conversationId, file, extra));
          }
        }
        const payload: Payload = {
          v: 1,
          text: pending.text,
          reply_to: pending.replyTo,
          reply_preview: pending.replyPreview
            ? { sender_id: pending.replyPreview.senderId, text: pending.replyPreview.text }
            : null,
          attachments: pending.uploaded,
          ...(pending.forwarded ? { forwarded: pending.forwarded } : {}),
          ...(pending.linkPreview ? { link_preview: pending.linkPreview } : {}),
        };
        const kind = pending.voice ? "voice" : pending.uploaded.length ? "attachment" : "text";
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
          replyPreview: pending.replyPreview,
          linkPreview: pending.linkPreview ?? null,
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
      // Instant previews of your own new photos, videos and recordings (a forward has none: nothing new was picked).
      const localUrls = input.prepared
        ? []
        : input.voice
        ? [input.voice.url ?? safeObjectUrl(input.files[0], input.files[0].type)]
        : // Your own files open and save straight away, without downloading them back.
          input.files.map((f) => safeObjectUrl(f, f.type));
      const quoted = input.replyTo
        ? threadsRef.current[conversationId]?.messages.find((m) => m.id === input.replyTo)
        : undefined;
      const replyPreview = quoted ? { senderId: quoted.senderId, text: shorten(messageSummary(quoted), 200) } : null;
      pendingSends.current.set(id, { ...input, localUrls, replyPreview, uploaded: input.prepared });
      const optimistic: ChatMessage = {
        id,
        conversationId,
        senderId: userId,
        seq: Number.MAX_SAFE_INTEGER,
        kind: input.voice ? "voice" : input.files.length || input.prepared?.length ? "attachment" : "text",
        keyVersion: null,
        revision: 0,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
        text: input.text,
        replyTo: input.replyTo,
        attachments: input.prepared
          ? input.prepared.map((a) => ({ ...a, has_thumb: Boolean(a.thumb_key) }))
          : input.files.map((f, index) => ({
          id: `local-${index}-${f.name}-${f.size}`,
          name: f.name,
          mime: f.type || "application/octet-stream",
          size: f.size,
          file_key: "",
          has_thumb: false,
          localUrl: localUrls[index],
          ...(input.voice ? { voice: true, duration: input.voice.duration, waveform: input.voice.waveform } : {}),
        })),
        state: "sending",
        systemEvent: null,
        systemData: {},
        reactions: [],
        replyPreview,
        forwarded: input.forwarded ?? 0,
        linkPreview: input.linkPreview ?? null,
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
        reply_preview: message.replyPreview ? { sender_id: message.replyPreview.senderId, text: message.replyPreview.text } : null,
        ...(message.forwarded ? { forwarded: message.forwarded } : {}),
        // The preview stays while its link is still in the text.
        ...(message.linkPreview && firstLink(text) === message.linkPreview.url ? { link_preview: message.linkPreview } : {}),
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
      const updated: ChatMessage = {
        ...message,
        text,
        revision,
        editedAt: raw.edited_at,
        linkPreview: message.linkPreview && firstLink(text) === message.linkPreview.url ? message.linkPreview : null,
      };
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

  const forward = useCallback(
    async (message: ChatMessage, conversationIds: string[], note: string) => {
      const targets = [...new Set(conversationIds)].slice(0, MAX_FORWARD_TARGETS);
      const failures: string[] = [];
      for (const conversationId of targets) {
        try {
          // Files are copied in storage (still encrypted); their keys go in the new message.
          const prepared: UploadedAttachment[] = [];
          for (const attachment of message.attachments) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { has_thumb, localUrl, ...details } = attachment;
            prepared.push({ ...details, id: await api.forwardAttachment(conversationId, attachment.id) });
          }
          const voice = message.kind === "voice" && prepared[0]
            ? { duration: prepared[0].duration ?? 0, waveform: prepared[0].waveform ?? [] }
            : undefined;
          await send(conversationId, {
            text: message.text,
            files: [],
            replyTo: null,
            prepared,
            voice,
            forwarded: message.forwarded + 1,
            linkPreview: message.linkPreview,
          });
          if (note.trim()) await send(conversationId, { text: note.trim(), files: [], replyTo: null });
        } catch {
          failures.push(conversationId);
        }
      }
      if (failures.length) {
        throw new Error(
          failures.length === targets.length
            ? "The message could not be forwarded."
            : `The message was forwarded, but not to ${failures.length} of the chats.`,
        );
      }
    },
    [send],
  );

  const react = useCallback(
    async (message: ChatMessage, emoji: string | null) => {
      const conversationId = message.conversationId;
      const current = threadsRef.current[conversationId]?.messages.find((m) => m.id === message.id) ?? message;
      const mine = current.reactions.find((r) => r.userId === userId);
      const next = emoji && mine?.emoji !== emoji ? emoji : null; // the same emoji again removes it
      const before = current.reactions;
      const apply = (reactions: MessageReaction[]) =>
        setThreads((t) => mapMessage(t, conversationId, message.id, (m) => ({ ...m, reactions })));
      apply([...before.filter((r) => r.userId !== userId), ...(next ? [{ userId, emoji: next }] : [])]);
      try {
        if (!next) {
          if (mine) await api.removeReaction(message.id);
          return;
        }
        const attempt = async (version: number, key: Uint8Array) => {
          const encrypted = await encryptJson(
            { v: 1, emoji: next } satisfies ReactionPayload,
            key,
            reactionAssociatedData(conversationId, message.id, userId, version),
          );
          return api.setReaction(message.id, { key_version: version, ...encrypted });
        };
        let { version, key } = await currentKey(conversationId);
        try {
          await attempt(version, key);
        } catch (error) {
          if (errorType(error) !== "key_outdated") throw error;
          ({ version, key } = await rotateKey(conversationId));
          await attempt(version, key);
        }
      } catch (error) {
        apply(before);
        throw error;
      }
    },
    [currentKey, rotateKey, userId],
  );

  const findMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      const has = () => Boolean(threadsRef.current[conversationId]?.messages.some((m) => m.id === messageId));
      // Wait for a page that is loading to reach the thread state.
      const settle = async () => {
        for (let i = 0; i < 100 && threadsRef.current[conversationId]?.loading; i += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
      };
      for (let page = 0; page < JUMP_PAGES; page += 1) {
        await settle();
        if (has()) return true;
        if (!threadsRef.current[conversationId]?.hasMore) return false;
        await loadThread(conversationId, true);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      await settle();
      return has();
    },
    [loadThread],
  );

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
      rawConversations.map((c) => {
        const isGroup = c.kind === "group";
        const other = isGroup ? null : (c.participants.find((p) => p.id !== userId) ?? null);
        const group = isGroup ? (groupInfos[c.id] ?? null) : null;
        const photoKey = group?.photo?.file_key;
        const groupPhoto = photoKey ? groupPhotos[photoKey] : undefined;
        return {
        ...c,
        other,
        isGroup,
        group,
        title: isGroup ? (group?.name ?? "Group") : (other?.name ?? "Conversation"),
        photoUrl: isGroup ? (groupPhoto && groupPhoto !== "loading" ? groupPhoto : null) : (other?.avatar_url ?? null),
        members: c.participants.filter((p) => !p.left),
        isAdmin: c.role === "admin" || c.role === "owner",
        isOwner: c.role === "owner",
        isMuted: Boolean(c.muted_until && new Date(c.muted_until).getTime() > Date.now()),
        preview: (() => {
          // A reaction newer than the last message is what the list shows.
          const reaction = reactionPreviews[c.id];
          const lastAt = c.last_message?.created_at ?? c.last_message_at;
          if (reaction && (!lastAt || new Date(reaction.at).getTime() > new Date(lastAt).getTime())) {
            return reactionPreviewText(reaction, c, userId);
          }
          return previewOf(previews[c.id] ?? null, userId, c);
        })(),
        };
      }),
    [groupInfos, groupPhotos, previews, rawConversations, reactionPreviews, userId],
  );

  // Muted chats do not count towards the sidebar badge (their own row still shows it).
  const unreadTotal =
    status === "ready"
      ? rawConversations.reduce(
          (sum, c) => (c.muted_until && new Date(c.muted_until).getTime() > Date.now() ? sum : sum + c.unread_count),
          0,
        ) + unreadElsewhere
      : serverUnread;

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
    conversationsHaveMore: listPaging.hasMore,
    loadingMoreConversations: listPaging.loadingMore,
    loadMoreConversations,
    ensureConversation,
    openWith,
    invite,
    loadThread,
    send,
    retry,
    edit,
    deleteForEveryone,
    deleteForMe,
    markSeen,
    react,
    forward,
    createGroup,
    updateGroup,
    addGroupMembers,
    removeGroupMember,
    leaveGroup,
    setGroupAdmin,
    transferOwnership,
    muteConversation,
    archiveConversation,
    hideConversation,
    typingPeople: Object.fromEntries(Object.entries(typingPeople).map(([c, people]) => [c, Object.keys(people).map(Number)])),
    findMessage,
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

function unreadIn(list: RawConversation[]) {
  return list.reduce((sum, c) => sum + c.unread_count, 0);
}

/** Most recent activity first; ties broken by id, the same order as the server's pages. */
function sortConversations(list: RawConversation[]) {
  return [...list].sort(
    (a, b) =>
      new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime() ||
      b.id.localeCompare(a.id),
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
