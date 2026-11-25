"use client";

import Picker, { EmojiStyle, Theme } from "emoji-picker-react";

/**
 * Every emoji, with search and categories. Uses the device's own emoji (no
 * images are downloaded). Loaded on demand from reactions.tsx.
 */
export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <Picker
      onEmojiClick={(data) => onPick(data.emoji)}
      emojiStyle={EmojiStyle.NATIVE}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      lazyLoadEmojis
      previewConfig={{ showPreview: false }}
      searchPlaceHolder="Search emoji"
      width={320}
      height={360}
      autoFocusSearch
    />
  );
}
