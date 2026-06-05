\*\*PAPERWEIGHT\*\*  
   
\*Anchor your creative archive.\*  
   
Roadmap · Confidential Working Document · March 2026  
   
This document tracks planned future directions for Paperweight beyond the current version. Items here are aspirational and subject to change. Paperweight is a platform — Core infrastructure plus a family of client products. Each version advances both the infrastructure and the product family.  
   
| \*\*PRODUCT\*\* | ROLE / SHIPS WITH |  
| \--- | \--- |  
| Paperweight (Core) | Engine — vault, broadcast, access control, signed URLs, analytics. Ships with v1. |  
| Paperweight Play | Listener experience — streaming UI, playback, unlock flows, subscriber access. Launches with v1 (web). Mobile at v1.5 |  
| Paperweight Studio | Creator dashboard as named product — upload, scheduling, analytics, subscriber management. Ships with v1.5 |  
| Paperweight Cloud | Managed hosting — no hardware required. Ships with v2. |  
| Paperweight API | Third-party access to the Paperweight backend. v3+. |  
   
| \*\*v1.0  \*\*\*\*The Anchor\*\* \*\*Creator Server Foundation \+ Direct Support\*\* |  
| \--- |  
   
v1 is the complete creator-owned broadcast platform. The Core/Play architecture, full monetization layer, and listener-facing product identity all ship together. This is not an unfinished tool — it is the full first product.  
   
\*\*Core Infrastructure\*\*  
   
| \*\*FEATURE\*\* | DESCRIPTION |  
| \--- | \--- |  
| Vault Scanner | Scans local media folders and indexes files with metadata (title, BPM, length, tags). Folder, Metadata, and Hybrid vault modes. Auto-ingests new files on drop. |  
| Live Broadcast | Continuous HLS stream. Shuffle Mode (random rotation, zero-config default) and Scheduled Mode (time-block programming). Runs 24/7 on low-power hardware. |  
| Web Player | Broadcast-first layout — live stream is the first thing a visitor sees. Now playing, up next queue. Communicates with Core via signed URL / permission flow. |  
| Public Library | Visitors browse the creator's archive by category. Free tier gets live stream and limited previews. Subscriber tier placeholder activates via paywall. |  
| Creator Dashboard | Local control panel. Upload content, edit broadcast schedule, view basic listener analytics (count, top content). Accessible on local network only. |  
| Core/Play Architecture | Web player in v1 talks to Core through the same signed URL / permission flow that all future clients use. The upgrade path to Play mobile (v2) is refinement, not reconstruction. |  
   
\*\*Paperweight Play (Web) \+ Monetization\*\*  
   
Play launches with v1 as a complete listener-facing product identity — not a patch release. The paywall and the polished listener experience arrive together.  
   
| \*\*FEATURE\*\* | DESCRIPTION |  
| \--- | \--- |  
| Library Paywall | Full activation of the subscriber tier. Stripe and PayPal integration for access control. Paperweight takes no cut of creator earnings — processor fees only. |  
| Subscriber Tiers | Free (live stream \+ limited previews), Supporter (full library), Premium (downloads \+ exclusive content). Creator-configurable. |  
| Tip / Support Button | One-time support option on the station page. Low friction for casual listeners. |  
| Private Releases | Supporter-only content not visible to free listeners. |  
| Download Access | Subscribers download tracks, episodes, or sessions based on their tier. Signed tokens issued by Core — no raw file access. |  
   
\*\*Architecture Notes\*\*  
   
\- Paywall-ready from the start — access control model (public / private / supporters-only) is built into the v1 data model.  
   
\- Zero-config default — install, add media, station is live.  
   
\- Runs on Raspberry Pi 4, mini PCs, old laptops, Ubuntu — no high-end hardware required.  
   
\- Closed source through v1. Architecture and vision locked in before external contributors shape it.  
   
| \*\*v2.0  \*\*\*\*The Signal\*\* \*\*Paperweight Cloud \+ Studio \+ Play Mobile \+ Open Source\*\* |  
| \--- |  
   
