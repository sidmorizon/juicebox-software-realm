# Juicebox Test Client

用于测试 Juicebox Software Realm 的前端客户端和本地 Auth Server。

## 架构概述

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        整体架构                                             │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│  ┌─────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────────────┐│
│  │  Google OAuth   │    │      Auth Server        │    │        Realm Servers            ││
│  │                 │    │      (port 3009)        │    │    (ports 8580/8581/8582)       ││
│  │                 │    │                         │    │                                 ││
│  │  - 验证用户身份  │    │  - 核对 Google ID Token │    │  - 只持有 Ed25519 公钥           ││
│  │  - 返回 ID Token│    │  - 持有 Ed25519 私钥    │    │  - 验证 Realm JWT 签名          ││
│  │                 │    │  - 签发 Realm JWT       │    │  - 存储/恢复用户数据            ││
│  └────────┬────────┘    └───────────┬─────────────┘    └───────────────┬─────────────────┘│
│           │                         │                                  │                  │
│           │                         │                                  │                  │
│           └────────────┬────────────┴──────────────────────────────────┘                  │
│                        │                                                                  │
│                        ▼                                                                  │
│             ┌──────────────────────┐                                                      │
│             │     Test Client      │                                                      │
│             │     (port 8006)      │                                                      │
│             │                      │                                                      │
│             │  - Google 登录按钮    │                                                      │
│             │  - juicebox-sdk      │                                                      │
│             │  - Register/Recover  │                                                      │
│             └──────────────────────┘                                                      │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 密钥分发

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Ed25519 密钥对分发                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                    ┌─────────────────────┐                                  │
│                    │   Ed25519 密钥对     │                                  │
│                    │                     │                                  │
│                    │  privateKey: "..."  │                                  │
│                    │  publicKey: "..."   │                                  │
│                    └──────────┬──────────┘                                  │
│                               │                                             │
│               ┌───────────────┴───────────────┐                             │
│               │                               │                             │
│               ▼                               ▼                             │
│   ┌───────────────────────┐       ┌───────────────────────┐                │
│   │     Auth Server       │       │    Realm Servers      │                │
│   │                       │       │                       │                │
│   │  ✅ 私钥 (签名 JWT)    │       │  ❌ 无私钥             │                │
│   │  ✅ 公钥              │       │  ✅ 公钥 (验证签名)    │                │
│   └───────────────────────┘       └───────────────────────┘                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 测试环境 vs 生产环境

| 环境 | 密钥生成 | 密钥存储 | 配置方式 |
|------|---------|---------|---------|
| **测试环境** | Auth Server 启动时自动生成 | `.auth-keys.json` 文件 | 文件 + Makefile |
| **生产环境** | 离线生成 (air-gapped) | 密钥管理系统 (KMS/Vault) | 环境变量 |

#### 测试环境

- `.auth-keys.json` 由 Auth Server 首次启动时**自动生成**
- 方便本地开发，无需手动配置
- ⚠️ **仅用于开发测试，不可用于生产环境**

#### 生产环境

⚠️ **生产环境必须使用环境变量配置密钥，禁止使用文件存储！**

1. **离线生成密钥对**（在安全的离线环境中）：
   ```bash
   node generate-keys.js
   ```

2. **配置 Auth Server 环境变量**：
   ```bash
   # 租户配置
   export TENANT_NAME="JuiceBoxRealmTenantOneKey"   # 租户名 (对应 JWT iss 和 kid)
   export TENANT_VERSION="1"                                # 版本号 (对应 JWT kid)
   
   # 密钥配置
   export TENANT_PRIVATE_KEY="302e020100300506032b6570..."  # PKCS8 私钥 (hex)
   export TENANT_PUBLIC_KEY="302a300506032b6570..."         # SPKI 公钥 (hex)
   ```

