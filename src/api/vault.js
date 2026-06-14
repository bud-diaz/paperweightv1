const router = require('express').Router();
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { canAccessVaultContent } = require('../auth/vault');
const { paymentLimiter } = require('../middleware/rateLimiter');
const config = require('../config');
const asyncHandler = require('../middleware/asyncHandler');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

// Fetch the price config for a given unlock type + target.
function getPriceConfig(db, unlockType, targetId) {
  if (unlockType === 'track') {
    return db.prepare('SELECT * FROM vault_prices WHERE content_id = ?').get(targetId);
  }
  if (unlockType === 'project') {
    return db.prepare('SELECT * FROM vault_projects WHERE id = ?').get(targetId);
  }
  if (unlockType === 'all_access') {
    return db.prepare('SELECT * FROM vault_all_access WHERE id = 1 AND enabled = 1').get();
  }
  return null;
}

// Enforce minimum price server-side. Returns an error string or null.
function validateAmount(priceConfig, amount) {
  if (!priceConfig) return 'Pricing not configured for this item';
  if (amount < 0) return 'Amount must be zero or greater';
  if (priceConfig.allow_free) return null;
  if (!amount || amount < priceConfig.minimum_price) {
    return `Minimum price is ${priceConfig.minimum_price} cents ($${(priceConfig.minimum_price / 100).toFixed(2)})`;
  }
  return null;
}

function normalizePriceOption(row) {
  if (!row) return null;
  return {
    id: row.id ?? row.content_id ?? null,
    contentId: row.content_id ?? null,
    name: row.name ?? null,
    description: row.description ?? null,
    suggestedPrice: row.suggested_price ?? 0,
    minimumPrice: row.minimum_price ?? 0,
    allowFree: row.allow_free === 1 || row.allow_free === true,
    paymentType: row.payment_type || 'one_time',
    recurringInterval: row.recurring_interval || null,
    currency: row.currency || 'usd',
  };
}

function normalizeUnlockOptions(options = {}) {
  return {
    track: normalizePriceOption(options.track),
    project: normalizePriceOption(options.project),
    allAccess: normalizePriceOption(options.allAccess),
  };
}

function isFreeOneTimeUnlock(priceConfig, amountCents, paymentType) {
  return paymentType === 'one_time' && amountCents === 0 && !!priceConfig?.allow_free;
}

function stripeObjectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function stripeSubscriptionPeriodEnd(value) {
  if (!value || typeof value === 'string' || !value.current_period_end) return null;
  return new Date(value.current_period_end * 1000).toISOString();
}

function isStripeSubscriptionActive(value) {
  return !!(value && typeof value !== 'string' && ['active', 'trialing'].includes(value.status));
}

function resolvePaidUnlockSession(session) {
  const meta = session?.metadata || {};
  if (!meta.vault_unlock_type || !meta.vault_listener_id) return null;

  if (meta.vault_payment_type === 'one_time') {
    if (session.payment_status !== 'paid') return null;
    const stripePaymentId = stripeObjectId(session.payment_intent);
    if (!stripePaymentId) return null;
    return { stripePaymentId, expiresAt: null };
  }

  if (meta.vault_payment_type === 'recurring') {
    if (!isStripeSubscriptionActive(session.subscription)) return null;
    const stripePaymentId = stripeObjectId(session.subscription);
    const expiresAt = stripeSubscriptionPeriodEnd(session.subscription);
    if (!stripePaymentId || !expiresAt) return null;
    return { stripePaymentId, expiresAt };
  }

  return null;
}

// ─── Creator routes (requireDashboard) ───────────────────────────────────────

const dashRouter = require('express').Router();
dashRouter.use(requireDashboard);

// GET /api/dashboard/vault/pricing
// Returns full vault pricing state: all track prices, projects with items, all-access config.
dashRouter.get('/pricing', (req, res) => {
  const db = getDb();

  const trackPrices = db.prepare(`
    SELECT vp.*, m.title, m.filename, m.category
    FROM vault_prices vp
    JOIN media m ON m.id = vp.content_id
  `).all();

  const projects = db.prepare('SELECT * FROM vault_projects ORDER BY created_at DESC').all();
  const projectIds = projects.map(p => p.id);

  const allItems = projectIds.length
    ? db.prepare(`
        SELECT vpi.*, m.title, m.filename, m.category
        FROM vault_project_items vpi
        JOIN media m ON m.id = vpi.content_id
        WHERE vpi.project_id IN (${projectIds.map(() => '?').join(',')})
        ORDER BY vpi.sort_order
      `).all(...projectIds)
    : [];

  const projectMap = {};
  for (const p of projects) {
    projectMap[p.id] = { ...p, items: [] };
  }
  for (const item of allItems) {
    if (projectMap[item.project_id]) {
      projectMap[item.project_id].items.push(item);
    }
  }

  const allAccess = db.prepare('SELECT * FROM vault_all_access WHERE id = 1').get();

  res.json({
    trackPrices,
    projects: Object.values(projectMap),
    allAccess: allAccess || null,
  });
});

