import { FastifyInstance } from 'fastify';
import { RegisterService } from '../services/register.service.js';
import { SearchService } from '../services/search.service.js';
import { FeedbackService } from '../services/feedback.service.js';
import { AuthService } from '../services/auth.service.js';
import { QuarantineService } from '../services/quarantine.service.js';
import { RegisterAgentRequest, SearchAgentRequest, FeedbackRequest } from '../types/agent.types.js';

export async function routes(fastify: FastifyInstance) {
  const registerService = new RegisterService();
  const searchService = new SearchService();
  const feedbackService = new FeedbackService();
  const authService = new AuthService();
  const quarantineService = new QuarantineService();

  // Health check (no auth required)
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Get token endpoint (auto-registration based on identifier)
  // Provider calls this first to get JWT
  // Consumer calls this first to get JWT
  fastify.post<{ Body: { type: 'consumer' | 'provider' } }>('/auth/token', async (request, reply) => {
    try {
      const { type } = request.body;

      if (!type || (type !== 'consumer' && type !== 'provider')) {
        return reply.code(400).send({ error: 'type must be "consumer" or "provider"' });
      }

      // Extract identifier from request (IP, endpoint, or custom header)
      const identifier = authService.extractIdentifier(request);
      const providerSecret = request.headers['x-provider-secret'] as string | undefined;

      // Get or create token
      const token = await authService.getOrCreateToken(type, identifier, providerSecret);

      return reply.code(200).send({
        token,
        expires_in: '24h',
        token_type: 'Bearer',
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Token generation error');
      return reply.code(500).send({ error: 'Failed to generate token' });
    }
  });

  // Register agent (Provider only, requires JWT)
  // Returns JWT back to provider for future validations
  fastify.post<{ Body: RegisterAgentRequest }>('/register', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers['authorization'];
      const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) {
        return reply.code(401).send({ error: 'Access token required' });
      }

      try {
        const payload = authService.verifyToken(token);
        request.caller = payload;

        if (payload.type !== 'provider') {
          return reply.code(403).send({ error: 'Provider access required' });
        }
      } catch (error: any) {
        return reply.code(403).send({ error: 'Invalid or expired token' });
      }
    }
  }, async (request, reply) => {
    try {
      // Add caller_id to registration
      const registrationData = {
        ...request.body,
        caller_id: request.caller!.caller_id,
      };

      const result = await registerService.register(registrationData);

      // Return JWT token to provider for validating execution keys
      const providerJwt = request.headers['authorization']!.toString().substring(7);

      return reply.code(200).send({
        ...result,
        jwt_token: providerJwt, // Provider stores this to validate executions
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Register agent error');
      return reply.code(400).send({ error: 'Failed to register agent' });
    }
  });

  // Search agents (Consumer only, requires JWT)
  // Returns agents WITH execution keys
  fastify.post<{ Body: SearchAgentRequest }>('/search', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers['authorization'];
      const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) {
        return reply.code(401).send({ error: 'Access token required' });
      }

      try {
        const payload = authService.verifyToken(token);
        request.caller = payload;

        if (payload.type !== 'consumer') {
          return reply.code(403).send({ error: 'Consumer access required' });
        }
      } catch (error: any) {
        return reply.code(403).send({ error: 'Invalid or expired token' });
      }
    }
  }, async (request, reply) => {
    try {
      const agents = await searchService.search(request.body);

      // Generate execution key for each agent
      const agentsWithKeys = await Promise.all(
        agents.map(async (agent) => {
          const providerSecret = agent.caller_id
            ? await authService.getProviderSecret(agent.caller_id)
            : null;
          const { key, expires_at } = await authService.generateExecutionKey(
            request.caller!.caller_id,
            agent.id,
            providerSecret || undefined
          );

          return {
            ...agent,
            execution_key: key,
            key_expires_at: expires_at,
          };
        })
      );

      return reply.code(200).send(agentsWithKeys);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Search agents error');
      return reply.code(400).send({ error: 'Failed to search agents' });
    }
  });

  // Feedback (Consumer only, requires JWT)
  fastify.post<{ Body: FeedbackRequest }>('/feedback', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers['authorization'];
      const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) {
        return reply.code(401).send({ error: 'Access token required' });
      }

      try {
        const payload = authService.verifyToken(token);
        request.caller = payload;

        if (payload.type !== 'consumer') {
          return reply.code(403).send({ error: 'Consumer access required' });
        }
      } catch (error: any) {
        return reply.code(403).send({ error: 'Invalid or expired token' });
      }
    }
  }, async (request, reply) => {
    try {
      // Adiciona consumer_id do JWT ao feedback (anti-fraude)
      const feedbackData = {
        ...request.body,
        consumer_id: request.caller!.caller_id,
      };

      const result = await feedbackService.submitFeedback(feedbackData);
      return reply.code(200).send(result);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Submit feedback error');
      const message = typeof error?.message === 'string' ? error.message : 'Failed to submit feedback';
      const isRateLimit = message.toLowerCase().includes('rate limit');
      const status = isRateLimit ? 429 : 400;
      return reply.code(status).send({ error: message });
    }
  });

  // Agent health metrics endpoint (no auth required - public info)
  fastify.get<{ Params: { id: string } }>('/agents/:id/health', async (request, reply) => {
    try {
      const { id } = request.params;

      const health = await quarantineService.checkAgentHealth(id);

      if (!health) {
        return reply.code(404).send({ error: 'Agent não encontrado' });
      }

      return reply.code(200).send(health);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Agent health error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
