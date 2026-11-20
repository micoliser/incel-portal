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
};

export type Participant = ChatPerson & { last_read_seq: number; left: boolean };

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
  archived: boolean;
  last_read_seq: number;
  participants: Participant[];
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

export async function listConversations() {
  const { data } = await apiClient.get<{ results: RawConversation[] }>("/chat/conversations");
  return data.results;
}

export async function getConversation(id: string) {
  const { data } = await apiClient.get<RawConversation>(`/chat/conversations/${id}`);
  return data;
}

export async function startConversation(userId: number, keys: WrappedKeyInput[]) {
  const { data } = await apiClient.post<RawConversation>("/chat/conversations", { user_id: userId, keys });
  return data;
}

export async function updateConversation(id: string, input: { muted_until?: string | null; archived?: boolean }) {
  const { data } = await apiClient.patch<RawConversation>(`/chat/conversations/${id}`, input);
  return data;
}

export async function getKeys(conversationId: string) {
  const { data } = await apiClient.get<{ results: RawKey[] }>(`/chat/conversations/${conversationId}/keys`);
  return data.results;
}

export async function addKeyVersion(conversationId: string, version: number, keys: WrappedKeyInput[]) {
  await apiClient.post(`/chat/conversations/${conversationId}/keys`, { version, keys });
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