// PUT /api/dashboard/vault/pricing/track/:content_id
// Body: { suggested_price, minimum_price, allow_free, payment_type, recurring_interval }
// Pass body: {} or omit to remove vault pricing (resets visibility to 'public').
dashRouter.put('/pricing/track/:content_id', (req, res) => {
  const db = getDb();
  const contentId = parseInt(req.params.content_id, 10);

  const media = db.prepare('SELECT id, visibility FROM media WHERE id = ? AND is_active = 1').get(contentId);
  if (!media) return res.status(404).json({ error: 'Media not found' });

  const { suggested_price, minimum_price, allow_free, payment_type, recurring_interval } = req.body;

  // If no pricing fields provided, remove vault pricing and reset visibility
  const isRemoval = suggested_price == null && minimum_price == null && allow_free == null && payment_type == null;

  if (isRemoval) {
    db.prepare('DELETE FROM vault_prices WHERE content_id = ?').run(contentId);
    if (media.visibility === 'vault') {
      db.prepare("UPDATE media SET visibility = 'public', updated_at = ? WHERE id = ?").run(now(), contentId);
    }
    log('info', 'vault', `Track pricing removed: media ${contentId}`);
    return res.json({ ok: true, removed: true });
  }

  // Validate
  const suggestedCents = parseInt(suggested_price, 10) || 0;
  const minimumCents   = parseInt(minimum_price, 10) || 0;
  const freeAllowed    = allow_free ? 1 : 0;
  const ptype          = ['one_time', 'recurring'].includes(payment_type) ? payment_type : 'one_time';
  const interval       = ['monthly', 'annually'].includes(recurring_interval) ? recurring_interval : null;

  if (!freeAllowed && minimumCents < 1) {
    return res.status(400).json({ error: 'minimum_price must be >= 1 cent when allow_free is false' });
  }

  db.prepare(`
    INSERT INTO vault_prices (content_id, suggested_price, minimum_price, allow_free, payment_type, recurring_interval, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_id) DO UPDATE SET
      suggested_price    = excluded.suggested_price,
      minimum_price      = excluded.minimum_price,
      allow_free         = excluded.allow_free,
      payment_type       = excluded.payment_type,
      recurring_interval = excluded.recurring_interval,
      updated_at         = excluded.updated_at
  `).run(contentId, suggestedCents, minimumCents, freeAllowed, ptype, interval, now());

  // Auto-set visibility to 'vault'
  db.prepare("UPDATE media SET visibility = 'vault', updated_at = ? WHERE id = ?").run(now(), contentId);

  log('info', 'vault', `Track pricing set: media ${contentId} suggested=${suggestedCents} min=${minimumCents}`);
  res.json({ ok: true, contentId });
});

