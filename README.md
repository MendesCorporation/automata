# Automata - The Internet of Intelligent Agents

![Status](https://img.shields.io/badge/status-production--ready-brightgreen)
![Security](https://img.shields.io/badge/security-JWT-blue)
![TypeScript](https://img.shields.io/badge/typescript-5.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

<div align="center">
  <img src="public/images/automata-geladeira.gif" alt="Smart Refrigerator requesting quotes from multiple agents" width="600">
  <p><em>The future of service discovery: AI agents finding and orchestrating services automatically</em></p>
</div>

---

## 🌐 The Vision: An Internet of Agents

Imagine a world where AI agents can **discover and connect to services automatically** - just like humans use Google to find websites, but for intelligent agents finding specialized services.

### The Evolution of Service Discovery

**📞 Yesterday (2000s):** Businesses advertised in phone books and websites
- Manual lookup, fixed catalogs
- No quality metrics
- Static, one-size-fits-all

**🔍 Today (2020s):** Google search and online marketplaces
- SEO optimization, reviews
- Better for humans
- Still requires manual integration for APIs

**🤖 Tomorrow (2025+):** The Agent Internet with Automata
- **Agents discover services automatically** based on intent
- **Performance-based ranking** - best agents surface first
- **Natural language**: "Find me a hotel" → AI handles the rest
- **Zero configuration**: Agents register once, discoverable forever

### Real-World Example

```typescript
// A smart refrigerator needs price quotes for groceries

// 🔴 Old Way: Hardcode 3 specific grocery APIs
const quotes = [
  await fetch('https://store1.com/api/quote'),
  await fetch('https://store2.com/api/quote'),
  await fetch('https://store3.com/api/quote'),
];

// 🟢 New Way: Automata discovers the best available agents
const consumer = new AgentConsumer({ llm: {...} });

const agents = await consumer.search({
  intent: 'grocery.price.quote',
  location: 'Miami,Florida,USA',
  tags: ['delivery', 'fresh-produce'],
});

// Agents are automatically ranked by performance
// Execute the top 3 with automatic fallback
const quotes = await consumer.executeMultipleWithFeedback(agents.slice(0, 3), {
  task: 'get_quote',
  params: { items: ['milk', 'eggs', 'bread'] }
});
```

**The result?** Your refrigerator finds the **best** grocery delivery agents automatically - no hardcoding, no manual updates, no breaking when one service goes down.

---

## 📋 What is Automata?

Automata is a registry system for building agent ecosystems. Think "DNS for AI agents" or "npm registry for services."

### Three Core Components

- **🏗️ Registry Central**: Catalog with ranking algorithm, JWT auth, and basic anti-fraud
- **📦 Agent Provider SDK**: Create agents that offer services and register themselves
- **🔍 Agent Consumer SDK**: Discover and consume services with LLM integration

### What We're Building

**For Service Providers:**
- Register once and become discoverable
- Performance-based ranking
- Agents find you via intent matching
- Auto-registration on startup

**For Service Consumers:**
- Natural language search with LLM
- Automatic fallback if an agent fails
- Agents ranked by performance data
- LLM validation and interpretation

**For the Ecosystem:**
- Decentralized agent creation
- Merit-based ranking
- Automatic JWT authentication
- Feedback-driven improvements

---

## 🎯 The Problem We Solve

### Today's Challenges

**Problem 1: Service Discovery is Manual**
- Developers hardcode specific API endpoints
- When a service goes down, systems break
- No automatic discovery of better alternatives

**Problem 2: No Quality Metrics**
- All services appear equal
- No way to know which is fastest/most reliable
- Manual testing required

**Problem 3: Integration Complexity**
- Each API has different auth, formats, schemas
- High maintenance overhead
- Vendor lock-in

### Automata's Solution

**✅ Automatic Discovery**
- Agents register themselves with intents and capabilities
- Consumers search by intent: `food.restaurant.search`, `weather.forecast`
- LLM extracts intents from natural language

**✅ Performance-Based Ranking**
- 9 factors: intent match, geography, success rate, latency, rating, description similarity, categories, tags, fraud score
- Real-time feedback loop
- Best agents automatically surface first

**✅ Unified Interface**
- All agents use the same HTTP + JSON format
- Automatic JWT authentication
- Input schema validation built-in

---

## 🚀 Quick Start (5 Minutes)

### 1. Create a Provider Agent

```typescript
import { AgentProvider } from '@apptrix/automata-agent-provider';

const agent = new AgentProvider({
  id: 'agent:weather:brazil',
  name: 'WeatherBrazil',
  description: 'Weather forecasts for Brazilian cities',
  intents: ['weather.forecast'],
  tasks: ['get_weather'], 
  categories: ['weather', 'forecast'],
  tags: ['weather', 'brazil', 'forecast'],
  locationScope: 'Brazil',
  languages: ['pt-BR', 'en-US'],
  version: '1.0.1',
  port: 4001,
});

// Define what the agent does
agent.onExecute(async (request) => {
  if (request.task === 'get_weather') {
    const weather = await fetchWeather(request.params.city);
    return {
      success: true,
      data: { temperature: weather.temp, condition: weather.condition }
    };
  }

  return { success: false, error: 'Unknown task' };
});

// Start (auto-registers and becomes discoverable)
await agent.start();
```

### 2. Create a Consumer Agent

```typescript
import { AgentConsumer } from '@apptrix/automata-agent-consumer';

const consumer = new AgentConsumer({
  llm: {
    provider: 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: 'gpt-4o-mini',
  },
});

// Natural language input
const userInput = "What's the weather in São Paulo?";

// LLM analyzes and extracts structured data
const analysis = await consumer.analyzePrompt(userInput);

// Search for matching agents
const agents = await consumer.search({
  intent: analysis.intents, // analyzePrompt returns intents array
  categories: analysis.categories,
  location: analysis.location,
  limit: 5,
});

// Execute with automatic feedback
const result = await consumer.executeWithFeedback(agents[0], {
  task: 'get_weather',
  params: { city: 'São Paulo' },
});

console.log(result.data); // { temperature: 28, condition: 'sunny' }
```

### Terminal Demo (price quotes)

<div align="center">
  <img src="public/images/demo.gif" alt="Terminal demo quoting apple price across 3 supermarkets" width="700">
  <p><em>Terminal demo: quoting apple prices from 3 supermarkets via the consumer SDK</em></p>
</div>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Registry Central                       │
│           (Managed - Production Ready)                   │
│                                                          │
│  • Agent catalog with ranking                           │
│  • JWT authentication (3 layers)                        │
│  • Anti-fraud & quarantine system                       │
│  • Real-time feedback & statistics                      │
│  • Input schema validation                              │
└────────┬────────────────────────────────┬───────────────┘
         │                                │
         │ JWT (auto)                     │ JWT + Execution Keys
         │                                │
    ┌────▼──────────┐              ┌─────▼────────────┐
    │ Agent         │              │ Agent            │
    │ Provider      │              │ Consumer         │
    │               │              │                  │
    │ • Auto-       │              │ • LLM-powered    │
    │   register    │  Exec Key    │   search         │
    │ • Expose      │  (JWT 5min)  │ • Semantic       │
    │   /execute    │ ◄────────────│   validation     │
    │ • Input       │              │ • Auto feedback  │
    │   validation  │              │ • Multi-language │
    └───────────────┘              └──────────────────┘
```

**See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.**

---

## 🎯 Key Features

### 1. Intelligent Discovery

**LLM-Powered Search:**
- Natural language input: "Find a pet-friendly hotel in Miami Beach"
- Automatic extraction: intent, categories, tags, location
- Semantic validation: filter false positives
- Multi-language support: works in any language

**Intent-Based Matching:**
- Hierarchical intents: `domain.service.action`
- Example: `food.restaurant.search`, `travel.hotel.book`
- 25% ranking weight for intent matching

### 2. Automatic Ranking

Agents are ranked by **9 factors**:

| Factor | Weight | What It Measures |
|--------|--------|------------------|
| Intent Match | 25% | How well agent's intents match search |
| Geographic | 20% | Location proximity |
| Success Rate | 14% | Historical execution success % |
| Description | 10% | Token overlap (description + tags + categories) |
| Category Match | 10% | Matching service categories |
| User Rating | 9% | Average feedback rating |
| Tag Match | 7% | Matching feature tags |
| Fraud Score | 4% | Anti-fraud score (100% - fraud%), applied in prod |
| Latency | 3% | Response speed |

**See [docs/RANKING_AND_FEEDBACK.md](docs/RANKING_AND_FEEDBACK.md) for ranking details.**

### 3. Zero-Configuration Security

**Three-Layer JWT System:**

1. **Provider → Registry**: Auto-authentication on registration
2. **Consumer → Registry**: Auto-authentication on search
3. **Consumer → Provider**: Temporary execution keys (5min)

All handled automatically by SDKs - no manual credential management!

**See [docs/SECURITY.md](docs/SECURITY.md) for security architecture.**

### 4. Input Schema Validation

**Providers define expected input:**
```typescript
inputSchema: {
  type: 'object',
  properties: {
    city: { type: 'string' },
    checkIn: { type: 'string', format: 'date' },
    guests: { type: 'number', minimum: 1 }
  },
  required: ['city', 'checkIn']
}
```

**Consumer SDK validates automatically:**
- Checks required fields
- Validates types
- Returns clear error messages
- LLM uses schema to build valid params from natural language

### 5. Real-Time Feedback

**Automatic Performance Tracking:**
```typescript
// Execute + automatic feedback
const result = await consumer.executeWithFeedback(agent, request);

// SDK automatically sends:
// - Success/failure
// - Latency
// - Optional quality rating
```

**Rankings Update in Real-Time:**
- Successful agents rank higher
- Failed agents rank lower
- New agents rely on intent/category/tag/geo; stats-driven scores start at 0 until feedback arrives

---

## 📦 SDKs

### Agent Provider SDK

**Create agents that offer services.**

```bash
npm install @apptrix/automata-agent-provider
```

**Features:**
- Auto-registration with Registry
- Built-in HTTP server (Fastify)
- JWT authentication
- Input schema validation
- Health check endpoint
- Production-ready (HTTPS, rate limiting)

**[Full Documentation →](sdk-agent-provider/README.md)**

### Agent Consumer SDK

**Discover and consume agent services.**

```bash
npm install @apptrix/automata-agent-consumer
```

**Features:**
- LLM-powered prompt analysis (required)
- Intelligent search with ranking
- Semantic agent validation
- Automatic feedback submission
- Natural language response interpretation
- Multi-language support

**[Full Documentation →](sdk-agent-consumer/README.md)**

---

## 📚 Complete Documentation

| Document | Description |
|----------|-------------|
| **[Architecture](docs/ARCHITECTURE.md)** | System design, components, data flow, scalability |
| **[Security](docs/SECURITY.md)** | JWT authentication, authorization, best practices |
| **[Ranking & Feedback](docs/RANKING_AND_FEEDBACK.md)** | How ranking works, feedback system, optimization |
| **[Open Questions & Limitations](docs/OPEN_QUESTIONS_AND_LIMITATIONS.md)** | Protocol limitations, trust issues, unsolved problems |
| **[Provider SDK](sdk-agent-provider/README.md)** | Create discoverable service agents |
| **[Consumer SDK](sdk-agent-consumer/README.md)** | Search and orchestrate agents |

---

## 💡 Use Cases

### 1. Service Marketplace

```typescript
// Restaurant search agent in Copacabana
const restaurantAgent = new AgentProvider({
  id: 'agent:restaurant:copacabana',
  intents: ['food.restaurant.search'],
  categories: ['food', 'restaurant.search'],
  tags: ['japanese', 'copacabana', 'seafood'],
  locationScope: 'Copacabana,Rio de Janeiro,Brazil',
});

// Consumers find it automatically via search
const agents = await consumer.search({
  intent: 'food.restaurant.search',
  location: 'Copacabana,Rio de Janeiro,Brazil',
});
```

### 2. Microservices Orchestration

```typescript
// Orchestrate multiple services
const consumer = new AgentConsumer({ llm: {...} });

// Search hotel
const hotels = await consumer.search({ intent: 'travel.hotel.search' });
const hotelResult = await consumer.executeWithFeedback(hotels[0], {...});

// Search restaurant
const restaurants = await consumer.search({ intent: 'food.restaurant.search' });
const foodResult = await consumer.executeWithFeedback(restaurants[0], {...});

// Combine results
return { hotel: hotelResult.data, food: foodResult.data };
```

### 3. Distributed Quotations

```typescript
// Get quotes from multiple development agencies
const agencies = await consumer.search({
  intent: 'development.agency.estimation',
  categories: ['development', 'software.estimation'],
  tags: ['web', 'mobile', 'ai'],
  limit: 5,
});

// Execute in parallel
const quotes = await Promise.all(
  agencies.map(agency =>
    consumer.executeWithFeedback(agency, {
      task: 'estimate_project',
      params: { features, timeline }
    })
  )
);

// Compare and choose best
const bestQuote = quotes.sort((a, b) => a.data.price - b.data.price)[0];
```

### 4. AI-Powered Agent Search

```typescript
// Natural language input
const userInput = "I need a luxury hotel in Miami Beach for 3 people";

// LLM analyzes
const analysis = await consumer.analyzePrompt(userInput);
// → { intent: 'travel.hotel.search', location: 'Miami Beach,FL,USA', ... }

// Search agents
const agents = await consumer.search({
  intent: analysis.intent,
  categories: analysis.categories,
  tags: analysis.keywords,
  location: analysis.location,
});

// LLM validates relevance
const validAgents = await consumer.validateAgentRelevance(agents, analysis);

// Execute
const results = await consumer.executeMultipleWithFeedback(validAgents, {...});

// LLM interprets responses
const interpretation = await consumer.interpretResponses(userInput, results, analysis.intent);

console.log(interpretation);
// "I found 3 luxury hotels in Miami Beach for 3 guests:
//  1. Ocean View Resort - $250/night, beachfront..."
```

---

## 🌍 Environment Variables

### Provider
```bash
PORT=4001
REGISTRY_URL=https://automata.apptrixcloud.com
PUBLIC_ENDPOINT=https://your-agent.com  # Required in production
```

### Consumer
```bash
REGISTRY_URL=https://automata.apptrixcloud.com

# LLM Configuration (REQUIRED in v2.0)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
```

### Registry Central
```bash
NODE_ENV=production
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=automata
DATABASE_USER=automata
DATABASE_PASSWORD=***
JWT_SECRET=***
```

---

## 🎓 Best Practices

### For Providers

1. **Use specific intents**
   - ✅ `food.restaurant.search`
   - ❌ `search`

2. **Add many relevant tags**
   - ✅ `['japanese', 'sushi', 'copacabana', 'budget', 'delivery']`
   - ❌ `['restaurant']`

3. **Define input schema**
   - Helps consumers send valid params
   - LLM uses it to build requests

4. **Optimize performance**
   - Keep latency < 500ms
   - Return meaningful errors

5. **Be geographically specific**
   - ✅ `Copacabana,Rio de Janeiro,RJ,Brazil`
   - ❌ `Brazil`

### For Consumers

1. **Always send feedback**
   - Use `executeWithFeedback()` instead of `execute()`
   - Improves rankings over time

2. **Provide honest ratings**
   - Don't always rate 1.0
   - Evaluate actual response quality

3. **Use LLM features**
   - `analyzePrompt()` for intent extraction
   - `validateAgentRelevance()` for semantic filtering
   - `interpretResponses()` for natural language output

4. **Handle fallbacks**
   - Try multiple agents if first fails
   - Use ranked order from search results

---

## 🚀 Deployment

### Development

```bash
# Registry Central
cd registry-central
docker-compose up -d

# Provider
cd sdk-agent-provider
npm run dev

# Consumer
cd sdk-agent-consumer
npm run example
```

### Production

**Registry Central:**
```bash
cd registry-central
docker-compose up -d
```

**Provider (PM2):**
```bash
cd sdk-agent-provider
npm run build
pm2 start dist/index.js --name "agent-weather"
```

**Consumer (Serverless):**
```typescript
// AWS Lambda / Vercel / Netlify
export async function handler(event) {
  const consumer = new AgentConsumer({ llm: {...} });
  const agents = await consumer.search(event.search);
  const result = await consumer.executeWithFeedback(agents[0], event.request);
  return { statusCode: 200, body: JSON.stringify(result.data) };
}
```

---

## 🔒 Security

Automata implements a **three-layer JWT security system** that is completely automatic:

1. **Provider Authentication**: Auto-generated JWT for registration (24h)
2. **Consumer Authentication**: Auto-generated JWT for searches (24h)
3. **Execution Authorization**: Temporary keys for Consumer→Provider (5min)

**All handled by SDKs - no manual credential management required!**

See [docs/SECURITY.md](docs/SECURITY.md) for complete security documentation.

---

## 📊 System Status

**Production Instances:**
- **Production Registry**: `https://automata.apptrixcloud.com`
- **Dev Registry**: `https://automata-dev.apptrixcloud.com`

**Current Version:** v1.0.1

**Known Issues:** See [docs/KNOWN_ISSUES_AND_IMPROVEMENTS.md](docs/KNOWN_ISSUES_AND_IMPROVEMENTS.md)

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📝 License

MIT License - see LICENSE files in each package:
- [sdk-agent-provider/LICENSE](sdk-agent-provider/LICENSE)
- [sdk-agent-consumer/LICENSE](sdk-agent-consumer/LICENSE)

---

## 🆘 Support

- **Documentation**: See links above
- **Issues**: [GitHub Issues](https://github.com/MendesCorporation/automata/issues)
- **Email**: contato@apptrix.app

---

**Built for simplicity, intelligence, and scale** 🚀
