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

## Native form controls

A `<select>` left at the browser default (`appearance: auto`) has its box
themed by our CSS but its **arrow drawn by the UA in system colours**, which
makes every dropdown read as un-themed next to the controls around it — in
all six themes, not just the dark ones. So `select` sets `appearance: none`
and draws the caret itself (two `linear-gradient` halves of a chevron) on
`--text-secondary`, which means it tracks the theme like the rest of the
control. `padding-right: 26px` is the caret's room; trimming it runs the
option text under the caret.

The **open option list** needs its own rule. Chromium renders a select's
popup itself on Windows rather than handing it to the OS menu system, so
`select option` does take our `background-color`/`color` — without that rule
the rows fall back to the browser's own grey panel, which is what makes an
opened dropdown look un-themed even when the closed control is correct.
`option:checked` gets `--bg-hover` so the current row reads as selected in
the theme's own palette rather than the Windows highlight blue.

`color-scheme` (set per theme in `themes.css`: `dark` on `:root`, `light` on
`nova`) still matters as the fallback for any chrome that does reach the
platform renderer — scrollbars inside a long popup, for one.

## Texture & depth

Flat gradients read as "dark mode with a hue," not as six distinct
materials. This section pushes each theme toward its actual namesake —
metal, glass, neon-grid, lava, canopy, paper — using pure CSS/SVG only
(no bundled image assets, so nothing here touches the offline/licensing
constraints).

### Shared technique: grain overlay

Before anything theme-specific, one shared layer does the most work: a
fixed, full-viewport noise texture over the gradient shell, generated
inline via SVG `feTurbulence` (no asset file) at very low opacity with
`mix-blend-mode: soft-light` *(shipped: `overlay` acts as `screen` on dark
backgrounds — a flat brightness wash with no visible texture; `soft-light`
adds grain without the wash; Nova overrides to `multiply` since paper
fiber must darken white, not lighten it)*. This alone turns a smooth
gradient into something that reads as a *surface*.

```css
.app-shell::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  opacity: calc(var(--grain-opacity, 0.05) * var(--texture-opacity));
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,\
    <svg xmlns='http://www.w3.org/2000/svg'>\
      <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter>\
      <rect width='100%25' height='100%25' filter='url(%23n)'/>\
    </svg>");
}
```

`--grain-opacity` and `--grain-tint` (set via `filter: sepia() hue-rotate()`
on the pseudo-element, or a CSS `filter` on the SVG itself) are set per
theme so the same mechanism produces brushed-metal grain, paper fiber, or
heat-shimmer depending on context. `--texture-opacity` is the master
toggle described below — multiplying by it means grain (and everything
else in this section) degrades to fully invisible with the toggle off,
with no separate code path.

### Per-theme signature texture

**Obsidian — machined metal**
- Replace the flat sheen with a `repeating-linear-gradient` of
  near-invisible diagonal light/dark lines — brushed aluminum under
  raking light.
- Beveled panes: `box-shadow: inset 1px 1px 0 rgba(255,255,255,0.04), inset -1px -1px 0 rgba(0,0,0,0.4)` — reads as a machined plate, not a flat rectangle.
- A specular line (`linear-gradient(90deg, transparent, var(--accent-tertiary), transparent)` at 1px height, ~15% opacity) under the active pane header.

**Midnight — glass and gemstone**
- Modals/popovers get `backdrop-filter: blur(16px)` over a translucent
  `--bg-surface-raised` — frosted glass floating over the violet depth,
  not a flat card.
- A small offset radial-gradient "facet" highlight on cards, mimicking
  light hitting one face of a cut gem.
- A sparse star-speckle overlay across the whole app (`.app::after`,
  tiled `radial-gradient` dots at offset `background-size`s so no grid
  pattern emerges, `mix-blend-mode: screen` at ~half opacity) —
  barely-there stars that survive the panes' opaque backgrounds.
- *(shipped)* The token set was darkened from the original table
  (`--bg-base: #070512`, `--bg-surface: #100b1e`) — "close to black with
  speckles of stars" needed a near-black base, not dark violet.

