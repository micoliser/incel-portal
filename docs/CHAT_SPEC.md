# Workspace Chat — Specification (draft)

Status: first release built (one-to-one chat). Code: `api/chat/`, `portal/lib/chat/`, `portal/components/chat/`. Where the build differs from the first draft of this document, the text below describes what was built.

## 1. Decisions

| Topic | Decision |
|---|---|
| Who can chat | Every active portal user can message every other active user. |
| Privacy | End-to-end encrypted. Message text and files are encrypted in the sender's browser and decrypted only in participants' browsers. The server, admins and anyone with database, S3 or backup access cannot read them. |
| Retention | Messages are kept forever (for now). |
| Edit | Sender only, within 30 minutes of sending. Shows "edited". |
| Delete for everyone | Sender only, within 30 minutes. Leaves "This message was deleted". |
| Delete for me | Anyone, any time. Hides the message only for that user. |
| Upload limit | 25 MB per file (images, videos, any file). |
| Read receipts | Always on, visible to everyone in the conversation. |
| Where | Full page at `/chat` and a slide-up drawer available on every portal page. |
| Shared computers | The chat key is removed from the browser on sign-out (manual or inactivity). |
| Unlocking | A 6-digit chat PIN, entered on six circles (X Chat style), combined with the portal password. Chosen over a 4-digit PIN, which anyone with database access could crack in about an hour; X avoids that only with outside key servers (Juicebox). |

First release: one-to-one chat with text, images, videos, files and voice messages, unread counts, read receipts, push notifications.

**Voice messages** (`lib/chat/voice.ts`, `VoiceNote` in `attachment-view.tsx`): recorded in the browser with `MediaRecorder` (Opus in WebM on Chrome, Edge and Firefox; AAC in MP4 on Safari) at 32 kbps, about 5 MB for the 20-minute maximum. Recording stops by itself at 20 minutes and goes to review. A voice message is a message of kind `voice` with exactly one attachment, uploaded and encrypted like any file. Its length and a 48-bar waveform travel inside the encrypted message (`voice`, `duration`, `waveform` on the attachment), so the server sees only the encrypted size. In the composer the microphone replaces the send button while the box is empty: record (with a live level meter and timer; Esc or the bin cancels), stop to review and play it back, or send straight away. The player downloads and decrypts the audio on the first play (the sender's copy is local), has a seekable waveform and 1×, 1.5× and 2× speed, and only one voice message plays at a time. Voice messages can be replied to and deleted, not edited. Previews read "Voice message (0:42)".

**Reactions** (`MessageReaction`, `components/chat/reactions.tsx`): one per person per message. The emoji is encrypted with the conversation key (`{v: 1, emoji}`, associated data `chat-reaction-v1|conversation|message|user|keyVersion`), so the server stores only that a person reacted to a message, not with what. `PUT messages/{id}/reaction` sets or replaces it, using the newest key version (409 `key_outdated` otherwise, and the browser makes a new version and retries); `DELETE` removes it. Choosing the same emoji again removes it. Not allowed on system notes or deleted messages; deleting a message for everyone removes its reactions. Reactions come with every message (`reactions`) and live as `reaction.updated`. The bar offers 👍 ❤️ 😂 😮 😢 🙏 and "+" for the full picker (`emoji-picker-react`, device emoji, loaded only when opened); it opens from the smile button on hover, the message menu (React) or a long press on phones. Reactions show as chips under the message ("❤️ 2"), naming who reacted. The conversation list shows 'Ada reacted ❤️ to "…"' when the newest reaction (`last_reaction` on each conversation) is newer than the last message. Reactions send no push and do not count as unread.

**Replies:** a reply carries a short encrypted preview of what it quotes (`reply_preview`: sender and up to 200 characters), so the quote shows even when the original is not loaded. Choosing the quote scrolls to the original and highlights it, loading older pages first if needed (up to 40 pages of 50); if it is gone (deleted for you, or further back), a notice says so.

**Forwarding** (`ForwardDialog`, `forward()` in the provider): Forward in the message menu opens a dialog with your chats and a people search (people without chat cannot be chosen); pick up to 5 and optionally add a note, sent as a separate message after each forward. The browser re-encrypts the message for each destination chat's key, with `forwarded` (a count, +1 per forward) inside the encrypted payload, so the server does not know a message was forwarded. Files, photos, videos and voice messages are copied in storage still encrypted (`POST conversations/{id}/attachments/forward {attachment_id}`: S3 CopyObject into the destination chat's prefix, reserved like a fresh upload; you must be in both chats and the source must be sent and not deleted); their keys travel in the new encrypted message. The copy is independent of the original. The reply quote and reactions are not carried over. The bubble shows "Forwarded", or "Forwarded many times" from 5 forwards on. The original sender is not shown. The forwarded mark is set by the sender's browser and cannot be enforced by the server. `CHAT_STORAGE_COPY` (default true) turns the storage copy off where there is no real storage (the end-to-end stack).

