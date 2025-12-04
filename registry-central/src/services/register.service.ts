import { AgentRepository } from '../repositories/agent.repository.js';
import { StatsRepository } from '../repositories/stats.repository.js';
import { Agent, RegisterAgentRequest } from '../types/agent.types.js';

export class RegisterService {
  private agentRepo: AgentRepository;
  private statsRepo: StatsRepository;

  constructor() {
    this.agentRepo = new AgentRepository();
    this.statsRepo = new StatsRepository();
  }

  async register(request: RegisterAgentRequest & { caller_id: string }): Promise<{ id: string }> {
    this.validateRequest(request);
    this.validateEndpoint(request.endpoint);

    const agent: Agent & { caller_id?: string } = {
      id: request.id,
      name: request.name,
      endpoint: request.endpoint,
      description: request.description,
      intents: request.intents,
      tasks: request.tasks || [],
      tags: request.tags,
      categories: request.categories,
      location_scope: request.location_scope || 'Global',
      languages: request.languages,
      version: request.version,
      meta: request.meta || {},
      input_schema: request.input_schema,
      caller_id: request.caller_id,
    };

    await this.agentRepo.upsert(agent);

    const existingStats = await this.statsRepo.findByAgentId(agent.id);
    if (!existingStats) {
      await this.statsRepo.create({
        agent_id: agent.id,
        calls_total: 0,
        calls_success: 0,
        avg_latency_ms: 0,
        avg_rating: 0,
      });
    }

    return { id: agent.id };
  }

  private validateRequest(request: RegisterAgentRequest): void {
    if (!request.id || request.id.trim() === '') {
      throw new Error('Field "id" is required');
    }
    if (!request.name || request.name.trim() === '') {
      throw new Error('Field "name" is required');
    }
    if (!request.endpoint || request.endpoint.trim() === '') {
      throw new Error('Field "endpoint" is required');
    }
    if (!request.description || request.description.trim() === '') {
      throw new Error('Field "description" is required');
    }
    if (!request.intents || request.intents.length === 0) {
      throw new Error('Field "intents" must contain at least one intent');
    }
    if (!request.categories || request.categories.length === 0) {
      throw new Error('Field "categories" must contain at least one category');
    }
    if (!request.languages || request.languages.length === 0) {
      throw new Error('Field "languages" must contain at least one language');
    }
  }

  private validateEndpoint(endpoint: string): void {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      if (!endpoint.startsWith('https://')) {
        throw new Error(
          'Production mode requires HTTPS endpoint. ' +
          'Received: ' + endpoint + '. ' +
          'Localhost endpoints are only allowed in development mode.'
        );
      }
    } else {
      const isLocalhost = endpoint.startsWith('http://localhost:') ||
                         endpoint.startsWith('http://127.0.0.1:') ||
                         endpoint.startsWith('https://localhost:') ||
                         endpoint.startsWith('https://127.0.0.1:');

      const isHttps = endpoint.startsWith('https://');
      const isHttpPublic = endpoint.startsWith('http://') && !isLocalhost;

      if (isHttpPublic) {
        throw new Error(
          'Development mode requires either localhost endpoint or HTTPS. ' +
          'HTTP is only allowed for localhost. ' +
          'Received: ' + endpoint
        );
      }

      if (!isLocalhost && !isHttps) {
        throw new Error(
          'Invalid endpoint. Must be localhost or HTTPS. ' +
          'Received: ' + endpoint
        );
      }
    }

    try {
      new URL(endpoint);
    } catch (error) {
      throw new Error('Invalid endpoint URL format: ' + endpoint);
    }
  }
}
