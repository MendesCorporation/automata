# Agent Provider SDK

**Build discoverable service agents that auto-register with the Automata Registry**

The Provider SDK lets you create agents that expose services via HTTP, automatically register with Registry Central, and get discovered by consumers searching for your capabilities.

---

## Why Use This SDK?

✅ **Auto-Registration**: Start your agent and it automatically appears in the registry
✅ **Maximum Discoverability**: Optimize intents, categories, and tags to be found by the right consumers
✅ **Schema Validation**: Define `inputSchema` to ensure consumers send valid parameters
✅ **JWT Security**: Built-in authentication with execution keys
✅ **Simple HTTP API**: Expose `/execute` and `/health` endpoints automatically
✅ **Production-Ready**: HTTPS support, rate limiting, and metadata

---

## Installation

```bash
npm install @apptrix/automata-agent-provider
```

---

## Quick Start

```typescript
import { AgentProvider } from '@apptrix/automata-agent-provider';

const agent = new AgentProvider({
  id: 'agent:restaurant:copacabana',
  name: 'RestauranteCopacabana',
  description: 'Searches for restaurants in Copacabana, Rio de Janeiro',

  // 🎯 Discoverability fields (MOST IMPORTANT)
  intents: ['food.restaurant.search'],
  tasks: ['search_restaurants', 'get_menu', 'get_hours'],  // Available operations
  categories: ['food', 'restaurant.search'],
  tags: ['restaurant', 'food', 'copacabana', 'brazilian', 'seafood'],

  locationScope: 'Copacabana,Rio de Janeiro,Brazil',
  languages: ['pt-BR', 'en-US'],
  version: '1.0.0',
  port: 4001,

  // Production: provide public HTTPS endpoint
  publicEndpoint: 'https://restaurant-copacabana.example.com',

  // Optional: define input schema for validation
  inputSchema: {
    type: 'object',
    properties: {
      cuisine: { type: 'string' },
      maxPrice: { type: 'number' },
      rating: { type: 'number', minimum: 1, maximum: 5 },
    },
    required: ['cuisine'],
  },

  meta: {
    priceRange: { min: 30, max: 200 },
    averageRating: 4.5,
  },
});

// Define execution handler
agent.onExecute(async (request) => {
  const { task, params } = request;

  if (task === 'search_restaurants') {
    const { cuisine, maxPrice = 200 } = params || {};

    // Your business logic here
    const restaurants = await searchRestaurants(cuisine, maxPrice);

    return {
      success: true,
      data: { restaurants },
    };
  }

  return {
    success: false,
    error: 'Unknown task',
  };
});

// Start agent (binds HTTP server + auto-registers)
await agent.start();
```

---

## 🎯 Maximize Discoverability: Intents, Categories, and Tags

The Registry uses **three key fields** to match your agent with consumers. Understanding these is critical to being found:

### 1. **Intents** (Most Specific)
Intents describe the **exact action** your agent performs using dot notation.

**Best Practices:**
- Use hierarchical naming: `domain.subdomain.action`
- Be specific: `food.restaurant.search` NOT `search`
- Support multiple intents if your agent handles different actions

**Examples:**
```typescript
intents: ['food.restaurant.search']
intents: ['travel.hotel.book', 'travel.hotel.search']
intents: ['finance.invoice.generate', 'finance.invoice.send']
intents: ['communication.email.send']
```

**Common Intent Patterns:**
- `{domain}.{service}.search` - Search/query operations
- `{domain}.{service}.book` - Booking/reservation operations
- `{domain}.{service}.generate` - Content generation
- `{domain}.{service}.send` - Communication operations
- `{domain}.{service}.validate` - Validation operations

### 2. **Categories** (Broader Grouping)
Categories group your agent within a domain hierarchy.

**Best Practices:**
- Use 2-3 categories: broad → specific
- First category is the domain (e.g., `food`, `travel`, `finance`)
- Second category is the subdomain (e.g., `restaurant.search`, `hotel.booking`)

**Examples:**
```typescript
categories: ['food', 'restaurant.search']
categories: ['travel', 'hotel', 'booking']
categories: ['finance', 'accounting', 'invoice']
categories: ['communication', 'email', 'marketing']
```

