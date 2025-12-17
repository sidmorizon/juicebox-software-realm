import './styles.css';

// Import juicebox-sdk
let Client, Configuration, RegisterError, DeleteError, RecoverErrorReason, AuthTokenGenerator;
let sdkLoaded = false;
let authMode = 'token';
let stats = { requests: 0, success: 0, errors: 0 };
let isOperationInProgress = false;
let googleUser = null; // Store Google user info

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Default configuration
const DEFAULT_CONFIG = {
  realms: [
    { id: "237bc280f9944b44b8a515962ff27787", address: "http://localhost:8580" },
    { id: "ea92c916cc0b454c98bc784816633fbb", address: "http://localhost:8581" },
    { id: "144733cee32840a29b5ae2629791eeef", address: "http://localhost:8582" }
  ],
  register_threshold: 3,
  recover_threshold: 2,
  pin_hashing_mode: "Standard2019"
};

// ============================================
// Google Login Functions
// ============================================

// Decode JWT token payload (Google ID token is a JWT)
function decodeJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to decode JWT:', e);
    return null;
  }
}

// Auth Server URL
const AUTH_SERVER_URL = 'http://localhost:3009';

// Store tokens from auth server
let serverTokens = null;
let googleIdToken = null;

// Google login callback - called by Google Identity Services
window.handleGoogleLogin = async (response) => {
  console.log('Google login response:', response);
  
  if (response.credential) {
    googleIdToken = response.credential;
    const payload = decodeJwtPayload(response.credential);
    if (payload) {
      googleUser = {
        id: payload.sub,           // Google unique user ID
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      };
      
      // Update UI
      document.querySelector('.g_id_signin').style.display = 'none';
      document.getElementById('btn-dev-mode').style.display = 'none';
      document.getElementById('user-status').style.display = 'flex';
      document.getElementById('user-email').textContent = `👤 ${googleUser.email}`;
      
      // Auto-fill user-info with Google user ID (stable identifier)
      document.getElementById('user-info').value = `google:${googleUser.id}`;
      
      log(`✅ Google login successful: ${googleUser.email}`, 'success');
      
      // Try to get tokens from Auth Server
      await fetchTokensFromServer();
    }
  }
};

