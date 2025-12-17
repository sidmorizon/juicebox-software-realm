/**
 * Juicebox Auth Token Server
 * 
 * 本地开发用的后端服务，用于：
 * 1. 验证 Google ID Token
 * 2. 签发 Realm 兼容的 JWT tokens
 * 
 * 启动方式: node server.js
 * 端口: 3000
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { SignJWT } from 'jose';
import { OAuth2Client } from 'google-auth-library';

const app = express();
const PORT = 3009;

// ============================================
// 配置
// ============================================

// Google OAuth Client ID (需要替换为你的)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '244450898872-47ako15ia39518jku25tvmm1v3cft8k5.apps.googleusercontent.com';

// Realm 配置
const REALM_IDS = [
  '237bc280f9944b44b8a515962ff27787',
  'ea92c916cc0b454c98bc784816633fbb',
  '144733cee32840a29b5ae2629791eeef'
];

// 租户配置 (可通过环境变量覆盖)
const TENANT_NAME = process.env.TENANT_NAME || 'JuiceBoxRealmTenantOneKey';
const TENANT_VERSION = parseInt(process.env.TENANT_VERSION, 10) || 1;

// 密钥环境变量 (生产环境使用)
const ENV_PRIVATE_KEY = process.env.TENANT_PRIVATE_KEY;
const ENV_PUBLIC_KEY = process.env.TENANT_PUBLIC_KEY;

// ============================================
// 生成或加载 Ed25519 密钥对
// ============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 密钥文件路径
const KEYS_FILE = path.join(__dirname, '.auth-keys.json');

let privateKey, publicKey;

function initializeKeys() {
  // 优先级 1: 环境变量
  if (ENV_PRIVATE_KEY && ENV_PUBLIC_KEY) {
    console.log('✅ Loading keys from environment variables...');
    privateKey = crypto.createPrivateKey({
      key: Buffer.from(ENV_PRIVATE_KEY, 'hex'),
      format: 'der',
      type: 'pkcs8'
    });
    publicKey = crypto.createPublicKey({
      key: Buffer.from(ENV_PUBLIC_KEY, 'hex'),
      format: 'der',
      type: 'spki'
    });
    return;
  }
  
  // 优先级 2: 从文件加载
  if (fs.existsSync(KEYS_FILE)) {
    console.log(`✅ Loading keys from ${KEYS_FILE}...`);
    try {
      const savedKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      privateKey = crypto.createPrivateKey({
        key: Buffer.from(savedKeys.privateKey, 'hex'),
        format: 'der',
        type: 'pkcs8'
      });
      publicKey = crypto.createPublicKey({
        key: Buffer.from(savedKeys.publicKey, 'hex'),
        format: 'der',
        type: 'spki'
      });
      
      console.log('Keys loaded successfully!');
      printKeyConfig();
      return;
    } catch (e) {
      console.error('Failed to load keys from file:', e.message);
    }
  }
  
  // 优先级 3: 生成新密钥并保存
  console.log('🔑 Generating new Ed25519 key pair and saving to file...');
  const keyPair = crypto.generateKeyPairSync('ed25519');
  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;
  
  // 保存到文件
  const privateKeyHex = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  
  const keysData = {
    privateKey: privateKeyHex,
    publicKey: publicKeyHex,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keysData, null, 2));
  console.log(`✅ Keys saved to ${KEYS_FILE}`);
  
  printKeyConfig();
}

function printKeyConfig() {
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  
  console.log('\n========================================');
  console.log('Realm 服务器配置（复制到 Makefile 第 8 行）');
  console.log('========================================');
  
  const authKeyJson = JSON.stringify({
    data: publicKeyHex,
    encoding: 'Hex',
    algorithm: 'Edwards25519'
  });
  const tenantSecrets = JSON.stringify({
    [TENANT_NAME]: { [TENANT_VERSION.toString()]: authKeyJson }
  });
  console.log(`export TENANT_SECRETS = ${tenantSecrets}`);
  console.log('========================================\n');
}

// ============================================
// Google OAuth 验证
// ============================================

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    return {
      sub: payload.sub,           // Google unique user ID
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };
  } catch (error) {
    console.error('Google token verification failed:', error.message);
    throw new Error('Invalid Google ID token');
  }
}

// ============================================
// 中间件
// ============================================

app.use(cors({
  origin: ['http://localhost:8006', 'http://127.0.0.1:8006'],
  credentials: true
}));
app.use(express.json());

// ============================================
// API 路由
// ============================================

// 默认路由 - 帮助页面
app.get('/', (req, res) => {
  const privateKeyHex = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  
  const authKeyJson = JSON.stringify({
    data: publicKeyHex,
    encoding: 'Hex',
    algorithm: 'Edwards25519'
  });
  
  const tenantSecrets = JSON.stringify({
    [TENANT_NAME]: { [TENANT_VERSION.toString()]: authKeyJson }
  });
  
  const generatorConfig = JSON.stringify({
    key: privateKeyHex,
    tenant: TENANT_NAME,
    version: TENANT_VERSION
  }, null, 2);
  
  // 读取 .auth-keys.json 文件内容
  let authKeysContent = '';
  try {
    if (fs.existsSync(KEYS_FILE)) {
      authKeysContent = fs.readFileSync(KEYS_FILE, 'utf8');
    }
  } catch (e) {
    authKeysContent = '// 文件不存在或无法读取';
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Juicebox Auth Server</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f; 
      color: #f1f5f9; 
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #818cf8; }
    h2 { color: #6366f1; margin-top: 2rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .card {
      background: #12121a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
    }
    .label { 
      color: #94a3b8; 
      font-size: 0.875rem; 
      margin-bottom: 0.5rem;
      display: block;
    }
    pre {
      background: #1a1a24;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .success { color: #10b981; }
    .warning { color: #f59e0b; }
    code { 
      background: #1a1a24; 
      padding: 0.2rem 0.4rem; 
      border-radius: 4px;
      font-size: 0.875rem;
    }
    .copy-btn {
      background: #6366f1;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .copy-btn:hover { background: #818cf8; }
    .endpoint { color: #818cf8; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #333; }
    th { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Juicebox Auth Server</h1>
    <p class="success">✅ Server is running on port ${PORT}</p>
    
    <h2>📋 当前密钥对配置</h2>
    
    <div class="card">
      <span class="label">1️⃣ 前端 Generator 配置 (test-client/index.html)</span>
      <p style="color: #888; font-size: 0.9em;">⚠️ 仅 DevMode 需要，Google 登录方式不需要此配置</p>
      <p>在 Generator Config 文本框中填入以下 JSON：</p>
      <pre id="generator-config">${generatorConfig}</pre>
      <button class="copy-btn" onclick="copyToClipboard('generator-config')">📋 复制</button>
    </div>
    
    <div class="card">
      <span class="label">2️⃣ Realm 服务器配置 (Makefile 第 8 行)</span>
      <p>替换 <code>export TENANT_SECRETS = ...</code> 为：</p>
      <pre id="tenant-secrets">export TENANT_SECRETS = ${tenantSecrets}</pre>
      <button class="copy-btn" onclick="copyToClipboard('tenant-secrets')">📋 复制</button>
    </div>
    
    <div class="card">
      <span class="label">3️⃣ 密钥对原文件 (.auth-keys.json)</span>
      <p>完整的密钥对 JSON 文件，包含私钥和公钥：</p>
      <pre id="auth-keys-json">${authKeysContent}</pre>
      <button class="copy-btn" onclick="copyToClipboard('auth-keys-json')">📋 复制</button>
    </div>
    
    <h2>🔗 API 端点</h2>
    <table>
      <tr>
        <th>方法</th>
        <th>路径</th>
        <th>说明</th>
      </tr>
      <tr>
        <td><code>GET</code></td>
        <td class="endpoint">/</td>
        <td>帮助页面（当前页面）</td>
      </tr>
      <tr>
        <td><code>GET</code></td>
        <td class="endpoint">/health</td>
        <td>健康检查</td>
      </tr>
      <tr>
        <td><code>POST</code></td>
        <td class="endpoint">/api/auth/realm-tokens</td>
        <td>验证 Google 登录并签发 tokens</td>
      </tr>
    </table>
    
    <h2>🚀 快速开始</h2>
    <div class="card">
      <ol>
        <li>复制上面的 <strong>Realm 服务器配置</strong> 到 <code>Makefile</code> 第 8 行</li>
        <li>重启 Realm 服务器: <code>make dev-multi</code></li>
        <li>打开前端: <a href="http://localhost:8006" style="color: #818cf8;">http://localhost:8006</a></li>
        <li>使用 <strong>Generator 模式</strong> 或 <strong>Dev Mode</strong> 测试</li>
      </ol>
    </div>
    
    <h2>⚠️ 安全提示</h2>
    <div class="card">
      <p class="warning">⚠️ Generator 模式仅用于本地测试！</p>
      <p>生产环境中，私钥应该只存在于后端服务器，客户端不应该知道私钥。</p>
      <p>生产环境请使用 <strong>Token Map 模式</strong>，由后端 (Auth Server) 签发 JWT。</p>
    </div>
  </div>
  
  <script>
    function copyToClipboard(id) {
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板！');
      });
    }
  </script>
</body>
</html>
  `;
  
  res.type('html').send(html);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tenant: TENANT_NAME });
});

// 签发 Realm tokens（需要 Google 登录）
app.post('/api/auth/realm-tokens', async (req, res) => {
  try {
    const { googleIdToken } = req.body;
    
    if (!googleIdToken) {
      return res.status(400).json({ error: 'Missing googleIdToken' });
    }
    
    // 验证 Google ID Token
    const googleUser = await verifyGoogleIdToken(googleIdToken);
    console.log(`Verified Google user: ${googleUser.email} (${googleUser.sub})`);
    
    // 为每个 Realm 生成 JWT
    const tokens = {};
    const now = Math.floor(Date.now() / 1000);
    
    for (const realmId of REALM_IDS) {
      tokens[realmId] = await new SignJWT({
        sub: googleUser.sub,    // Google user ID（用户唯一标识）
        aud: realmId,           // 目标 Realm ID
        scope: 'user',          // 权限范围
      })
        .setProtectedHeader({ 
          alg: 'EdDSA', 
          kid: `${TENANT_NAME}:${TENANT_VERSION}` 
        })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)  // 1小时过期
        .setIssuer(TENANT_NAME)
        .sign(privateKey);
    }
    
    res.json({
      user: {
        id: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name
      },
      tokens: tokens
    });
    
  } catch (error) {
    console.error('Error generating tokens:', error);
    res.status(401).json({ error: error.message });
  }
});

// ============================================
// 启动服务器
// ============================================

initializeKeys();

app.listen(PORT, () => {
  console.log(`\n🚀 Auth Token Server running at http://localhost:${PORT}`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  GET  /health              - 健康检查`);
  console.log(`  POST /api/auth/realm-tokens - 验证 Google 并签发 tokens`);
  console.log(`\nGoogle Client ID: ${GOOGLE_CLIENT_ID}`);
  console.log(`Tenant: ${TENANT_NAME}:${TENANT_VERSION}`);
  console.log(`Realms: ${REALM_IDS.join(', ')}`);
});

