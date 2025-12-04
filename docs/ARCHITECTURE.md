# Architecture - Automata Agent Registry

This document keeps the original structure, diagrams, and detailed walkthrough, now updated to match the current codebase (registry-central, sdk-agent-provider, sdk-agent-consumer). All content is in English.

---

## 🌐 Overview

The Automata system consists of 3 independent components that communicate via HTTP REST APIs:

- **Registry Central**: Centralized catalog, ranking, authentication, feedback, anti-fraud/quarantine
- **Agent Provider SDK**: Builds and exposes agents, auto-registers, validates execution keys locally
- **Agent Consumer SDK**: Searches agents, validates relevance with LLM, executes, interprets, and sends feedback

```
╔═══════════════════════════════════════ ECOSYSTEM ═══════════════════════════════════════╗
║                                                                                          ║
║   ┌────────────────────────────┐          ┌───────────────────────────────┐              ║
║   │   Registry Central         │          │   PostgreSQL (Managed)        │              ║
║   │   (Fastify + Node)         │          │   agents / stats / callers    │              ║
║   │                            │          │   feedback / fraud logs       │              ║
║   │   Services:                │          └───────────────────────────────┘              ║
║   │   • AuthService (JWT)      │                     ▲                                  ║
║   │   • RegisterService        │                     │                                  ║
║   │   • SearchService (Ranking)│                     │                                  ║
║   │   • FeedbackService        │                     │                                  ║
║   │   • QuarantineService      │                     │                                  ║
║   │   • FraudDetectionService  │                     │                                  ║
║   │   • Cron Auto-Review       │                     │                                  ║
║   └────────────────────────────┘                     │                                  ║
║             ▲          ▲                             │                                  ║
║             │          │                             │                                  ║
║   ┌─────────┘          └─────────┐     ┌─────────────┴─────────────┐                    ║
║   │   Agent Provider (SDK)       │     │   Agent Consumer (SDK)    │                    ║
║   │   • Fastify /execute         │     │   • LLM-powered search    │                    ║
║   │   • auto-register            │     │   • relevance + task pick │                    ║
║   │   • validate exec key local  │     │   • schema-based params   │                    ║
║   │   • rate limit 1 req/s       │     │   • execute + feedback    │                    ║
║   └──────────────────────────────┘     └───────────────────────────┘                    ║
║                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 🔎 Component Details

### 1. Registry Central

**Responsibilities:**
- Issue 24h JWTs for providers/consumers (`POST /auth/token`), deriving `caller_id` from IP/headers.
- Auto-register providers (`POST /register`), storing agent metadata: `intents`, `tasks`, `tags`, `categories`, `location_scope`, `languages`, `input_schema`, `meta`, `caller_id`, and `status`.
- Search + rank (`POST /search`), returning stateless execution keys (JWT 5m) signed with the provider secret.
- Collect feedback (`POST /feedback`), apply anti-fraud weights (production only), and update stats.
- Public health endpoints: `GET /health`, `GET /agents/:id/health`.
- Quarantine/ban logic + daily auto-review (production only).

**Technologies:**
- Node.js + TypeScript + Fastify
- PostgreSQL (JSONB + `pg_trgm` for fuzzy intent search)
- Docker + Docker Compose

**Database Schema (current):**

```
╔══════════════════════╗
║        agents        ║
╠══════════════════════╣
║ id (PK)              ║
║ name                 ║
║ endpoint             ║
║ description          ║
║ intents TEXT[]       ║
║ tasks   TEXT[]       ║  // available operations
║ tags    TEXT[]       ║
║ categories TEXT[]    ║
║ location_scope       ║
║ languages TEXT[]     ║
║ version              ║
║ input_schema JSONB   ║
║ meta JSONB           ║
║ caller_id            ║  // owner/provider
║ status               ║  // active|quarantine|banned
║ quarantine_reason    ║
║ quarantine_at        ║
║ created_at/updated_at║
╚══════════════════════╝
      1:1
╔══════════════════════╗
║     agent_stats      ║
╠══════════════════════╣
║ agent_id (PK, FK)    ║
║ calls_total          ║
║ calls_success        ║
║ avg_latency_ms       ║
║ avg_rating           ║
║ last_feedback_at     ║
║ created_at/updated_at║
╚══════════════════════╝

