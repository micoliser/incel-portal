import { apiClient } from "@/lib/api-client";
import type { KeyBackup, PinBackup } from "@/lib/chat/crypto";

export type ChatAccount = {
  key_id: string;
  public_key: string;
  pin: PinBackup;
  recovery: KeyBackup;
  created_at: string;
  updated_at: string;
};

export type ChatPerson = {
  id: number;
  name: string;
  email: string;
  department: string | null;
  is_active: boolean;
  chat_ready: boolean;
  key_id: string | null;
  public_key: string | null;
  last_seen_at: string | null;
  online?: boolean;
  /** Profile picture, or null to show initials. */
  avatar_url?: string | null;
};

export type Participant = ChatPerson & {
  last_read_seq: number;
  left: boolean;
  role?: GroupRole;
  /** Added to a group before setting up chat; joins when they do. */
  pending?: boolean;
  joined_at?: string;
};

/** In a group: the owner (creator, cannot be removed), admins, members. */
export type GroupRole = "member" | "admin" | "owner";

/** Group name, description and photo key, encrypted with a conversation key version. */
export type RawGroupInfo = {
  key_version: number;
  nonce: string;
  ciphertext: string;
  /** Fingerprint of the details, set by admins (see groupInfoDigest). */
  digest?: string | null;
};

export type RawAttachment = { id: string; size: number | null; has_thumb: boolean };

export type RawMessage = {
  id: string;
  conversation_id: string;
  sender_id: number | null;
  seq: number;
  kind: "text" | "attachment" | "voice" | "system";
  key_version: number | null;
  nonce: string | null;
  ciphertext: string | null;
  revision: number;
  system_event: string | null;
  system_data: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  deleted_at: string | null;
  attachments: RawAttachment[];
  /** Encrypted emoji, one per person. */
  reactions?: RawReaction[];
};

export type RawReaction = {
  user_id: number;
  key_version: number;
  nonce: string;
  ciphertext: string;
  updated_at: string;
};

export type RawConversation = {
  id: string;
  kind: "direct" | "group";
  created_at: string;
  last_message_at: string | null;
  latest_key_version: number;
  unread_count: number;
  last_message: RawMessage | null;
  muted_until: string | null;
  /** Hidden from your list until a newer message arrives (it can still be opened). */
  hidden?: boolean;
  archived: boolean;
  last_read_seq: number;
  participants: Participant[];
  /** Your role (groups). */
  role?: GroupRole;
  /** Groups only: the encrypted details. */
  info?: RawGroupInfo | null;
  has_photo?: boolean;
  created_by_id?: number | null;
  /** The newest reaction and its message, for the list preview. */
  last_reaction?: (RawReaction & { message: RawMessage }) | null;
};

export type RawKey = {
  version: number;
  recipient_key_id: string;
  wrapped_by_id: number | null;
  wrapper_public_key: string;
  wrapped_key: string;
  nonce: string;
};

export type WrappedKeyInput = {
  recipient_id: number;
  recipient_key_id: string;
  wrapped_key: string;
  nonce: string;
};

export type AccountSetupInput = { public_key: string; pin: PinBackup; recovery: KeyBackup };

export async function getAccount() {
  const { data } = await apiClient.get<{ set_up: boolean; account: ChatAccount | null }>("/chat/account");
  return data;
}

export async function createAccount(input: AccountSetupInput) {
  const { data } = await apiClient.post<{ account: ChatAccount }>("/chat/account", input);
  return data.account;
}

export async function updateBackups(input: { pin?: PinBackup; recovery?: KeyBackup }) {
  const { data } = await apiClient.patch<{ account: ChatAccount }>("/chat/account", input);
  return data.account;
}

/** Starting over needs the code emailed by sendResetCode. */
export async function resetAccount(input: AccountSetupInput & { code: string }) {
  const { data } = await apiClient.post<{ account: ChatAccount }>("/chat/account/reset", input);
  return data.account;
}

