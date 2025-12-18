.PHONY: build run dev dev-multi run-multi clean kill-ports test install-client test-client auth-server check-public-key dev-all

# 环境变量
# TENANT_SECRETS 格式: {"租户名":{"版本": "AuthKeyJSON字符串"}}
# AuthKeyJSON 字符串内容: {"data":"公钥PKIX hex","encoding":"Hex","algorithm":"Edwards25519"}
# 客户端使用对应的私钥签名，服务端使用公钥验证
# 可运行 node test-client/generate-keys.js 生成新密钥对
export TENANT_SECRETS = {"JuiceBoxRealmTenantOneKey":{"1":"{\"data\":\"302a300506032b65700321006008835a9432d035b4195b9fa56b9b248c6295153484e4816c05b130f0bc1eb2\",\"encoding\":\"Hex\",\"algorithm\":\"Edwards25519\"}"}}

# Memory 存储持久化文件（可选，不设置则纯内存存储）
# 每个 Realm 实例需要独立的数据文件，在 dev-multi 中单独设置
# 单实例开发时使用这个默认值
export MEMORY_STORE_FILE = .realm-data.json

# 固定的 Realm ID (16-byte hex string = 32 hex chars)
REALM_ID_1 = 237bc280f9944b44b8a515962ff27787
REALM_ID_2 = ea92c916cc0b454c98bc784816633fbb
REALM_ID_3 = 144733cee32840a29b5ae2629791eeef

# 构建二进制文件
build:
	go build -o jb-sw-realm ./cmd/jb-sw-realm

# 运行单个实例
run:
	go run ./cmd/jb-sw-realm -id $(REALM_ID_1)

# 开发模式：启动单个实例 (端口 8580)
dev:
	go run ./cmd/jb-sw-realm -port 8580 -id $(REALM_ID_1)

# 开发模式：同时启动 3 个实例 (端口 8580, 8581, 8582)
# 每个实例使用独立的数据文件
dev-multi: check-public-key
	@echo "Starting 3 instances on ports 8580, 8581, 8582..."
	@echo "Realm IDs: $(REALM_ID_1), $(REALM_ID_2), $(REALM_ID_3)"
	@echo "Data files: .realm-data-8580.json, .realm-data-8581.json, .realm-data-8582.json"
	@MEMORY_STORE_FILE=.realm-data-8580.json go run ./cmd/jb-sw-realm -port 8580 -id $(REALM_ID_1) & \
	MEMORY_STORE_FILE=.realm-data-8581.json go run ./cmd/jb-sw-realm -port 8581 -id $(REALM_ID_2) & \
	MEMORY_STORE_FILE=.realm-data-8582.json go run ./cmd/jb-sw-realm -port 8582 -id $(REALM_ID_3) & \
	wait

# 使用已构建的二进制启动多实例
run-multi: build
	@echo "Starting 3 instances on ports 8580, 8581, 8582..."
	@echo "Realm IDs: $(REALM_ID_1), $(REALM_ID_2), $(REALM_ID_3)"
	@MEMORY_STORE_FILE=.realm-data-8580.json ./jb-sw-realm -port 8580 -id $(REALM_ID_1) & \
	MEMORY_STORE_FILE=.realm-data-8581.json ./jb-sw-realm -port 8581 -id $(REALM_ID_2) & \
	MEMORY_STORE_FILE=.realm-data-8582.json ./jb-sw-realm -port 8582 -id $(REALM_ID_3) & \
	wait

# 清理构建产物和依赖
clean:
	@echo "Cleaning build artifacts and dependencies..."
	rm -f jb-sw-realm
	rm -rf node_modules
	rm -rf test-client/node_modules
	rm -rf test-client/dist
	rm -rf test-client/.vite
	rm -f .realm-data.json
	rm -f .realm-data-*.json
	rm -f test-client/.auth-keys.json
	@echo "Clean complete."

# 终止指定端口的进程
kill-ports:
	@echo "Killing processes on ports 8006, 8007..."
	@PIDS_8006=$$(lsof -ti:8006 2>/dev/null); \
	if [ -n "$$PIDS_8006" ]; then \
		echo "Killing process on port 8006 (PID: $$PIDS_8006)"; \
		kill -9 $$PIDS_8006 2>/dev/null || true; \
	else \
		echo "No process found on port 8006"; \
	fi; \
	PIDS_8007=$$(lsof -ti:8007 2>/dev/null); \
	if [ -n "$$PIDS_8007" ]; then \
		echo "Killing process on port 8007 (PID: $$PIDS_8007)"; \
		kill -9 $$PIDS_8007 2>/dev/null || true; \
	else \
		echo "No process found on port 8007"; \
	fi; \
	echo "Done."

# 测试
test:
	go test ./...

# 安装前端依赖 (使用 yarn)
install-client:
	@echo "Installing test-client dependencies..."
	@cd test-client && yarn install

