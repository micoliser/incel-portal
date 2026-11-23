import type { Page, Request } from "@playwright/test";

import { PASSWORD, USERS } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { chatResetCodeFor, emailCount } from "../support/mail";
import { main, sidebar } from "../support/ui";

/**
 * Two people set up end-to-end encrypted chat and talk in real time.
 * Femi Finance and Chidi Clerk start without chat; the steps build on each
 * other, so they run as one sequence.
 */
test.describe.configure({ mode: "serial" });

const FEMI_PIN = "246810";
const CHIDI_PIN = "135790";

// The e2e stack has no object storage (its endpoint is 127.0.0.1:9). Stand in
// for it in the browser, so encrypted uploads and downloads round-trip.
const bucket = new Map<string, Buffer>();
async function fakeStorage(page: Page) {
  await page.route("http://127.0.0.1:9/**", async (route) => {
    const request = route.request();
    const key = new URL(request.url()).pathname;
    if (request.method() === "PUT") {
      bucket.set(key, request.postDataBuffer() ?? Buffer.alloc(0));
      await route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    } else if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT",
          "Access-Control-Allow-Headers": "*",
        },
      });
    } else {
      const body = bucket.get(key);
      await route.fulfill({
        status: body ? 200 : 404,
        body: body ?? "",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
  });
}

async function typePin(page: Page, label: RegExp, pin: string) {
  await page.getByLabel(label).pressSequentially(pin);
}

/**
 * These sessions were started through the API, not the sign-in form, so chat
 * first asks for the portal password (its second lock), then a PIN twice.
 */
async function setUpChat(page: Page, pin: string) {
  await page.goto("/chat");
  await expect(main(page).getByRole("heading", { name: "Set up private chat" })).toBeVisible();
  await page.getByLabel("Portal password").fill("not my password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That is not your portal password." })).toBeVisible();
  await expect(page.getByLabel("Portal password")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Portal password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(main(page).getByRole("heading", { name: "Create a chat PIN" })).toBeVisible();
  await typePin(page, /^New chat PIN/, pin);
  await expect(main(page).getByRole("heading", { name: "Confirm your PIN" })).toBeVisible();
  await typePin(page, /^Confirm chat PIN/, "000000");
  await expect(page.getByRole("alert").filter({ hasText: "The PINs did not match." })).toBeVisible();
  await typePin(page, /^New chat PIN/, pin);
  await typePin(page, /^Confirm chat PIN/, pin);

  await expect(main(page).getByRole("heading", { name: "Save your recovery code" })).toBeVisible({ timeout: 20_000 });
  const code = (await main(page).locator("p.font-mono").innerText()).trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await page.getByLabel(/last four characters/).fill(code.slice(-4));
  await page.getByRole("button", { name: "I have saved it" }).click();
  await expect(main(page).getByRole("heading", { name: "Conversations" })).toBeVisible();
  return code;
}

function thread(page: Page) {
  return page.getByRole("log", { name: "Messages" });
}

let femi: Page;
let chidi: Page;
const sentBodies: string[] = [];

test.beforeAll(async ({ browser }) => {
  femi = await pageAs(browser, "finance");
  chidi = await pageAs(browser, "clerk");
  await fakeStorage(femi);
  await fakeStorage(chidi);
  femi.on("request", (request: Request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/chat/")) {
      sentBodies.push(request.postData() ?? "");
    }
  });
});

test.afterAll(async () => {
  await femi.context().close();
  await chidi.context().close();
});

test("a first-time user sets up chat and gets a recovery code", async () => {
  await setUpChat(femi, FEMI_PIN);
});