// POST /api/dashboard/vault/projects
// Body: { name, description?, cover_art_path?, suggested_price, minimum_price, allow_free, payment_type, recurring_interval }
dashRouter.post('/projects', (req, res) => {
  const { name, description, cover_art_path, suggested_price, minimum_price, allow_free, payment_type, recurring_interval } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const ptype    = ['one_time', 'recurring'].includes(payment_type) ? payment_type : 'one_time';
  const interval = ['monthly', 'annually'].includes(recurring_interval) ? recurring_interval : null;
  const minCents = parseInt(minimum_price, 10) || 0;
  const freeAllowed = allow_free ? 1 : 0;

  if (!freeAllowed && minCents < 1) {
    return res.status(400).json({ error: 'minimum_price must be >= 1 cent when allow_free is false' });
  }

  const db = getDb();
  const info = db.prepare(`
    INSERT INTO vault_projects (name, description, cover_art_path, suggested_price, minimum_price, allow_free, payment_type, recurring_interval)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), description || null, cover_art_path || null, parseInt(suggested_price, 10) || 0, minCents, freeAllowed, ptype, interval);

  log('info', 'vault', `Project created: ${name.trim()} (id=${info.lastInsertRowid})`);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

// PUT /api/dashboard/vault/projects/:id
dashRouter.put('/projects/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM vault_projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, description, cover_art_path, suggested_price, minimum_price, allow_free, payment_type, recurring_interval } = req.body;
  const ptype    = ['one_time', 'recurring'].includes(payment_type) ? payment_type : 'one_time';
  const interval = ['monthly', 'annually'].includes(recurring_interval) ? recurring_interval : null;
  const minCents = parseInt(minimum_price, 10) || 0;
  const freeAllowed = allow_free ? 1 : 0;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!freeAllowed && minCents < 1) {
    return res.status(400).json({ error: 'minimum_price must be >= 1 cent when allow_free is false' });
  }

  db.prepare(`
    UPDATE vault_projects SET
      name               = ?,
      description        = ?,
      cover_art_path     = ?,
      suggested_price    = ?,
      minimum_price      = ?,
      allow_free         = ?,
      payment_type       = ?,
      recurring_interval = ?,
      updated_at         = ?
    WHERE id = ?
  `).run(
    String(name).trim(),
    description || null,
    cover_art_path || null,
    parseInt(suggested_price, 10) || 0,
    minCents, freeAllowed, ptype, interval, now(),
    req.params.id
  );

  res.json({ ok: true });
});

// DELETE /api/dashboard/vault/projects/:id
dashRouter.delete('/projects/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM vault_projects WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Project not found' });
  log('info', 'vault', `Project deleted: id=${req.params.id}`);
  res.json({ ok: true });
});

// POST /api/dashboard/vault/projects/:id/items
// Body: { content_id, sort_order? }
dashRouter.post('/projects/:id/items', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM vault_projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const contentId = parseInt(req.body.content_id, 10);
  if (!contentId) return res.status(400).json({ error: 'content_id is required' });

  const media = db.prepare('SELECT id FROM media WHERE id = ? AND is_active = 1').get(contentId);
  if (!media) return res.status(404).json({ error: 'Media not found' });

  const sortOrder = parseInt(req.body.sort_order, 10) || 0;

  try {
    db.prepare(
      'INSERT INTO vault_project_items (project_id, content_id, sort_order) VALUES (?, ?, ?)'
    ).run(req.params.id, contentId, sortOrder);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Content item already belongs to a project' });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
});

// DELETE /api/dashboard/vault/projects/:id/items/:content_id
dashRouter.delete('/projects/:id/items/:content_id', (req, res) => {
  const db = getDb();
  const info = db.prepare(
    'DELETE FROM vault_project_items WHERE project_id = ? AND content_id = ?'
  ).run(req.params.id, req.params.content_id);
  if (info.changes === 0) return res.status(404).json({ error: 'Item not found in project' });
  res.json({ ok: true });
});

// PUT /api/dashboard/vault/all-access
// Body: { enabled, subscribers_included, suggested_price, minimum_price, allow_free, payment_type, recurring_interval }
dashRouter.put('/all-access', (req, res) => {
  const { enabled, subscribers_included, suggested_price, minimum_price, allow_free, payment_type, recurring_interval } = req.body;
  const ptype    = ['one_time', 'recurring'].includes(payment_type) ? payment_type : 'recurring';
  const interval = ['monthly', 'annually'].includes(recurring_interval) ? recurring_interval : null;
  const minCents = parseInt(minimum_price, 10) || 0;
  const freeAllowed = allow_free ? 1 : 0;

  if (!freeAllowed && minCents < 1 && (enabled || enabled == null)) {
    return res.status(400).json({ error: 'minimum_price must be >= 1 cent when allow_free is false' });
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO vault_all_access (id, enabled, subscribers_included, suggested_price, minimum_price, allow_free, payment_type, recurring_interval, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled              = excluded.enabled,
      subscribers_included = excluded.subscribers_included,
      suggested_price      = excluded.suggested_price,
      minimum_price        = excluded.minimum_price,
      allow_free           = excluded.allow_free,
      payment_type         = excluded.payment_type,
      recurring_interval   = excluded.recurring_interval,
      updated_at           = excluded.updated_at
  `).run(
    enabled ? 1 : 0,
    subscribers_included ? 1 : 0,
    parseInt(suggested_price, 10) || 0,
    minCents, freeAllowed, ptype, interval, now()
  );

  log('info', 'vault', `All-access config updated: enabled=${!!enabled} subscribers_included=${!!subscribers_included}`);
  res.json({ ok: true });
});

