# Agent Registry Central

A distributed agent registry and orchestration platform that enables intelligent agent discovery, ranking, and fraud detection for multi-agent systems.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Anti-Fraud System](#anti-fraud-system)
- [Quarantine System](#quarantine-system)
- [Ranking Algorithm](#ranking-algorithm)
- [Development](#development)
- [Production Deployment](#production-deployment)

## Overview

The Agent Registry Central is a high-performance, production-ready service that manages agent registration, discovery, and orchestration. It provides intelligent agent ranking based on multiple factors including performance metrics, geographic relevance, and fraud detection.

## Features

### Core Functionality
- **Agent Registration**: Providers can register agents with metadata, intents, categories, and capabilities
- **Intelligent Search**: Multi-factor ranking algorithm for agent discovery
- **Real-time Feedback**: Performance tracking with latency, success rate, and user ratings
- **JWT Authentication**: Secure authentication for providers and consumers
- **Execution Keys**: Short-lived tokens for secure agent-to-consumer communication

### Advanced Features
- **Anti-Fraud Detection**: Self-rating detection, spam prevention, and suspicious pattern recognition
- **Quarantine System**: Two-threshold system for automatic agent quality control
- **Automatic Review**: Daily cron jobs for agent health monitoring
- **Environment-based Validation**: HTTPS enforcement in production, localhost allowed in development
- **Rate Limiting**: Built-in protection against abuse (1 second per IP in Provider SDK)

### Production-Ready
- **PostgreSQL Database**: Robust data persistence with connection pooling
- **Docker Support**: Full containerization with docker-compose
- **Health Checks**: Service health monitoring and graceful degradation
- **TypeScript**: Full type safety throughout the codebase

## Architecture

```
┌─────────────────┐
│   Consumer SDK  │ ─┐
└─────────────────┘  │
                     │
┌─────────────────┐  │    ┌──────────────────┐
│  Provider SDK   │ ─┼───▶│  Registry Central │
└─────────────────┘  │    └──────────────────┘
                     │            │
┌─────────────────┐  │            │
│   Provider SDK  │ ─┘            ▼
└─────────────────┘         ┌──────────┐
                            │ PostgreSQL│
                            └──────────┘
```

### Components

1. **Registry Service** (Port 3000): Main API for agent registration, search, and feedback
2. **PostgreSQL Database**: Data persistence for agents, stats, feedback, and fraud detection
3. **Cron Service**: Daily auto-review of agent health and quarantine status

## Getting Started

### Prerequisites

- Node.js 18+ or Docker
- PostgreSQL 15+ (if running locally)

### Installation with Docker (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd registry-central
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Start services:
```bash
docker-compose up -d
```

4. Check service health:
```bash
curl http://localhost:3000/health
```

### Local Development Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database:
```bash
# Create database
createdb agent_registry

# Run migrations
npm run migrate
```

3. Build and start:
```bash
npm run build
npm start
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Database Configuration
DATABASE_HOST=postgres          # Use 'localhost' for local dev, 'postgres' for Docker
DATABASE_PORT=5432
DATABASE_NAME=agent_registry
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Server Configuration
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=true                # Set to true when behind Nginx/ALB to honor X-Forwarded-For/X-Real-IP

# Environment
NODE_ENV=development           # 'development' or 'production'
JWT_SECRET=change-me-in-prod-32chars-min

# Debug log for search requests
SEARCH_DEBUG=true
```

### Important: Production vs Development

#### Development Mode (`NODE_ENV=development`)
- Accepts `http://localhost:*` and `http://127.0.0.1:*` endpoints from providers
- Accepts any `https://*` endpoint
- Rejects public HTTP endpoints (non-localhost)
- Anti-fraud system is **disabled**
- Quarantine system is **disabled**

#### Production Mode (`NODE_ENV=production`)
- **Only** accepts `https://*` endpoints from providers
- Rejects all localhost endpoints
- Rejects all HTTP endpoints
- Anti-fraud system is **enabled**
- Quarantine system is **enabled**
- Providers must specify `publicEndpoint` (HTTPS) in their configuration

## API Documentation

### Authentication

All API requests require JWT authentication. Obtain a token first:

```bash
# For Provider
POST /auth/provider
Headers: X-Client-Id: provider-unique-id

# For Consumer
POST /auth/consumer
Headers: X-Client-Id: consumer-unique-id

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_at": "2025-12-04T10:30:00Z"
}
```

### Register an Agent

```bash
POST /register
Headers:
  Authorization: Bearer <provider-token>
  Content-Type: application/json

Body:
{
  "id": "weather-agent-01",
  "name": "Weather Information Agent",
  "endpoint": "https://api.weather-agent.com",  # HTTPS in production
  "description": "Provides real-time weather data and forecasts",
  "intents": ["weather.current", "weather.forecast"],
  "tasks": ["time_data"]
  "categories": ["weather", "data"],
  "tags": ["weather", "api", "forecast"],
  "location_scope": "Global",
  "languages": ["en", "pt"],
  "version": "1.0.0",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": { "type": "string" }
    }
  }
}

Response:
{
  "id": "weather-agent-01"
}
```

### Search for Agents

```bash
POST /search
Headers:
  Authorization: Bearer <consumer-token>
  Content-Type: application/json

Body:
{
  "intent": "weather.current",  // Can be string or array: ["weather.current", "weather.forecast"]
  "categories": ["weather"],
  "description": "Need current weather in San Francisco",
  "location": "San Francisco, CA, USA",
  "tags": ["api"],
  "language": "en",
  "limit": 5
}

Response:
[
  {
    "id": "weather-agent-01",
    "name": "Weather Information Agent",
    "endpoint": "https://api.weather-agent.com",
    "description": "Provides real-time weather data and forecasts",
    "intents": ["weather.current", "weather.forecast"],
    "tasks": ["get_weather", "get_forecast"],  // Available operations
    "categories": ["weather", "data"],
    "tags": ["weather", "api", "forecast"],
    "location_scope": "Global",
    "score": 0.87,
    "execution_key": "eyJhbGciOiJIUzI1NiIs...",  // JWT for executing this agent
    "key_expires_at": "2025-12-04T10:35:00Z",
    "input_schema": { ... }
  }
]
```

### Submit Feedback

```bash
POST /feedback
Headers:
  Authorization: Bearer <consumer-token>
  Content-Type: application/json

Body:
{
  "agent_id": "weather-agent-01",
  "success": true,
  "latency_ms": 245,
  "rating": 0.95
}

Response:
{
  "success": true
}
```

### Get Agent Health (Public)

```bash
GET /agents/:id/health
# No authentication required - public endpoint

Response:
{
  "agent_id": "weather-agent-01",
  "status": "active",
  "health_score": 0.85,
  "metrics": {
    "success_rate": 0.92,
    "avg_rating": 0.88,
    "avg_latency_ms": 250,
    "total_feedbacks": 1543,
    "fraud_detected": 12,
    "fraud_percentage": 0.8,
    "self_rating_percentage": 0.3
  },
  "warnings": [],
  "quarantine_risk": "low"
}
```

## Security

### JWT Authentication

The system uses JWT (JSON Web Tokens) for authentication:

- **Provider Tokens**: Used to register and update agents
- **Consumer Tokens**: Used to search agents and submit feedback
- **Execution Keys**: Short-lived tokens (5 minutes) for direct agent execution

### Caller Identification

Callers are automatically identified by:
1. **IP Address**: Primary identifier
2. **Custom Header**: `X-Client-Id` for testing/development (format: `client-id|ip`)

### Anti-Spoofing Protection

The system prevents IP spoofing by:
- Validating IP consistency for client IDs
- Rejecting requests with mismatched IP addresses
- Storing hashed tokens (not plain text)

## Anti-Fraud System

The anti-fraud system operates **only in production mode** and includes:

### 1. Self-Rating Detection
- Detects when a provider submits feedback for their own agent
- Applied automatically based on `caller_id` matching
- **Penalty**: 90% weight reduction (0.1x multiplier)
- Logged in `fraud_detections` table

### 2. Spam Detection
- Detects more than 10 feedbacks per hour from same consumer to same agent
- **Action**: Feedback is blocked (429 error)
- Prevents feedback manipulation

### 3. Rating Pattern Detection
- Detects suspicious patterns of extreme ratings (>80% are 0.0 or 1.0)
- Requires minimum 10 feedbacks
- **Action**: Logged for analysis (doesn't block)

### 4. Decreasing Weight Formula
- Each subsequent feedback from same consumer has reduced impact
- **Formula**: `weight = 1.0 / (1 + log(1 + count))`
- Minimum weight: 10%
- Prevents single consumer from dominating ratings

### Combined Fraud Protection

All weights are multiplied:
```
total_weight = self_rating_weight × decreasing_weight
```

Example:
- First feedback: `weight = 1.0`
- Second feedback: `weight = 0.63`
- Third feedback: `weight = 0.48`
- Self-rating first feedback: `weight = 0.1` (90% reduction)

## Quarantine System

The quarantine system operates **only in production mode** and has two thresholds:

### Threshold 1: Quarantine (Warning)

Agents are automatically quarantined if any condition is met:

| Metric | Minimum Feedbacks | Threshold |
|--------|------------------|-----------|
| Success Rate | 20 | < 40% |
| Average Rating | 15 | < 0.3 |
| Average Latency | 10 | > 30 seconds |
| Fraud Percentage | Any | > 50% |

**Effect**:
- Agent remains searchable but receives -0.3 score penalty
- Status changed to `quarantine`
- Can be reactivated if metrics improve

### Threshold 2: Ban (Critical)

Quarantined agents are permanently banned if any condition is met:

| Metric | Minimum Feedbacks | Threshold |
|--------|------------------|-----------|
| Success Rate | 40 | < 20% |
| Average Rating | 30 | < 0.15 |
| Fraud Percentage | Any | > 70% |
| Self-Rating % | Any | > 80% |

**Effect**:
- Agent is removed from search results
- Status changed to `banned`
- Cannot be reactivated automatically

### Reactivation

Quarantined agents are automatically reactivated if **all** conditions are met:
- Success rate ≥ 45%
- Average rating ≥ 0.35
- Fraud percentage < 40%

### Manual Operations

```bash
# Quarantine an agent
POST /agents/:agentId/quarantine
Body: { "reason": "Low performance" }

# Reactivate an agent
POST /agents/:agentId/reactivate

# Ban an agent
POST /agents/:agentId/ban
Body: { "reason": "Excessive fraud" }
```

## Ranking Algorithm

Agents are ranked using a weighted scoring algorithm:

### Score Components

| Factor | Weight | Description |
|--------|--------|-------------|
| Intent Match | 25% | Exact or partial intent matching |
| Geography | 20% | Location relevance |
| Success Rate | 14% | Historical success percentage |
| Description | 10% | Token overlap with search description |
| Categories | 10% | Category similarity |
| User Rating | 9% | Average user rating |
| Tags | 7% | Tag similarity |
| Fraud Score | 4% | Anti-fraud score (100% - fraud%) |
| Latency | 3% | Response time (lower is better) |

### Intent Matching

- **Exact match**: 1.0 score (e.g., `weather.current` = `weather.current`)
- **Partial match**: 0.6 score (e.g., `development.agency.quote` ≈ `development.agency.estimation`)
- **Category match**: 0.3 score (e.g., `development.*` ≈ `development.*`)
- **No match**: 0.0 score

### Geography Scoring

- **Global scope**: 0.3 score
- **Exact location match**: 1.0 score
- **Partial location match**: 0.3 to 0.8 score
- **No match**: 0.2 score

### Minimum Thresholds

Agents must meet minimum requirements to appear in results:
- **Minimum score**: 0.4
- **Minimum geo score**: 0.3 (if location specified)

### Penalties

- **Quarantine status**: -0.3 score penalty
- **Banned status**: Excluded from results

### Example Calculation

```
Agent A:
  Intent: 1.0 (exact match)
  Description: 0.8 (good overlap)
  Categories: 1.0 (perfect match)
  Geography: 0.3 (global)
  Success: 0.92 (92%)
  Rating: 0.88
  Tags: 0.6
  Latency: 1.0 (250ms)
  Fraud: 0.99 (1% fraud)

Final Score =
  1.0×0.25 + 0.3×0.20 + 0.92×0.14 + 0.8×0.10 + 1.0×0.10 +
  0.88×0.09 + 0.6×0.07 + 0.99×0.04 + 1.0×0.03
  = 0.82
```

## Development

### Project Structure

```
registry-central/
├── src/
│   ├── config/          # Configuration management
│   ├── database/        # Database client and migrations
│   ├── repositories/    # Data access layer
│   ├── services/        # Business logic
│   │   ├── auth.service.ts
│   │   ├── register.service.ts
│   │   ├── search.service.ts
│   │   ├── feedback.service.ts
│   │   ├── fraud-detection.service.ts
│   │   └── quarantine.service.ts
│   ├── routes/          # API routes
│   ├── types/           # TypeScript types
│   ├── cron/            # Scheduled jobs
│   └── index.ts         # Application entry point
├── docker-compose.yml   # Docker orchestration
├── Dockerfile           # Container definition
├── .env                 # Environment configuration
└── package.json         # Dependencies
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm test -- search.service.test.ts
```

### Database Migrations

```bash
# Create migration
npm run migrate:create

# Run migrations
npm run migrate

# Rollback migration
npm run migrate:rollback
```

### Cron Jobs

The auto-review cron job runs daily at 2:00 AM:

```bash
# Run manually
node dist/cron/auto-review.js

# View logs
docker logs agent-registry-cron
```

## Production Deployment

### Pre-Deployment Checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Generate strong `JWT_SECRET` (32+ characters)
- [ ] Configure production database with backups
- [ ] Use HTTPS endpoints for all providers
- [ ] Set up monitoring and alerting
- [ ] Configure log aggregation
- [ ] Test auto-review cron job
- [ ] Verify firewall rules and rate limiting
- [ ] Ensure reverse proxy sets `X-Forwarded-For` / `X-Real-IP` and `TRUST_PROXY=true`

### Reverse Proxy (real client IP)

When running behind Nginx/ALB/Traefik, enable proxy headers so the Registry stores the real client IP (not `172.18.0.1` from Docker):

```nginx
location / {
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://registry-central:3000;
}
```

Set `TRUST_PROXY=true` (default) so Fastify trusts the proxy and uses those headers for `request.ip`.

### Docker Production Deployment

1. Update `.env` for production:
```env
NODE_ENV=production
JWT_SECRET=<strong-random-secret-32chars-minimum>
DATABASE_HOST=postgres
DATABASE_PASSWORD=<strong-database-password>
```

2. Build and start services:
```bash
docker-compose up -d --build
```

3. Verify services:
```bash
docker-compose ps
docker logs agent-registry-central
```

4. Set up monitoring:
```bash
# View logs
docker-compose logs -f

# Check resource usage
docker stats
```

### Scaling Considerations

- **Database**: Use managed PostgreSQL (AWS RDS, Google Cloud SQL, etc.)
- **Registry Service**: Scale horizontally with load balancer
- **Cron Service**: Run on single instance only (use leader election if needed)
- **Cache Layer**: Consider Redis for frequent searches
- **Message Queue**: Consider adding for async operations

### Health Monitoring

Monitor these endpoints:

```bash
# Service health
GET /health

# Database connectivity
GET /health/db

# Metrics (if enabled)
GET /metrics
```

### Backup Strategy

1. **Database Backups**: Daily automated backups
2. **Transaction Logs**: Continuous archival for point-in-time recovery
3. **Environment Config**: Version controlled and encrypted
4. **Disaster Recovery**: Test recovery procedures quarterly

## Technologies

- **Node.js** with TypeScript
- **Fastify** - High-performance web framework
- **PostgreSQL** - Relational database
- **Docker** - Containerization
- **JWT** - Authentication
- **pg** - PostgreSQL client

## Troubleshooting

### Database Connection Error

Ensure PostgreSQL is running:
```bash
docker-compose ps
docker-compose logs postgres
```

### Port Already in Use

Change the port in `.env`:
```env
PORT=3001
```

### Reset Database

```bash
docker-compose down -v
docker-compose up -d
```

### Check Service Logs

```bash
# Registry logs
docker logs agent-registry-central

# Cron logs
docker logs agent-registry-cron

# Database logs
docker logs agent-registry-db
```

## License

MIT

## Support

For issues and questions, please open an issue on the repository.