test("inviting someone opens a waiting chat, notifies and emails them", async () => {
  const emailsBefore = emailCount(USERS.clerk.email);
  await femi.getByRole("textbox", { name: "Search people to message" }).fill("Chidi");
  const row = femi.getByRole("list", { name: "People" }).getByRole("listitem").filter({ hasText: USERS.clerk.name });
  await expect(row.getByText("Has not set up chat yet")).toBeVisible();
  await row.getByRole("button", { name: "Invite" }).click();

  await expect(femi).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(thread(femi).getByText("Invitation sent")).toBeVisible();
  await expect(femi.getByText(/has not set up chat yet\. You can send messages once they accept/)).toBeVisible();
  await expect(femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` })).toHaveCount(0);
  await expect(main(femi).getByRole("list", { name: "Conversations" }).getByText("Invitation sent")).toBeVisible();
  await expect.poll(() => emailCount(USERS.clerk.email)).toBe(emailsBefore + 1);

  await femi.getByRole("button", { name: "Send a reminder" }).click();
  await expect(femi.getByText("You have already reminded Chidi Clerk today.")).toBeVisible();
});

test("setting up chat accepts the invitation on both sides", async () => {
  await setUpChat(chidi, CHIDI_PIN);
  const invitation = main(chidi).getByRole("list", { name: "Conversations" }).getByRole("button", { name: new RegExp(USERS.finance.name) });
  await expect(invitation).toBeVisible();
  await invitation.click();
  await expect(thread(chidi).getByText(`${USERS.finance.name} invited you to chat`)).toBeVisible();
  await expect(thread(chidi).getByText("You accepted the chat invitation")).toBeVisible();

  // Femi's open chat updates live and can now send.
  await expect(thread(femi).getByText(`${USERS.clerk.name} accepted the chat invitation`)).toBeVisible();
  await expect(femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` })).toBeVisible();
});

test("messages arrive live, are encrypted before they leave, and show as seen", async () => {
  await chidi.goto("/dashboard");

  const composer = femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` });
  await composer.fill("Hello Chidi, the invoices are ready");
  await composer.press("Enter");
  await expect(thread(femi).getByText("Hello Chidi, the invoices are ready")).toBeVisible();
  await expect(thread(femi).getByLabel("Sent").first()).toBeVisible();

  // Nothing readable was sent to the server.
  expect(sentBodies.length).toBeGreaterThan(0);
  expect(sentBodies.join("\n")).not.toContain("invoices");

  // Chidi sees the unread count and the message without reloading.
  await expect(sidebar(chidi).getByRole("link", { name: /Chat\s*1 unread/ })).toBeVisible();
  await sidebar(chidi).getByRole("link", { name: /Chat/ }).click();
  await main(chidi).getByRole("button", { name: new RegExp(USERS.finance.name) }).click();
  await expect(thread(chidi).getByText("Hello Chidi, the invoices are ready")).toBeVisible();

  await expect(thread(femi).getByLabel("Seen").first()).toBeVisible();

  const reply = chidi.getByRole("textbox", { name: `Message ${USERS.finance.name}` });
  await reply.fill("Thanks Femi");
  await reply.press("Enter");
  await expect(thread(femi).getByText("Thanks Femi")).toBeVisible();
});

test("the sender can edit and delete a message for everyone", async () => {
  const bubble = thread(femi).locator(".group").filter({ hasText: "Hello Chidi, the invoices are ready" });
  await bubble.hover();
  await bubble.getByRole("button", { name: "Message options" }).click();
  await femi.getByRole("menuitem", { name: "Edit" }).click();
  const composer = femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` });
  await composer.fill("Hello Chidi, the invoices are ready for review");
  await composer.press("Enter");
  await expect(thread(chidi).getByText("Hello Chidi, the invoices are ready for review")).toBeVisible();
  await expect(thread(chidi).getByText("Edited ·")).toBeVisible();

  const edited = thread(femi).locator(".group").filter({ hasText: "ready for review" });
  await edited.hover();
  await edited.getByRole("button", { name: "Message options" }).click();
  await femi.getByRole("menuitem", { name: "Delete for everyone" }).click();
  await expect(thread(femi).getByText("This message was deleted")).toBeVisible();
  await expect(thread(chidi).getByText("This message was deleted")).toBeVisible();
});

test("delete for me hides a message only for that person", async () => {
  const bubble = thread(chidi).locator(".group").filter({ hasText: "Thanks Femi" });
  await bubble.hover();
  await bubble.getByRole("button", { name: "Message options" }).click();
  await expect(chidi.getByRole("menuitem", { name: "Delete for everyone" })).toBeVisible();
  await chidi.getByRole("menuitem", { name: "Delete for me" }).click();
  await expect(thread(chidi).getByText("Thanks Femi")).toHaveCount(0);
  await femi.reload();
  await expect(thread(femi).getByText("Thanks Femi")).toBeVisible();
});