The data model supports group chats later without migration of existing data.

## 2. What end-to-end encryption means here

Protected: message text, file contents, file names and types, image and video thumbnails, captions.

Not protected (the server needs these to work): who talks to whom, when, message and file sizes, read positions, online status.

Known limits, accepted:

- **Forgotten PIN and lost recovery code means the history is gone.** The user can reset their chat (start over with a new key) from the unlock screen, after a warning of what that means and an 8-character code (letters and digits) emailed to them; old messages stay unreadable to them. There is no admin reset or delete.
- **Reset code:** 8 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no look-alikes), always at least one letter and one digit; only an HMAC of it is kept, in the cache, for 15 minutes; a new code replaces the old one and can be requested once a minute; five wrong tries cancel it; it works once. `reset/code/check` checks it before the new PIN is chosen, and `reset` checks and uses it.
- **Django admin:** chat accounts, conversations, messages and attachments are visible read-only to superusers only (no add, edit, delete or bulk actions). Encrypted values show as truncated base64 plus their size; S3 keys are not shown. Every list or detail page opened is audited as `CHAT_ADMIN_VIEWED` with the model, object and filters.
- **Search** works only over messages already loaded and decrypted in the browser.
- **Push notifications** say "New message from Ada Obi" without the text.
- **The server cannot check file types or scan files for malware**; it only sees encrypted bytes and their size.
- **A web app trusts the code the server delivers.** Someone able to deploy a modified portal could capture keys. E2EE protects against database, storage, backup and log access, not against a hostile deployment.
- **Management cannot retrieve chats for investigations.** A participant-initiated report is planned for later (section 9).

## 3. Cryptography

Library: `libsodium-wrappers-sumo` (sumo build needed for Argon2id). No hand-rolled primitives. The design gets an independent security review before release.

### 3.1 User keys

- Each user has one X25519 key pair (`crypto_box_keypair`). One pair per user, not per device, to keep multi-device and shared computers simple.
- The public key is stored on the server in plain form.
- The private key is stored on the server twice, each copy encrypted (`crypto_secretbox`, XSalsa20-Poly1305):
  1. **PIN copy, two layers.** Inside: sealed with a key derived from the 6-digit **chat PIN** (Argon2id, `crypto_pwhash`, 64 MiB, 3 passes, random salt). Outside: sealed again with a **password secret** derived in the browser from the portal password (Argon2id, 32 MiB, 2 passes, salt = BLAKE2b of `incel-chat-password|<user id>`). The server never receives the password secret; Django stores only its usual password hash.
  2. **Recovery copy**, sealed with a key derived from a **recovery code** (32 random characters (160 bits) from a 32-letter alphabet without I, L, O or U, shown once at setup as 8 groups of 4; 64 MiB, 3 passes).
- Why two layers: a 6-digit PIN alone (1,000,000 possibilities) could be tried offline by anyone holding a copy of the database. With the outer layer, they must first find the user's portal password, so chat is as strong as the password plus the PIN. Weak portal passwords weaken chat.
- The password secret is made at sign-in (`lib/chat/password.ts`) and kept sealed in the browser like the key (3.2), so chat asks only for the PIN. If it is missing (signed in before this release, storage blocked), chat asks for the portal password too, checked with `POST /chat/account/check-password` before it is used.
- Five wrong PINs in a row forget the password secret, so the portal password is needed again.
- Changing the password in the portal swaps only the outer layer (old and new password are both typed there; no PIN or key needed). A reset by email link or by an admin cannot do that, so the next unlock says the password changed and the recovery code is used once; it then locks the key with a new PIN and the new password.
- Changing the PIN rebuilds the PIN copy from the unlocked key. Using the recovery code asks for a new PIN and issues a new recovery code.

### 3.2 Keeping the key on a shared computer

After unlocking, the browser keeps the private key in IndexedDB **encrypted with a per-session secret held by the server** (random 32 bytes, stored in the cache for 12 hours under a random id, returned by `POST /chat/session-secrets`; the browser keeps the id with its sealed copy and fetches the secret with `GET /chat/session-secrets/{id}`). So:

