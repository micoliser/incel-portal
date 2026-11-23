/**
 * Profile pictures: the browser crops the chosen image to a square, shrinks it
 * and saves it as JPEG, then uploads it the way other portal images are
 * uploaded (a signed link straight to storage, then the API checks the file
 * and saves its address).
 */
import axios from "axios";

import { apiClient } from "@/lib/api-client";

const EDGE = 512;
const QUALITY = 0.86;
/** What people may choose; anything the browser can decode as an image works. */
export const PROFILE_PHOTO_MAX_INPUT_BYTES = 20 * 1024 * 1024;

export class NotAnImageError extends Error {
  constructor() {
    super("Choose an image file, such as a JPEG or PNG photo.");
  }
}

/** Crop to the centre square and shrink to 512 × 512 JPEG. */
export async function prepareProfilePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") throw new NotAnImageError();
  if (file.size > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    throw new Error("That image is over 20 MB. Choose a smaller one.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new NotAnImageError();
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const edge = Math.min(EDGE, side);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the picture.");
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("This browser could not prepare the picture.");
    return new File([blob], "profile.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/** Upload a prepared picture and make it the profile picture. Returns the updated user. */
export async function uploadProfilePhoto<T>(photo: File): Promise<T> {
  const { data: signed } = await apiClient.post<{ upload_url: string; public_url: string }>(
    "/me/profile-photo/upload-url",
    { content_type: photo.type, size: photo.size },
  );
  await axios.put(signed.upload_url, photo, { headers: { "Content-Type": photo.type } });
  const { data } = await apiClient.put<T>("/me/profile-photo", { avatar_url: signed.public_url });
  announceProfileChange();
  return data;
}

export async function removeProfilePhoto<T>(): Promise<T> {
  const { data } = await apiClient.delete<T>("/me/profile-photo");
  announceProfileChange();
  return data;
}

/** Tells the rest of the page (chat) to refresh people's pictures. */
export const PROFILE_CHANGED_EVENT = "portal-profile-changed";

function announceProfileChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}