**Cosmic — galactic nebula** *(shipped direction — replaced the original
"synthwave grid" concept, which read as scanlines rather than "cosmic")*
- A nebula field of soft radial/conic gradient patches on `body::before`
  (behind the panes), visible through shell gaps, with the slow 20s drift
  animation.
- A *very* faint full-viewport nebula wash on `.app::after`
  (`mix-blend-mode: screen`, alphas ≤0.06, huge soft ellipses only — hard
  edges or higher alphas bleed color into the reading panes) so the
  galactic feel carries over the panes without touching legibility.

**Sunset — lava and ember**
- Grain tinted orange/red here specifically (`--grain-tint: sepia(1) saturate(3) hue-rotate(-20deg)`), so it reads as ash/heat-shimmer.
- Stack two or three radial glows at different sizes/positions/opacities
  near the bottom instead of one clean circle — closer to how uneven lava
  light actually looks.
- Section dividers use a jagged `clip-path` (small repeating triangle
  notches) instead of a straight hairline — cracked earth rather than a
  ruled line.

**Emerald — canopy and forest floor**
- Dappled light: 4–5 soft, irregularly-placed low-opacity radial
  gradients scattered across the shell (varying size, ~4-8% opacity) —
  sunlight through leaves, breaks up flatness more than one directional
  gradient can.
- A faint wood-grain streak (`repeating-linear-gradient` with irregular
  stop spacing) on raised/earthy surfaces — settings panels, gold-accented
  elements.
- Slightly stronger edge vignette (`radial-gradient` darkening toward the
  corners) than the other themes — forest depth, things receding into
  shadow.

**Nova — paper and daylight**
- Needs texture most — flat white reads cheapest of the six. Paper-grain
  via the shared technique, warm-tinted, at a *higher* opacity than the
  dark themes (paper fiber is more visible than metal grain).
- Elevation via soft, warm-tinted diffuse shadows
  (`box-shadow: 0 2px 12px rgba(120,100,70,0.08)`) instead of black
  shadows — daylight-on-paper shadows are soft and warm, not dark.
- Optional: a faint deckle/fiber edge (irregular `clip-path` or a subtle
  `mask-image` noise on the border) on Notes cards specifically, since
  Notes is the "physical page" surface of the app.

### Restraint

Texture should read as *material*, not *decoration* — this is a calm
study tool, not a game UI. Keep motion limited to the one spot already
flagged in Cosmic. Keep grain/noise opacity low enough to be felt rather
than seen. And treat each theme's signature technique (grid for Cosmic,
bevel for Obsidian, glass for Midnight, grain for Nova) as the one thing
that theme is *for*, rather than piling every technique onto every theme
equally.

### User toggle: texture on/off

All of the above is gated by a single global control — "Texture" or
"Enhanced depth" — in the Appearance popover next to the theme picker.
One switch for all six themes, since the mechanism (grain, bevels, glass
blur, grid, dappled light, paper fiber) is the same technique family
throughout.

**Mechanism:** a single CSS variable drives every opacity-based texture
layer, so turning it off is instant and requires no re-render:

```css
:root {
  --texture-opacity: 1;
}
[data-texture="off"] {
  --texture-opacity: 0;
}
```

Every opacity-based effect above multiplies by `var(--texture-opacity)`
rather than using a hardcoded value (see the grain example). Effects that
aren't opacity-driven — Midnight's `backdrop-filter: blur()`, Cosmic's
`transform`-based grid — need an explicit
`[data-texture="off"] .glass-modal { backdrop-filter: none; }` style
override, since a blur can't be faded via one shared variable.

**Persistence:** one more field alongside the existing `ThemeId`, stored
through the same mechanism already persisting layout/theme/reference:

```ts
interface AppearanceSettings {
  theme: ThemeId;
  texture: "on" | "off";
}
```

**Default:** on. But respect `prefers-reduced-motion` and
`prefers-contrast: more` at first launch — auto-default to off if either
is set, same spirit as the existing OS-awareness for dark/light mode.

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
- The texture toggle (see above) is itself an accessibility feature —
  make sure `[data-texture="off"]` truly zeroes out every layer (grain,
  glass blur, grid transform, dappled light) rather than just the ones
  that happen to be opacity-based, or a user with `prefers-contrast` /
  motion sensitivity who relied on the auto-default still gets partial
  texture.
