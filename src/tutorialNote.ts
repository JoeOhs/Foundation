import { addNote, getMeta, setMeta } from './db';

const TUTORIAL_FLAG = 'tutorial-note-v1';
const MARKDOWN_FLAG = 'markdown-note-v1';

// Pinned notes sort by updated_at DESC. Backdating this one parks it below
// the welcome note (and below anything the user has pinned themselves)
// rather than jumping to the top of an existing user's list.
const MARKDOWN_NOTE_TIMESTAMP = '2000-01-01 00:00:00';

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

const MARKDOWN_MARKDOWN = `# 🧰 Advanced Markdown

*Pinned like the welcome note — unpin it with 📌, or delete it once you've taken what you need.*

Foundation renders **GitHub-Flavored Markdown**. Everything below works as written — flip to **Preview** to see it.

---

## 📊 Tables

| Reference | Theme | Note |
|---|---|---|
| Isaiah 53:5 | Atonement | "by his stripes we are healed" |
| 1 Peter 2:24 | Atonement | quotes Isaiah directly |
| Romans 5:8 | Love | "while we were yet sinners" |

Colons in the divider row set alignment — \`|:---|\` left, \`|:---:|\` centered, \`|---:|\` right.

## ☑️ Task lists

- [x] Read the chapter through once
- [ ] Trace the Old Testament quotations
- [ ] Write the summary

## ✂️ Strikethrough, nesting, quotes

~~Struck through~~ with \`~~text~~\`.

1. An outer point
   1. A nested point — indent three spaces
   - Mixed list types nest happily
     > and blockquotes nest inside lists too

## 💻 Code blocks

Fence a block with three backticks to keep text exactly as typed, in a monospaced font — handy for transliteration and original-language lines:

\`\`\`
bere'shit bara' 'elohim
ἐν ἀρχῇ ἦν ὁ λόγος
\`\`\`

## ✏️ Line breaks

One **Enter** starts a new line here — most Markdown editors need two. Leave a blank line when you want a genuinely new paragraph.

## 🖼️ Images and dividers

\`![caption](file:///C:/path/to/image.png)\` embeds a local image. Headings run \`#\` through \`######\`, and \`---\` alone on a line draws a divider like the ones in this note.

---

## 📥 Importing

**📥** at the top of this panel accepts **.md**, **.markdown**, **.txt**, **.rtf**, **.html** and **.htm** — pick as many files at once as you like. Each file becomes one note, its filename becomes the title, and RTF and HTML are converted to Markdown on the way in.

Imported notes arrive **Free-form** (unanchored). To tie one to Scripture, expand it, click **Edit**, and choose a verse, chapter or book from the dropdown before saving.

## 📤 Exporting

**📤** writes *every* note into a single file named \`foundation-notes-YYYY-MM-DD.md\`. Each note appears as:

- a \`##\` heading carrying its anchor — \`Genesis 1:1\`, \`Freeform\`, and so on
- a \`###\` heading with its title, when it has one
- the note body, with \`---\` separating one note from the next

It is a plain, portable text file. Nothing proprietary, and nothing leaves your machine.

---

## 🪴 Taking your notes to Obsidian

The export is ordinary Markdown, so an Obsidian vault reads it as-is:

1. Export with **📤**.
2. Drop the \`.md\` file into any folder inside your vault.
3. Open Obsidian — it arrives as one long note, each Foundation note a \`##\` section in the outline.

Want one file per note instead? Obsidian's built-in **Note Composer** ("Split note") breaks it apart at the headings, as will any split-by-heading community plugin. The same file imports cleanly into Logseq, Zettlr, or anything else that speaks Markdown.

Two honest caveats:

- Obsidian's own extras — \`[[wikilinks]]\`, YAML frontmatter, callouts — mean nothing to Foundation. Bring a note back in and they survive as literal text, so the words return but the graph does not.
- Your **Links** (verse bindings) and **highlight** colors live in Foundation's database, not in the note text. Send them into a note first from the **Links** and **Highlights** tabs if you want them to travel.

---

*Back to your studies. — Foundation*
`;

// Seed the pinned tutorial notes once each. Idempotent via per-note meta
// flags, so a deleted note stays deleted, and a note added in a later
// version still reaches users who already have the earlier ones.
export async function seedTutorialNoteIfNeeded(): Promise<void> {
  if ((await getMeta(TUTORIAL_FLAG)) === null) {
    await addNote({ title: '📖 Welcome to Foundation — start here', content: TUTORIAL_MARKDOWN, pinned: true });
    await setMeta(TUTORIAL_FLAG, new Date().toISOString());
  }
  if ((await getMeta(MARKDOWN_FLAG)) === null) {
    await addNote({
      title: '🧰 Advanced Markdown — tables, import & export',
      content: MARKDOWN_MARKDOWN,
      pinned: true,
      updated_at: MARKDOWN_NOTE_TIMESTAMP,
    });
    await setMeta(MARKDOWN_FLAG, new Date().toISOString());
  }
}
