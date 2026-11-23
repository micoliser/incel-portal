/*
 * Chat notification previews, decrypted in the browser (docs/CHAT_SPEC.md).
 *
 * A chat push carries the message still encrypted. This turns it into
 * "Ada: The invoices are ready" (or, in a group, title "Finance team" and
 * body "Ada: …") using the chat key that is unlocked in this browser: the
 * same sealed copy a chat tab uses, opened with the server's session secret.
 * When anything is missing (chat locked, signed out, previews turned off,
 * the key expired) it returns null and the plain notification is shown.
 *
 * Loaded by the service worker (sw.js) with importScripts, after libsodium.
 * Also loadable in a page, which the end-to-end tests use.
 */
(function (scope) {
  "use strict";

  var DB_NAME = "incel-chat";
  var STORE = "keys";

  function idbGet(key) {
    return new Promise(function (resolve) {
      var request;
      try {
        request = indexedDB.open(DB_NAME, 1);
      } catch (error) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE);
      };
      request.onerror = function () {
        resolve(null);
      };
      request.onsuccess = function () {
        var db = request.result;
        try {
          var get = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
          get.onsuccess = function () {
            db.close();
            resolve(get.result || null);
          };
          get.onerror = function () {
            db.close();
            resolve(null);
          };
        } catch (error) {
          db.close();
          resolve(null);
        }
      };
    });
  }

  /** GET (or POST) the API with the sign-in cookies, refreshing the session once if it expired. */
  async function api(base, path, options) {
    var init = Object.assign({ credentials: "include", headers: { Accept: "application/json" } }, options || {});
    var response = await fetch(base + path, init);
    if (response.status === 401) {
      var refreshed = await fetch(base + "/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!refreshed.ok) return null;
      response = await fetch(base + path, init);
    }
    if (!response.ok) return null;
    return response.json();
  }

  function duration(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function summary(payload) {
    if (payload.text) return payload.text;
    var first = (payload.attachments || [])[0];
    if (!first) return "New message";
    if (first.voice) return "Voice message (" + duration(first.duration) + ")";
    if (String(first.mime || "").indexOf("image/") === 0) return "Photo";
    if (String(first.mime || "").indexOf("video/") === 0) return "Video";
    return first.name || "File";
  }

  function shorten(text, length) {
    var line = String(text).replace(/\s+/g, " ").trim();
    return line.length > length ? line.slice(0, length - 1) + "…" : line;
  }

  /**
   * `chat`: the `chat` part of a push. `fallbackTitle`: the sender's name from
   * the push. Returns { title, body } or null.
   */
  async function chatPushPreview(chat, fallbackTitle) {
    if (!chat || !chat.conversation_id || chat.key_version == null || !scope.sodium) return null;
    var config = await idbGet("config");
    if (!config || config.previews === false || !config.apiBase) return null;
    var sealed = await idbGet("current");
    if (!sealed || !sealed.secretId) return null;

    var base = String(config.apiBase).replace(/\/$/, "");
    var s = scope.sodium;
    await s.ready;
    var b64 = function (text) {
      return s.from_base64(text, s.base64_variants.ORIGINAL);
    };

    var secret = await api(base, "/chat/session-secrets/" + encodeURIComponent(sealed.secretId));
    if (!secret || !secret.secret) return null;
    var privateKey = s.crypto_secretbox_open_easy(b64(sealed.box), b64(sealed.nonce), s.from_hex(secret.secret));

    try {
      var conversationId = chat.conversation_id;
      var keys = await api(base, "/chat/conversations/" + conversationId + "/keys");
      if (!keys) return null;
      var openKey = function (version) {
        var row = (keys.results || []).find(function (r) {
          return r.version === version;
        });
        if (!row) return null;
        try {
          return s.crypto_box_open_easy(b64(row.wrapped_key), b64(row.nonce), b64(row.wrapper_public_key), privateKey);
        } catch (error) {
          return null;
        }
      };

      var ciphertext = chat.ciphertext;
      var nonce = chat.nonce;
      if (!ciphertext) {
        // Too big for the push: fetch just this message.
        var page = await api(
          base,
          "/chat/conversations/" + conversationId + "/messages?after_seq=" + (Number(chat.seq) - 1) + "&limit=1",
        );
        var found = page && (page.results || []).find(function (m) {
          return m.id === chat.message_id;
        });
        if (!found || !found.ciphertext) return null;
        ciphertext = found.ciphertext;
        nonce = found.nonce;
      }

      var key = openKey(chat.key_version);
      if (!key) return null;
      var ad =
        "chat-v1|" + conversationId + "|" + chat.message_id + "|" + chat.sender_id + "|" + chat.key_version + "|" + (chat.revision || 0);
      var plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, b64(ciphertext), ad, b64(nonce), key);
      var payload = JSON.parse(s.to_string(plain));
      var text = shorten(summary(payload), 180);

      if (chat.conversation_kind !== "group") {
        return { title: fallbackTitle || "New message", body: text };
      }

      // Groups: the (encrypted) group name as the title, and who wrote it.
      var conversation = await api(base, "/chat/conversations/" + conversationId);
      var name = "Group";
      var sender = (fallbackTitle || "Someone").split(" ")[0];
      if (conversation) {
        var person = (conversation.participants || []).find(function (p) {
          return p.id === chat.sender_id;
        });
        if (person && person.name) sender = person.name.split(" ")[0];
        var info = conversation.info;
        var infoKey = info ? openKey(info.key_version) : null;
        if (info && infoKey) {
          try {
            var details = JSON.parse(
              s.to_string(
                s.crypto_aead_xchacha20poly1305_ietf_decrypt(
                  null,
                  b64(info.ciphertext),
                  "chat-info-v1|" + conversationId + "|" + info.key_version,
                  b64(info.nonce),
                  infoKey,
                ),
              ),
            );
            if (details && details.name) name = shorten(details.name, 80);
          } catch (error) {
            // Keep "Group".
          }
        }
      }
      return { title: name, body: sender + ": " + text };
    } catch (error) {
      return null;
    } finally {
      s.memzero(privateKey);
    }
  }

  scope.chatPushPreview = function (chat, fallbackTitle) {
    return chatPushPreview(chat, fallbackTitle).catch(function () {
      return null;
    });
  };
})(self);