- the copy on disk is useless without the server's secret;
- the server's secret is useless without the copy on disk;
- sign-out (manual or inactivity) deletes the server's secret **and** clears the IndexedDB store, and other tabs are told through the existing logout BroadcastChannel;
- on sign-in, any chat store belonging to a different user is wiped first.

Decrypted messages are held in memory only, never written to browser storage.

### 3.3 Conversation keys

- Each conversation has a random 32-byte symmetric key with a version number (starts at 1).
- The key is wrapped for every participant with `crypto_box_easy` (sender's private key + recipient's public key), so the recipient can tell which participant wrapped it.
- Group chats later: adding a member wraps the current key for them (they may read history if the group allows); removing a member creates a new version wrapped for remaining members only.
- If a participant's public key changes (chat reset), the next client from the other side wraps a new key version for them and the thread shows "Ada Obi reset their chat. Messages before this are not available to them." (Ada sees "You reset your chat. Messages before this are not available to you."; the conversation list shows the same note, cut off with "…"). Messages that cannot be opened show "This message is not available."

### 3.4 Messages

- Encrypted with XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf`), random 24-byte nonce.
- Associated data binds each ciphertext to its place: `conversation_id | message_id | sender_id | key_version | revision`. The server cannot move a message to another conversation, change its sender or replay an old edit.
- Plaintext is JSON: `{ "v": 1, "text": "...", "reply_to": "<message_id>|null", "attachments": [ { "id", "name", "mime", "size", "width", "height", "duration", "file_key", "thumb_key" } ] }`.

### 3.5 Files

- Each file gets its own random key and is encrypted in chunks (`crypto_secretstream_xchacha20poly1305`, 64 KiB chunks) so 25 MB files do not freeze the page.
- Images and videos get a thumbnail made in the browser (canvas, ≤ 480 px, first video frame), encrypted the same way.
- The file key lives inside the encrypted message, never on the server.
- Viewing decrypts into a Blob URL that is revoked when the message leaves the screen.

### 3.6 Key verification (later)

The server hands out public keys, so in theory it could substitute one. Phase 2 adds a "safety code" per conversation (a short fingerprint of both public keys) that two people can compare in person. Key changes are always announced in the thread (3.3).

## 4. Backend

New Django app `chat`. Integer user ids unchanged.

### 4.1 Models

```
ChatAccount            one per user who has set up chat
  user                 OneToOne(User)
  public_key           bytes (32)
  key_id               UUID, changes on reset
  pin_box              bytes  (private key, PIN layer inside, password layer outside)
  pin_nonce, pin_inner_nonce, pin_salt, pin_ops, pin_mem
  recovery_box         bytes
  recovery_salt, recovery_ops, recovery_mem
  last_seen_at         datetime | null
  created_at, updated_at

Conversation
  id                   UUID
  kind                 direct | group
  direct_key           "minUserId:maxUserId", unique when kind=direct (prevents duplicates)
  created_by           User
  last_message_at      datetime (sorting the list)
  next_seq             bigint (per-conversation message counter)
  created_at

Participant
  conversation, user   unique together
  role                 member | admin   (admin used by groups later)
  joined_at, left_at
  last_read_seq        bigint (read receipts and unread counts)
  muted_until          datetime | null
  archived             bool

ConversationKey
  conversation, version, recipient   unique together
  wrapped_key          bytes
  nonce                bytes
  wrapped_by           User
  recipient_key_id     UUID (which ChatAccount key it was wrapped for)

Message
  id                   UUID, generated by the sender's browser (also the retry key)
  conversation, sender
  seq                  bigint, unique per conversation (ordering + paging cursor)
  kind                 text | attachment | voice | system
  key_version          int
  nonce                bytes
  ciphertext           bytes | null (null after delete for everyone)
  revision             int (0, +1 per edit)
  created_at, edited_at, deleted_at

MessageAttachment
  id                   UUID
  message              FK | null (null until the message is sent)
  uploaded_by          User
  file_s3_key, thumb_s3_key
  encrypted_size       int
  created_at

HiddenMessage          delete for me
  user, message        unique together
