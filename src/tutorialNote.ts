import { addNote, getMeta, setMeta } from './db';

const TUTORIAL_FLAG = 'tutorial-note-v1';

const TUTORIAL_MARKDOWN = `# 📖 Welcome to Foundation

*Your notes live here. This one is **pinned** to the top — unpin it with the 📌 when you're ready, or delete it once you've got the hang of things.*

---

## ✍️ Notes are Markdown

Type plainly, or format with the toolbar (or shortcuts):

- **Bold** with \`**text**\` — or **Ctrl+B**
- *Italic* with \`*text*\` — or **Ctrl+I**
- [Links](https://example.com) with **Ctrl+K**
- \`inline code\`, and lists like this one
- > Blockquotes for the words that matter most

Flip between **Write** and **Preview** at any time. A note can be anchored to a **verse**, a **chapter**, a **book**, or left **Freeform** (like this one) — pick from the dropdown before saving.

---

## 🖍️ Highlighters

1. Click a verse in the reader (**Shift+click** for a range).
2. In the bar that pops up, tap a **color** to highlight — or **⌫** to clear.

Highlights stay put, show in **every translation**, and gather under the **Highlights** tab. Rename, recolor, or add your own palette colors there — think *Promises*, *Commands*, *Prophecy*…

---

## 🔗 Links (Bindings)

Tie two verses together — a prophecy to its fulfillment, a question to its answer:

1. Select the first verse → click **🔗 Bind**.
2. Select the second verse (any pane) → click **Bind**.

Bound verses wear a **dashed outline**. Manage them under the **Links** tab, where you can **Loose** a link, give it a color, or send it to a note.

> *Isaiah 53:5 🔗 1 Peter 2:24* — try it.

---

## 📌 Pinning, 📥 Import & 📤 Export

- **Pin** any note (📌 on its card) to keep it at the top.
- Bring notes in from other apps with **📥** (Markdown, text, RTF, HTML).
- Back everything up with **📤** — one tidy Markdown file.
- Send **highlights** and **links** straight into a note from their tabs.
- Pop the whole panel out to its own window with **⧉** for a second screen.

---

*Happy studying. — Foundation*
`;

// Seed the pinned tutorial note once. Idempotent via a meta flag, so it
// won't come back if the user deletes it.
export async function seedTutorialNoteIfNeeded(): Promise<void> {
  if ((await getMeta(TUTORIAL_FLAG)) !== null) return;
  await addNote({ title: '📖 Welcome to Foundation — start here', content: TUTORIAL_MARKDOWN, pinned: true });
  await setMeta(TUTORIAL_FLAG, new Date().toISOString());
}
