'use strict';

// Single source of truth for the six Markdown/text docs meant for a
// creator-mode "Docs" modal that don't already have a hand-formatted HTML
// twin under landing/ (license and content-responsibility do, and are served
// separately via /landing/license and /landing/content-responsibility).
// Shared by src/index.js's /api/docs routes and by both client-bundle build
// scripts (scripts/generate-client-bundle.js, scripts/build-desktop-runtime.js)
// so none of the three can drift out of sync with each other.
//
// The vanilla-JS Docs modal that rendered these (client/js/docs.js) was
// retired in the creator.html -> Studio cutover; studio/src/lib/api.js has
// the api.docs.list()/get() client methods ported but no modal UI calls them
// yet — see CLAUDE.md's Creator Studio section for the tracked gap. The
// /api/docs routes themselves stay live regardless of frontend.

module.exports = [
  { id: 'readme',           title: 'README',                        file: 'README.md',              urlPath: '/docs/readme.md' },
  { id: 'asciline-notice',  title: 'Third-Party Notice (Asciline)',  file: 'THIRD-PARTY NOTICE.txt', urlPath: '/docs/asciline-notice.txt' },
  { id: 'setup-windows',    title: 'Setup — Windows',                file: 'SETUP_WINDOWS.md',       urlPath: '/docs/setup-windows.md' },
  { id: 'setup-macos',      title: 'Setup — macOS',                  file: 'SETUP_MACOS.md',         urlPath: '/docs/setup-macos.md' },
  { id: 'setup-linux-pi',   title: 'Setup — Linux / Raspberry Pi',   file: 'SETUP_LINUX_PI.md',      urlPath: '/docs/setup-linux-pi.md' },
  { id: 'setup-cloudflare', title: 'Setup — Cloudflare Tunnel',      file: 'CLOUDFLARE_SETUP.md',    urlPath: '/docs/cloudflare-setup.md' },
];
