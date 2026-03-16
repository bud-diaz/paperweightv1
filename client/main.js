import { initPlayer, destroyPlayer } from './player.js';
import { initLibrary } from './library.js';
import { initDashboard } from './dashboard.js';

const PAGES = {
  player:    { el: document.getElementById('page-player'),    init: initPlayer,    destroy: destroyPlayer },
  library:   { el: document.getElementById('page-library'),   init: initLibrary,   destroy: null },
  dashboard: { el: document.getElementById('page-dashboard'), init: initDashboard, destroy: null },
};

let currentPage = null;

function navigate(hash) {
  const name = (hash.replace('#', '') || 'player');
  const page = PAGES[name] || PAGES.player;

  if (currentPage === page) return;

  // Hide all pages
  for (const p of Object.values(PAGES)) p.el.hidden = true;

  // Update nav
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === name);
  });

  currentPage = page;
  page.el.hidden = false;
  page.init();
}

window.addEventListener('hashchange', () => navigate(window.location.hash));
document.addEventListener('DOMContentLoaded', () => navigate(window.location.hash || '#player'));
