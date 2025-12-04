# Security Architecture - Automata Agent Registry

This document details the security architecture of the Automata system, including automatic JWT authentication and authorization flows across all three layers.

## 📋 Overview

Automata implements a **three-layer JWT security system** that is completely automatic and transparent to developers:

1. **Provider → Registry**: Authentication for agent registration
2. **Consumer → Registry**: Authentication for agent search
3. **Consumer → Provider**: Temporary authorization for execution

All security is handled automatically by the SDKs - no manual credential management required.

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Registry Central                     │
│              (Authentication System)                 │
│                                                      │
│  ┌───────────────────────────────────────────────┐ │
│  │          AuthService                          │ │
│  │                                               │ │
│  │  • extractIdentifier(request)                 │ │
│  │    - Extracts IP or unique identifier         │ │
│  │                                               │ │
│  │  • generateCallerId(type, identifier)         │ │
│  │    - Generates unique caller_id (SHA256 hash) │ │
│  │                                               │ │
│  │  • getOrCreateToken(type, identifier)         │ │
│  │    - Creates or reuses JWT (24h validity)     │ │
│  │                                               │ │
│  │  • generateExecutionKey(consumer, agent)      │ │
│  │    - Generates execution key (5min, one-use)  │ │
│  │                                               │ │
│  │  • validateToken(jwt)                         │ │
│  │    - Validates JWT and returns payload        │ │
│  └───────────────────────────────────────────────┘ │
│                                                      │
│  Database: callers, execution_keys                  │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Flow 1: Provider → Registry (Auto-Registration)

### Objective
Allow provider agents to auto-register without manual credentials.

### Developer Code
```typescript
// SDK Provider - Developer perspective
const agent = new AgentProvider({
  id: 'agent:weather:brazil',
  name: 'WeatherBrazil',
  // ... other config
  registryUrl: 'https://registry.automata.io',
});

await agent.start(); // Auto-registers with Registry
```

### Internal Flow

```
Provider                    Registry Central             Database
   │                              │                         │
   │ 1. POST /auth/token          │                         │
   │    { type: "provider" }      │                         │
   │    Headers:                  │                         │
   │      x-provider-secret: JWT_SECRET                     │
   │──────────────────────────────▶                         │
   │                              │                         │
   │                              │ 2. extractIdentifier()  │
   │                              │    (IP or x-client-id)  │
   │                              │                         │
   │                              │ 3. generateCallerId()   │
   │                              │    SHA256(provider:IP)  │
   │                              │                         │
   │                              │ 4. encryptSecret()      │
   │                              │    Encrypt JWT_SECRET   │
   │                              │    with AES-256-CBC     │
   │                              │                         │
   │                              │ 5. INSERT/UPDATE caller │
   │                              │────────────────────────▶│
   │                              │    caller_id, encrypted │
   │                              │    secret, type         │
   │                              │                         │
   │ 6. { token: "eyJhbG...",     │                         │
   │       expires_in: "24h" }    │                         │
   │◀──────────────────────────────                         │
   │                              │                         │
   │ 7. POST /register            │                         │
   │    Authorization: Bearer JWT │                         │
   │    { id, name, endpoint...}  │                         │
   │──────────────────────────────▶                         │
   │                              │                         │
   │                              │ 8. validateToken(JWT)   │
   │                              │                         │
   │                              │ 9. UPSERT agents        │
   │                              │────────────────────────▶│
   │                              │    + caller_id ref      │
   │                              │                         │
   │ 10. { id, jwt_token }        │                         │
   │◀──────────────────────────────                         │
   │                              │                         │
   │ Provider uses its JWT_SECRET │                         │
   │ to validate execution keys   │                         │
```

### Security Features

- **Caller ID**: Auto-generated via SHA256 hash of `type:identifier`
- **Identifier**: Real machine IP, `x-client-id` header, or network IP
- **JWT Duration**: 24 hours
- **Provider Secret**: Provider sends its JWT_SECRET via `x-provider-secret` header
- **Secret Encryption**: Registry encrypts provider secret with AES-256-CBC before storing
- **Execution Key Generation**: Registry uses provider's secret to sign execution keys
- **Local Validation**: Provider validates execution keys locally using its JWT_SECRET
- **No Shared Secret**: Each provider has its own secret, isolated from others