╔══════════════════════╗
║       callers        ║   // auth for consumer/provider
╠══════════════════════╣
║ caller_id (PK)       ║
║ type (consumer/provider)║
║ identifier (IP|x-client-id)║
║ jwt_token            ║ // consumer: hash of JWT; provider: encrypted secret
║ token_expires_at     ║
║ is_active            ║
║ created_at/updated_at║
╚══════════════════════╝

╔══════════════════════╗
║   agent_feedbacks    ║
╠══════════════════════╣
║ id (PK)              ║
║ agent_id (FK)        ║
║ consumer_id (FK)     ║
║ success              ║
║ latency_ms           ║
║ rating               ║
║ created_at           ║
╚══════════════════════╝

╔══════════════════════╗
║ fraud_detection_log  ║
╠══════════════════════╣
║ id (PK)              ║
║ agent_id (FK)        ║
║ consumer_id (FK)     ║
║ fraud_type           ║
║ severity             ║
║ details JSONB        ║
║ detected_at          ║
╚══════════════════════╝
```

> Note: there is **no** `execution_keys` table. Execution keys are stateless JWTs generated at `/search`, signed with the provider secret (stored encrypted in `callers.jwt_token`).

**Auth & Secrets**
- Provider: `/auth/token` requires header `x-provider-secret: <JWT_SECRET>` (mandatory). The secret is encrypted (AES-256-CBC) and stored in `callers`.
- Consumer: `/auth/token` may send `x-client-id` for stable `caller_id`; token hash is stored.
- `caller_id` = SHA-256 of `type:identifier` (prefixed with `provider-` or `consumer-`).

**Endpoints**
- `POST /auth/token` (provider/consumer)
- `POST /register` (provider)
- `POST /search` (consumer)
- `POST /feedback` (consumer)
- `GET /health` (public)
- `GET /agents/:id/health` (public)

**Quarantine / Ban**
- `status=quarantine`: score penalty -0.3, still searchable.
- `status=banned`: excluded from search.
- Daily auto-review (production): thresholds for success/rating/latency/fraud → quarantine/ban; automatic reactivation when metrics improve.

---

### 2. SDK Agent Provider

**Responsibilities:**
- Expose `POST /execute` (validates execution key JWT with local `JWT_SECRET`) and `GET /health`.
- Rate limit 1 req/s per IP on `/execute`.
- Auto-auth (`/auth/token` with `x-provider-secret`) + auto-register (`/register`).
- Production: `publicEndpoint` HTTPS required; public HTTP allowed only for dev/localhost.
- Keeps running even if registry fails; always validates execution keys locally.

**Internal Architecture:**

```typescript
class AgentProvider {
  private config: AgentConfig;
  private executeHandler?: ExecuteHandler;
  private server?: FastifyInstance;

  async start() {
    // 1) Start Fastify + rate limit
    // 2) POST /auth/token (x-provider-secret: JWT_SECRET)
    // 3) POST /register (sends tasks, input_schema, meta, etc.)
    // 4) Stores nothing for exec keys; validates JWT with local JWT_SECRET
  }

  onExecute(handler: ExecuteHandler): void { this.executeHandler = handler; }
}

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  intents: string[];
  tasks?: string[];           // available operations
  categories: string[];
  tags: string[];
  locationScope: string;
  languages: string[];
  version: string;
  port: number;
  registryUrl?: string;
  publicEndpoint?: string;    // required in production
  inputSchema?: JSONSchema;   // input validation
  meta?: Record<string, any>;
  llm?: LLMConfig;            // optional helper
}
```

**Exec Key Validation**
- `/execute` requires `Authorization: Bearer <exec_key>`.
- Validates JWT with `JWT_SECRET` and checks `agent_id` in payload.

---

### 3. SDK Agent Consumer

**Responsibilities:**
- Authenticate (`/auth/token`, optional `x-client-id`) and store JWT.
- Search (`/search`) requires `categories`; `intent` may be string/array; receives `execution_key`, `tasks`, `input_schema`, `score`.
- LLM is required: `analyzePrompt` (extracts intents, including `brand.*` when a brand is present), categories, tags, location; `validateAgentRelevance` (filters and selects `task` per agent).
- Builds params according to `input_schema`, marks missing fields, tracks `pendingAgents`.
- Executes single or multiple agents with automatic feedback and LLM interpretation.
- Agent cache + short conversation memory for interpretation (not used for validation).

**Internal Architecture:**

```typescript
class AgentConsumer {
  private registryUrl: string;
  private registryToken?: string;
  private llmService: LLMService;
  private memory = [];
  private agentCache = new Map();
  private pendingAgents = new Map();

