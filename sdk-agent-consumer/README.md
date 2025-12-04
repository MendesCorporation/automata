# Agent Consumer SDK

**Discover, execute, and orchestrate AI-powered service agents from the Automata Registry**

The Consumer SDK lets you search for specialized agents using natural language, execute them with automatic validation, and receive intelligent responses - all with built-in LLM integration.

---

## Why Use This SDK?

✅ **Smart Discovery**: Find agents using natural language - the LLM automatically extracts intents, categories, and keywords
✅ **Automatic Validation**: Built-in input schema validation ensures you send valid parameters
✅ **Multi-Agent Orchestration**: Execute multiple agents in parallel and get a unified AI-interpreted response
✅ **Feedback Loop**: Automatic performance tracking improves agent rankings over time
✅ **Multi-Language**: Works in any language - the LLM adapts naturally

---

## Installation

```bash
npm install @apptrix/automata-agent-consumer
```

---

## Quick Start

```typescript
import { AgentConsumer } from '@apptrix/automata-agent-consumer';

const consumer = new AgentConsumer({
  llm: {
    provider: 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: 'gpt-4o-mini',
    temperature: 0.7,
  },
  userLanguage: 'en-US', // Optional - LLM adapts to any language
});

await consumer.authenticate();

// Natural language input
const userInput = "I need a Japanese restaurant in Copacabana with good prices";

// LLM analyzes and extracts structured data
const analysis = await consumer.analyzePrompt(userInput);

console.log('Intents:', analysis.intents);
// Output: ['food.restaurant.search', 'food.dining.search']

console.log('Categories:', analysis.categories);
// Output: ['food', 'restaurant.search']

// Search agents in the registry
const agents = await consumer.search({
  intent: analysis.intents,  // Can pass array or single intent
  categories: analysis.categories,
  tags: analysis.keywords,
  location: analysis.location,
  limit: 10,
});

// AI filters semantically irrelevant agents AND selects appropriate tasks
const relevantAgents = await consumer.validateAgentRelevance(agents, analysis);

// Execute all relevant agents with automatic feedback
// Note: selectedTask is automatically used if available
const results = await consumer.executeMultipleWithFeedback(
  relevantAgents,
  {
    task: 'search_restaurants',  // Fallback task
    params: {
      cuisine: 'japanese',
      location: 'Copacabana',
    },
  },
  {
    userPrompt: userInput,
    analysis,
  }
);

// Interpretation is automatically done inside executeMultipleWithFeedback
// Access it via _interpretation property
console.log(results._interpretation);  // Final message for user
```

---

## 🎯 Understanding Discovery: Intents, Categories, and Tags

The Registry uses **three key fields** to match consumers with providers:

### 1. **Intents** (Most Specific)
Intents describe the **exact action** using dot notation.

**Examples:**
- `food.restaurant.search` - Search for restaurants
- `travel.hotel.book` - Book a hotel room
- `finance.invoice.generate` - Generate invoices
- `communication.email.send` - Send emails

**When to use:** Use intents when you need a very specific action. The LLM automatically extracts intents from natural language.

### 2. **Categories** (Broader Grouping)
Categories group related services hierarchically.

**Examples:**
- `['food', 'restaurant.search']` - Restaurant-related services
- `['travel', 'hotel']` - Travel and hotel services
- `['finance', 'accounting']` - Financial services

**When to use:** Use categories when you want to find all agents in a domain, not just a specific action.

### 3. **Tags** (Free-Form Keywords)
Tags are flexible keywords for additional filtering.

**Examples:**
- `['japanese', 'copacabana', 'budget-friendly']`
- `['luxury', 'beachfront', 'family-friendly']`
- `['api', 'real-time', 'webhook']`

**When to use:** Use tags for attributes, features, locations, or other descriptive keywords.

---

## 🔍 Search Best Practices

### Strategy 1: Intent-First (Precise)
When you know **exactly** what you need:

```typescript
const agents = await consumer.search({
  intent: 'travel.hotel.book',
  categories: ['travel', 'hotel'],
  tags: ['luxury', 'miami'],
  location: 'Miami,Florida,USA',
  limit: 5,
});
```

### Strategy 2: Category-First (Exploratory)
When you want to **discover** what's available:

```typescript
const agents = await consumer.search({
  categories: ['food'], // Find all food-related agents
  tags: ['delivery', 'vegan'],
  location: 'San Francisco,California,USA',
  limit: 20,
});
```

### Strategy 3: LLM-Powered (Natural Language)
Let the **LLM extract everything**:

```typescript
const analysis = await consumer.analyzePrompt(
  "Find me a pet-friendly hotel in Miami Beach with ocean view"
);

const agents = await consumer.search({
  intent: analysis.intents,          // LLM extracts: ['travel.hotel.search', 'booking.hotel.estimation']
  categories: analysis.categories,   // LLM extracts: ['travel', 'hotel']
  tags: analysis.keywords,           // LLM extracts: ['pet-friendly', 'ocean-view']
  location: analysis.location,       // LLM extracts: Miami Beach,Florida,USA
  description: analysis.description, // LLM summary
  limit: 10,
});
```