---

## 🎯 Flow 2: Consumer → Registry (Search)

### Objective
Allow consumers to search for agents without manual credentials.

### Developer Code
```typescript
// SDK Consumer - Developer perspective
const consumer = new AgentConsumer({
  registryUrl: 'https://registry.automata.io',
});

const agents = await consumer.search({
  categories: ['weather'],
});
```

### Internal Flow

```
Consumer                    Registry Central             Database
   │                              │                         │
   │ 1. POST /auth/token          │                         │
   │    { type: "consumer" }      │                         │
   │    x-client-id: "cli-xyz"    │                         │
   │──────────────────────────────▶                         │
   │                              │                         │
   │                              │ 2. extractIdentifier()  │
   │                              │    (x-client-id or IP)  │
   │                              │                         │
   │                              │ 3. generateCallerId()   │
   │                              │    SHA256(consumer:cli) │
   │                              │                         │
   │                              │ 4. getOrCreateToken()   │
   │                              │────────────────────────▶│
   │                              │                         │
   │ 5. { token: "eyJhbG...",     │                         │
   │       expires_in: "24h" }    │                         │
   │◀──────────────────────────────                         │
   │                              │                         │
   │ Consumer stores JWT          │                         │
   │                              │                         │
   │ 6. POST /search              │                         │
   │    Authorization: Bearer JWT │                         │
   │    { categories: [...] }     │                         │
   │──────────────────────────────▶                         │
   │                              │                         │
   │                              │ 7. validateToken(JWT)   │
   │                              │    Extract caller_id    │
   │                              │                         │
   │                              │ 8. SELECT agents        │
   │                              │────────────────────────▶│
   │                              │                         │
   │                              │ 9. Calculate ranking    │
   │                              │                         │
   │                              │ 10. For each agent:     │
   │                              │     - Get provider      │
   │                              │       caller_id         │
   │                              │────────────────────────▶│
   │                              │     - Get encrypted     │
   │                              │       provider secret   │
   │                              │◀────────────────────────│
   │                              │     - Decrypt secret    │
   │                              │     - Generate exec key │
   │                              │       signed with       │
   │                              │       provider secret   │
   │                              │                         │
   │ 11. [{ id, endpoint, score,  │                         │
   │         execution_key,       │                         │
   │         key_expires_at }]    │                         │
   │◀──────────────────────────────                         │
```

### Security Features

- **Auto-authentication**: Consumer calls `/auth/token` automatically on first search
- **Stable Identifier**: `x-client-id` header recommended to avoid collisions
- **Execution Keys**: Generated for each (consumer, agent) pair in search
- **Provider-Specific Signing**: Each execution key is signed with the target provider's secret
- **Isolated Security**: Compromising one provider's secret doesn't affect others
- **Validity**: 5 minutes from generation

---

## 🎯 Flow 3: Consumer → Provider (Execution)

### Objective
Allow consumers to execute tasks on providers securely with temporary authorization.

### Developer Code
```typescript
// SDK Consumer - Developer perspective
const result = await consumer.executeWithFeedback(agents[0], {
  task: 'get_weather',
  params: { city: 'São Paulo' },
});
```

### Internal Flow