  async authenticate() { /* POST /auth/token */ }

  async search(req: SearchRequest): Promise<AgentInfo[]> {
    // auto-auth, POST /search (categories required)
    // returns exec_key + input_schema + tasks + score
  }

  async validateAgentRelevance(agents, analysis) {
    // LLM filters and selects task per agent
  }

  async executeMultipleWithFeedback(agents, req, ctx) {
    // builds params from schema (LLM) + auto feedback + interpretation
  }
}

interface AgentConsumerConfig {
  llm: LLMConfig;            // required
  userLanguage?: string;
  registryUrl?: string;
}
```

---

## 🔄 Communication Flows

### Agent Registration Flow

```
Provider                     Registry Central                     Database
   |                                |                                   |
   | 1. start()                     |                                   |
   |--------------------------------|                                   |
   | 2. POST /auth/token            |                                   |
   |    { type: "provider" }        |                                   |
   |    x-provider-secret: JWT_SECRET                                   |
   |-------------------------------->| callers UPSERT (caller_id,        |
   |                                 | identifier, encrypted secret, TTL)|
   |            {token 24h}          |                                   |
   |<--------------------------------|                                   |
   | 3. POST /register (Bearer)      |                                   |
   |    {id,name,endpoint,intents,   | agents UPSERT (+caller_id owner,  |
   |     tasks,categories,tags,      | status=active, input_schema, meta)|
   |     location_scope,languages,   | agent_stats INSERT (if missing)   |
   |     version,input_schema,meta}  |                                   |
   |-------------------------------->|                                   |
   |        { id, jwt_token }        |                                   |
   |<--------------------------------|                                   |
   | 4. stores JWT (optional)        |                                   |
   |    but validates exec key local |                                   |
```

### Search and Execution Flow

```
Consumer                Registry Central                Database           Provider
   | POST /auth/token                                                     |
   |------------------>| callers UPSERT                                   |
   |    {token 24h}    |                                                 |
   |<------------------|                                                 |
   | POST /search (Bearer)                                               |
   |------------------>| filters: intent/categories/language             |
   |                   | fallback: intent-only -> fuzzy -> all agents    |
   |                   | drop banned; penalize quarantine; min score 0.4 |
   |                   | min geo 0.3 when location provided              |
   |                   | fetch stats/fraud%                              |
   |                   | generate exec_key JWT 5m with provider secret   |
   |   [{agent,exec_key,key_expires_at,                                  |
   |     input_schema,tasks,caller_id,score}]                            |
   |<------------------|                                                 |
   | validate params with input_schema (SDK)                             |
   | POST /execute (Bearer exec_key)                                     |
   |--------------------------------------------------------------->     |
   |                                                      validates JWT   |
   |                                                      (JWT_SECRET)    |
   |<---------------------------------------------------------------      |
   | POST /feedback (Bearer registry JWT)                                 |
   | success, latency_ms, rating                                          |
   |------------------>| stats update + anti-fraud (prod)                |
```

---

## 📊 Ranking Algorithm

The Registry uses a multi-factor weighted algorithm (as implemented in SearchService).

### Search Inputs

```typescript
interface SearchRequest {
  intent?: string | string[];      // string or array
  categories: string[];            // required
  tags?: string[];
  location?: string;
  language?: string;
  description?: string;
  limit?: number;                  // capped at 10
}
```

### Ranking Factors

| Factor             | Weight | Description                                        |
|--------------------|--------|----------------------------------------------------|
| Intent Match       | 25%    | Exact, hierarchical, fuzzy trigram                |
| Geographic Match   | 20%    | Proximity to `location_scope` (Global = 0.3)       |
| Success Rate       | 14%    | calls_success / calls_total (new = 0.5)           |
| Description Similar| 10%    | Token overlap of description/tags/categories      |
| Category Match     | 10%    | Overlap of categories                              |
| Rating             | 9%     | avg_rating (neutral 0.5 if empty)                  |
| Tag Match          | 7%     | Overlap of tags                                    |
| Fraud Score        | 4%     | 1 - fraud% (production; else 1.0)                  |
| Latency            | 3%     | Buckets <=500 / 1500 / 3000 / >3000 ms             |

### Score Calculation

```typescript
final_score =
  intent_score   * 0.25 +
  geo_score      * 0.20 +
  success_rate   * 0.14 +
  description    * 0.10 +
  category       * 0.10 +
  rating         * 0.09 +
  tag            * 0.07 +
  fraud          * 0.04 +
  latency        * 0.03;

