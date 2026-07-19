# Foundation — Visual Theme System

Six themes, ranging dark → light, each with its own gradient identity so the
app has real visual depth instead of a single dark/light toggle. This doc
gives Claude Code everything needed to implement them: full token sets,
gradient recipes, and the integration plan.

---

## 0. Design approach

Right now Foundation has one axis: light/dark, OS-aware, via CSS variables.
This expands that into a **theme registry**: a named set of CSS custom
properties per theme, selected via a `data-theme` attribute on `<html>`,
with the existing dark-mode logic becoming just one entry in the registry
(or the fallback when no theme is chosen).

Every theme defines the same variable contract, so components never
hardcode colors — they only ever reference variables. That contract:

```css
--bg-base          /* app shell background (gradient lives here) */
--bg-surface        /* pane / panel background */
--bg-surface-raised  /* modals, popovers, the concordance pane */
--bg-hover           /* row/button hover */
--border             /* hairline dividers, pane borders */
--border-strong      /* focused pane border, active tab */
--text-primary       /* body/reading text — HIGH CONTRAST, protected */
--text-secondary     /* labels, verse numbers, metadata */
--text-muted         /* footnote markers, timestamps */
--accent-primary      /* links, active states, selected word */
--accent-secondary     /* secondary highlight, Strong's tag glow */
--accent-tertiary      /* rare — used sparingly for a signature detail */
--scrollbar-thumb
--gradient-shell     /* full CSS background-image value for the app shell */
```

**Reading text is protected across all six themes.** `--text-primary` is
tuned per theme for contrast against `--bg-surface`, not against the
gradient — the actual verse/reading pane always sits on `--bg-surface`,
which is a flat (non-gradient) color, so Strong's number tagging,
footnote markers, and search highlighting stay legible everywhere. The
gradient is a shell/chrome effect (header, sidebar, app background behind
panes), never something reading text sits directly on top of.

---

## 1. Obsidian — deep black, metallic accents