// Fetch tokens from Auth Server
async function fetchTokensFromServer() {
  if (!googleIdToken) {
    log('No Google ID token available', 'warning');
    return;
  }
  
  try {
    log('Fetching tokens from Auth Server...', 'info');
    const response = await fetch(`${AUTH_SERVER_URL}/api/auth/realm-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleIdToken })
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    const data = await response.json();
    serverTokens = data.tokens;
    
    // Auto-fill Token Map
    document.getElementById('auth-tokens-json').value = JSON.stringify(serverTokens, null, 2);
    
    // Switch to Token Map mode for production-like behavior
    switchAuthMode('token');
    
    log(`✅ Got tokens from Auth Server for user: ${data.user.email}`, 'success');
    log('Switched to Token Map mode (production-like)', 'info');
    
  } catch (error) {
    log(`⚠️ Auth Server not available: ${error.message}`, 'warning');
    log('Falling back to Generator mode (for local testing only)', 'info');
  }
}

// Dev mode: set a dev user and use Generator mode (no Auth Server needed)
window.fetchDevTokens = () => {
  // 使用固定的 dev 用户 ID（不拼接时间戳）
  const userId = document.getElementById('user-info').value || 'dev-user-001';
  
  // Set user info field
  document.getElementById('user-info').value = userId;
  
  // Make sure we're in Generator mode
  switchAuthMode('generator');
  
  // Update UI to show dev user
  document.getElementById('user-status').style.display = 'flex';
  document.getElementById('user-email').textContent = `🔧 Dev: ${userId}`;
  document.querySelector('.g_id_signin').style.display = 'none';
  document.getElementById('btn-dev-mode').style.display = 'none';
  
  log(`✅ [DEV] Dev mode activated, user: ${userId}`, 'success');
  log('Using Generator mode - make sure Realm servers have matching TENANT_SECRETS', 'info');
};

// Google logout
window.handleGoogleLogout = () => {
  googleUser = null;
  googleIdToken = null;
  serverTokens = null;
  
  // Update UI
  document.querySelector('.g_id_signin').style.display = 'block';
  document.getElementById('btn-dev-mode').style.display = 'inline-block';
  document.getElementById('user-status').style.display = 'none';
  document.getElementById('user-info').value = '';
  document.getElementById('auth-tokens-json').value = '{}';
  
  log('Logged out from Google, tokens cleared', 'info');
};

// Helper to convert hex string to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Load SDK
async function loadSDK() {
  const statusEl = document.getElementById('sdk-status');
  
  try {
    log('Loading juicebox-sdk...', 'info');
    
    // Import from npm package
    const sdk = await import('juicebox-sdk');
    
    Client = sdk.Client;
    Configuration = sdk.Configuration;
    RegisterError = sdk.RegisterError;
    DeleteError = sdk.DeleteError;
    RecoverErrorReason = sdk.RecoverErrorReason;
    AuthTokenGenerator = sdk.AuthTokenGenerator;
    
    sdkLoaded = true;
    statusEl.className = 'sdk-status ready';
    statusEl.innerHTML = '✅ juicebox-sdk loaded successfully';
    log('juicebox-sdk loaded successfully!', 'success');
    
    // Enable buttons
    document.getElementById('btn-register').disabled = false;
    document.getElementById('btn-recover').disabled = false;
    document.getElementById('btn-delete').disabled = false;
  } catch (e) {
    statusEl.className = 'sdk-status error';
    statusEl.innerHTML = `❌ Failed to load SDK: ${e.message}`;
    log(`Failed to load juicebox-sdk: ${e.message}`, 'error');
    log('Make sure to run: cd test-client && npm install && npm run dev', 'warning');
    console.error('SDK load error:', e);
  }
}

// Auth token callback - called by juicebox-sdk
window.JuiceboxGetAuthToken = async (realmId) => {
  const realmIdHex = bytesToHex(new Uint8Array(realmId));
  log(`Auth token requested for realm: ${realmIdHex}`, 'info');
  
  if (authMode === 'generator') {
    try {
      const generatorConfig = JSON.parse(document.getElementById('generator-json').value);
      // Validate that key is a hex string (ed25519 private key in PKCS8 format: 96 hex chars)
      if (!generatorConfig.key || !/^[0-9a-fA-F]+$/.test(generatorConfig.key)) {
        throw new Error('Key must be a hex string representing ed25519 private key');
      }
      // AuthTokenGenerator expects an object, not a JSON string
      const generator = new AuthTokenGenerator(generatorConfig);
      // generator.vend(realm_id, secret_id) 
      // 注意：两个参数都必须是 16 字节的 hex 字符串（32 hex 字符）
      // secret_id 会成为 JWT 的 sub 字段，用于标识用户
      // 这里使用 realmIdHex 作为 secret_id，意味着所有用户共享同一个身份
      // 生产环境应使用 Token Map 模式，由后端根据用户身份签发不同的 JWT
      // vend(realm_id: string, secret_id: string): string;
      const token = generator.vend(realmIdHex, realmIdHex);
      log(`Generated auth token for realm ${realmIdHex}`, 'success');
      return token;
    } catch (e) {
      log(`Failed to generate token: ${e.message}`, 'error');
      console.error('JuiceboxGetAuthToken ERROR: ', e);
      throw e;
    }
  } else {
    try {
      const tokensMap = JSON.parse(document.getElementById('auth-tokens-json').value);
      const token = tokensMap[realmIdHex];
      if (!token) {
        throw new Error(`No token found for realm ${realmIdHex}`);
      }
      log(`Using mapped token for realm ${realmIdHex}`, 'success');
      return token;
    } catch (e) {
      log(`Failed to get token from map: ${e.message}`, 'error');
      throw e;
    }
  }
};

function getConfig() {
  try {
    return JSON.parse(document.getElementById('config-json').value);
  } catch (e) {
    log('Invalid configuration JSON', 'error');
    return null;
  }
}

function renderRealms() {
  const config = getConfig();
  if (!config) return;

  const container = document.getElementById('realms-list');
  container.innerHTML = config.realms.map((realm, i) => `
    <div class="realm-item" id="realm-${realm.id}">
      <div class="realm-status" id="status-${realm.id}"></div>
      <div class="realm-info">
        <div class="realm-name">Realm ${i + 1}: ${realm.id}</div>
        <div class="realm-url">${realm.address}</div>
      </div>
      <button class="btn-secondary" onclick="window.checkRealm('${realm.id}', '${realm.address}')" style="padding: 0.5rem 0.75rem; font-size: 0.8rem;">
        Ping
      </button>
    </div>
  `).join('');
}

async function checkRealm(id, address) {
  const statusEl = document.getElementById(`status-${id}`);
  statusEl.className = 'realm-status';
  
  try {
    const response = await fetch(`${address}/`, {
      method: 'GET',
      mode: 'cors',
    });
    
    if (response.ok) {
      const data = await response.json();
      statusEl.classList.add('online');
      log(`Realm ${id} is online at ${address} (realmID: ${data.realmID || 'unknown'})`, 'success');
    } else {
      statusEl.classList.add('offline');
      log(`Realm ${id} responded with status ${response.status}`, 'warning');
    }
  } catch (e) {
    statusEl.classList.add('offline');
    log(`Realm ${id} is offline: ${e.message}`, 'error');
  }
}

async function checkAllRealms() {
  const config = getConfig();
  if (!config) return;

  log('Checking all realms...', 'info');
  for (const realm of config.realms) {
    await checkRealm(realm.id, realm.address);
  }
}

function resetConfig() {
  document.getElementById('config-json').value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  renderRealms();
  log('Configuration reset to defaults', 'info');
}

function switchAuthMode(mode) {
  authMode = mode;
  document.getElementById('tab-token').classList.toggle('active', mode === 'token');
  document.getElementById('tab-generator').classList.toggle('active', mode === 'generator');
  document.getElementById('auth-token-section').style.display = mode === 'token' ? 'block' : 'none';
  document.getElementById('auth-generator-section').style.display = mode === 'generator' ? 'block' : 'none';
}

function setButtonsDisabled(disabled) {
  isOperationInProgress = disabled;
  document.getElementById('btn-register').disabled = disabled || !sdkLoaded;
  document.getElementById('btn-recover').disabled = disabled || !sdkLoaded;
  document.getElementById('btn-delete').disabled = disabled || !sdkLoaded;
}

function updateStats() {
  document.getElementById('stat-requests').textContent = stats.requests;
  document.getElementById('stat-success').textContent = stats.success;
  document.getElementById('stat-errors').textContent = stats.errors;
}

function log(message, type = 'info') {
  const container = document.getElementById('output');
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-message log-${type}">${message}</span>
  `;
  container.insertBefore(entry, container.firstChild);
  console.log(`[${type}] ${message}`);
}

function clearLog() {
  document.getElementById('output').innerHTML = '<div class="empty-state">No logs yet.</div>';
  stats = { requests: 0, success: 0, errors: 0 };
  updateStats();
}

function createClient() {
  if (!sdkLoaded) {
    log('SDK not loaded yet', 'error');
    return null;
  }

  try {
    const configJSON = document.getElementById('config-json').value;
    const client = new Client(
      new Configuration(configJSON),
      [] // previousSecrets
    );
    return client;
  } catch (e) {
    log(`Invalid configuration: ${e.message}`, 'error');
    return null;
  }
}

async function handleRegister() {
  if (!sdkLoaded || isOperationInProgress) return;

  const client = createClient();
  if (!client) return;

  setButtonsDisabled(true);
  stats.requests++;
  updateStats();
  log('Starting registration...', 'info');

  const pin = document.getElementById('pin').value;
  const userInfo = document.getElementById('user-info').value;
  const secret = document.getElementById('secret').value;
  const allowedGuesses = parseInt(document.getElementById('allowed-guesses').value);

  try {
    await client.register(
      encoder.encode(pin),
      encoder.encode(secret),
      encoder.encode(userInfo),
      allowedGuesses
    );
    stats.success++;
    updateStats();
    log('✅ Registration successful!', 'success');
  } catch (e) {
    stats.errors++;
    updateStats();
    const errorName = RegisterError ? RegisterError[e] : e;
    log(`❌ Registration failed: ${errorName || e.message || e}`, 'error');
  }

  setButtonsDisabled(false);
}

async function handleRecover() {
  if (!sdkLoaded || isOperationInProgress) return;

  const client = createClient();
  if (!client) return;

  setButtonsDisabled(true);
  stats.requests++;
  updateStats();
  log('Starting recovery...', 'info');

  const pin = document.getElementById('pin').value;
  const userInfo = document.getElementById('user-info').value;

  try {
    const recoveredSecret = await client.recover(
      encoder.encode(pin),
      encoder.encode(userInfo)
    );
    stats.success++;
    updateStats();
    const secretStr = decoder.decode(recoveredSecret);
    log(`✅ Recovery successful! Secret: ${secretStr}`, 'success');
  } catch (e) {
    stats.errors++;
    updateStats();
    if (e.reason !== undefined) {
      const reasonName = RecoverErrorReason ? RecoverErrorReason[e.reason] : e.reason;
      log(`❌ Recovery failed: ${reasonName}, guesses remaining: ${e.guesses_remaining}`, 'error');
    } else {
      log(`❌ Recovery failed: ${e.message || e}`, 'error');
    }
  }

  setButtonsDisabled(false);
}

async function handleDelete() {
  if (!sdkLoaded || isOperationInProgress) return;

  if (!confirm('Are you sure you want to delete the registered secret?')) {
    return;
  }

  const client = createClient();
  if (!client) return;

  setButtonsDisabled(true);
  stats.requests++;
  updateStats();
  log('Starting deletion...', 'info');

  try {
    await client.delete();
    stats.success++;
    updateStats();
    log('✅ Deletion successful!', 'success');
  } catch (e) {
    stats.errors++;
    updateStats();
    const errorName = DeleteError ? DeleteError[e] : e;
    log(`❌ Deletion failed: ${errorName || e.message || e}`, 'error');
  }

  setButtonsDisabled(false);
}

// Expose functions to window for onclick handlers
window.checkRealm = checkRealm;
window.checkAllRealms = checkAllRealms;
window.resetConfig = resetConfig;
window.switchAuthMode = switchAuthMode;
window.clearLog = clearLog;
window.handleRegister = handleRegister;
window.handleRecover = handleRecover;
window.handleDelete = handleDelete;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Set default config
  document.getElementById('config-json').value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  renderRealms();
  
  // Load SDK and then check all realms
  await loadSDK();
  
  // Automatically check all realm statuses after SDK is loaded
  if (sdkLoaded) {
    checkAllRealms();
  }
  
  // Re-render realms when config changes
  document.getElementById('config-json').addEventListener('input', () => {
    renderRealms();
  });
});

