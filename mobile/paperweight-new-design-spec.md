# Paperweight UI Design Specification

## 1. Design Direction

Paperweight should feel **heavy, grounded, architectural, and premium**.

The visual system combines: - industrial material language - restrained
editorial typography - dense dark surfaces - high-contrast media
artwork - minimal use of a warm oxide accent - structural, weighty
interface components

The interface should not feel glossy, futuristic, playful, or like a
generic streaming service. It should feel closer to a **piece of media
equipment**: deliberate, substantial, and built to stay put.

**Core principle:** Color means something is happening.

------------------------------------------------------------------------

## 2. Brand Character

Paperweight should communicate:

-   **Weight** --- dense surfaces, substantial controls, deliberate
    spacing
-   **Permanence** --- restrained palette and durable visual language
-   **Media** --- artwork remains prominent and expressive
-   **Infrastructure** --- controls feel functional rather than
    decorative
-   **Independence** --- avoid visual conventions that make Paperweight
    look like a clone of Spotify, Apple Music, or generic creator SaaS
-   **Precision** --- clear hierarchy, minimal ornament, consistent
    states

### Keywords

`heavy` · `industrial` · `editorial` · `architectural` · `broadcast` ·
`tactile` · `premium` · `independent`

------------------------------------------------------------------------

## 3. Color System

### Core Palette

  -----------------------------------------------------------------------
  Token                   Hex                     Purpose
  ----------------------- ----------------------- -----------------------
  `ink`                   `#090909`               Primary background,
                                                  deepest surfaces

  `surface`               `#121212`               Cards, panels,
                                                  navigation surfaces

  `raised`                `#1B1B1B`               Elevated controls and
                                                  secondary panels

  `paper`                 `#F0EFEA`               Primary text, light
                                                  surfaces, high-emphasis
                                                  icons

  `concrete`              `#8A8984`               Secondary text,
                                                  metadata, disabled
                                                  states

  `oxide`                 `#C84B20`               Active, interactive,
                                                  live, selected states
  -----------------------------------------------------------------------

### Oxide

`#C84B20` is the primary Paperweight accent.

It should evoke: - oxidized metal - fired clay - industrial equipment -
heat - physical material

Oxide should **not** become a decorative brand wash.

Use it selectively for: - primary actions - active navigation
indicators - playback progress - selected controls - toggles -
live/on-air indicators - focus and active states - small brand moments

Avoid: - large orange backgrounds - orange body text - orange borders
around every component - decorative gradients - tinting the entire logo
orange

As a general target, neutral colors should account for roughly **90%+ of
the interface**.

------------------------------------------------------------------------

## 4. Logo Treatment

The folded Paperweight `P` is the primary mark.

### Preferred Treatment

On dark surfaces: - white/paper front faces - subtle gray dimensional
faces - black negative space

The logo should retain its folded, architectural dimensionality.

### Rules

-   Give the mark generous clear space.
-   Do not flatten the dimensional faces unnecessarily.
-   Do not add glow effects.
-   Do not surround it with decorative containers unless required by the
    platform.
-   Prefer monochrome logo treatments.
-   Oxide may be used sparingly for special active states or small brand
    applications, but should not replace the primary white mark.

The mark should feel like an **object**, not an icon floating in space.

------------------------------------------------------------------------

## 5. Typography

### Recommended Primary Typeface

**Space Grotesk**

Suggested weights: - Bold: `700` - Semibold: `600` - Medium: `500` -
Regular: `400`

### Hierarchy

#### Display / Product Titles

-   Weight: 600--700
-   Tight line height
-   Slightly tight tracking
-   High contrast against background

#### Section Titles

-   Weight: 500--600
-   Compact
-   Minimal decoration

#### Body

-   Weight: 400
-   Paper or softened off-white
-   Comfortable line height

#### Metadata

-   Weight: 400--500
-   Concrete gray
-   Smaller scale

#### Labels / Status

-   Weight: 500--600
-   Uppercase may be used selectively
-   Slight positive letter spacing

Example:

``` text
● LIVE
Night Shift Radio
Rolling Woods Radio
SZA  ·  Snooze
```

`LIVE` uses Oxide. The rest remains neutral.

------------------------------------------------------------------------

## 6. Layout

The desktop interface is structured as a dense media workspace.

### Primary Regions

