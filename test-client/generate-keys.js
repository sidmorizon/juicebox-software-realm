#!/usr/bin/env node
/**
 * Generate ed25519 key pair for Juicebox auth
 * 
 * Usage: node generate-keys.js
 * 
 * This generates:
 * - Private key seed (64 hex chars) - for client's AuthTokenGenerator
 * - Public key PKIX (hex) - for server's TENANT_SECRETS
 */

import crypto from 'crypto';

// Generate ed25519 key pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Export private key in PKCS8 DER format (48 bytes = 96 hex chars)
const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
const privateKeyHex = privateKeyDer.toString('hex');

// Export public key in SPKI/PKIX DER format  
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const publicKeyHex = publicKeyDer.toString('hex');

console.log('=== Ed25519 Key Pair for Juicebox ===\n');

console.log('Private Key (PKCS8 DER hex):');
console.log('----------------------------------------');
console.log(privateKeyHex);

console.log('\n\nPublic Key (SPKI/PKIX DER hex):');
console.log('----------------------------------------');
console.log(publicKeyHex);

// AuthKeyJSON format for TENANT_SECRETS
const authKeyJson = JSON.stringify({
  data: publicKeyHex,
  encoding: "Hex",
  algorithm: "Edwards25519"
});

console.log('\n\nAuthKeyJSON (for TENANT_SECRETS value):');
console.log('----------------------------------------');
console.log(authKeyJson);

console.log('\n\n=== 配置说明 ===');
console.log(`
1. Auth Server 环境变量:
   export TENANT_PRIVATE_KEY="${privateKeyHex}"
   export TENANT_PUBLIC_KEY="${publicKeyHex}"

2. Realm Server 环境变量 (替换 <tenant> 和 <version>):
   export TENANT_SECRETS='{"<tenant>":{"<version>":"${authKeyJson.replace(/"/g, '\\"')}"}}'

3. 前端 Generator Config (替换 <tenant> 和 <version>):
   {
     "key": "${privateKeyHex}",
     "tenant": "<tenant>",
     "version": <version>
   }
`);