```
Consumer         Registry         Provider         Database
   │                 │                │                │
   │ 1. Has agents   │                │                │
   │    with exec    │                │                │
   │    keys         │                │                │
   │                 │                │                │
   │ 2. POST /execute                 │                │
   │    Authorization: Bearer {exec_key}               │
   │──────────────────────────────────▶                │
   │                 │                │                │
   │                 │                │ 3. Validate    │
   │                 │                │    execution   │
   │                 │                │    key via JWT │
   │                 │                │                │
   │                 │                │    jwt.verify( │
   │                 │                │      exec_key, │
   │                 │                │      JWT_SECRET│
   │                 │                │    )           │
   │                 │                │                │
   │                 │                │ 4. Check:      │
   │                 │                │    - Expired?  │
   │                 │                │    - Agent ID? │
   │                 │                │                │
   │ 5. { success, data }             │                │
   │◀──────────────────────────────────                │
   │                 │                │                │
   │ 6. POST /feedback│                │                │
   │    { agent_id,   │                │                │
   │      success,    │                │                │
   │      latency,    │                │                │
   │      rating }    │                │                │
   │─────────────────▶│                │                │
   │                 │                │                │
   │                 │ 7. UPDATE stats                 │
   │                 │────────────────────────────────▶│
```

### Security Features

- **Execution Key**: Short-lived JWT (5 minutes)
- **One-Time Use**: Ideally marked as used after first execution
- **Agent-Specific**: Each key is valid only for one specific agent
- **Local Validation**: Provider validates key locally without calling Registry

### Execution Key Payload (JWT)

```json
{
  "consumer_caller_id": "consumer-abc123",
  "agent_id": "agent:weather:brazil",
  "key_id": "exec-xyz789",
  "exp": 1234567890,
  "iat": 1234567590
}
```

---

## 🗄️ Database Schema

### Table: callers

Stores all registered callers (consumers and providers).

```sql
CREATE TABLE callers (
    caller_id VARCHAR(255) PRIMARY KEY,      -- SHA256 hash (unique)
    type VARCHAR(50) NOT NULL,               -- 'consumer' or 'provider'
    identifier VARCHAR(512) NOT NULL,        -- IP, x-client-id, etc
    jwt_token TEXT,                          -- For consumer: SHA256 of JWT
                                             -- For provider: AES-256 encrypted secret
    token_expires_at TIMESTAMP,              -- JWT expiration
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(type, identifier)                 -- Prevent duplicates
);

CREATE INDEX idx_callers_type ON callers (type);
CREATE INDEX idx_callers_identifier ON callers (identifier);
```

**Example records:**
```json
// Consumer record
{
  "caller_id": "consumer-1a2b3c4d5e6f7a8b",
  "type": "consumer",
  "identifier": "cli-app-123|192.168.1.50",
  "jwt_token": "a3f5b8c2...",  // SHA256 hash of JWT token
  "token_expires_at": "2025-12-03T10:30:00Z",
  "is_active": true
}

// Provider record
{
  "caller_id": "provider-a3f5b8c2d1e4f6a7",
  "type": "provider",
  "identifier": "192.168.1.100",
  "jwt_token": "e4f1a9b7...:c2d8f3a1...",  // AES-256 encrypted JWT_SECRET (iv:data)
  "token_expires_at": "2025-12-03T10:30:00Z",
  "is_active": true
}
```

### Table: execution_keys

Stores temporary execution keys for Consumer→Provider executions.

```sql
CREATE TABLE execution_keys (
    key_id VARCHAR(255) PRIMARY KEY,         -- Unique key ID
    consumer_caller_id VARCHAR(255) NOT NULL
        REFERENCES callers(caller_id),
    agent_id VARCHAR(255) NOT NULL
        REFERENCES agents(id),
    execution_key TEXT NOT NULL,             -- Execution key JWT
    expires_at TIMESTAMP NOT NULL,           -- Expiration (5 minutes)
    used BOOLEAN DEFAULT false,              -- Usage marker
    created_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (consumer_caller_id) REFERENCES callers(caller_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_execution_keys_consumer ON execution_keys (consumer_caller_id);
CREATE INDEX idx_execution_keys_agent ON execution_keys (agent_id);
CREATE INDEX idx_execution_keys_expires ON execution_keys (expires_at);
```

**Example record:**
```json
{
  "key_id": "exec-c4d5e6f7a8b9c0d1",
  "consumer_caller_id": "consumer-1a2b3c4d5e6f7a8b",
  "agent_id": "agent:weather:brazil",
  "execution_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2025-12-02T10:35:00Z",
  "used": false
}
```