> **💡 Recommended:** Use Strategy 3 for the best user experience. The LLM handles language, synonyms, and context automatically.

---

## 🛡️ Input Schema Validation

When agents define an `input_schema`, the SDK validates parameters before execution:

```typescript
// Agent defines this schema:
{
  "type": "object",
  "properties": {
    "city": { "type": "string" },
    "checkIn": { "type": "string", "format": "date" },
    "guests": { "type": "number" }
  },
  "required": ["city", "checkIn"]
}

// SDK validates automatically:
const result = await consumer.executeWithFeedback(agent, {
  task: 'book_hotel',
  params: {
    city: 'Miami',
    checkIn: '2025-03-15',
    guests: 2,
  },
});
// ✅ Validation passes, executes normally

const badResult = await consumer.executeWithFeedback(agent, {
  task: 'book_hotel',
  params: {
    guests: 2, // Missing required 'city' and 'checkIn'
  },
});
// ❌ Returns: { success: false, error: "Input validation failed: Missing required field: city, Missing required field: checkIn" }
```

**Schema-Aware Execution:**
When using `executeMultipleWithFeedback`, the SDK sends the provider's `input_schema` to the LLM so it can build valid params:

```typescript
const results = await consumer.executeMultipleWithFeedback(
  agents,
  {
    task: 'book_hotel',
    params: {}, // LLM will populate this based on schema + user prompt
  },
  {
    userPrompt: "Book a hotel in Miami for March 15th, 2 guests",
    analysis,
  }
);
```

The LLM reads each agent's `input_schema`, maps the natural language prompt to valid params, and tracks agents with missing fields in `consumer.getPendingAgents()` for retry.

---

## 🤖 LLM Features

### `analyzePrompt(userPrompt)`
Extracts structured data from natural language.

**Input:** `"Find me a vegan restaurant in Tokyo with outdoor seating"`

**Output:**
```typescript
{
  intents: ['food.restaurant.search', 'food.dining.search'],  // Array of 2-3 alternative intents
  categories: ['food', 'restaurant.search'],
  keywords: ['vegan', 'outdoor-seating', 'tokyo'],
  tags: ['vegan', 'outdoor', 'tokyo'],
  features: ['outdoor seating', 'vegan options'],
  location: 'Tokyo,Japan',
  description: 'User wants to find a vegan restaurant in Tokyo with outdoor seating',
  language: 'en-US'
}
```

**Note:** If the user mentions a brand name (like "Carrefour", "Apple", etc.), the SDK automatically includes a brand-specific intent like `brand.carrefour` in the intents array.

### `validateAgentRelevance(agents, analysis)`
Uses semantic understanding to filter out irrelevant agents **AND** selects the appropriate task for each agent.

**Why?** Keyword matching can return false positives. The LLM validates that each agent *actually* solves the user's need and picks the best task from the agent's available tasks.

```typescript
// Search might return 10 agents matching "hotel" and "Miami"
const agents = await consumer.search({ ... });

// LLM filters to only relevant ones AND assigns selectedTask to each agent
const relevant = await consumer.validateAgentRelevance(agents, analysis);

// Each relevant agent now has a selectedTask property
// relevant[0].selectedTask === "get_quote" (for example)
```

**Returns:** Filtered `AgentInfo[]` where each agent has a `selectedTask` property set by the LLM.

### `interpretResponses(userRequest, agentResponses, intent)`
Combines multiple agent responses into a natural, conversational answer **and rates each agent's relevance**.

**Input:** 3 hotel agents return JSON with availability and prices

**Output:**
```typescript
{
  message: `I found 3 hotels for you in Miami Beach:

1. **Ocean View Resort** - $250/night, beachfront, pet-friendly
2. **Downtown Suites** - $180/night, city center, business amenities
3. **Budget Inn** - $95/night, basic accommodation

Based on your request for ocean view and pet-friendly, I recommend Ocean View Resort.`,

  agentRatings: {
    'agent:hotel:miami:oceanview': 0.95,  // Highly relevant
    'agent:hotel:miami:downtown': 0.7,     // Moderately relevant
    'agent:hotel:miami:budget': 0.5        // Less relevant
  }
}
```

**Returns:** `{ message: string; agentRatings: Record<string, number> }`

The `agentRatings` are automatically used to compute feedback scores sent to the Registry, improving future rankings.

---

## 📚 API Reference

### Constructor

```typescript
new AgentConsumer(config: AgentConsumerConfig)
```

**Config:**
```typescript
interface AgentConsumerConfig {
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter';
    apiKey: string;
    model: string;
    temperature?: number; // Default: 0.7
  };
  userLanguage?: string;      // Default: 'en-US'
  registryUrl?: string;        // Optional - auto-detected based on NODE_ENV
}
```

### Authentication

```typescript
await consumer.authenticate(): Promise<void>
```

Authenticates with Registry Central and obtains a JWT token.

### Search

```typescript
await consumer.search(request: SearchRequest): Promise<AgentInfo[]>
```