``` text
┌────────────┬───────────────────────────────┬─────────────┐
│            │                               │             │
│ Navigation │         Main Content          │ Side Panel  │
│            │                               │             │
├────────────┴───────────────────────────────┴─────────────┤
│                    Persistent Player                     │
└──────────────────────────────────────────────────────────┘
```

### Left Navigation

Contains: - Paperweight mark - Home - Search - Stack - Play - Studio -
library navigation - playlist/media shortcuts - new playlist action

Navigation should feel anchored rather than floating.

Active navigation uses: - slightly raised background - Oxide icon or
indicator - Paper text

Inactive navigation uses Paper/Concrete without unnecessary color.

### Main Content

Main content may contain: - search - hero station/program artwork -
active/live information - primary playback actions - recently played
media - discovery - station content

Artwork supplies most of the interface's non-brand color.

### Right Context Panel

Use for contextual information such as: - liked songs - current queue -
Stack - current station - related media - secondary controls

This panel should remain visually subordinate to the main content area.

### Persistent Player

A full-width player anchors the bottom of the workspace.

It should feel like a **hardware control strip** rather than a floating
mini-player.

------------------------------------------------------------------------

## 7. Surface Model

Use three primary depth levels.

### Ink

`#090909`

Application background and deepest areas.

### Surface

`#121212`

Primary panels: - navigation - media sections - side panels - cards

### Raised

`#1B1B1B`

Interactive/elevated elements: - buttons - selected navigation - input
fields - popovers - secondary controls

Depth should come primarily from **value differences and borders**, not
large blurred shadows.

Recommended border:

``` css
border: 1px solid rgba(240, 239, 234, 0.08);
```

Shadows, where necessary, should be short and dense.

------------------------------------------------------------------------

## 8. Component Shape Language

Paperweight should avoid excessive pill-shaped UI.

### Recommended

-   medium-small corner radii
-   rectangular/slab-like buttons
-   dense panels
-   strong alignment
-   thick enough controls to feel tactile

Suggested radii:

``` text
Small control:    6px
Button:           8px
Card:             8–10px
Major panel:      10–12px
Pill:             only when semantically appropriate
```

Avoid huge 20--30px radii across every component.

The interface should feel **machined**, not bubbly.

------------------------------------------------------------------------

## 9. Buttons

### Primary

Background: Oxide\
Text/Icon: Paper

Use for the strongest immediate action:

``` text
▶ Play Now
```

### Secondary

Background: Raised\
Text: Paper

Example:

``` text
Shuffle
```

### Tertiary / Icon

Minimal or transparent background.

Use Paper for normal state and Oxide when selected/active.

### Interaction

Hover states should change luminance modestly rather than introduce
glow.

Press states should feel physically compressed.

------------------------------------------------------------------------

## 10. Navigation States

### Default

``` text
Icon: Concrete/Paper
Text: Paper
Background: transparent
```

### Hover

``` text
Background: Raised
Text: Paper
```

### Active

``` text
Background: Raised
Icon/indicator: Oxide
Text: Paper
```

Use a small Oxide edge, icon, or indicator rather than flooding the
entire item with orange.

------------------------------------------------------------------------

## 11. Playback

Playback is one of the few places where Oxide can appear consistently.

Use Oxide for: - progress completed - active play/pause control -
selected repeat/shuffle - live indicator - interactive scrubber thumb

Unplayed progress remains neutral/dark gray.

Playback controls should be large enough to feel tactile without
becoming oversized.

------------------------------------------------------------------------

## 12. Live / Broadcast State

Live broadcasting is an important semantic state.

Preferred pattern:

``` text
● LIVE
```

-   Dot: Oxide
-   Label: Oxide
-   Supporting text: Paper/Concrete

Do not use flashing animation by default.

A subtle pulse may be used only when it communicates an active
transition or connection process.

------------------------------------------------------------------------

## 13. Artwork

Album, show, station, and creator artwork is intentionally allowed to
break the neutral palette.

Artwork should provide the majority of visual color in content areas.

### Hero Artwork

Use: - darkened imagery - restrained gradient overlays where necessary
for text legibility - edge-to-edge image treatment inside structured
containers

Avoid artificially recoloring all artwork to match Oxide.

The brand system should **frame media, not overpower it**.

------------------------------------------------------------------------

## 14. Motion

Paperweight motion should communicate mass.