// ─── Listener routes ──────────────────────────────────────────────────────────

// GET /api/vault/unlock-options/:content_id
// Public — no auth required. Returns pricing options for a vault item,
// or { alreadyUnlocked: true } if the listener already has access.
router.get('/unlock-options/:content_id', (req, res) => {
  const db = getDb();
  const contentId = parseInt(req.params.content_id, 10);

  const media = db.prepare(
    "SELECT id, visibility FROM media WHERE id = ? AND is_active = 1"
  ).get(contentId);

  if (!media) return res.status(404).json({ error: 'Not found' });

  if (media.visibility !== 'vault') {
    return res.json({ isVault: false });
  }

  const listenerId = req.tokenRow?.listener_id || null;
  const result = canAccessVaultContent(listenerId, contentId);

  if (result.allowed) {
    return res.json({ alreadyUnlocked: true });
  }

  res.json({ isVault: true, unlockOptions: normalizeUnlockOptions(result.unlockOptions) });
});

// POST /api/vault/unlock
// Requires authenticated listener account (listener_id on token).
// Body: { unlock_type, target_id, amount, payment_type, recurring_interval }
// Returns: { checkoutUrl }
router.post('/unlock', paymentLimiter, asyncHandler(async (req, res) => {
  const listenerId = req.tokenRow?.listener_id;
  if (!listenerId) {
    return res.status(401).json({ error: 'Account required', action: 'signup' });
  }

  const { unlock_type, target_id, amount, payment_type, recurring_interval } = req.body;

  // Validate unlock_type
  if (!['track', 'project', 'all_access'].includes(unlock_type)) {
    return res.status(400).json({ error: 'unlock_type must be track, project, or all_access' });
  }

  // Validate payment_type
  if (!['one_time', 'recurring'].includes(payment_type)) {
    return res.status(400).json({ error: 'payment_type must be one_time or recurring' });
  }

  if (payment_type === 'recurring' && !['monthly', 'annually'].includes(recurring_interval)) {
    return res.status(400).json({ error: 'recurring_interval must be monthly or annually' });
  }

  const amountCents = parseInt(amount, 10);
  if (!amountCents && amountCents !== 0) {
    return res.status(400).json({ error: 'amount is required' });
  }

  // target_id required for track and project
  const targetId = (unlock_type !== 'all_access') ? parseInt(target_id, 10) : null;
  if (unlock_type !== 'all_access' && !targetId) {
    return res.status(400).json({ error: 'target_id is required for track and project unlocks' });
  }

  // Fetch price config and enforce minimum
  const db = getDb();
  const priceConfig = getPriceConfig(db, unlock_type, targetId);
  const priceError = validateAmount(priceConfig, amountCents);
  if (priceError) return res.status(400).json({ error: priceError });
  if (payment_type === 'recurring' && amountCents < 1) {
    return res.status(400).json({ error: 'Recurring unlocks require a paid amount' });
  }
  if (isFreeOneTimeUnlock(priceConfig, amountCents, payment_type)) {
    createVaultUnlock(db, {
      listenerId,
      unlockType: unlock_type,
      targetId,
      paymentType: 'one_time',
      amountPaid: 0,
      stripePaymentId: null,
      expiresAt: null,
    });
    return res.json({ unlocked: true });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: 'Stripe is not configured on this server' });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const base   = config.station.publicUrl || `http://localhost:${config.port}`;

    // Build a human-readable product name
    let productName = 'Vault Access';
    if (unlock_type === 'track' && targetId) {
      const m = db.prepare('SELECT title, filename FROM media WHERE id = ?').get(targetId);
      if (m) productName = `Vault: ${m.title || m.filename}`;
    } else if (unlock_type === 'project' && priceConfig) {
      productName = `Vault Project: ${priceConfig.name}`;
    } else if (unlock_type === 'all_access') {
      productName = 'Vault All-Access Pass';
    }

    const metadata = {
      vault_unlock_type:    unlock_type,
      vault_target_id:      String(targetId || ''),
      vault_listener_id:    String(listenerId),
      vault_payment_type:   payment_type,
    };

    let session;

    if (payment_type === 'one_time') {
      // Stripe Checkout mode: payment (same pattern as tips)
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency:     priceConfig.currency || 'usd',
            product_data: { name: productName },
            unit_amount:  amountCents,
          },
          quantity: 1,
        }],
        success_url: `${base}/api/vault/unlock-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${base}/#library`,
        metadata,
        payment_intent_data: { metadata },
      });
    } else {
      // Recurring: create a dynamic Stripe Price, then Checkout mode: subscription
      const stripeInterval = recurring_interval === 'annually' ? 'year' : 'month';
      const price = await stripe.prices.create({
        unit_amount:  amountCents,
        currency:     priceConfig.currency || 'usd',
        recurring:    { interval: stripeInterval },
        product_data: { name: productName },
      });

      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: price.id, quantity: 1 }],
        success_url:       `${base}/api/vault/unlock-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:        `${base}/#library`,
        metadata,
        subscription_data: { metadata },
      });
    }

    log('info', 'vault', `Unlock checkout created: ${unlock_type} target=${targetId || 'all'} listener=${listenerId} amount=${amountCents}`);
    res.json({ checkoutUrl: session.url });

  } catch (err) {
    log('error', 'vault', `Unlock checkout failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}));

// GET /api/vault/unlock-success?session_id=xxx
// Stripe redirects here after successful vault checkout.
// Creates vault_unlock opportunistically (webhook is authoritative).
router.get('/unlock-success', asyncHandler(async (req, res) => {
  const { session_id } = req.query;

  if (session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['payment_intent', 'subscription'],
      });

      const meta = session.metadata || {};
      const paid = resolvePaidUnlockSession(session);
      if (paid) {
        const db = getDb();
        createVaultUnlock(db, {
          listenerId:      parseInt(meta.vault_listener_id, 10),
          unlockType:      meta.vault_unlock_type,
          targetId:        meta.vault_target_id ? parseInt(meta.vault_target_id, 10) : null,
          paymentType:     meta.vault_payment_type,
          amountPaid:      session.amount_total || 0,
          stripePaymentId: paid.stripePaymentId,
          expiresAt:       paid.expiresAt,
        });
      }
    } catch { /* webhook is authoritative — don't block redirect */ }
  }

  res.redirect('/#library');
}));

// ─── Shared unlock creation helper (used by redirect + webhook) ───────────────

function createVaultUnlock(db, { listenerId, unlockType, targetId, paymentType, amountPaid, stripePaymentId, expiresAt }) {
  const paidAmount = Number(amountPaid || 0);
  const isFreeOneTime = paymentType === 'one_time' && paidAmount === 0;
  if (!stripePaymentId && !isFreeOneTime) {
    throw new Error('Paid vault unlocks require a Stripe payment or subscription id');
  }

  // Idempotent: skip if stripe_payment_id already recorded
  if (stripePaymentId) {
    const existing = db.prepare(
      'SELECT id FROM vault_unlocks WHERE stripe_payment_id = ?'
    ).get(stripePaymentId);
    if (existing) return existing.id;
  }

  // ON CONFLICT DO NOTHING — backstop against idx_vault_unlocks_payment so a
  // duplicate payment id can never create a second unlock row, even outside the
  // webhook transaction (e.g. a checkout success-redirect racing the webhook).
  const info = db.prepare(`
    INSERT INTO vault_unlocks (listener_id, unlock_type, target_id, amount_paid, payment_type, stripe_payment_id, active, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT DO NOTHING
  `).run(listenerId, unlockType, targetId || null, paidAmount, paymentType, stripePaymentId || null, expiresAt || null);

  if (info.changes === 0 && stripePaymentId) {
    // Lost the race to a concurrent insert — return the row that won.
    const row = db.prepare('SELECT id FROM vault_unlocks WHERE stripe_payment_id = ?').get(stripePaymentId);
    return row ? row.id : null;
  }

  log('info', 'vault', `Vault unlock created: ${unlockType} target=${targetId || 'all'} listener=${listenerId} id=${info.lastInsertRowid}`);
  return info.lastInsertRowid;
}

module.exports = router;
module.exports.dashRouter     = dashRouter;
module.exports.createVaultUnlock = createVaultUnlock;
module.exports.normalizePriceOption = normalizePriceOption;
module.exports.normalizeUnlockOptions = normalizeUnlockOptions;
module.exports.isFreeOneTimeUnlock = isFreeOneTimeUnlock;
module.exports.resolvePaidUnlockSession = resolvePaidUnlockSession;
