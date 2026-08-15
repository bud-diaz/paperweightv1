# Paperweight — Design Spec

This is a descriptive spec of the UI and visual style **as currently shipped**, not a redesign proposal. It documents what exists, including inconsistencies, so anyone extending the UI can match the right pattern instead of guessing or inventing a new one.

## Overview

Paperweight's UI is split across two visually distinct systems that don't share a token source:

1. **Creator Studio SPA** (`studio/`, built to `client/app/`) — the primary app: creator dashboard + public listener view + public share pages. Dark **glassmorphism**, signature accent colors **lime** and **coral**.
2. **Standalone HTML entry points** — three small pages outside the SPA (`client/embed.html`, `client/pair.html`, `landing/listen.html`). Dark, minimal, each with its own inline `<style>` block. Two of them use a **neon green** accent instead of lime/coral.

Both are "dark, high-contrast, glowing accent on black" in spirit, but they are implemented as separate, unrelated token sets. Treat them as two systems, not one, when building new UI — match whichever system the page belongs to.

---

## 1. Studio SPA (`studio/`)

### Tech basis

- **Tailwind CSS v4**, CSS-first config — there is **no `tailwind.config.js`**. All theming lives in `studio/src/index.css` via `@theme inline { ... }`, which maps Tailwind's expected tokens (`--color-primary`, `--font-sans`, `--radius-lg`, etc.) onto plain CSS custom properties defined on `:root`.
- **shadcn/ui**, `"style": "new-york"`, `"baseColor": "neutral"` (`studio/components.json`), built on Radix primitives + `class-variance-authority` (`cva`) + `cn()` (`twMerge(clsx(...))`, `studio/src/lib/utils.ts`).
- `@import 'tw-animate-css'` supplies `animate-in`/`animate-out`/`fade-in`/`zoom-in`/`slide-in-from-*` utilities for Radix components.
- No custom breakpoint, spacing, or shadow scale is declared — responsive layout uses Tailwind's stock `sm/md/lg/xl` breakpoints directly; shadows/animations are hand-written CSS (see [Glassmorphism primitives](#glassmorphism-primitives)).

### Color tokens

Defined once on `:root` in `studio/src/index.css` (HSL, shadcn convention). **The app is hard-locked to dark** — there is no light theme. A `.dark` class selector exists but only re-declares four of these tokens with identical values (a vestige of the shadcn scaffold); `next-themes` is a dependency but no `ThemeProvider` or toggle is wired up anywhere, and `color-scheme: dark` is forced globally.

| Token | Value (HSL) | ≈ Hex | Role |
|---|---|---|---|
| `--background` | `0 0% 0%` | `#000000` | page background |
| `--foreground` | `224 30% 94%` | `#eef0f7` | primary text |
| `--primary` / `--ring` / `--sidebar-primary` | `69 100% 65%` | `#bcff42` | **signature lime** — CTAs, focus ring, active nav rail |
| `--primary-foreground` | `0 0% 0%` | `#000000` | text on lime |
| `--accent` | `7 84% 68%` | `#ff8071` | **signature coral** — secondary accent, gradients |
| `--accent-foreground` | `0 0% 0%` | `#000000` | text on coral |
| `--card` | `0 0% 100% / .08` | white @ 8% | glass card fill |
| `--card-border` | `0 0% 100% / .16` | white @ 16% | glass card border |
| `--popover` | `0 0% 4%` | `#0a0a0a` | popover/menu surface |
| `--border` | `0 0% 100% / .14` | white @ 14% | default hairline border |
| `--input` | `0 0% 100% / .12` | white @ 12% | input border |
| `--secondary` | `0 0% 100% / .1` | white @ 10% | secondary surface |
| `--muted` / `--muted-foreground` | `0 0% 100% / .08` / `226 14% 60%` | — | de-emphasized surface/text |
| `--destructive` | `4 76% 61%` | `#e5564b`-ish | destructive actions |
| `--sidebar*` | mirrors `background`/`primary`/`border` | — | sidebar has its own token set (`--sidebar`, `--sidebar-border`, `--sidebar-accent`, etc.), all currently equal to the main tokens |
| `--radius` | `0.85rem` | 13.6px | base corner radius; `sm/md/lg/xl` are derived via `calc()` |