Avoid: - springy overshoot - excessive bouncing - playful elastic
transitions - constant ambient animation

Prefer: - quick initial response - controlled deceleration - short
travel distance - deliberate settling

Elements should appear to **move with inertia and stop with weight**.

Suggested general duration:

``` text
Micro interaction: 100–160ms
Panel transition:   180–260ms
Large transition:   240–350ms
```

Motion should never make the product feel floaty.

------------------------------------------------------------------------

## 15. Iconography

Use simple line icons with consistent stroke weight.

Icons should: - remain monochrome by default - use Oxide for active
states - avoid unnecessary filled illustrations - remain visually
subordinate to media and typography

The Paperweight logo is dimensional. Interface icons do not need to
imitate it.

------------------------------------------------------------------------

## 16. Inputs and Search

Inputs use Raised or Surface backgrounds.

Example:

``` text
┌──────────────────────────────────┐
│  ◯  Search artists, songs...     │
└──────────────────────────────────┘
```

Recommended: - no heavy outline at rest - subtle border - Paper input
text - Concrete placeholder - Oxide focus indicator

Focus should be obvious but restrained.

------------------------------------------------------------------------

## 17. Accessibility

Do not rely solely on Oxide to communicate state.

Active states should combine color with at least one additional
signal: - icon change - text - indicator - position - background change

Primary text should maintain strong contrast against dark surfaces.

Concrete should be reserved for secondary information and should not be
used where reduced contrast harms readability.

------------------------------------------------------------------------

## 18. Responsive Behavior

### Desktop

Use the full three-region workspace: - navigation - main content -
context panel - persistent player

### Tablet

Collapse or reduce the context panel first.

Navigation may become icon-forward.

### Mobile

Use a simplified hierarchy: - main content - bottom navigation or
compact mode selector - persistent/expandable player

Do not attempt to squeeze the desktop dashboard into a phone viewport.

Maintain the same visual mass through: - dark surfaces - dense
controls - strong typography - limited Oxide usage

------------------------------------------------------------------------

## 19. Design Tokens

Suggested CSS variables:

``` css
:root {
  --pw-ink: #090909;
  --pw-surface: #121212;
  --pw-raised: #1B1B1B;
  --pw-paper: #F0EFEA;
  --pw-concrete: #8A8984;
  --pw-oxide: #C84B20;

  --pw-border: rgba(240, 239, 234, 0.08);
  --pw-border-strong: rgba(240, 239, 234, 0.14);

  --pw-radius-sm: 6px;
  --pw-radius-md: 8px;
  --pw-radius-lg: 12px;

  --pw-space-1: 4px;
  --pw-space-2: 8px;
  --pw-space-3: 12px;
  --pw-space-4: 16px;
  --pw-space-5: 24px;
  --pw-space-6: 32px;
}
```

------------------------------------------------------------------------

## 20. Product-Wide Application

The design language should remain consistent across Paperweight while
allowing each mode to emphasize different functions.

### Discover

Editorial and artwork-forward. Oxide identifies active discovery
actions.

### Stack

Dense, organizational, and tactile. Selected or reordered media uses
restrained Oxide feedback.

### Play

Artwork-forward and immersive. Oxide primarily communicates playback and
live states.

### Studio

More utilitarian and information-dense. Oxide identifies active
broadcasting, selected controls, and important operational state.

The visual identity should come from the **shared material system**, not
from assigning each section a different brand color.

------------------------------------------------------------------------

## 21. Avoid

Do not introduce:

-   neon green as a primary accent
-   purple/blue SaaS gradients
-   glassmorphism everywhere
-   excessive transparency
-   glowing controls
-   giant rounded pills
-   excessive drop shadows
-   colorful navigation icons
-   gradient-filled logos
-   soft floating cards with no structural relationship
-   gratuitous animation

Paperweight should not look weightless.

------------------------------------------------------------------------

## 22. Design Summary

The target experience is:

> **A media interface with the visual weight of a physical object.**

Paperweight is predominantly Ink, Surface, Raised, Paper, and Concrete.

Media artwork supplies expressive color.

Oxide appears when the system is **active, live, selected, or asking the
user to act**.

The folded `P`, dense dark architecture, restrained typography, physical
controls, and industrial color language should make Paperweight feel
less like another streaming app and more like a **piece of media
infrastructure**.