### 3. **Tags** (Free-Form Keywords)
Tags are flexible keywords that describe attributes, features, locations, or specializations.

**Best Practices:**
- Include location-specific tags (neighborhood, city, region)
- Add feature tags (e.g., `real-time`, `webhook`, `api`)
- Include domain-specific attributes (e.g., `luxury`, `budget`, `family-friendly`)
- Use lowercase with hyphens (e.g., `pet-friendly`, not `Pet Friendly`)

**Examples:**
```typescript
// Restaurant agent
tags: ['restaurant', 'food', 'copacabana', 'brazilian', 'seafood', 'budget-friendly']

// Hotel agent
tags: ['hotel', 'booking', 'miami-beach', 'luxury', 'pet-friendly', 'ocean-view']

// Invoice agent
tags: ['invoice', 'pdf', 'api', 'real-time', 'webhook', 'stripe-compatible']
```

### 4. **Tasks** (Available Operations)
Tasks list the specific operations your agent can perform. This helps the Consumer SDK's LLM select the appropriate task for each request.

**Best Practices:**
- Use clear, descriptive names (e.g., `get_quote`, `book_room`, `send_email`)
- Use snake_case for consistency
- List all available operations your agent supports
- Keep task names aligned with your intents

**Examples:**
```typescript
// Hotel agent
tasks: ['search_hotels', 'book_room', 'cancel_booking', 'get_availability']

// Restaurant agent
tasks: ['search_restaurants', 'get_menu', 'get_hours', 'make_reservation']

// Invoice agent
tasks: ['generate_invoice', 'send_invoice', 'validate_invoice', 'get_status']
```

**Why it matters:** When consumers call `validateAgentRelevance()`, the LLM uses your `tasks` list to select the most appropriate task for the user's request. Without tasks defined, consumers must manually specify the task name.

---

## 🔍 Discoverability Example

Here's how a well-configured agent appears in searches:

```typescript
const agent = new AgentProvider({
  id: 'agent:hotel:miami-luxury',
  name: 'MiamiLuxuryHotels',
  description: 'Book luxury hotels in Miami Beach with ocean views and premium amenities',

  // Consumer searches: "Find me a luxury hotel in Miami Beach"
  // ✅ LLM extracts intent: travel.hotel.book
  intents: ['travel.hotel.book', 'travel.hotel.search'],

  // ✅ LLM selects appropriate task from available operations
  tasks: ['search_hotels', 'book_room', 'get_availability', 'cancel_booking'],

  // ✅ LLM extracts categories: ['travel', 'hotel']
  categories: ['travel', 'hotel', 'booking'],

  // ✅ LLM extracts tags: ['luxury', 'miami-beach', 'ocean-view']
  tags: ['hotel', 'luxury', 'miami-beach', 'ocean-view', 'pet-friendly', 'spa', 'pool'],

  // ✅ Location matching
  locationScope: 'Miami Beach,Florida,USA',

  languages: ['en-US', 'es-ES'],
  version: '1.0.0',
  port: 4002,
  publicEndpoint: 'https://miami-hotels.example.com',

  // Optional: guide consumers on valid params
  inputSchema: {
    type: 'object',
    properties: {
      checkIn: { type: 'string', format: 'date' },
      checkOut: { type: 'string', format: 'date' },
      guests: { type: 'number', minimum: 1 },
      roomType: { type: 'string', enum: ['standard', 'deluxe', 'suite'] },
    },
    required: ['checkIn', 'checkOut', 'guests'],
  },
});
```

**Result:** Your agent ranks high when consumers search for:
- "luxury hotel in Miami"
- "book hotel Miami Beach"
- "pet-friendly ocean view hotel Florida"

---

## 🛡️ Input Schema Validation

Define an `inputSchema` to ensure consumers send valid parameters:

```typescript
const agent = new AgentProvider({
  // ... other config
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', minLength: 2 },
      checkIn: { type: 'string', format: 'date' },
      checkOut: { type: 'string', format: 'date' },
      guests: { type: 'number', minimum: 1, maximum: 10 },
      budget: { type: 'number', minimum: 0 },
    },
    required: ['city', 'checkIn', 'checkOut'],
  },
});
```

