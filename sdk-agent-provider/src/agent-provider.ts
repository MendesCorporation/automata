import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import jwt from 'jsonwebtoken';
import { AgentConfig, ExecuteHandler, ExecuteRequest } from './types.js';
import { LLMService, LLMConfig, LLMMessage } from './llm-service.js';

const jwtSecretEnv = process.env.JWT_SECRET;
if (!jwtSecretEnv || jwtSecretEnv.length < 16) {
  throw new Error('JWT_SECRET env not configured or too short');
}
const JWT_SECRET: string = jwtSecretEnv;

export class AgentProvider {
  private config: AgentConfig;
  private executeHandler?: ExecuteHandler;
  private server?: FastifyInstance;
  private ipRateLimits: Map<string, number> = new Map();
  private rateLimitCleanupInterval?: NodeJS.Timeout;
  private llmService: LLMService | null = null;

  constructor(config: AgentConfig) {
    const isProd = process.env.NODE_ENV === 'production';
    const defaultRegistry = isProd ? 'https://automata.apptrixcloud.com' : 'https://automata-dev.apptrixcloud.com';
    const registryUrl = config.registryUrl || process.env.REGISTRY_URL || defaultRegistry;
    const publicEndpoint = config.publicEndpoint || process.env.PUBLIC_ENDPOINT;

    if (config.llm) {
      this.llmService = new LLMService(config.llm as LLMConfig);
    }

    this.config = { ...config, registryUrl, publicEndpoint };
  }

  onExecute(handler: ExecuteHandler): void {
    this.executeHandler = handler;
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const lastCall = this.ipRateLimits.get(ip);
    if (lastCall && now - lastCall < 1000) return false;
    this.ipRateLimits.set(ip, now);
    return true;
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [ip, ts] of this.ipRateLimits.entries()) {
      if (now - ts > 5000) this.ipRateLimits.delete(ip);
    }
  }

  async start(): Promise<void> {
    if (!this.executeHandler) {
      throw new Error('Execute handler is not configured . Use onExecute() before start()');
    }

    this.server = Fastify({ logger: true });
    await this.server.register(rateLimit, { max: 1, timeWindow: '1 second' });

    this.server.post<{ Body: ExecuteRequest }>('/execute', async (request, reply) => {
      try {
        const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
        if (!this.checkRateLimit(clientIp)) {
          return reply.code(429).send({ success: false, error: 'Rate limit exceeded. Wait 1 second between requests.' });
        }

        const authHeader = request.headers['authorization'];
        const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.substring(7)
          : null;
        if (!token) {
          return reply.code(401).send({ success: false, error: 'Execution token required' });
        }

        // DEBUG: Log JWT details
        console.log('\n========== JWT VALIDATION DEBUG ==========');
        console.log('Agent ID:', this.config.id);
        console.log('JWT_SECRET (first 10 chars):', JWT_SECRET.substring(0, 10) + '...');
        console.log('JWT_SECRET length:', JWT_SECRET.length);
        console.log('Token received (first 50 chars):', token.substring(0, 50) + '...');

        try {
          const payload = jwt.verify(token, JWT_SECRET) as any;
          console.log('✅ Token verified successfully');
          console.log('Payload:', JSON.stringify(payload, null, 2));
          console.log('==========================================\n');

          if (payload.agent_id !== this.config.id) {
            return reply.code(403).send({ success: false, error: 'Token not valid for this agent' });
          }
        } catch (err: any) {
          console.log('❌ Token verification FAILED');
          console.log('Error:', err.message);
          console.log('Error name:', err.name);
          console.log('==========================================\n');
          return reply.code(403).send({ success: false, error: `Invalid execution token: ${err.message}` });
        }

        const result = await this.executeHandler!(request.body);
        return reply.code(200).send(result);
      } catch (error: any) {
        return reply.code(500).send({ success: false, error: error.message });
      }
    });

    this.server.get('/health', async () => ({ status: 'ok', agentId: this.config.id }));

    const listenHost = process.env.HOST || '0.0.0.0';
    const listenPort = process.env.PORT ? parseInt(process.env.PORT, 10) : this.config.port;

    await this.server.listen({ port: listenPort, host: listenHost });

    this.rateLimitCleanupInterval = setInterval(() => this.cleanupRateLimits(), 10000);

    await this.registerWithCentral();
  }

  private async registerWithCentral(): Promise<void> {
    try {
      const tokenResponse = await fetch(`${this.config.registryUrl}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.config.id,
          'x-provider-secret': JWT_SECRET, // obrigatório: segredo do provider para assinar execution_key
        },
        body: JSON.stringify({ type: 'provider' }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token request failed: ${tokenResponse.statusText}`);
      }

      const tokenData = await tokenResponse.json() as any;
      const registryToken = tokenData.token;

      let endpoint: string;
      if (this.config.publicEndpoint) {
        endpoint = this.config.publicEndpoint;
      } else if (process.env.NODE_ENV === 'production') {
        throw new Error('Production mode requires publicEndpoint (HTTPS) in AgentConfig.');
      } else {
        endpoint = `http://localhost:${this.config.port}`;
      }

      const payload = {
        id: this.config.id,
        name: this.config.name,
        endpoint,
        description: this.config.description,
        intents: this.config.intents,
        tasks: this.config.tasks || [],
        tags: this.config.tags,
        categories: this.config.categories,
        location_scope: this.config.locationScope,
        languages: this.config.languages,
        version: this.config.version,
        meta: this.config.meta || {},
        input_schema: this.config.inputSchema,
      };

      const registerResponse = await fetch(`${this.config.registryUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${registryToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!registerResponse.ok) {
        const errorData = await registerResponse.json() as any;
        throw new Error(`Registration failed: ${errorData.error || registerResponse.statusText}`);
      }
    } catch (error: any) {
      // keep agent running even if registry fails
    }
  }

  async stop(): Promise<void> {
    if (this.rateLimitCleanupInterval) clearInterval(this.rateLimitCleanupInterval);
    if (this.server) {
      await this.server.close();
    }
  }

  async callLLM(prompt: string, systemPrompt: string = ''): Promise<string> {
    if (!this.llmService) {
      throw new Error('LLM not configured for this provider');
    }

    const messages: LLMMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await this.llmService.complete(messages);

    let content = response.content.trim();
    if (content.startsWith('```json')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (content.startsWith('```')) {
      content = content.replace(/```\n?/g, '');
    }
    return content;
  }
}