Cold, precise, machined. Chrome and gunmetal rather than warm black.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0a0a0c` | shell |
| `--bg-surface` | `#151517` | panes |
| `--bg-surface-raised` | `#1c1c1f` | modals |
| `--bg-hover` | `#202023` | hover |
| `--border` | `#2a2a2e` | dividers |
| `--border-strong` | `#6b6f78` | active pane |
| `--text-primary` | `#e8e8ea` | reading text |
| `--text-secondary` | `#a3a3aa` | labels |
| `--text-muted` | `#6e6e76` | footnotes |
| `--accent-primary` | `#c4c9d4` | links (brushed steel) |
| `--accent-secondary` | `#8a93a3` | Strong's glow |
| `--accent-tertiary` | `#dfae61` | rare — one warm "brass" detail (e.g. active Strong's number) |
| `--scrollbar-thumb` | `#3a3a3e` | |
| `--gradient-shell` | `linear-gradient(160deg, #0a0a0c 0%, #131316 45%, #0d0d10 75%, #050506 100%)` | subtle diagonal sheen, like light on brushed metal |

Signature detail: a very faint 1px `linear-gradient` highlight along the
top edge of the active pane header (`rgba(255,255,255,0.06)` to
transparent) — mimics a bevel catching light.

---

## 2. Midnight — dark violet, glossy accents

Deep indigo-black with jewel-toned glossy highlights (amethyst + teal
glass), not neon.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0e0a1c` | shell |
| `--bg-surface` | `#181229` | panes |
| `--bg-surface-raised` | `#201934` | modals |
| `--bg-hover` | `#261f3d` | hover |
| `--border` | `#2e2547` | dividers |
| `--border-strong` | `#7c5cff` | active pane |
| `--text-primary` | `#e8e4f5` | reading text |
| `--text-secondary` | `#a99fc7` | labels |
| `--text-muted` | `#6e6490` | footnotes |
| `--accent-primary` | `#8b6ef2` | links (amethyst) |
| `--accent-secondary` | `#4fd7c4` | Strong's glow (glossy teal) |
| `--accent-tertiary` | `#f2a3d0` | rare — orchid detail |
| `--scrollbar-thumb` | `#332a52` | |
| `--gradient-shell` | `radial-gradient(ellipse at top left, #241a3f 0%, #150f28 40%, #0e0a1c 100%)` | soft violet glow bleeding from one corner |

Signature detail: selected Strong's word gets a soft `box-shadow: 0 0 12px
rgba(79,215,196,0.35)` — a glossy "wet ink" glow rather than a flat
highlight background.

---

## 3. Cosmic — black with vaporwave color

The boldest theme. Deep black base keeps it usable for long reading; the
vaporwave palette lives in accents and the shell gradient only.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0a0014` | shell |
| `--bg-surface` | `#140a24` | panes |
| `--bg-surface-raised` | `#1c1030` | modals |
| `--bg-hover` | `#241736` | hover |
| `--border` | `#2c1b42` | dividers |
| `--border-strong` | `#ff6ec7` | active pane |
| `--text-primary` | `#f0e9fb` | reading text |
| `--text-secondary` | `#b39ddb` | labels |
| `--text-muted` | `#7a5f9e` | footnotes |
| `--accent-primary` | `#00e5ff` | links (cyan) |
| `--accent-secondary` | `#ff6ec7` | Strong's glow (pink) |
| `--accent-tertiary` | `#a742ff` | rare — purple detail |
| `--scrollbar-thumb` | `#3a2358` | |
| `--gradient-shell` | `linear-gradient(135deg, #0a0014 0%, #170a2e 35%, #240f3d 55%, #14082a 80%, #0a0014 100%)` with a low-opacity `radial-gradient(circle at 80% 20%, rgba(255,110,199,0.12), transparent 50%)` layered on top | dusk-horizon gradient with one pink "sun" glow |

Signature detail: this is the one theme worth a *very* restrained animated
touch — the pink radial glow in the header can drift 2–3% over 20s
(`prefers-reduced-motion` disables it entirely). Everything else in this
theme stays still; one moving element, not several.

---

## 4. Sunset — dark orange/red, lava accents

Warm and low-key, like reading by firelight. Lava accents are for glow,
never large fills.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#1a0d08` | shell |
| `--bg-surface` | `#28140c` | panes |
| `--bg-surface-raised` | `#331a10` | modals |
| `--bg-hover` | `#3d2013` | hover |
| `--border` | `#452a1c` | dividers |
| `--border-strong` | `#ff5722` | active pane |
| `--text-primary` | `#fbe6d4` | reading text |
| `--text-secondary` | `#d9a583` | labels |
| `--text-muted` | `#a3745a` | footnotes |
| `--accent-primary` | `#ff7043` | links (ember) |
| `--accent-secondary` | `#ffab40` | Strong's glow (amber) |
| `--accent-tertiary` | `#ff1744` | rare — hot-red detail |
| `--scrollbar-thumb` | `#4a2a18` | |
| `--gradient-shell` | `linear-gradient(180deg, #1a0d08 0%, #2b140a 40%, #3d1810 70%, #24100a 100%)` with `radial-gradient(circle at 50% 100%, rgba(255,87,34,0.10), transparent 60%)` | dark horizon with a low ember glow rising from the bottom, like distant lava |

---

## 5. Emerald — vibrant green, earthy accents

The one "vibrant" dark theme — forest depth rather than black, warmed by
wood/clay/gold tones.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0e1f16` | shell |
| `--bg-surface` | `#16301f` | panes |
| `--bg-surface-raised` | `#1c3a27` | modals |
| `--bg-hover` | `#234630` | hover |
| `--border` | `#2b4d36` | dividers |
| `--border-strong` | `#4caf7d` | active pane |
| `--text-primary` | `#e6f2e9` | reading text |
| `--text-secondary` | `#a8cbb4` | labels |
| `--text-muted` | `#729b80` | footnotes |
| `--accent-primary` | `#5fd393` | links (leaf) |
| `--accent-secondary` | `#d4a24e` | Strong's glow (gold, like gilt page edges) |
| `--accent-tertiary` | `#b08968` | rare — clay/wood detail |
| `--scrollbar-thumb` | `#2f5a3e` | |
| `--gradient-shell` | `linear-gradient(160deg, #0e1f16 0%, #163527 45%, #0f2a1c 75%, #0a1c12 100%)` | canopy-to-forest-floor depth |

Signature detail: footnote `°` markers render in `--accent-secondary`
gold instead of gray — a small nod to gilt-edged Bible pages that's easy
to reuse across all themes but reads best here.

---

## 6. Nova — daylight, pastel accents

The only light theme. Warm paper-white base (not stark white), pastel
accents kept desaturated so nothing fights the reading text.

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#faf7f2` | shell |
| `--bg-surface` | `#ffffff` | panes |
| `--bg-surface-raised` | `#ffffff` (with `box-shadow`, not color, for elevation) | modals |
| `--bg-hover` | `#f2ede3` | hover |
| `--border` | `#e6ddd0` | dividers |
| `--border-strong` | `#8fb8d9` | active pane |
| `--text-primary` | `#2b2924` | reading text |
| `--text-secondary` | `#6b6457` | labels |
| `--text-muted` | `#9a9284` | footnotes |
| `--accent-primary` | `#7ba7cc` | links (sky pastel) |
| `--accent-secondary` | `#e8a3b3` | Strong's glow (blush) |
| `--accent-tertiary` | `#a8cca0` | rare — mint detail |
| `--scrollbar-thumb` | `#d9d0c0` | |
| `--gradient-shell` | `linear-gradient(160deg, #faf7f2 0%, #f5efe4 50%, #f0e8da 100%)` | warm paper gradient, barely-there |

This is the theme most likely to be used in daylight for long sessions, so
contrast ratios matter most here — `--text-primary` on `--bg-surface` is
~13:1, comfortably past AA/AAA for body text.

---

## Integration plan for Claude Code

### 1. Replace the boolean dark-mode flag with a theme registry

Currently (per README) dark mode is OS-aware via CSS variables with a
manual toggle, and theme choice is already part of what gets persisted
alongside layout/pane-count/reference. Extend that persisted value from a
boolean to a string theme id:

```ts
// src/themes.ts
export type ThemeId =
  | "obsidian" | "midnight" | "cosmic"
  | "sunset" | "emerald" | "nova";

export const THEMES: Record<ThemeId, ThemeMeta> = {
  obsidian: { label: "Obsidian", mode: "dark", swatch: ["#0a0a0c", "#c4c9d4", "#dfae61"] },
  midnight: { label: "Midnight", mode: "dark", swatch: ["#0e0a1c", "#8b6ef2", "#4fd7c4"] },
  cosmic:   { label: "Cosmic",   mode: "dark", swatch: ["#0a0014", "#00e5ff", "#ff6ec7"] },
  sunset:   { label: "Sunset",   mode: "dark", swatch: ["#1a0d08", "#ff7043", "#ffab40"] },
  emerald:  { label: "Emerald",  mode: "dark", swatch: ["#0e1f16", "#5fd393", "#d4a24e"] },
  nova:     { label: "Nova",     mode: "light",swatch: ["#faf7f2", "#7ba7cc", "#e8a3b3"] },
};
```

`mode` (`dark`/`light`) is kept per-theme so the existing OS-aware default
logic still works: on first run, pick `obsidian` or `nova` based on
`prefers-color-scheme`, same as today's boolean did, then let the user
override to any of the six.

### 2. CSS: one file, `data-theme` selectors

Add `src/styles/themes.css`, imported once in your global stylesheet.
Each theme is a flat block of custom-property overrides scoped to
`[data-theme="..."]` on `<html>`:

```css
:root {
  /* fallback = obsidian, so an unthemed state never breaks */
  --bg-base: #0a0a0c;
  --bg-surface: #151517;
  /* ...full obsidian set as default... */
}

[data-theme="midnight"] {
  --bg-base: #0e0a1c;
  --bg-surface: #181229;
  --border-strong: #7c5cff;
  --accent-primary: #8b6ef2;
  --accent-secondary: #4fd7c4;
  --gradient-shell: radial-gradient(ellipse at top left, #241a3f 0%, #150f28 40%, #0e0a1c 100%);
  /* ...rest of table 2 above... */
}

/* cosmic, sunset, emerald, nova follow the same pattern */
```

Apply the theme by setting the attribute, not by swapping stylesheets:

```ts
document.documentElement.setAttribute("data-theme", themeId);
```

This keeps theme switching instant (no FOUC, no stylesheet reload) and
makes it trivial to preview a theme on hover in the picker before
committing.

### 3. Where the gradient actually goes

`--gradient-shell` should be applied to exactly one element — the app
shell / outermost container — as `background-image`, with `--bg-base` as
`background-color` fallback:

```css
.app-shell {
  background-color: var(--bg-base);
  background-image: var(--gradient-shell);
  background-attachment: fixed; /* gradient doesn't repeat/scroll oddly under panes */
}

.pane, .modal, .concordance-pane {
  background-color: var(--bg-surface); /* flat, protects reading contrast */
}
```

This is the key rule to keep the reading experience solid across all six
themes: **panes are flat, the shell is gradient.** Never apply
`--gradient-shell` to `.pane` directly.

### 4. Component audit

Grep for any hardcoded hex/rgb values in `src/components/` (Pane,
NotesPanel, SearchPanel, ImportWizard, LibraryPanel, StrongsWords) and
replace with the variable contract from Section 0. This is the actual
work — the token tables above are only correct if nothing in the
component tree bypasses them. Pay particular attention to:

- `StrongsWords.tsx` — the click-highlight and hover states almost
  certainly have a hardcoded highlight color today; move to
  `--accent-secondary`.
- Any `box-shadow` glows on active/focused elements — these should read
  per-theme too (Midnight and Cosmic lean on glow as their signature
  effect; Obsidian and Nova should stay closer to flat).
- Scrollbar styling (`::-webkit-scrollbar-thumb`) — currently likely one
  hardcoded gray.

### 5. Theme picker UI

A settings panel section with six swatch buttons (using the `swatch`
tuples above — base/accent1/accent2 as three stacked or diagonal color
chips) rather than a dropdown of names. Selecting one:

1. Sets `data-theme` immediately (live preview, no confirm step).
2. Persists via the same mechanism already used for pane
   layout/theme/reference (per README, this already exists — extend the
   stored value rather than adding a new persistence path).

### 6. Accessibility notes for Claude Code to keep in mind

- Verify `--text-primary` on `--bg-surface` meets 4.5:1 for all six —
  the tables above were chosen with that in mind but should be checked
  against final rendered fonts/sizes, not just spot-checked by eye.
- `--border-strong` (used for focus rings) must be distinguishable from
  `--border` at a glance — this is what carries keyboard-navigation
  visibility once the accessibility pass in the roadmap happens, so don't
  let any theme's focus color get too close to its own background.
- Cosmic's drift animation and any other motion must respect
  `prefers-reduced-motion: reduce` — disable entirely, don't just slow
  down.
- Don't let `--accent-tertiary` ("rare" colors) leak into more than one
  or two UI touchpoints per theme — that's what keeps six themes from
  turning into six busy themes.