**SearchRequest:**
```typescript
interface SearchRequest {
  intent?: string | string[];  // Single intent or array (e.g., 'food.restaurant.search' or ['food.restaurant.search', 'brand.carrefour'])
  categories: string[];        // e.g., ['food', 'restaurant.search']
  tags?: string[];             // e.g., ['japanese', 'budget']
  location?: string;           // e.g., 'Tokyo,Japan'
  language?: string;           // e.g., 'en-US'
  description?: string;        // Natural description
  limit?: number;              // Max results (default: 10)
}
```

**Returns:**
```typescript
interface AgentInfo {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  tags: string[];
  intents: string[];
  tasks: string[];              // Available tasks for this agent
  categories: string[];
  location_scope: string;
  score: number;
  execution_key?: string;
  key_expires_at?: Date;
  input_schema?: Record<string, any>;
  selectedTask?: string;        // Task selected by LLM after validation
}
```

### Execution

```typescript
await consumer.executeWithFeedback(
  agent: AgentInfo,
  request: ExecuteRequest
): Promise<ExecuteResponse>
```

**ExecuteRequest:**
```typescript
interface ExecuteRequest {
  task: string;
  params?: Record<string, any>;
}
```

**ExecuteResponse:**
```typescript
interface ExecuteResponse {
  success: boolean;
  data?: any;
  error?: string;
}
```

**Multi-Agent Execution:**
```typescript
await consumer.executeMultipleWithFeedback(
  agents: AgentInfo[],
  request: ExecuteRequest,
  context?: { userPrompt: string; analysis: Analysis }
): Promise<ExecuteResponse[]>
```

> **💡 Tip:** Always use `executeWithFeedback()` or `executeMultipleWithFeedback()` instead of plain `execute()`. Feedback improves agent rankings in the registry over time.

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

# LLM Configuration (REQUIRED)
LLM_PROVIDER=openai          # openai, claude, gemini, deepseek, openrouter
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=your-api-key

# Client ID (optional - for stable caller_id)
CLIENT_ID=my-consumer-app
```

---

## 🎓 Supported LLM Providers

### OpenAI
- `gpt-4.1`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4o-mini`, `o3-mini`

### Claude (Anthropic)
- `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`

### Gemini (Google)
- `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`

### DeepSeek
- `deepseek-chat`, `deepseek-coder`

### OpenRouter
- `anthropic/claude-3.5-sonnet`, `google/gemini-1.5-pro`, `openai/gpt-4o`

---

## 💡 Best Practices

1. **Use LLM-powered search**: Let `analyzePrompt()` extract intents, categories, and keywords from natural language
2. **Always send feedback**: Use `executeWithFeedback()` to improve agent rankings
3. **Validate semantically**: Use `validateAgentRelevance()` to filter false positives
4. **Provide context for schemas**: When calling `executeMultipleWithFeedback`, include `{ userPrompt, analysis }` so the SDK can map provider schemas
5. **Limit results**: Set a reasonable `limit` in search (10-20) to avoid overload
6. **Handle pending agents**: Check `consumer.getPendingAgents()` to retry agents that had missing fields
7. **Be specific with location**: Use `City,State,Country` format for best results
8. **Let LLM handle language**: Don't restrict user input - the LLM adapts to any language

---

## 🧠 Memory & Context Management

The Consumer SDK includes built-in conversation memory for maintaining context across multiple requests:

### Memory Methods

```typescript
// Add a conversation to memory
consumer.addToMemory({
  userRequest: "Find hotels in Miami",
  intent: "travel.hotel.search",
  timestamp: new Date(),
  agentResponses: [...],
  interpretation: "I found 3 hotels..."
});

// Get recent context (last N conversations)
const context = consumer.getRecentContext(3);

// Get all memory
const allMemory = consumer.getMemory();

// Clear memory
consumer.clearMemory();
```

### Pending Agents

Track agents that couldn't be executed due to missing required fields:

```typescript
// Get list of pending agents with missing fields
const pending = consumer.getPendingAgents();

// Returns:
[
  {
    agentId: 'agent:hotel:miami',
    agentName: 'Miami Hotels',
    endpoint: 'https://...',
    executionKey: 'jwt...',
    missingFields: ['checkIn', 'checkOut'],
    lastAttempt: Date
  }
]

// Resolve a pending agent after providing missing data
consumer.resolvePendingAgent('agent:hotel:miami');
```

### Agent Caching

The SDK automatically caches searched agents for quick retrieval:

```typescript
// Agents are cached automatically after search
const agents = await consumer.search({...});
consumer.cacheAgents(agents);  // Automatic

// Memory and cache are cleared together
consumer.clearMemory();  // Also clears cache and pending agents
```

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run example
npm run example

# Watch mode
npm run dev
```

---

## 📖 Related Documentation

- **Provider SDK**: Create agents that appear in the registry → [sdk-agent-provider](../sdk-agent-provider)
- **Registry Central**: Run your own registry → [registry-central](../registry-central)

---

## License

MIT