---

## 🔑 Caller ID Generation

### Algorithm

```typescript
function generateCallerId(
  type: 'consumer' | 'provider',
  identifier: string
): string {
  // Combine type and identifier
  const input = `${type}:${identifier}`;

  // SHA256 hash
  const hash = crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, 16); // First 16 characters

  // Final format: {type}-{hash}
  return `${type}-${hash}`;
}

// Examples:
// generateCallerId('provider', '192.168.1.100')
// → 'provider-a3f5b8c2d1e4f6a7'

// generateCallerId('consumer', 'cli-app-123')
// → 'consumer-1a2b3c4d5e6f7a8b'
```

### Identifier Extraction

```typescript
function extractIdentifier(request: FastifyRequest): string {
  // 1. Preference: custom header
  const customId = request.headers['x-client-id'];
  if (customId) return customId as string;

  // 2. Second option: x-forwarded-for (proxies)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (forwarded as string).split(',');
    return ips[0].trim();
  }

  // 3. Fallback: socket IP
  return request.socket.remoteAddress || 'unknown';
}
```

---

## 🔐 Provider Secret Encryption

### Why Encrypt Provider Secrets?

Each provider has its own JWT_SECRET used to sign execution keys. The Registry must store these secrets to generate execution keys for consumers. To protect provider secrets, the Registry encrypts them before storage.

### Encryption Algorithm

```typescript
function encryptSecret(secret: string): string {
  // Derive 32-byte key from Registry's JWT_SECRET
  const key = crypto
    .createHash('sha256')
    .update(JWT_SECRET)
    .digest()
    .subarray(0, 32);

  // Generate random 16-byte IV
  const iv = crypto.randomBytes(16);

  // Encrypt using AES-256-CBC
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final()
  ]);

  // Format: iv:encrypted_data (both hex)
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}
```

### Decryption Algorithm

```typescript
function decryptSecret(encrypted: string): string {
  const [ivHex, dataHex] = encrypted.split(':');

  // Derive same 32-byte key
  const key = crypto
    .createHash('sha256')
    .update(JWT_SECRET)
    .digest()
    .subarray(0, 32);

  // Parse IV and encrypted data
  const iv = Buffer.from(ivHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  // Decrypt using AES-256-CBC
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
```

### Security Properties

- **Algorithm**: AES-256-CBC (industry standard)
- **Key Derivation**: SHA-256 hash of Registry's JWT_SECRET
- **IV**: Random 16-byte initialization vector (prevents pattern detection)
- **Format**: `{iv_hex}:{encrypted_data_hex}`
- **Protection**: Provider secrets are never stored in plain text

### Usage Flow

1. **Provider Registration**: Provider sends JWT_SECRET via `x-provider-secret` header
2. **Encryption**: Registry encrypts secret with `encryptSecret()`
3. **Storage**: Encrypted secret stored in `callers.jwt_token`
4. **Retrieval**: When consumer searches, Registry calls `getProviderSecret(caller_id)`
5. **Decryption**: Registry decrypts secret with `decryptSecret()`
6. **Signing**: Registry signs execution key with decrypted provider secret
7. **Validation**: Provider validates execution key locally using its JWT_SECRET

---

## 🛡️ Security Validations

### 1. JWT Validation (Registry)

```typescript
function validateToken(token: string) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Check expiration
    if (payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    // Check caller exists and is active
    const caller = await db.query(
      'SELECT * FROM callers WHERE caller_id = $1 AND is_active = true',
      [payload.caller_id]
    );

    if (!caller.rows[0]) {
      throw new Error('Caller not found or inactive');
    }

    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}
```

### 2. Execution Key Validation (Provider)

```typescript
function validateExecutionKey(key: string, agentId: string) {
  try {
    const payload = jwt.verify(key, JWT_SECRET);

    // Check expiration
    if (payload.exp < Date.now() / 1000) {
      throw new Error('Execution key expired');
    }

    // Check if valid for this agent
    if (payload.agent_id !== agentId) {
      throw new Error('Key not valid for this agent');
    }

    return payload;
  } catch (error) {
    throw new Error('Invalid execution key');
  }
}
```

