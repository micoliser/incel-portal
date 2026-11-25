import fs from "node:fs";
import path from "node:path";

import { expect, type Browser, type Page } from "@playwright/test";

/**
 * The test API writes every email it would send as a file in this directory
 * (see e2e/scripts/api-server.sh), so tests can read what a user was sent.
 */
const MAILBOX = path.resolve(__dirname, "..", ".mail");

/** Undo quoted-printable encoding, which wraps long lines and escapes "=". */
function decode(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function messagesTo(address: string): string[] {
  if (!fs.existsSync(MAILBOX)) return [];
  return fs
    .readdirSync(MAILBOX)
    .map((name) => path.join(MAILBOX, name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
    .flatMap((file) => fs.readFileSync(file, "utf8").split(/^-{20,}$/m))
    .filter((message) => new RegExp(`^To: .*${address.replace(/[.+]/g, "\\$&")}`, "m").test(message))
    .map(decode);
}

/** How many emails have been sent to the address so far. */
export function emailCount(address: string): number {
  return messagesTo(address).length;
}

/** The newest set-password or reset-password link emailed to the address, as a portal path. */
export async function passwordLinkFor(address: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const matches = messagesTo(address)
          .map((message) => message.match(/\/reset-password\?uid=[\w-]+&(?:amp;)?token=[\w-]+/))
          .filter((match): match is RegExpMatchArray => match !== null);
        link = matches.at(-1)?.[0].replace("&amp;", "&");
        return link;
      },
      { message: `a password link should be emailed to ${address}` },
    )
    .toBeTruthy();
  return link as string;
}

/** The newest chat reset code emailed to the address (it is in the subject). */
export async function chatResetCodeFor(address: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      () => {
        code = messagesTo(address)
          .map((message) => message.match(/^Subject: Your chat reset code: ([0-9A-Z]{8})\r?$/m)?.[1])
          .filter(Boolean)
          .at(-1);
        return code;
      },
      { message: `a chat reset code should be emailed to ${address}` },
    )
    .toBeTruthy();
  return code as string;
}

/** Follow the newest password link sent to the address and choose a password. */
export async function setPasswordFromEmail(page: Page, address: string, password: string) {
  await page.goto(await passwordLinkFor(address));
  await page.getByPlaceholder("Enter new password").fill(password);
  await page.getByPlaceholder("Repeat new password").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Credentials Updated Successfully")).toBeVisible();
}

/** A browser session with nobody signed in. */
export async function signedOutPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}
