# Studio Dashboard Mission-Control Migration Map

This document is the pre-implementation contract for replacing the vertical
Studio dashboard with the mission-control console. The outer player card,
vibrancy treatment, non-Studio panels, existing element IDs, and existing
dashboard component classes are out of scope.

## Instrument mapping

| Existing section | Mission-control destination | Span | Default presentation |
| --- | --- | ---: | --- |
| Broadcast | Broadcast Control | 7 | Label face; now-playing, mode, restart, and queue controls |
| Live Video + Go Live / Radio Host | Live Broadcast | 5 | Label face; consolidated audio/video live controls |
| Schedule | Schedule | 8 | Label face; functional back |
| Station | System | 4 | Label face; functional back |
| Vault | Vault | 4 | Open on first visit, then persisted |
| Earnings | Earnings | 4 | Label face; Today/Lifetime back |
| Analytics | Analytics | 6 | Label face; functional back |
| Analytics top list | Top Tracks | 6 | Label face; functional back |
| Upload | Upload | 4 | Label face; Radio Host rules retained |
| Posts | Posts | 4 | Label face; functional back |
| Security + Authorized Devices | Security | 4 | Label face; combined functional back |
| Search & Add Content | Search + Add | 12 | Label face; desktop/Radio Host only |
| Notifications & Feed, Creator Bio, Collections, All-Access Pricing, Share Links, Payments, Tip Button | More Settings | 12 | Label face; existing inner accordions retained |

The six-cell status strip remains visible above the cards. Instrument cards
show only their label/abbreviation and a restrained state cue until activated.
At most three cards may be open. Opening a fourth closes the least recently
opened card. `Vault` is the first-visit default; subsequent open state is stored
under the existing `pw_dash_section_open` local-storage key.

## Selector contract

The source dashboard contains 284 IDs inside `#dash-content`; 257 are queried
directly by the dashboard modules through `el(...)` or `getElementById(...)`.
Every original ID must remain unique. The implementation must also preserve the
dynamic selector families used for rendered records:

- Queue/library: `.lib-queue-btn[data-id]`, `[data-sq-idx]`.
- Schedule: `[data-edit-block]`, `[data-del-block]`, `#sched-edit-*`, and the
  `#se-{label,day,start,end,cat,mode,src,tid,save,msg}-*` family.
- Collections/vault: `[data-del]`, `[data-remove-track]`, `#hl-tog-project-*`,
  `#pprice-*`, `#more-*`, `#save-*`, `#vis-*`, `#release-*`, `#edit-*`,
  `#tok-*`, `#tier-*`, `#assign-*`, `#revoke-*`, and `[data-unassign]`.
- Posts: `[data-edit-post]`, `[data-del-post]`, `#post-edit-*`, and `#pe-*`.
- Share links: `[data-share-target]`, `[data-open-share]`,
  `[data-copy-share]`, and `[data-del-share]`.
- Smart playlists: `[data-sp-tags-input]`, `[data-track-count]`,
  `[data-preview-playlist]`, `[data-edit-playlist]`, `[data-del-playlist]`,
  `[data-assign-playlist]`, `#sp-preview-*`, `#sp-edit-*`, and `#sp-*` editor IDs.
- Devices: `[data-rename-device]` and `[data-revoke-device]`.
- Analytics: `[id^="plays-"]`.
- Shared collections: `.ext-tab-btn`, `.typeahead-item`, `.mgmt-title`, and
  `.mgmt-thumb img` retain their intentionally plural cardinality.

The permanent audit script added with the implementation derives and prints the
complete literal ID list from the dashboard modules, then fails if any queried
ID is missing or duplicated in `creator.html`.

## Desktop-only attribute contract

All 15 current placements remain on the same elements while those elements are
moved:

1. Station URL update row.
2. Station searchable wrapper.
3. Cloudflare/telemetry wrapper.
4. `#vsb-tokens`.
5. `#vault-panel-tokens`.
6. `#btn-import-folder`.
7. `#import-folder-msg`.
8. `#live-source-toggle`.
9. Radio Host toggle row.
10. `#rh-switches-info`.
11. `#live-video-source-toggle`.
12. `.sched-add-details`.
13. `#smart-playlists-details`.
14. `#sched-preview-details`.
15. `#dash-ext-search-section`.

## Data-path decisions

- Status values are mirrors of existing dashboard loads, not a second polling
  loop.
- Active schedule information uses the existing `/api/schedule/current` route.
- The existing earnings response gains UTC-day totals and per-target rows.
- The Earnings status cell controls a shared Today/Lifetime state that updates
  the strip, totals, and per-track/collection list together.
- No existing input, button, or generated row is recreated or removed.