test("files are encrypted, uploaded and opened by the other person", async () => {
  await femi.locator('input[type="file"]').setInputFiles({
    name: "budget-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Quarterly budget notes"),
  });
  await expect(femi.getByRole("list", { name: "Files to send" }).getByText("budget-notes.txt").first()).toBeVisible();
  await femi.getByRole("button", { name: "Send message" }).click();
  await expect(thread(chidi).getByText("budget-notes.txt").first()).toBeVisible();

  // What storage holds is not the file.
  const stored = [...bucket.values()].map((b) => b.toString("latin1")).join("");
  expect(stored.length).toBeGreaterThan(0);
  expect(stored).not.toContain("Quarterly budget notes");

  const download = chidi.waitForEvent("download");
  await thread(chidi).getByRole("button", { name: "Download budget-notes.txt" }).click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(path)).toString()).toBe("Quarterly budget notes");
});

test("photos show as a picture with a download button, then full size", async () => {
  // A 64 x 48 PNG, so the browser can make a preview.
  const png = await femi.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0d47a1";
    context.fillRect(0, 0, 64, 48);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await femi.locator('input[type="file"]').setInputFiles({ name: "site-photo.png", mimeType: "image/png", buffer: Buffer.from(png) });
  const composer = femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` });
  await composer.fill("Site photo");
  await composer.press("Enter");

  // The sender sees their own photo straight away.
  await expect(thread(femi).getByRole("img", { name: "site-photo.png" })).toBeVisible();
  await expect(thread(femi).getByRole("button", { name: /^Download site-photo\.png/ })).toHaveCount(0);

  // The other person sees the preview with a download pill; opening it loads the full photo.
  await expect(thread(chidi).getByRole("img", { name: "site-photo.png" })).toBeVisible();
  await expect(thread(chidi).getByText("Site photo")).toBeVisible();
  await thread(chidi).getByRole("button", { name: /^Download site-photo\.png/ }).click();
  await expect(thread(chidi).getByRole("button", { name: /^Download site-photo\.png/ })).toHaveCount(0);
  await thread(chidi).getByRole("img", { name: "site-photo.png" }).click();
  const viewer = chidi.getByRole("dialog", { name: "site-photo.png" });
  await expect(viewer.getByRole("img", { name: "site-photo.png" })).toBeVisible();
  await chidi.keyboard.press("Escape");

  // Once downloaded it stays downloaded, after a reload too.
  await chidi.reload();
  await expect(thread(chidi).getByRole("img", { name: "site-photo.png" })).toBeVisible();
  await expect(thread(chidi).getByRole("button", { name: /^Download site-photo\.png/ })).toHaveCount(0);
});

test("voice messages are recorded, reviewed, sent and played", async () => {
  const composer = femi.getByRole("textbox", { name: `Message ${USERS.clerk.name}` });
  await expect(composer).toHaveValue("");
  await femi.getByRole("button", { name: "Record a voice message" }).click();
  await expect(femi.getByRole("timer")).toHaveText(/0:0[1-9]/, { timeout: 10_000 });

  // Stop to review it first: it can be played back before sending.
  await femi.getByRole("button", { name: "Stop and review" }).click();
  await expect(femi.getByRole("button", { name: /^Play voice message, 0:0\d/ })).toBeVisible();
  await femi.getByRole("button", { name: "Send voice message" }).click();

  // The other person gets a player, and the list says what it is.
  const play = thread(chidi).getByRole("button", { name: /^Play voice message, 0:0\d/ });
  await expect(play).toBeVisible();
  await expect(main(chidi).getByRole("button", { name: new RegExp(USERS.finance.name) })).toContainText(/Voice message \(0:0\d\)/);
  await play.click();
  await expect(thread(chidi).getByRole("button", { name: "Pause voice message" })).toBeVisible();
  await thread(chidi).getByRole("button", { name: "Pause voice message" }).click();
  await expect(thread(chidi).getByRole("button", { name: "Playback speed 1 times. Change speed" })).toBeVisible();

  // Cancelling a recording sends nothing.
  await femi.getByRole("button", { name: "Record a voice message" }).click();
  await expect(femi.getByRole("timer")).toBeVisible();
  await femi.getByRole("button", { name: "Cancel recording" }).click();
  await expect(composer).toBeVisible();
  await expect(thread(femi).getByRole("button", { name: /^Play voice message/ })).toHaveCount(1);
});

test("reactions are encrypted, live, one per person, and show in the list", async () => {
  // The first row with this text is the original photo message (replies quote it later).
  const photo = (page: Page) => thread(page).locator("[data-message-id]").filter({ hasText: "Site photo" }).first();
  const before = sentBodies.length;

  // Chidi reacts from the message menu (the hover button does the same).
  await photo(chidi).getByRole("button", { name: "Message options" }).click();
  await chidi.getByRole("menuitem", { name: "React" }).click();
  await chidi.getByRole("button", { name: "React with ❤️" }).click();
  await expect(photo(chidi).getByRole("button", { name: /^❤️ 1, You\. Remove your reaction/ })).toBeVisible();

  // Femi sees it live, and the list says who reacted to what.
  await expect(photo(femi).getByRole("button", { name: new RegExp(`^❤️ 1, ${USERS.clerk.name}\\.`) })).toBeVisible();
  await expect(
    main(femi).getByRole("list", { name: "Conversations" }).getByRole("button", { name: new RegExp(USERS.clerk.name) }),
  ).toContainText('Chidi reacted ❤️ to "Site photo"');

  // Femi adds the same emoji by choosing the chip: one chip, two people.
  await photo(femi).getByRole("button", { name: /^❤️ 1/ }).click();
  await expect(photo(chidi).getByRole("button", { name: /^❤️ 2, You and / })).toBeVisible();
  // The emoji never reached the server readable.
  expect(sentBodies.slice(before).join("\n")).not.toContain("❤");

  // Picking another emoji replaces your reaction; the full picker has every emoji.
  await photo(chidi).getByRole("button", { name: "Message options" }).click();
  await chidi.getByRole("menuitem", { name: "React" }).click();
  await chidi.getByRole("button", { name: "React with 😂" }).click();
  await expect(photo(femi).getByRole("button", { name: /^😂 1/ })).toBeVisible();
  await expect(photo(femi).getByRole("button", { name: /^❤️ 1, You\./ })).toBeVisible();
  await photo(chidi).getByRole("button", { name: "Message options" }).click();
  await chidi.getByRole("menuitem", { name: "React" }).click();
  await chidi.getByRole("button", { name: "More emoji" }).click();
  await expect(chidi.getByPlaceholder("Search emoji")).toBeVisible();
  await chidi.keyboard.press("Escape");

  // Choosing your own chip again removes it.
  await photo(chidi).getByRole("button", { name: /^😂 1, You\. Remove/ }).click();
  await expect(photo(femi).getByRole("button", { name: /^😂/ })).toHaveCount(0);
});

test("choosing a quoted message scrolls to the original", async () => {
  const photo = thread(chidi).locator("[data-message-id]").filter({ hasText: "Site photo" }).first();
  await photo.getByRole("button", { name: "Message options" }).click();
  await chidi.getByRole("menuitem", { name: "Reply" }).click();
  const reply = chidi.getByRole("textbox", { name: `Message ${USERS.finance.name}` });
  await reply.fill("Nice photo");
  await reply.press("Enter");

  // The quote shows on Femi's side, and choosing it brings the photo into view.
  const quote = thread(femi).getByRole("button", { name: /^Replying to You: Site photo\. Go to the original message/ });
  await expect(quote).toBeVisible();
  await thread(femi).evaluate((log) => log.parentElement?.scrollTo({ top: 0 }));
  await quote.click();
  const original = thread(femi).locator("[data-message-id]").filter({ hasText: "Site photo" }).first();
  await expect(original).toBeInViewport();
  await expect(original).toHaveClass(/bg-\[#0d47a1\]\/10/);
});

test("messages and files are forwarded with a Forwarded label and an optional note", async () => {
  // Chidi forwards a text, with a note, into a chat (here the same one, which is allowed).
  const text = thread(chidi).locator("[data-message-id]").filter({ hasText: "Nice photo" }).last();
  await text.getByRole("button", { name: "Message options" }).click();
  await chidi.getByRole("menuitem", { name: "Forward" }).click();
  const dialog = chidi.getByRole("dialog", { name: "Forward message" });
  await expect(dialog.getByRole("button", { name: "Forward", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: new RegExp(USERS.finance.name) }).click();
  await expect(dialog.getByText("1 of 5 selected")).toBeVisible();
  await dialog.getByPlaceholder("Add a message (optional)").fill("Look at this");
  await dialog.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(chidi.getByText(`Forwarded to ${USERS.finance.name}.`)).toBeVisible();

  const forwarded = thread(femi).locator("[data-message-id]").filter({ hasText: "Forwarded" }).filter({ hasText: "Nice photo" });
  await expect(forwarded).toHaveCount(1);
  await expect(thread(femi).getByText("Look at this")).toBeVisible();

  // Femi forwards a file: it arrives as a file, marked Forwarded, and nothing readable reached the server.
  const before = sentBodies.length;
  const file = thread(femi).locator("[data-message-id]").filter({ hasText: "budget-notes.txt" }).first();
  await file.getByRole("button", { name: "Message options" }).click();
  await femi.getByRole("menuitem", { name: "Forward" }).click();
  const femiDialog = femi.getByRole("dialog", { name: "Forward message" });
  await femiDialog.getByRole("checkbox", { name: new RegExp(USERS.clerk.name) }).click();
  await femiDialog.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(
    thread(chidi).locator("[data-message-id]").filter({ hasText: "Forwarded" }).filter({ hasText: "budget-notes.txt" }),
  ).toHaveCount(1);
  expect(sentBodies.slice(before).join("\n")).not.toContain("budget");
});

test("a profile picture from the header shows on messages; right-click opens reactions and actions", async () => {
  // A small square PNG, made in the browser.
  const png = await femi.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 40;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#16a34a";
    context.fillRect(0, 0, 40, 40);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await femi.getByRole("button", { name: "Add a profile picture" }).click();
  const dialog = femi.getByRole("dialog", { name: "Profile picture" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from(png) });
  // Choosing only previews it; nothing is uploaded until Upload.
  await expect(dialog.getByText("Preview. Choose Upload to use this picture.")).toBeVisible();
  await expect(femi.getByRole("button", { name: "Add a profile picture" })).toBeVisible();
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(femi.getByText("Profile picture updated.")).toBeVisible();
  await expect(femi.getByRole("button", { name: "Change your profile picture" }).locator("img")).toBeVisible();

  // Only images can be chosen.
  // The "updated" notice sits over the header button for a few seconds.
  await femi.getByRole("button", { name: "Change your profile picture" }).dispatchEvent("click");
  await femi
    .getByRole("dialog", { name: "Profile picture" })
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(femi.getByText("Choose an image file, such as a JPEG or PNG photo.")).toBeVisible();
  await femi.keyboard.press("Escape");

  // Chidi sees Femi's picture beside her messages (after the chat list refreshes).
  await chidi.reload();
  const fromFemi = thread(chidi).locator("[data-message-id]").filter({ hasText: "budget-notes.txt" }).first();
  await expect(fromFemi.locator('img[src*="profile-photos"]')).toBeVisible();
  // People without a picture keep their initials.
  const fromChidi = thread(chidi).locator("[data-message-id]").filter({ hasText: "Nice photo" }).first();
  await expect(fromChidi.locator('img[src*="profile-photos"]')).toHaveCount(0);
  await expect(fromChidi.getByText("CC", { exact: true })).toBeVisible();

  // Right-click: reactions with the message actions underneath, like WhatsApp.
  await fromChidi.getByText("Nice photo", { exact: true }).last().click({ button: "right" });
  await expect(chidi.getByRole("group", { name: "React to this message" })).toBeVisible();
  const menu = chidi.getByRole("group", { name: "Message actions" });
  await expect(menu.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Forward" })).toBeVisible();
  await menu.getByRole("button", { name: "Reply" }).click();
  await expect(chidi.getByText(/Replying to/)).toBeVisible();
  await chidi.getByRole("button", { name: "Cancel reply" }).click();
});

test("the drawer opens chat from any page", async () => {
  await chidi.goto("/dashboard");
  await chidi.getByRole("button", { name: /^Open chat/ }).click();
  const drawer = chidi.getByRole("dialog", { name: "Chat" });
  await drawer.getByRole("button", { name: new RegExp(USERS.finance.name) }).click();
  await expect(drawer.getByRole("log", { name: "Messages" }).getByText("budget-notes.txt").first()).toBeVisible();
  await chidi.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(chidi.getByRole("button", { name: /^Open chat/ })).toBeFocused();
});

test("signing out forgets the key; after signing back in only the PIN is asked", async () => {
  await femi.goto("/dashboard");
  await sidebar(femi).getByRole("button", { name: "Log out" }).click();
  await femi.getByRole("dialog").getByRole("button", { name: "Log out" }).click();
  await expect(femi).toHaveURL("/");

  await femi.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.finance.email);
  await femi.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await femi.getByRole("button", { name: "Sign in to Workspace" }).click();
  await expect(femi).toHaveURL(/\/dashboard/);

  // Signing in through the form keeps the password's part of the lock, so
  // chat asks only for the PIN.
  await femi.goto("/chat");
  await expect(main(femi).getByRole("heading", { name: "Enter your chat PIN" })).toBeVisible();
  await typePin(femi, /^Chat PIN/, "999999");
  await expect(femi.getByRole("alert").filter({ hasText: "That PIN is not right. 4 tries left" })).toBeVisible({ timeout: 20_000 });

  // A wrong recovery code is turned down on Continue, before any new PIN is asked for.
  await main(femi).getByRole("button", { name: "Forgot PIN?" }).click();
  const recoveryField = femi.getByLabel("Recovery code");
  await recoveryField.fill("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA");
  await femi.getByRole("button", { name: "Continue" }).click();
  await expect(femi.getByRole("alert").filter({ hasText: "That recovery code is not right." })).toBeVisible({ timeout: 20_000 });
  await expect(recoveryField).toHaveAttribute("aria-invalid", "true");
  await expect(main(femi).getByRole("heading", { name: "Choose a new PIN" })).toHaveCount(0);
  await main(femi).getByRole("button", { name: "Back to PIN" }).click();
  await typePin(femi, /^Chat PIN/, FEMI_PIN);
  await main(femi).getByRole("button", { name: new RegExp(USERS.clerk.name) }).click();
  await expect(thread(femi).getByText("budget-notes.txt").first()).toBeVisible();

  // Reloading keeps it unlocked for this sign-in.
  await femi.reload();
  await expect(thread(femi).getByText("budget-notes.txt").first()).toBeVisible();
});

test("resetting chat needs the code emailed to the user", async () => {
  await chidi.goto("/chat");
  await main(chidi).getByRole("button", { name: "Chat settings" }).click();
  await chidi.getByRole("menuitem", { name: "Lock chat on this computer" }).click();
  await chidi.getByLabel("Portal password").fill(PASSWORD);
  await main(chidi).getByRole("button", { name: "Continue" }).click();
  await main(chidi).getByRole("button", { name: "Forgot PIN?" }).click();
  await main(chidi).getByRole("button", { name: "Lost the recovery code too?" }).click();

  await expect(main(chidi).getByRole("heading", { name: "Reset your chat" })).toBeVisible();
  await expect(main(chidi).getByText(/stays unreadable to you, for good/)).toBeVisible();
  await expect(main(chidi).getByRole("button", { name: "Email me a code" })).toBeDisabled();
  await main(chidi).getByLabel("I understand my earlier messages will not be available to me.").check();
  await main(chidi).getByRole("button", { name: "Email me a code" }).click();

  await expect(main(chidi).getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(main(chidi).getByText(USERS.clerk.email)).toBeVisible();
  const code = await chatResetCodeFor(USERS.clerk.email);
  expect(code).toMatch(/^(?=.*\d)(?=.*[A-Z])[0-9A-Z]{8}$/);

  // Continue waits for a code; a wrong one is turned down straight away.
  const field = chidi.getByLabel("Reset code");
  await expect(main(chidi).getByRole("button", { name: "Continue" })).toBeDisabled();
  await field.fill("ABC");
  await main(chidi).getByRole("button", { name: "Continue" }).click();
  await expect(chidi.getByRole("alert").filter({ hasText: "That code is not right." })).toBeVisible();
  await field.fill(code === "ZZZZ9999" ? "YYYY9999" : "ZZZZ9999");
  await main(chidi).getByRole("button", { name: "Continue" }).click();
  await expect(chidi.getByRole("alert").filter({ hasText: "That code is not right. 4 tries left." })).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(main(chidi).getByRole("button", { name: /^Send a new code in \d+s$/ })).toBeDisabled();

  await field.fill(code.toLowerCase());
  await main(chidi).getByRole("button", { name: "Continue" }).click();
  // The password was given on the unlock screen, so it is not asked again.
  await expect(main(chidi).getByRole("heading", { name: "Choose a new PIN" })).toBeVisible();
  await typePin(chidi, /^New chat PIN/, "246810");
  await typePin(chidi, /^Confirm chat PIN/, "246810");
  await expect(main(chidi).getByRole("heading", { name: "Save your recovery code" })).toBeVisible({ timeout: 20_000 });

  // The other person is told.
  await femi.goto("/chat");
  await main(femi).getByRole("button", { name: new RegExp(USERS.clerk.name) }).click();
  await expect(thread(femi).getByText(`${USERS.clerk.name} reset their chat.`, { exact: false })).toBeVisible();
});