if (status === 'quarantine') final_score = Math.max(0, final_score - 0.3);
// filters: min score 0.4; min geo 0.3 if location provided; excludes banned.
```

### Example Calculation

```typescript
intent_score = 1.0
category_score = 1.0
tag_score = 1.0
geo_score = 1.0
success_rate = 0.95
rating_score = 0.92
description_score = 0.85
fraud_score = 0.99
latency_score = 1.0
// final ≈ 0.987
```

---

## 📈 Scalability

### Registry Central
- Vertical: CPU/RAM; optimize queries and indexes (GIN/trgm).
- Horizontal: multiple Fastify instances behind LB (`trustProxy` enabled).
- Execution keys are stateless JWTs (no extra writes).
- Cron auto-review only in production; ensure single runner/leader.
- Consider cache (Redis) for frequent searches.

### Agents
- Fully independent; ranking naturally shifts load (slow agents lose score).
- Provider has local rate limit; feedback is limited (60/min per consumer in code).

---

## 🛡️ Security Layers

1. **Authentication (Provider/Consumer ⇄ Registry)**
   - `/auth/token` returns 24h JWT.
   - Provider: `x-provider-secret` mandatory; secret encrypted with AES-256-CBC and stored in `callers`.
   - Consumer: `x-client-id` optional for stable identity; token hash stored.
   - `caller_id` = SHA-256(type:identifier).

2. **Authorization (Consumer ⇄ Provider)**
   - Execution key = JWT 5 minutes, signed with provider secret; includes `agent_id`.
   - Provider validates locally with `JWT_SECRET` and checks `agent_id`.

3. **Anti-Fraud & Quarantine (production)**
   - Self-rating → weight 0.1; spam >10 feedbacks/hour (consumer+agent) is blocked.
   - Decreasing weight per consumer (min 0.1).
   - Extreme patterns logged; fraud% used in ranking.
   - Automatic quarantine/ban by thresholds (success, rating, latency, fraud); automatic reactivation when metrics recover.

See `docs/SECURITY.md` for details.

---

## 🚀 Deployment

### Development

```bash
# Registry Central
cd registry-central
docker-compose up -d

# Provider Agent
cd sdk-agent-provider
npm run dev

# Consumer Agent
cd sdk-agent-consumer
npm run example
```

### Production

```bash
# Registry Central
cd registry-central
docker-compose -f docker-compose.yml up -d

# Provider (HTTPS required)
cd sdk-agent-provider
npm run build
pm2 start dist/index.js --name "agent-restaurant"

# Consumer
cd sdk-agent-consumer
npm run build
```

Production checklist: `NODE_ENV=production`, strong `JWT_SECRET` (provider and registry), HTTPS `publicEndpoint`, `TRUST_PROXY=true` behind LB, monitoring/logging, DB backups.

---

## 🤔 Design Decisions

### Why HTTP REST instead of gRPC?
- Simplicity, firewall-friendly, language-agnostic, rich tooling.

### Why PostgreSQL instead of MongoDB?
- ACID for stats/feedback; JSONB flexibility; joins for ranking; `pg_trgm` for fuzzy search.

### Why JWT instead of API Keys?
- Stateless, short-lived (exec keys 5m), no central session; provider-signed keys isolate compromise.

### Why LLM integration in Consumer?
- Natural language → intents/tags/categories/location.
- Semantic validation and task selection.
- Parameter construction aligned to `input_schema`.
- Consolidated interpretation of responses.

---

## 📡 Monitoring and Observability

### Metrics to Track

1. **Registry Central**
   - Auth/search/feedback volume, ranking latency
   - DB pool usage, 4xx/5xx rates
   - Execution keys generated, fraud detections
   - Auto-review results (quarantine/ban/reactivations)

2. **Agents**
   - Success rate, average latency, ratings
   - Invalid execution attempts (401/403)

3. **System**
   - Resource usage (CPU/RAM), log throughput, error rates

### Recommended Tools
- Logs: Structured JSON (Pino)
- Metrics: Prometheus + Grafana
- Tracing: OpenTelemetry
- Alerts: PagerDuty / Opsgenie

### Useful Endpoints/Flags
- `GET /health` (registry)
- `GET /agents/:id/health` (public)
- `SEARCH_DEBUG=true` to log scoring/ranking details

---

**Built for simplicity, security, and scale** 🌟
