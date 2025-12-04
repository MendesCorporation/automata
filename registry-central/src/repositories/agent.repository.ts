import { db } from '../database/client.js';
import { Agent } from '../types/agent.types.js';

export class AgentRepository {
  async findById(id: string): Promise<Agent | null> {
    const result = await db.query<Agent>(
      'SELECT * FROM agents WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async create(agent: Agent & { caller_id?: string }): Promise<Agent> {
    const result = await db.query<Agent>(
      `INSERT INTO agents (
        id, name, endpoint, description, intents, tasks, tags, categories,
        location_scope, languages, version, meta, input_schema, caller_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        agent.id,
        agent.name,
        agent.endpoint,
        agent.description,
        agent.intents,
        agent.tasks || [],
        agent.tags,
        agent.categories,
        agent.location_scope,
        agent.languages,
        agent.version,
        JSON.stringify(agent.meta),
        agent.input_schema ? JSON.stringify(agent.input_schema) : null,
        agent.caller_id || null,
      ]
    );
    return result.rows[0];
  }

  async update(agent: Agent & { caller_id?: string }): Promise<Agent> {
    const result = await db.query<Agent>(
      `UPDATE agents SET
        name = $2,
        endpoint = $3,
        description = $4,
        intents = $5,
        tasks = $6,
        tags = $7,
        categories = $8,
        location_scope = $9,
        languages = $10,
        version = $11,
        meta = $12,
        input_schema = $13,
        caller_id = $14
      WHERE id = $1
      RETURNING *`,
      [
        agent.id,
        agent.name,
        agent.endpoint,
        agent.description,
        agent.intents,
        agent.tasks || [],
        agent.tags,
        agent.categories,
        agent.location_scope,
        agent.languages,
        agent.version,
        JSON.stringify(agent.meta),
        agent.input_schema ? JSON.stringify(agent.input_schema) : null,
        agent.caller_id || null,
      ]
    );
    return result.rows[0];
  }

  async upsert(agent: Agent): Promise<Agent> {
    const existing = await this.findById(agent.id);
    if (existing) {
      return await this.update(agent);
    } else {
      return await this.create(agent);
    }
  }

  async search(filters: {
    intent?: string | string[];
    categories?: string[];
    language?: string;
  }): Promise<Agent[]> {
    let query = 'SELECT * FROM agents WHERE 1=1';
    const params: any[] = [];
    let paramCount = 1;

    // Intent matching - support string or array (overlap)
    if (filters.intent) {
      if (Array.isArray(filters.intent)) {
        query += ` AND intents && $${paramCount}`;
        params.push(filters.intent);
      } else {
        query += ` AND $${paramCount} = ANY(intents)`;
        params.push(filters.intent);
      }
      paramCount++;
    }

    if (filters.categories && filters.categories.length > 0) {
      query += ` AND categories && $${paramCount}`;
      params.push(filters.categories);
      paramCount++;
    }

    if (filters.language) {
      query += ` AND $${paramCount} = ANY(languages)`;
      params.push(filters.language);
      paramCount++;
    }

    const result = await db.query<Agent>(query, params);
    return result.rows;
  }

  async searchByIntentFuzzy(intent: string, limit: number = 50): Promise<Array<Agent & { intent_similarity: number }>> {
    const result = await db.query<any>(
      `
      SELECT *,
             similarity(array_to_string(intents, ','), $1) AS intent_similarity
      FROM agents
      WHERE similarity(array_to_string(intents, ','), $1) >= 0.2
      ORDER BY intent_similarity DESC
      LIMIT $2
      `,
      [intent, limit]
    );
    return result.rows;
  }

  async findAll(): Promise<Agent[]> {
    const result = await db.query<Agent>('SELECT * FROM agents');
    return result.rows;
  }
}