**Benefits:**
1. **Consumer SDK auto-validates** before calling your agent
2. **LLM uses the schema** to build valid params from natural language
3. **Consumers see clear errors** if they send invalid data
4. **Registry displays schema** so consumers know what to send

---

## 📚 API Reference

### Constructor

```typescript
new AgentProvider(config: AgentConfig)
```

**AgentConfig:**
```typescript
interface AgentConfig {
  id: string;                    // Unique ID (e.g., 'agent:restaurant:copacabana')
  name: string;                  // Display name
  description: string;           // Service description (be specific!)

  // 🎯 Discoverability (CRITICAL)
  intents: string[];             // Exact actions (e.g., ['food.restaurant.search'])
  tasks?: string[];              // Optional - Available task names (e.g., ['get_quote', 'get_menu'])
  categories: string[];          // Domain hierarchy (e.g., ['food', 'restaurant.search'])
  tags: string[];                // Keywords (e.g., ['japanese', 'budget', 'copacabana'])

  locationScope: string;         // Geographic scope (City,State,Country)
  languages: string[];           // Supported languages (e.g., ['en-US', 'pt-BR'])
  version: string;               // Version (semver)

  port: number;                  // Local bind port
  registryUrl?: string;          // Optional - defaults based on NODE_ENV
  publicEndpoint?: string;       // Required in production (HTTPS)

  inputSchema?: JSONSchema;      // Optional - defines expected input
  meta?: Record<string, any>;    // Optional - custom metadata

  llm?: {                        // Optional - only if you use callLLM helper
    provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter';
    apiKey: string;
    model: string;
    temperature?: number;
  };
}
```

### Methods

#### `agent.onExecute(handler)`
Defines the execution handler called when consumers invoke your agent.

```typescript
type ExecuteHandler = (request: ExecuteRequest) => Promise<ExecuteResponse>;

interface ExecuteRequest {
  task: string;
  params?: Record<string, any>;
}

interface ExecuteResponse {
  success: boolean;
  data?: any;
  error?: string;
}
```

**Example:**
```typescript
agent.onExecute(async (request) => {
  const { task, params } = request;

  switch (task) {
    case 'search_hotels':
      return { success: true, data: await searchHotels(params) };

    case 'book_hotel':
      return { success: true, data: await bookHotel(params) };

    default:
      return { success: false, error: `Unknown task: ${task}` };
  }
});
```

#### `await agent.start()`
Starts the HTTP server and registers with Registry Central.

**What happens:**
1. Binds HTTP server to `HOST:PORT` (defaults: `0.0.0.0:3000`)
2. Sends `POST /register` to Registry Central
3. Logs confirmation
4. Agent is now discoverable in searches

#### `await agent.stop()`
Stops the HTTP server.

#### `await agent.callLLM(prompt, systemPrompt?)`
Helper method to call configured LLM (requires `llm` config).

**Parameters:**
- `prompt: string` - User prompt to send to LLM
- `systemPrompt?: string` - Optional system prompt for context

**Returns:** `Promise<string>` - LLM response content (auto-cleans JSON markdown blocks)

**Example:**
```typescript
const agent = new AgentProvider({
  // ... other config
  llm: {
    provider: 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: 'gpt-4o-mini',
    temperature: 0.7,
  },
});

agent.onExecute(async (request) => {
  if (request.task === 'analyze_menu') {
    const menuText = request.params?.menu;

    const analysis = await agent.callLLM(
      `Analyze this restaurant menu and extract dishes: ${menuText}`,
      'You are a restaurant menu analyzer. Return JSON with dish names and prices.'
    );

    return {
      success: true,
      data: JSON.parse(analysis),
    };
  }
});
```

**Note:** Only available if `llm` is configured in `AgentConfig`. Throws error if LLM not configured.

---

## 🌐 Exposed Endpoints

When you call `agent.start()`, these endpoints are automatically exposed:

### `POST /execute`
Main endpoint for task execution.