3. **配置 Realm Server 环境变量**：
   ```bash
   # Realm Server 只需要公钥
   export TENANT_SECRETS='{"JuiceBoxRealmTenantOneKey":{"1":"{\"data\":\"302a300506032b6570...\",\"encoding\":\"Hex\",\"algorithm\":\"Edwards25519\"}"}}'
   ```
   
   **TENANT_SECRETS 格式说明**：
   ```
   {
     "JuiceBoxRealmTenantOneKey": {   ← 租户名
       "1": "{...}"                           ← 版本号
     }
   }
   ```
   
   内层 JSON 字符串 (AuthKeyJSON)：
   ```json
   {
     "data": "302a300506032b6570...",   // .auth-keys.json 的 publicKey
     "encoding": "Hex",                 // 固定值
     "algorithm": "Edwards25519"        // 固定值
   }
   ```
   
   **对应关系**：
   | 配置项 | TENANT_SECRETS | JWT header kid |
   |--------|----------------|----------------|
   | tenant | 第一层 key | `"JuiceBoxRealmTenantOneKey:1"` |
   | version | 第二层 key `"1"` | `"JuiceBoxRealmTenantOneKey:1"` |
   | publicKey | `data` 字段 | - |

4. **密钥加载优先级**（Auth Server）：
   - ① 环境变量 `TENANT_PRIVATE_KEY` + `TENANT_PUBLIC_KEY`
   - ② 文件 `.auth-keys.json`（仅测试环境）
   - ③ 自动生成新密钥（仅测试环境）

## 完整认证流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Google    │     │ Test Client │     │ Auth Server │     │   Realm     │
│   OAuth     │     │  (Browser)  │     │             │     │  Servers    │
│             │     │ port: 8006  │     │ port: 3009  │     │ ports: 8580 │
│             │     │             │     │             │     │  8581/8582  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │    ① 点击 Google 登录按钮              │                   │
       │◄──────────────────│                   │                   │
       │                   │                   │                   │
       │    ② 返回 Google ID Token             │                   │
       │──────────────────►│                   │                   │
       │                   │                   │                   │
       │                   │  ③ POST /api/auth/realm-tokens        │
       │                   │     { googleIdToken }                 │
       │                   │──────────────────►│                   │
       │                   │                   │                   │
       │                   │                   │ ④ 验证 Google Token
       │                   │                   │   (调用 Google API)
       │                   │                   │                   │
       │                   │                   │ ⑤ 用私钥为每个 Realm
       │                   │                   │   签发 JWT tokens
       │                   │                   │                   │
       │                   │  ⑥ 返回 tokens    │                   │
       │                   │  { "realmId": "jwt", ... }            │
       │                   │◄──────────────────│                   │
       │                   │                   │                   │
       │                   │  ⑦ Register/Recover (携带 JWT)        │
       │                   │───────────────────────────────────────►
       │                   │                   │                   │
       │                   │                   │    ⑧ 用公钥验证 JWT
       │                   │                   │       提取 sub 作为用户ID
       │                   │                   │                   │
       │                   │  ⑨ 操作结果       │                   │
       │                   │◄──────────────────────────────────────│
       │                   │                   │                   │