v2 removes the biggest adoption barrier — not everyone wants to run their own server. Paperweight Cloud lets creators spin up a station without touching hardware. Self-hosted always remains the primary product. Cloud is an accessibility layer, never an architectural dependency.  
   
| \*\*FEATURE\*\* | DESCRIPTION |  
| \--- | \--- |  
| Paperweight Cloud | Managed hosting. Creators create an account, upload media, and their station goes live — no hardware or terminal required. |  
| Paperweight Studio | Creator dashboard as a named product. Upload, scheduling, analytics, subscriber management. Same experience self-hosted or cloud. |  
| Paperweight Play (mobile) | React Native app, iOS \+ Android. Listener-side at launch: stream playback, now playing, library, subscriber access. Background audio, lock screen controls, headphone support. |  
| Station Stickers | Embeddable live badge with deep-link into Paperweight Play mobile app. The primary discovery vector for new listeners. |  
| Migration Tools | Move between self-hosted and Cloud without losing vault or subscriber data. |  
| Open Source Release | v1 codebase open sourced at or before v2 launch. Showrunner model — the original creator owns the world, contributors build within it. Contributor guidelines published. |  
   
| \*\*v3.0  \*\*\*\*The Ecosystem\*\* \*\*Plugin Architecture\*\* |  
| \--- |  
   
v3 opens Paperweight to community extension through a plugin system. Contributors have a clear, contained way to participate — they build plugins. The core stays small and opinionated. Everything else is optional and community-driven.  
   
| \*\*PLUGIN\*\* | \*\*DESCRIPTION\*\* |  
| \--- | \--- |  
| \*\*paperweight-plugin-station-radar\*\* | Stations opt in by broadcasting metadata. A discovery page surfaces all live stations. This is how the network begins. |  
| \*\*paperweight-plugin-raids\*\* | When a broadcast ends, the creator sends their audience to another station automatically. Listeners inherit. |  
| paperweight-plugin-chat | Adds live listener chat to stations. |  
| paperweight-plugin-beatstore | Beat licensing and lease options directly on the station. Beatmakers sell without a third-party platform. |  
| paperweight-plugin-analytics | Expanded listener stats, growth tracking, top content reporting. |  
| paperweight-plugin-discord | Posts to Discord automatically when the station goes live. |  
| paperweight-plugin-beat-roulette | Randomly surfaces beats for rappers and producers browsing the station. |  
   
\*Station Radar as a plugin is the proof of concept for the entire architecture. The network begins as an opt-in, not a mandate.\*  
   
| \*\*v4.0  \*\*\*\*The Network\*\* \*\*Station Discovery \*\*\*\*&\*\*\*\* Connection\*\* |  
| \--- |  
   
v4 is not a feature release — it's a recognition. By this point, enough stations are running the Station Radar and Raids plugins that a real network exists. v4 formalizes it.  
   
| \*\*FEATURE\*\* | DESCRIPTION |  
| \--- | \--- |  
| Station Directory | Browsable and searchable by genre, location, and live status. |  
| Genre Networks | Beatmakers, podcasters, experimental radio, ambient, and more — genre-native discovery layers. |  
| Raid Chains | Coordinated multi-station audience sequences. |  
| Shared Programming Blocks | Synchronized co-broadcasts between stations. |  
| Open Station Metadata Standard | Any compatible directory or tool can discover and index Paperweight stations. |  
   
\*The network was never forced into existence. It grew from creators who chose to run the plugins. No central server controls it. No algorithm curates it.\*  
   
\*\*Future Direction\*\*  
   
Exploratory — not guaranteed.  
   
\- Decentralized station network — the long-term vision  
   
\- Paperweight API — third-party access to Core for external apps and integrations  
   
\- Creator mobile dashboard — upload, schedule, and manage station from Paperweight Play  
   
\- Enterprise / white-label licensing for indie labels and radio networks  
   
\- Inter-station collaborative spaces  
   
Paperweight — Roadmap · Confidential Working Document