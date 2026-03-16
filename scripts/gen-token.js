#!/usr/bin/env node
// Usage: node scripts/gen-token.js "Label name"

// Bootstrap config + DB before requiring auth
require('../src/config');
const { initDb, closeDb } = require('../src/db');
const { createToken } = require('../src/auth');

const label = process.argv[2] || 'Unnamed';

initDb();
const token = createToken(label);
closeDb();

console.log(`\nToken created for "${label}":\n`);
console.log(`  ${token}\n`);
console.log('Share this with your subscriber. They redeem it at /api/tokens/redeem\n');