**Request:**
```json
{
  "task": "search_restaurants",
  "params": {
    "cuisine": "japanese",
    "maxPrice": 150
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "restaurants": [
      {
        "name": "Sushi Bar Copacabana",
        "price": 120,
        "rating": 4.5
      }
    ]
  }
}
```

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "agentId": "agent:restaurant:copacabana"
}
```

---

## 🚀 Auto-Registration

When you call `agent.start()`, the SDK:

1. **Starts HTTP server** on configured port
2. **Calls Registry Central** `POST /register` with all metadata
3. **Sends public endpoint** (required in production)
4. **Logs confirmation** to console

**Development (HTTP):**
```typescript
const agent = new AgentProvider({
  // ... config
  port: 4001,
  // No publicEndpoint needed - uses http://localhost:4001
});
```

**Production (HTTPS):**
```typescript
const agent = new AgentProvider({
  // ... config
  port: 4001,
  publicEndpoint: 'https://your-domain.com', // Required!
});
```

> **⚠️ Important:** In production, consumers call your `publicEndpoint`, NOT `http://localhost`. Make sure your HTTPS endpoint is publicly accessible.

---

## 🌍 Environment Variables

Create a `.env` file:

```bash
# Environment
NODE_ENV=development  # or production

# Registry URL (optional - auto-detected)
# If unset:
#   NODE_ENV=production -> https://automata.apptrixcloud.com
#   otherwise          -> https://automata-dev.apptrixcloud.com
REGISTRY_URL=https://automata-dev.apptrixcloud.com

# Server config
HOST=0.0.0.0              # Bind address
PORT=4001                 # Local bind port
PUBLIC_ENDPOINT=https://your-domain.com  # Required in production

# Security (REQUIRED)
JWT_SECRET=your-secret-key-min-32-chars
# IMPORTANT: This secret is sent to Registry (encrypted) and used to sign execution keys
# Each provider has its own secret for isolated security

# LLM (optional - only needed if you use callLLM helper)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=your-api-key
LLM_TEMPERATURE=0.7
```

---

## 🔐 Security Architecture

### How Authentication Works

The Provider SDK implements a secure three-layer authentication system:

#### 1. Provider → Registry (Registration)

When you call `agent.start()`, the SDK automatically:

1. **Sends JWT_SECRET** to Registry via `x-provider-secret` header
2. **Registry encrypts** your secret with AES-256-CBC
3. **Stores encrypted secret** in database
4. **Returns authentication token** (24h validity)

```typescript
// You don't need to handle this - it's automatic
await agent.start();
// ✅ Your JWT_SECRET is now securely stored in Registry
```

#### 2. Consumer → Registry (Search)

When a consumer searches for agents:

1. **Registry finds matching agents** (including yours)
2. **Retrieves your encrypted secret** from database
3. **Decrypts your secret**
4. **Generates execution key** signed with YOUR secret
5. **Returns execution key** to consumer (5min validity)

#### 3. Consumer → Provider (Execution)

When a consumer executes a task on your agent:

1. **Consumer sends execution key** via Authorization header
2. **Your agent validates** the key using YOUR JWT_SECRET
3. **Validates agent_id** matches your agent
4. **Validates expiration** (5 minutes)
5. **Executes task** if valid

```typescript
// You don't need to handle this - SDK validates automatically
agent.onExecute(async (request) => {
  // ✅ If this code runs, the execution key was valid
  return { success: true, data: {...} };
});
```

### Security Benefits

✅ **Isolated Security**: Each provider has its own JWT_SECRET
✅ **Encrypted Storage**: Secrets are never stored in plain text
✅ **Short-lived Keys**: Execution keys expire in 5 minutes
✅ **Local Validation**: You validate keys without calling Registry
✅ **No Shared Secrets**: Compromising one provider doesn't affect others

### JWT_SECRET Requirements

- **Minimum length**: 32 characters
- **Keep it secret**: Never commit to git
- **Use environment variable**: Always load from `.env`
- **Unique per provider**: Don't reuse across different agents
- **Strong random**: Use cryptographically secure random string

```bash
# Good examples
JWT_SECRET=a8f3c9d2e7b4a1f6c8d3e9b2a7f4c1d8e6b9a3f7c2d5e8b1a4f9c6d3e7b2a5f8

# Bad examples
JWT_SECRET=secret              # Too short
JWT_SECRET=12345678901234567890123456789012  # Not random
JWT_SECRET=agent-weather-br    # Predictable
```