**Signature gradient**: lime → coral, diagonal, e.g. `linear-gradient(135deg, #dcff75, #ff8071 75%)`. This recurs by name across the app — `Avatar` initials badge, the AppShell share-modal icon tile, and the `.signal-gradient` text utility (`linear-gradient(120deg,#dfff81 0%,#9dff30 42%,#ff8776 100%)`). Treat it as *the* brand gradient for new UI that wants a "premium/branded" accent.

### Typography

Three self-hosted families (`client/vendor/fonts/`, woff2, loaded via `<link href="/vendor/fonts/fonts.css">` — self-hosted because the app's CSP requires `font-src 'self'`, not pulled from Google Fonts):

| Family | Weights | Used via | Role |
|---|---|---|---|
| **Manrope** | 400–800 | `font-sans` (Tailwind default, applied to `body`) | body copy, UI text |
| **Space Grotesk** | 500–700 | `.font-display` (hand-written utility class — **not** wired into Tailwind's `font-*` theme) | page titles, modal titles, metric values, wordmarks |
| **DM Mono** | 400–500 | `.font-mono-ui` (hand-written utility, distinct from Tailwind's `font-mono`) | eyebrow labels, badges, timestamps, mono UI chrome — e.g. `font-mono-ui text-[10px] uppercase tracking-[.22em]` |

Typical heading: `font-display text-3xl sm:text-4xl font-semibold tracking-[-.04em]`.

### Glassmorphism primitives

The visible look is driven almost entirely by hand-written CSS classes in `index.css` — **not** by the shadcn component variants (see [Component library](#component-library) below).

| Class | Purpose | Key styling |
|---|---|---|
| `.panel` | primary glass card | `linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.055))`, `1px solid rgba(255,255,255,.16)`, layered box-shadow, `backdrop-filter: blur(28px) saturate(150%)` |
| `.panel-subtle` | secondary/nested surface | same idea, lighter opacity, `blur(22px)` |
| `.lime-button` | primary CTA | `rgba(190,255,61,.72)` bg, black text, glow shadow, lifts on hover |
| `.ghost-button` | secondary/neutral action | `rgba(255,255,255,.075)` bg, subtle hover lift |
| `.input-studio` | form inputs | translucent bg, `rgba(255,255,255,.15)` border, lime focus ring `0 0 0 3px rgba(190,255,61,.09)` |
| `.modal-backdrop` / `.modal-panel` | modal chrome (custom, not Radix `Dialog`) | backdrop `rgba(0,0,0,.58)` + `blur(30px)`; panel near-opaque `#101116` |
| `.nav-item` / `.nav-item.active` | sidebar nav rows | active state: `inset 2px 0 hsl(var(--primary))` rail indicator |
| `.mode-switcher` / `.mode-option.active` | Stack/Play/Studio pill switcher | active option: solid lime bg, black text, glow |
| `.title-gradient` | large heading text | white → lavender, `linear-gradient(110deg,#f0f3ff 12%,#c9d1ed 78%)` |
| `.signal-gradient` | brand-forward accent text | lime → coral, see above |
| `@keyframes wave` / `.wave-bar` | equalizer-bar pulse | staggered `nth-child` delays |
| `@keyframes enter` / `.animate-enter` | entrance animation | fade + `translateY(8px)`, `.delay-1/2/3` stagger helpers, used by toasts/modals |

Both `AppShell` and `ListenerShell` share `.studio-app` (`min-height: 100dvh; background: #000`) plus `.noise` — a fixed full-viewport SVG fractal-noise overlay at ~3.5% opacity for film-grain texture.

### Component library

`studio/src/components/ui/` contains a full stock shadcn set (54 files: `button`, `card`, `dialog`, `badge`, `sidebar`, `select`, `tooltip`, `sonner`, etc.). **Most are unused scaffolding** — e.g. `card.tsx` and `badge.tsx` have zero import sites in the live app, `dialog.tsx` has one. The real UI is built from the custom classes above plus raw Tailwind utilities; the shadcn folder is an available-but-mostly-untapped primitives library, not the load-bearing design system.

Where shadcn components *are* used, they follow standard `cva` variant naming: `Button` — `default | destructive | outline | secondary | ghost | link`, sizes `default | sm | lg | icon`; `Badge` — `default | secondary | destructive | outline`.

**Known scaffold artifacts** (Replit-generated leftovers, harmless but not real tokens — don't treat as intentional if you see them): `button.tsx`/`badge.tsx` reference `hover-elevate`/`active-elevate-2` classes and `var(--button-outline)`/`var(--badge-outline)` custom properties that are **never defined anywhere** in the codebase.

### Iconography

**lucide-react**, thin stroke-based line icons at small explicit sizes (mostly `size={13}`–`size={19}`) — matches the minimal, high-density aesthetic. Used in 47+ files (`Bell`, `ChevronDown`, `CloudUpload`, `Music2`, `Search`, `Settings`, `Share2`, `ShieldCheck`, `Play`, `Pause`, etc.).

### Layout

**AppShell** (creator dashboard) — no route-based nav; a `ModeSwitcher` pill (Stack / Play / Studio) drives view state:
- **Studio mode**: fixed left sidebar (`.sidebar-shell`, `w-[248px]`, `md:translate-x-0`, mobile drawer otherwise), 80px header (`Logo` 32px + "Paperweight:" eyebrow + "STUDIO" wordmark), station identity row, nav grouped with uppercase mono labels and numeric badge pills, footer status card + sign out. Content is offset `md:pl-[248px]`.
- **Stack/Play modes**: sidebar hidden; content becomes `.mode-main` (`max-width: 1240px; margin: 0 auto`) with `.mode-content { padding-top: 3rem }`.
- 80px sticky glass header (`.glass-header`) across all modes: mobile hamburger, centered `ModeSwitcher`, breadcrumb text, right-aligned actions.
- Modals render through a single custom `Modal` primitive (`.modal-backdrop`/`.modal-panel`), not Radix `Dialog`.
- `StickyTransport`: persistent mini-player bar sliding in from top (desktop) / bottom (mobile).

**ListenerShell** (public listener view) — no sidebar at all: same 80px glass header pattern (larger 49px `Logo`, `ModeSwitcher` limited to Stack/Play — "Studio" triggers a login overlay instead), body renders the same `StackView`/`PlayerView` components AppShell uses, plus `StickyTransport`, a bottom-center `PostsTicker`, and its own modal stack (`WelcomeOverlay`, `AccountModal`, `CheckoutModal`, `VaultGateModal`, `SettingsTour`, `DashboardLogin`).

`studio/src/pages/Share.tsx` (public `/share/:token`) reuses the same `.studio-app.noise` root treatment and glass/lime language rather than a separate marketing palette — there is no distinct "marketing site" look inside `studio/`.

### Known inconsistencies (Studio SPA)

- **`Inter` font is orphaned**: four Inter woff2 weights are vendored in `client/vendor/fonts/`, but `fonts.css` declares no `@font-face` for it, and nothing in `studio/src` references it. Dead weight, not a live token.
- **Two parallel toast systems**: a local lightweight toast (`notify()` + `.panel`-styled div, used directly in both shells) and `sonner` (`ui/sonner.tsx`, mounted globally via `<Toaster />`). Which one fires for what isn't obvious from the shell code alone — check call sites before assuming either is "the" toast pattern.
- **Undefined scaffold classes** in `button.tsx`/`badge.tsx` — see [Component library](#component-library).

---

## 2. Standalone HTML entry points

Three pages live outside the SPA build, each fully self-contained (own inline `<style>`, no shared stylesheet, no build step). Shared traits: near-black background, white text, no `<meta name="theme-color">` on any of them (the only place `#0a0a0a` is declared as a theme color at all is the dynamically-generated `/manifest.json`, used for PWA chrome).

**This is the single biggest cross-system inconsistency in the app**: two of these three pages use **neon green `#39ff14`** as their accent — a different color, on a different token system, from the Studio SPA's lime `#bcff42`/coral `#ff8071`. They read as "the same brand" at a glance but do not share a source of truth.

### `client/embed.html` + `client/js/embed.js` — `/embed`, frameable mini player

- Background `#0a0a0a`, text `#fff`, card border `rgba(255,255,255,.15)`, `:root { color-scheme: dark }`.
- Font: **`Georgia, 'Times New Roman', serif`** — the one page in the whole app that uses neither the vendored fonts nor Studio's Manrope/Space Grotesk/DM Mono.
- Circular 44×44px play/pause button (unicode glyphs `▶`/`❙❙`, no icon library), uppercase letterspaced station name, LIVE badge in red `#f66`.
- Video mode (`.video-mode`): full-bleed `<video>` background with a bottom-heavy black gradient scrim for text legibility.
- No `theme-color`, no OG tags (iframe target, not shared directly).

### `client/pair.html` + `client/js/pair.js` — `/pair`, device-pairing confirmation

- Background `#0a0a0a`, text `#fff`, system UI font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`) — no vendored webfont loaded at all.
- Accent: **neon green `#39ff14`** — confirm button border/fill/text, success message state (`.pair-msg.ok`).
- Error state: `#ff5c5c`. Disabled button: `opacity: .5`.
- Deliberately requires an explicit button tap rather than auto-firing on load, so a chat-app link-preview crawler can't burn the one-time pairing token.

### `landing/listen.html` — `/landing/listen` (Express) and `/listen` (Vercel clean URL), public station search/player

Fullest standalone token set — a `:root` CSS-variable block, distinct from Studio's but structurally similar in spirit:

```
--bg: #080808        --neon: #39ff14         --border: rgba(255,255,255,.08)
--bg2: #0d0d0d        --neon-dim: rgba(57,255,20,.12)   --border-hi: rgba(255,255,255,.14)
--text: #fff          --t-mid: rgba(255,255,255,.45)    --serif: 'DM Serif Display', Georgia, serif
--t-muted: rgba(255,255,255,.25)  --t-dim: rgba(255,255,255,.13)   --mono: 'Space Mono', monospace
--discord: #5865F2
```

- Fonts loaded from **Google Fonts CDN** (`fonts.googleapis.com`, DM Serif Display + Space Mono) — the only page that doesn't self-host, inconsistent with the CSP-driven self-hosting rationale used elsewhere.
- Body font is Space Mono (14px/1.5); headings/wordmark use DM Serif Display.
- CTAs and LIVE badges: black text on neon-green fill with a glow (`box-shadow: 0 0 16px rgba(57,255,20,.35)`, brighter on hover).
- Ambient full-bleed radial glow (`#ambient`, neon @ 5% opacity, blurred) + body-level SVG film-grain noise overlay (`opacity: .03`) — same "atmosphere" instinct as the SPA's `.noise` layer, implemented independently.
- Layout: fixed-viewport "app shell" mockup (topbar wordmark + CTA, Search/Play pill tabs, station result cards, embedded `<iframe>` reusing `embed.html` cross-station, footer).
- Has OG/Twitter meta tags (`og:title`, `og:description`, `twitter:card=summary_large_image`) — the only one of the three that's meant to be link-shared.
- Fetches its station directory from an external system API (`system.paperweighthq.com`), not the local Express app.

---

## 3. Assets

### Brand/icon files (`client/`, served at domain root)

| File | Size | Used for |
|---|---|---|
| `client/brand-mark.png` | 512×512 | The actual logo — `Logo.tsx` renders this (not the favicon) so the header blends into black without a placeholder box |
| `client/favicon.png` | 128×128 | `<link rel="icon">` across embed/pair/listen/SPA |
| `client/icon.png` | 512×512 | `apple-touch-icon`, PWA manifest icons (192/512, `purpose: any maskable`) |
| `client/img/bg-pape-logo.jpg` | — | No live reference found anywhere in source — orphaned legacy asset |

### Self-hosted fonts (`client/vendor/fonts/`)

| Family | Weights shipped | Styles | Actually used? |
|---|---|---|---|
| Manrope | 400, 500, 600, 700, 800 | normal | ✅ Studio body text |
| Space Grotesk | 500, 600, 700 | normal | ✅ Studio display/headings |
| DM Mono | 400, 500 | normal | ✅ Studio mono UI |
| DM Serif Display | 400 | normal, italic | Not used by Studio; `landing/listen.html` pulls it from Google Fonts CDN instead of this vendored copy |
| Space Mono | 400, 700 | normal | Same — vendored but bypassed by `listen.html`'s CDN link |
| Inter | 400, 500, 600, 700 | normal | ❌ Orphaned — files present, no `@font-face` declared, no code references it |