---

## 🔒 Best Practices

### For Providers

1. **Never store execution keys**: Validate and discard
2. **Use HTTPS in production**: TLS/SSL mandatory
3. **Validate request payload**: Sanitize inputs
4. **Rate limiting**: Limit requests per IP
5. **Security logs**: Record invalid access attempts

```typescript
// Example: rate limiting
const rateLimit = {
  max: 100,           // 100 requests
  timeWindow: 60000   // per minute
};

agent.server.register(require('@fastify/rate-limit'), rateLimit);
```

### For Consumers

1. **Use x-client-id**: Custom header for stable identification
2. **Don't share tokens**: Each consumer should have its own
3. **Respect expiration**: Execution keys are temporary (5min)
4. **Handle 401/403 errors**: Re-authenticate if needed

```typescript
// Example: stable identifier
const consumer = new AgentConsumer({
  registryUrl: process.env.REGISTRY_URL,
  clientId: 'my-app-v1.0', // Custom identifier
});
```

### For Registry (Administrator)

1. **Rotate JWT_SECRET**: Periodically in production
2. **Monitor callers**: Detect abnormal patterns
3. **Cleanup**: Regularly remove expired execution keys
4. **Backup**: Regular backup of `callers` table
5. **Global rate limiting**: Protect public endpoints

```sql
-- Cleanup expired execution keys (periodic job)
DELETE FROM execution_keys
WHERE expires_at < NOW() - INTERVAL '1 hour';

-- Monitor authentication attempts
SELECT
  identifier,
  COUNT(*) as attempts,
  MAX(created_at) as last_attempt
FROM callers
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY identifier
HAVING COUNT(*) > 100
ORDER BY attempts DESC;
```

---

## 🚨 Error Handling

### HTTP Security Codes

| Code | Situation | Action |
|------|-----------|--------|
| **401** | Token missing or invalid | Re-authenticate (call `/auth/token`) |
| **403** | Valid token but no permission | Check execution key or agent_id |
| **419** | Token expired | Re-authenticate (call `/auth/token`) |
| **429** | Rate limit exceeded | Wait and retry |

### Example Error Handling (Consumer SDK)

```typescript
async function search(request: SearchRequest): Promise<AgentInfo[]> {
  try {
    const response = await fetch(`${this.registryUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify(request),
    });

    if (response.status === 401 || response.status === 419) {
      // Token expired, re-authenticate
      await this.authenticate();

      // Retry
      return this.search(request);
    }

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Failed to search agents: ${error.message}`);
  }
}
```

---

## 📊 Audit and Logs

### Security Events to Log

1. **Authentication**
   - Token obtain attempts
   - Tokens generated
   - Tokens rejected

2. **Authorization**
   - Execution keys generated
   - Execution keys used
   - Invalid execution keys

3. **Access**
   - Rejected requests (401/403)
   - Rate limit triggers
   - Blocked IPs

### Example Structured Log

```json
{
  "timestamp": "2025-12-02T10:30:00Z",
  "level": "warn",
  "event": "invalid_execution_key",
  "caller_id": "consumer-1a2b3c4d",
  "agent_id": "agent:weather:brazil",
  "ip": "192.168.1.50",
  "error": "Execution key expired",
  "user_agent": "automata-consumer-sdk/1.0.0"
}
```

---

## 🔐 Security Summary

| Aspect | Implementation | Protection |
|---------|---------------|----------|
| **Identity** | Caller ID via SHA256 hash | Guaranteed uniqueness |
| **Authentication** | JWT (24h) | Provider & Consumer → Registry |
| **Authorization** | Execution Keys (5min) | Consumer → Provider |
| **Confidentiality** | HTTPS/TLS | Encrypted communication |
| **Integrity** | JWT signature | Data not tampered |
| **Non-repudiation** | Logs + Audit trail | Traceability |

---

**Automatic, transparent, and robust security** 🔒