```

## 两种认证模式

Test Client 支持两种认证模式：

| 模式 | 适用场景 | 是否需要 Auth Server | 是否需要 Google 登录 |
|------|---------|---------------------|---------------------|
| **Token Map** | 生产环境、完整测试 | ✅ 需要 | ✅ 需要 |
| **Generator (DevMode)** | 本地快速调试 | ❌ 不需要 | ❌ 不需要 |

### Token Map 模式（推荐）

这是生产环境使用的模式：
1. 用户通过 Google 登录
2. Auth Server 验证 Google ID Token
3. Auth Server 用私钥为每个 Realm 签发 JWT
4. 前端使用这些 JWT 与 Realm 通信

### Generator 模式（DevMode）

⚠️ **仅用于本地开发调试，不可用于生产环境！**

Generator 模式允许前端直接生成 JWT，无需 Auth Server：

1. **使用场景**：
   - 本地快速测试，无需配置 Google OAuth
   - 离线开发调试
   - Auth Server 不可用时的降级方案

2. **启用方式**：
   - 点击 "🔧 Dev Mode" 按钮，或
   - 切换到 "Generator" 标签页

3. **Generator Config 配置**：

   Generator 需要配置私钥才能生成有效的 JWT：

   ```json
   {
     "key": "302e020100300506032b657004220420...",  // Ed25519 PKCS8 私钥 (hex)
     "tenant": "JuiceBoxRealmTenantOneKey",         // 租户名
     "version": 1                                   // 版本号
   }
   ```

   | 字段 | 说明 | 来源 |
   |------|------|------|
   | `key` | Ed25519 PKCS8 私钥 (96 hex 字符) | `.auth-keys.json` 的 `privateKey` |
   | `tenant` | 租户名 | 与 `TENANT_SECRETS` 一致 |
   | `version` | 版本号 | 与 `TENANT_SECRETS` 一致 |

4. **获取 Generator Config**：

   访问 Auth Server 配置页面 http://localhost:3009，复制 "前端 Generator 配置" 中的 JSON。

5. **注意事项**：
   - Generator 模式下，前端持有私钥，**严重不安全**
   - 所有用户使用相同的 secret_id，无法区分不同用户
   - 仅适用于功能测试，不适用于多用户场景

## JWT Token 结构

Auth Server 签发的 JWT 包含以下信息：

```json
{
  "header": {
    "alg": "EdDSA",
    "kid": "test:1"           // 租户名:版本号，用于查找公钥
  },
  "payload": {
    "sub": "google-user-id",  // 用户唯一标识 (来自 Google)
    "aud": "realm-id",        // 目标 Realm ID
    "iss": "JuiceBoxRealmTenantOneKey",  // 签发者 (租户名)
    "scope": "user",          // 权限范围
    "iat": 1234567890,        // 签发时间
    "exp": 1234571490         // 过期时间 (1小时后)
  },
  "signature": "..."          // Ed25519 签名
}
```

## 快速开始

### 1. 安装依赖

```bash
cd test-client
yarn install
```

### 2. 启动所有服务

```bash
# 方式一：单独启动
make auth-server     # 启动 Auth Server (port 3009)
make dev-multi       # 启动 3 个 Realm (ports 8580/8581/8582)
make test-client     # 启动前端 (port 8006)

# 方式二：一键启动全部
make dev-all
```

### 3. 配置同步

首次启动 Auth Server 后，需要将公钥同步到 Realm Server：

1. 访问 http://localhost:3009 查看 Auth Server 配置页面
2. 复制 `TENANT_SECRETS` 配置到 `Makefile` 第 8 行
3. 重启 Realm Servers: `make dev-multi`

### 4. 测试

1. 打开 http://localhost:8006
2. 点击 "Sign in with Google" 登录
3. 登录成功后自动获取 JWT tokens
4. 使用 Register/Recover/Delete 测试功能

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.html` | 前端页面入口 |
| `src/main.js` | 前端逻辑，包含 Google 登录和 SDK 调用 |
| `server.js` | Auth Server，验证 Google 登录并签发 JWT |
| `.auth-keys.json` | Ed25519 密钥对存储文件 (自动生成) |
| `generate-keys.js` | 手动生成密钥对的脚本 |

## API 端点

### Auth Server (port 3009)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 配置帮助页面 |
| GET | `/health` | 健康检查 |
| POST | `/api/auth/realm-tokens` | 验证 Google 登录并签发 tokens |

### Realm Server (ports 8580/8581/8582)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务状态 |
| POST | `/register1` | 注册流程第1步 |
| POST | `/register2` | 注册流程第2步 |
| POST | `/recover1` | 恢复流程第1步 |
| POST | `/recover2` | 恢复流程第2步 |
| POST | `/delete` | 删除用户数据 |

## 安全说明

⚠️ **生产环境注意事项**：

1. **密钥管理**：
   - 密钥必须在**离线安全环境**中生成
   - 通过**环境变量**配置，禁止使用文件存储
   - 私钥只存在于 Auth Server，绝不能暴露给前端或 Realm Server
   - `.auth-keys.json` 文件仅用于测试环境，生产环境禁止使用

2. **HTTPS**：生产环境必须使用 HTTPS

3. **Token 过期**：JWT 默认 1 小时过期，可根据需求调整

4. **CORS**：生产环境需要正确配置 CORS 白名单

5. **密钥轮换**：定期轮换密钥，使用 `kid` (tenant:version) 支持多版本共存