### Production Security Checklist

- [ ] Set strong `JWT_SECRET` (min 32 chars)
- [ ] Use `publicEndpoint` with HTTPS
- [ ] Set `NODE_ENV=production`
- [ ] Enable rate limiting (built-in)
- [ ] Validate input parameters
- [ ] Handle errors gracefully
- [ ] Monitor invalid execution attempts
- [ ] Keep SDK updated

---

## 💡 Best Practices

### 1. **Optimize for Discovery**
- Use **specific intents**: `food.restaurant.search` NOT `search`
- Add **many relevant tags**: location, features, attributes
- Write **descriptive description**: consumers see this in search results
- Set **precise locationScope**: `Neighborhood,City,Country` format

### 2. **Define Input Schema**
- Always define `inputSchema` for complex agents
- Mark fields as `required` appropriately
- Use JSON Schema formats (`date`, `email`, etc.)
- Consumers get better validation and error messages

### 3. **Handle Errors Gracefully**
- Always return `{ success: false, error: "..." }` on errors
- Provide **helpful error messages**
- Don't throw unhandled exceptions

### 4. **Version Your Agent**
- Use semantic versioning: `1.0.0`, `1.1.0`, `2.0.0`
- Bump version on breaking changes
- Document changes in your description

### 5. **Production Checklist**
- Set `publicEndpoint` to your HTTPS URL
- Configure rate limiting (built-in with Fastify)
- Set `JWT_SECRET` environment variable
- Use `NODE_ENV=production`
- Test health check: `GET https://your-domain.com/health`

### 6. **Location Scope**
Be as specific as possible:
- ✅ `Copacabana,Rio de Janeiro,Brazil`
- ✅ `Miami Beach,Florida,USA`
- ❌ `Brazil` (too broad)

### 7. **Unique Agent IDs**
Use namespaced IDs:
- Format: `agent:{domain}:{service}:{location}`
- Examples:
  - `agent:restaurant:copacabana`
  - `agent:hotel:miami-beach`
  - `agent:invoice:stripe-api`

---

## 📖 Complete Example

See [example.ts](./example.ts) for a working restaurant search agent.

### Run the Example

```bash
# Install dependencies
npm install

# Run example
npm run example

# Test the agent
curl -X POST http://localhost:4001/execute \
  -H "Content-Type: application/json" \
  -d '{"task":"search_restaurants","params":{"cuisine":"japanese"}}'
```

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Dev mode (watch)
npm run dev

# Run specific example
npm run agency          # Agency agent
npm run hotel:miami     # Miami hotel agent
npm run hotel:schema    # Hotel with input schema
```

---

## 📁 Project Structure

```
sdk-agent-provider/
├── src/
│   ├── agent-provider.ts   # Core SDK class
│   ├── types.ts            # TypeScript interfaces
│   └── index.ts            # Exports
├── example.ts              # Basic example
├── agency-agent.ts         # Agency example
├── hotel-miami.ts          # Hotel example
├── hotel-booking-schema.ts # Schema example
├── package.json
└── tsconfig.json
```

---

## 🔗 Related Documentation

- **Consumer SDK**: Search and execute agents → [sdk-agent-consumer](../sdk-agent-consumer)
- **Registry Central**: Run your own registry → [registry-central](../registry-central)

---

## 🚢 Publishing to NPM

To publish your provider agent as a package:

```bash
# Build
npm run build

# Publish
npm publish --access public
```

---

## 📝 Next Steps

After creating your provider agent:

1. **Start Registry Central**
   ```bash
   cd ../registry-central
   docker-compose up
   ```

2. **Start your provider agent**
   ```bash
   npm run example
   ```

3. **Test with Consumer SDK**
   ```bash
   cd ../sdk-agent-consumer
   npm run example
   ```

4. **Verify registration**
   ```bash
   curl https://automata-dev.apptrixcloud.com/search \
     -H "Authorization: Bearer YOUR_JWT" \
     -H "Content-Type: application/json" \
     -d '{"categories":["food"],"limit":10}'
   ```

---

## License

MIT