/** Emails an 8-character code that confirms a chat reset. 409 if one was sent under a minute ago. */
export async function sendResetCode() {
  const { data } = await apiClient.post<{ sent_to: string; expires_in: number }>("/chat/account/reset/code");
  return data;
}

/** 204 when the code is right (it stays valid for the reset itself); 400 otherwise. */
export async function checkResetCode(code: string) {
  await apiClient.post("/chat/account/reset/code/check", { code });
}

/** 204 when it is the user's portal password; 400 otherwise. */
export async function checkPassword(password: string) {
  await apiClient.post("/chat/account/check-password", { password });
}

export async function getTicket() {
  const { data } = await apiClient.post<{ ticket: string }>("/chat/ws-ticket");
  return data.ticket;
}

export async function searchPeople(search: string) {
  const { data } = await apiClient.get<{ results: ChatPerson[] }>("/chat/people", { params: { search } });
  return data.results;
}

/** Invite someone who has not set up chat; returns the waiting conversation. Again = a reminder (once a day). */
export async function invitePerson(userId: number) {
  const { data } = await apiClient.post<RawConversation>(`/chat/people/${userId}/invite`);
  return data;
}

export async function getUnreadCount() {
  const { data } = await apiClient.get<{ unread_count: number }>("/chat/unread-count");
  return data.unread_count;
}

/** One page of conversations, most recent activity first. `next` is where the following page starts. */
export type ConversationPage = {
  results: RawConversation[];
  has_more: boolean;
  next: string | null;
  /** Unread messages across every conversation, including ones not on this page. */
  unread_total: number;
};

export const CONVERSATION_PAGE_SIZE = 30;

export async function listConversations(params: { before?: string | null; limit?: number } = {}) {
  const { data } = await apiClient.get<ConversationPage>("/chat/conversations", {
    params: { limit: params.limit ?? CONVERSATION_PAGE_SIZE, ...(params.before ? { before: params.before } : {}) },
  });
  return data;
}

export async function getConversation(id: string) {
  const { data } = await apiClient.get<RawConversation>(`/chat/conversations/${id}`);
  return data;
}

export async function startConversation(userId: number, keys: WrappedKeyInput[]) {
  const { data } = await apiClient.post<RawConversation>("/chat/conversations", { user_id: userId, keys });
  return data;
}

/** Your own settings for a chat: mute until a time (null to unmute), archive, or hide until a new message. */
export async function updateConversation(
  id: string,
  input: { muted_until?: string | null; archived?: boolean; hidden?: boolean },
) {
  const { data } = await apiClient.patch<RawConversation>(`/chat/conversations/${id}`, input);
  return data;
}

export async function getKeys(conversationId: string) {
  const { data } = await apiClient.get<{ results: RawKey[] }>(`/chat/conversations/${conversationId}/keys`);
  return data.results;
}

/** `info`: for a group, its details re-encrypted with the new version. */
export async function addKeyVersion(
  conversationId: string,
  version: number,
  keys: WrappedKeyInput[],
  info?: RawGroupInfo | null,
) {
  await apiClient.post(`/chat/conversations/${conversationId}/keys`, { version, keys, ...(info ? { info } : {}) });
}

export async function getMessages(
  conversationId: string,
  params: { before_seq?: number; after_seq?: number; limit?: number },
) {
  const { data } = await apiClient.get<{ results: RawMessage[]; has_more: boolean }>(
    `/chat/conversations/${conversationId}/messages`,
    { params },
  );
  return data;
}

export async function postMessage(
  conversationId: string,
  input: {
    id: string;
    kind: "text" | "attachment" | "voice";
    key_version: number;
    nonce: string;
    ciphertext: string;
    attachment_ids?: string[];
  },
) {
  const { data } = await apiClient.post<RawMessage>(`/chat/conversations/${conversationId}/messages`, input);
  return data;
}