```

Server-side rules: only participants can read or post; only the sender can edit or delete for everyone, and only while `now - created_at <= 30 min`; text is limited to 64 KiB of ciphertext; a message may carry up to 10 attachments; system messages are created only by the server.

### 4.2 REST endpoints (all under `/api/v1/chat/`, no trailing slashes)

| Method | Path | Purpose |
|---|---|---|
| GET | `account` | Own chat setup status and encrypted key copies |
| POST | `account` | First setup: public key + both encrypted copies |
| PATCH | `account` | Replace the PIN copy, the recovery copy, or both (PIN change, password change, recovery-code use) |
| POST | `account/check-password` | 204 if it is the user's portal password, else 400 with tries left (before chat is locked with it). Wrong answers count toward the sign-in lockout; while locked, 403 `account_locked` with `retry_after` |
| POST | `account/reset/code` | Email a reset code (409 if one was sent under a minute ago) |
| POST | `account/reset/code/check` | 204 if the reset code is right; 400 with tries left otherwise |
| POST | `account/reset` | Start over with a new key pair; needs `code` |
| POST | `session-secrets` | New secret that seals this browser's copy of the key |
| GET, DELETE | `session-secrets/{id}` | Fetch it on page load; delete it on sign-out |
| POST | `ws-ticket` | One-time ticket for opening the WebSocket |
| GET | `people?search=` | Active users, with `chat_ready`, public key and online flag |
| POST | `people/{user_id}/invite` | Invite someone who has not set up chat (opens the waiting conversation); again = a reminder |
| GET | `unread-count` | Total unread, for the sidebar badge |
| GET | `conversations?limit=&before=` | One page (default 30, at most 100) of conversations, most recent activity first (last message time, or creation time for an empty chat; ties by id), each with unread count, last message, participants and their read positions. Returns `has_more`, `next` (the cursor for `before`) and `unread_total` across all conversations. The list loads older pages as it is scrolled; a chat opened by link that is not loaded yet is fetched on its own. After a disconnection the browser pages through missed messages (up to 10 pages of 100 per open chat, otherwise it reloads that chat from the newest messages). |
| POST | `conversations` | Start (or return existing) direct chat, with wrapped keys |
| GET, PATCH | `conversations/{id}` | One conversation; mute or archive it |
| GET | `conversations/{id}/keys` | Own wrapped keys, all versions |
| POST | `conversations/{id}/keys` | Add the next key version (after a key change) |
| GET | `conversations/{id}/messages?before_seq=&after_seq=&limit=50` | History (oldest first in each page), hidden ones excluded |
| POST | `conversations/{id}/messages` | Send; idempotent on the message id |
| POST | `conversations/{id}/read` | Move `last_read_seq` forward |
| POST | `conversations/{id}/attachments` | Reserve an upload; returns presigned PUT URLs for file and thumbnail |
| PATCH | `messages/{id}` | Edit (new ciphertext, revision + 1) |
| DELETE | `messages/{id}?scope=everyone\|me` | Delete for everyone / for me |
| PUT, DELETE | `messages/{id}/reaction` | Set or replace your encrypted reaction / remove it |
| POST | `conversations/{id}/attachments/forward` | Copy a file from another of your chats into this one (forwarding); returns a reserved attachment id |
| GET | `attachments/{id}/download?part=file\|thumb` | Short-lived presigned GET for the encrypted bytes |

Uploads reuse `common/storage.py`: new prefix `CHAT_ATTACHMENT_S3_PREFIX` (default `chat-attachments`), content type always `application/octet-stream`, `verify_upload` checks size only (≤ 25 MB plus encryption overhead). Attachments not linked to a message within 24 hours are deleted by a Celery job. Delete for everyone removes the S3 objects through Celery.

Throttles: `chat_messages` 60/minute, `chat_uploads` 30/minute, `chat_tickets` 30/minute, `chat_keys` 20/minute (key setup, backups, reset, new key versions).

Audit log records: `CHAT_SETUP`, `CHAT_KEY_BACKUP_UPDATED` (PIN or password change, or recovery), `CHAT_RESET_CODE_SENT`, `CHAT_KEY_RESET`, `CHAT_ADMIN_VIEWED`. It never records message content or per-message events. Uploaded files are checked for size only when the message is sent.

### 4.3 Realtime (Django Channels)

- Packages: `channels`, `channels-redis`, `uvicorn[standard]`.
- `portalapi/asgi.py` routes HTTP to Django as today and `/ws/chat/` to `ChatConsumer`.
- Channel layer on the existing Redis, database 13 (Celery uses 15, the cache 14).
- **Authentication by ticket:** the browser calls `POST /chat/ws-ticket` (normal cookie auth), receives a random single-use ticket stored in the cache for 30 seconds, then opens `wss://<realtime host>/ws/chat/?ticket=...`. This avoids depending on cookies reaching another hostname and keeps tokens out of URLs. The consumer also checks the Origin header against `CORS_ALLOWED_ORIGINS`.
- On connect the consumer joins group `user_<id>`, sets the presence key `chat:presence:<id>` with 60-second expiry (refreshed by each ping) and counts open sockets in `chat:connections:<id>` (one per tab). `last_seen_at` is written on connect, at most once a minute on ping, and on disconnect, so it stays accurate even when a browser dies without closing its socket. When the first socket opens or the last one closes, a `presence` event goes to everyone who shares a conversation with the user.
- Every 5 minutes the consumer re-checks that the user is still active and closes the socket (4001) if not. On sign-out the portal closes its own socket.

