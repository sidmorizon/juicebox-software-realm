#!/usr/bin/env node
/**
 * Generate Realm IDs using UUID v4
 * 
 * Usage: node generate-realm-ids.js [count]
 * 
 * Realm ID = UUID without dashes (32 hex chars = 16 bytes)
 */

import crypto from 'crypto';

const count = parseInt(process.argv[2], 10) || 3;

console.log('=== Generated Realm IDs ===\n');

console.log('Makefile format:');
console.log('----------------------------------------');
for (let i = 1; i <= count; i++) {
  const uuid = crypto.randomUUID();
  const realmId = uuid.replace(/-/g, '');
  console.log(`REALM_ID_${i} = ${realmId}`);
}

console.log('\n\nJSON array format (for test-client config):');
console.log('----------------------------------------');
const realmIds = [];
for (let i = 0; i < count; i++) {
  const uuid = crypto.randomUUID();
  const realmId = uuid.replace(/-/g, '');
  realmIds.push(realmId);
}
console.log(JSON.stringify(realmIds, null, 2));