# 启动测试前端页面 (需要 Node.js)
test-client:
	@echo "Starting test client at http://localhost:8006"
	@cd test-client && yarn dev

# 启动后端 Auth Token 服务器 (端口 3009)
auth-server:
	@echo "Starting Auth Token Server at http://localhost:3009"
	@cd test-client && yarn server

# 检查 publicKey 是否匹配
check-public-key:
	@if [ -f test-client/.auth-keys.json ]; then \
		echo "Checking publicKey consistency..."; \
		AUTH_KEYS_PUBLIC_KEY=$$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('test-client/.auth-keys.json','utf8')); console.log(data.publicKey);"); \
		MAKEFILE_PUBLIC_KEY=$$(node -e "const secrets=process.env.TENANT_SECRETS; if(!secrets) { process.exit(1); } try { const parsed=JSON.parse(secrets); const tenant=Object.keys(parsed)[0]; const version=Object.keys(parsed[tenant])[0]; const authKey=JSON.parse(parsed[tenant][version]); console.log(authKey.data); } catch(e) { process.exit(1); }"); \
		if [ $$? -ne 0 ] || [ -z "$$MAKEFILE_PUBLIC_KEY" ]; then \
			echo "⚠️  Warning: Failed to parse TENANT_SECRETS environment variable, skipping check"; \
		elif [ "$$AUTH_KEYS_PUBLIC_KEY" != "$$MAKEFILE_PUBLIC_KEY" ]; then \
			MAKEFILE_PATH=$$(pwd)/Makefile; \
			echo ""; \
			echo "❌ ERROR: PublicKey mismatch!"; \
			echo ""; \
			echo "  test-client/.auth-keys.json publicKey:"; \
			echo "    $$AUTH_KEYS_PUBLIC_KEY"; \
			echo ""; \
			echo "  Makefile TENANT_SECRETS publicKey:"; \
			echo "    $$MAKEFILE_PUBLIC_KEY"; \
			echo ""; \
			echo "  Please update $$MAKEFILE_PATH line 8 with the publicKey from .auth-keys.json"; \
			echo "  Or regenerate keys by deleting .auth-keys.json and restarting Auth Server"; \
			echo ""; \
			exit 1; \
		else \
			echo "✅ PublicKey matches"; \
		fi \
	else \
		echo "⚠️  test-client/.auth-keys.json not found, skipping publicKey check"; \
	fi


# 完整开发环境（含 Auth Server）：启动 3 个 Realm + Auth Server + 前端
dev-all:
	@echo "Starting full dev environment with Auth Server..."
	@echo "Frontend:    http://localhost:8006"
	@echo "Auth Server: http://localhost:3009"
	@echo "Realms:      http://localhost:8580, http://localhost:8581, http://localhost:8582"
	@echo ""
	@echo "Note: Run 'make install-client' first if you haven't"
	@echo "      首次启动后，需要更新 Makefile 的 TENANT_SECRETS 为 Auth Server 输出的公钥"
	@echo ""
	@cd test-client && yarn dev & \
	cd test-client && yarn server & \
	echo "Waiting for Auth Server to generate .auth-keys.json..."; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		if [ -f test-client/.auth-keys.json ]; then \
			break; \
		fi; \
		sleep 1; \
	done; \
	if [ -f test-client/.auth-keys.json ]; then \
		if ! $(MAKE) check-public-key; then \
			echo ""; \
			echo "⚠️  PublicKey mismatch detected. Realm servers will NOT be started."; \
			echo "   Frontend (port 8006) and Auth Server (port 3009) are still running."; \
			echo "   Press Ctrl+C to stop all processes."; \
			echo ""; \
			wait; \
		else \
			MEMORY_STORE_FILE=.realm-data-8580.json go run ./cmd/jb-sw-realm -port 8580 -id $(REALM_ID_1) & \
			MEMORY_STORE_FILE=.realm-data-8581.json go run ./cmd/jb-sw-realm -port 8581 -id $(REALM_ID_2) & \
			MEMORY_STORE_FILE=.realm-data-8582.json go run ./cmd/jb-sw-realm -port 8582 -id $(REALM_ID_3) & \
			wait; \
		fi \
	else \
		echo "⚠️  Warning: .auth-keys.json not found after 10 seconds, skipping check"; \
		MEMORY_STORE_FILE=.realm-data-8580.json go run ./cmd/jb-sw-realm -port 8580 -id $(REALM_ID_1) & \
		MEMORY_STORE_FILE=.realm-data-8581.json go run ./cmd/jb-sw-realm -port 8581 -id $(REALM_ID_2) & \
		MEMORY_STORE_FILE=.realm-data-8582.json go run ./cmd/jb-sw-realm -port 8582 -id $(REALM_ID_3) & \
		wait; \
	fi