Client → server events (nothing that changes data):

```
ping                       every 25 s; refreshes presence (also keeps Cloudflare's 100 s idle timeout away)
typing {conversation_id}   rate limited to 1 per 3 s
```

Server → client events:

```
message.new        {conversation_id, message}
message.edited     {conversation_id, message_id, revision, nonce, ciphertext, edited_at}
message.deleted    {conversation_id, message_id}
read.updated       {conversation_id, user_id, last_read_seq}
conversation.new   {conversation_id}
message.hidden     {conversation_id, message_id}   to the user's own other tabs
(system messages use message.new: key_reset, invite_sent, invite_accepted)
key.changed        {conversation_id, user_id | version}   a participant reset, or a new key version
typing             {conversation_id, user_id}
presence           {user_id, online, last_seen_at}
reaction.updated   {conversation_id, message_id, reaction, message} or {conversation_id, message_id, removed_user_id}
```

Online status and last seen come with the conversation and people lists, are updated live by `presence` events, and the browser refreshes the list once a minute while visible (covering a socket that died without a disconnect, which only drops offline when its presence key expires).

Sending path: browser → `POST messages` (gunicorn, normal auth, validation, throttling) → saved in Postgres → `transaction.on_commit` → `group_send` to each participant's `user_<id>` group → their open sockets. If the socket is down, the client re-fetches messages after the last `seq` it holds on reconnect, so nothing is lost.

Push: if a recipient has no presence key, send a web push "New message from {name}" with a link to the conversation, reusing `PushSubscription` and the push delivery code. Chat messages do not create entries in the notification bell. Muted conversations send no push.

### 4.4 Deployment

- New CapRover app `incel-portal-realtime`, same backend image, command:
  `uvicorn portalapi.asgi:application --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers`
- "Websocket Support" switched on for that app in CapRover.
- Own hostname, e.g. `workspacews.incelgroup.com`, proxied by Cloudflare (WebSockets are on by default).
- Same environment variables as the API, plus `CHANNEL_LAYER_URL`, `CHAT_ATTACHMENT_S3_PREFIX`, and on the portal `NEXT_PUBLIC_CHAT_WS_URL`.
- The REST API stays on gunicorn unchanged. If the realtime app is down, chat still works by refreshing; the rest of the portal is unaffected.

## 5. Portal

### 5.1 Code layout

```
lib/chat/crypto.ts        libsodium wrapper: keys, wrap/unwrap, encrypt/decrypt, file streams
lib/chat/keystore.ts      IndexedDB store sealed with the session secret; wipe on sign-out
lib/chat/api.ts           typed REST calls
lib/chat/socket.ts        ticket, connect, back-off reconnect, ping, event dispatch
components/chat/ChatProvider.tsx      one socket and one decrypted cache for the whole portal
components/chat/chat-gate.tsx         set-up, unlock (PIN), recovery code, start over
components/chat/pin-input.tsx         six circles over one numeric password input
components/chat/ConversationList.tsx
components/chat/MessageThread.tsx     virtualised list, loads older on scroll up
components/chat/MessageBubble.tsx     text, attachments, edited / deleted states, receipts
components/chat/Composer.tsx          text, attach, drag-drop, paste image
components/chat/AttachmentView.tsx    decrypt on demand, image / video / file
components/chat/ChatDrawer.tsx        slide-up drawer
app/(portal)/chat/page.tsx            full page
app/(portal)/chat/[conversationId]/page.tsx
```

`ChatProvider` sits in `app/(portal)/layout.tsx`, so the drawer stays open while moving between pages and the full page and drawer share the same state. The socket opens only after chat is unlocked.

### 5.2 Screens