export async function patchMessage(messageId: string, input: { revision: number; nonce: string; ciphertext: string }) {
  const { data } = await apiClient.patch<RawMessage>(`/chat/messages/${messageId}`, input);
  return data;
}

export async function deleteMessage(messageId: string, scope: "everyone" | "me") {
  await apiClient.delete(`/chat/messages/${messageId}`, { params: { scope } });
}

/** Copy a file you can see into another of your chats (for forwarding). Returns the new, reserved attachment id. */
export async function forwardAttachment(conversationId: string, attachmentId: string) {
  const { data } = await apiClient.post<{ id: string }>(`/chat/conversations/${conversationId}/attachments/forward`, {
    attachment_id: attachmentId,
  });
  return data.id;
}

export async function setReaction(messageId: string, body: { key_version: number; nonce: string; ciphertext: string }) {
  const { data } = await apiClient.put<RawReaction>(`/chat/messages/${messageId}/reaction`, body);
  return data;
}

export async function removeReaction(messageId: string) {
  await apiClient.delete(`/chat/messages/${messageId}/reaction`);
}

export async function markRead(conversationId: string, seq: number) {
  const { data } = await apiClient.post<{ last_read_seq: number }>(`/chat/conversations/${conversationId}/read`, {
    seq,
  });
  return data.last_read_seq;
}

export async function reserveAttachment(conversationId: string, size: number, thumbSize: number | null) {
  const { data } = await apiClient.post<{
    id: string;
    upload_url: string;
    thumb_upload_url: string | null;
    content_type: string;
  }>(`/chat/conversations/${conversationId}/attachments`, { size, thumb_size: thumbSize });
  return data;
}

export async function attachmentUrl(attachmentId: string, part: "file" | "thumb") {
  const { data } = await apiClient.get<{ url: string }>(`/chat/attachments/${attachmentId}/download`, {
    params: { part },
  });
  return data.url;
}


// --- Groups ----------------------------------------------------------------

export async function createGroup(body: { id: string; member_ids: number[]; keys: WrappedKeyInput[]; info: RawGroupInfo }) {
  const { data } = await apiClient.post<RawConversation>("/chat/groups", body);
  return data;
}

export async function updateGroupInfo(
  conversationId: string,
  body: { info: RawGroupInfo; changed: ("name" | "description" | "photo")[]; photo_object_key?: string | null },
) {
  const { data } = await apiClient.patch<RawConversation>(`/chat/conversations/${conversationId}/info`, body);
  return data;
}

export async function reserveGroupPhoto(conversationId: string, size: number) {
  const { data } = await apiClient.post<{ object_key: string; upload_url: string; content_type: string }>(
    `/chat/conversations/${conversationId}/photo`,
    { size },
  );
  return data;
}

export async function groupPhotoUrl(conversationId: string) {
  const { data } = await apiClient.get<{ url: string }>(`/chat/conversations/${conversationId}/photo`);
  return data.url;
}

export async function addGroupMembers(
  conversationId: string,
  body: { member_ids: number[]; version: number; keys: WrappedKeyInput[]; info: RawGroupInfo | null },
) {
  const { data } = await apiClient.post<RawConversation>(`/chat/conversations/${conversationId}/members`, body);
  return data;
}

export async function removeGroupMember(conversationId: string, userId: number) {
  await apiClient.delete(`/chat/conversations/${conversationId}/members/${userId}`);
}

export async function setGroupAdmin(conversationId: string, userId: number, admin: boolean) {
  await apiClient.patch(`/chat/conversations/${conversationId}/members/${userId}`, { admin });
}

/** The owner hands the group over (and becomes an admin). */
export async function transferGroupOwner(conversationId: string, userId: number) {
  await apiClient.post(`/chat/conversations/${conversationId}/owner`, { user_id: userId });
}

/** A preview for a link about to be sent (the server fetches the page and keeps nothing), or null. */
export async function fetchLinkPreview(url: string) {
  const { data } = await apiClient.post<{ preview: unknown }>("/chat/link-preview", { url });
  return data.preview;
}