- **Sidebar:** "Chat" item with an unread badge.
- **Full page:** list of conversations on the left, open thread on the right; on phones one pane at a time.
- **Drawer:** button at the bottom right of every portal page; opens a panel (about 380 × 560 px) with the list, then the thread. Hidden on `/chat` itself. Full screen on phones.
- **First use:** explains in plain words that chats are private and that IT cannot reset the PIN; the user chooses a 6-digit PIN and types it again, then saves the recovery code and types back its last group.
- **Each sign-in:** the first time chat is opened, ask for the PIN.
- **People who have not set up chat** show "Has not set up chat yet" with **Invite**. Inviting opens the conversation in the inviter's list with a note "Invitation sent"; the footer says the person has not set up chat yet and offers **Send a reminder** (once a day). Nothing can be sent until they set up chat.
- **Accepting:** setting up chat is accepting. Every conversation the person was invited to appears in their list with "<inviter> invited you to chat" and "You accepted the chat invitation"; the inviter sees "<name> accepted the chat invitation" live, and the composer appears. System notes are shown centred with their time.
- **Media:** photos and MP4/WebM videos show as tiles (WhatsApp style): the preview fills the bubble, a centred pill shows a download icon (play for video) and the size, video length sits bottom left, and the caption sits under the tile. Downloading a photo shows it full size in place; clicking it opens a viewer with **Save**. The sender sees their own copy immediately (never re-downloaded). Other files show as a file card with name, size and download.
- **Message actions:** reply, edit and delete for everyone (shown only within 30 minutes, own messages), delete for me, download.
- **Receipts:** one tick sent, "Seen" under the last message the other person has read.

### 5.3 Accessibility and behaviour

- New messages in the open thread are announced politely (`aria-live="polite"`), not every message in every chat.
- Enter sends, Shift+Enter adds a new line; Escape closes the drawer and returns focus to its button.
- All actions available from the keyboard; menus labelled; follows the colour and type rules in `TECHNICAL_DOCUMENTATION.md` section 12.1.
- Images and video play in the thread; other video formats (not MP4/WebM) and all other files download.

## 6. Testing

- Crypto: exercised end to end in the browser (setup with password check and PIN mismatch, unlock, wrong PIN, messages, files). Separate unit tests for the crypto module are still to add.
- API: non-participants get 404; edit and delete refused after 30 minutes and for non-senders; delete for me hides only for that user; idempotent send; unread counts; attachment size limit; orphan clean-up.
- Consumer (`chat/tests/test_consumer.py`): ticket single use, unknown ticket, Origin check, delivery including payloads with dates.
- End to end: two browser contexts (two users) set up chat, exchange text and a file, edit, delete, see receipts; sign-out clears the key and, after signing in through the form, only the PIN is asked.

## 7. Build order (first release)

1. Backend foundation: `chat` app, models, account/key endpoints, conversations and messages REST, tests.
2. Realtime: Channels, ticket, consumer, broadcast on commit, realtime CapRover app.
3. Portal crypto: libsodium wrapper, keystore, setup and unlock dialogs.
4. Chat page: list, thread, composer, receipts, edit/delete.
5. Attachments: encrypted upload, thumbnails, viewing, limits.
6. Drawer, sidebar badge, push.
7. Docs (README, technical documentation, user guide, deployment), end-to-end tests, security review.

Later phases: safety codes; unit tests for the crypto module; group chats; audio and video calls (WebRTC with a TURN server, a separate project).

## 8. Settled follow-ups

- **Leavers:** when a user is deactivated, their conversations stay visible to the other participants, read-only. Nobody can send new messages to a deactivated user; the thread shows "Ada Obi no longer has access to the portal."
- **Invitations:** inviting someone who has not set up chat opens a waiting conversation for the inviter, and the invitee gets a portal notification and an email ("<name> wants to chat with you"). Reminders: one per pair per 24 hours. See 5.2.
- **Realtime hostname:** `workspacews.incelgroup.com`.

## 9. Planned later: reporting messages

Not in the first release; the reviewer role is still to be decided.

- A "Report message" action on any message the user can read. The reporting user picks the messages to include (the reported one plus optional context before it).
- The reporting browser decrypts those messages and sends the plain text, file names and sender/time details to the API, together with a reason. This is the only path by which chat content can reach the company, and only by a participant's choice.
- Reports go to a designated reviewer role (for example HR) and are kept in a `ChatReport` model with status (open, reviewing, closed) and notes. Attachments are re-encrypted for or uploaded in plain form to a restricted prefix, to be decided with the reviewer role.
- The reported person is not told automatically. The audit log records that a report was made, by whom and when, not its content.
- The reporting UI states plainly that the selected messages will be readable by the reviewer.
