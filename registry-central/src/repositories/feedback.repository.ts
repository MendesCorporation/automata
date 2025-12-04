import { db } from '../database/client.js';
import { AgentFeedback } from '../types/agent.types.js';

export class FeedbackRepository {
  async create(feedback: AgentFeedback): Promise<AgentFeedback> {
    const result = await db.query<AgentFeedback>(
      `INSERT INTO agent_feedbacks (
        agent_id, consumer_id, success, latency_ms, rating
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        feedback.agent_id,
        feedback.consumer_id,
        feedback.success,
        feedback.latency_ms,
        feedback.rating,
      ]
    );
    return result.rows[0];
  }

  async findByAgentId(agentId: string, limit = 100): Promise<AgentFeedback[]> {
    const result = await db.query<AgentFeedback>(
      `SELECT * FROM agent_feedbacks
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
    return result.rows;
  }

  async findByConsumerAndAgent(consumerId: string, agentId: string): Promise<AgentFeedback[]> {
    const result = await db.query<AgentFeedback>(
      `SELECT * FROM agent_feedbacks
       WHERE consumer_id = $1 AND agent_id = $2
       ORDER BY created_at DESC`,
      [consumerId, agentId]
    );
    return result.rows;
  }

  async countByConsumerAndAgent(consumerId: string, agentId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks
       WHERE consumer_id = $1 AND agent_id = $2`,
      [consumerId, agentId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async countRecentByConsumerAndAgent(consumerId: string, agentId: string, hours = 1): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks
       WHERE consumer_id = $1 AND agent_id = $2
       AND created_at > NOW() - INTERVAL '${hours} hours'`,
      [consumerId, agentId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async countRecentByConsumer(consumerId: string, minutes = 1): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks
       WHERE consumer_id = $1
       AND created_at > NOW() - INTERVAL '${minutes} minutes'`,
      [consumerId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  // Calcula estatísticas de fraude para um agent
  async getFraudStats(agentId: string): Promise<{
    total: number;
    selfRatingCount: number;
    selfRatingPercentage: number;
  }> {
    // Primeiro, pega o caller_id do agent
    const agentResult = await db.query<{ caller_id: string }>(
      `SELECT caller_id FROM agents WHERE id = $1`,
      [agentId]
    );
    const agentCallerId = agentResult.rows[0]?.caller_id;

    // Conta total de feedbacks
    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks WHERE agent_id = $1`,
      [agentId]
    );
    const total = parseInt(totalResult.rows[0]?.count || '0');

    // Conta self-rating (consumer_id = agent caller_id)
    let selfRatingCount = 0;
    if (agentCallerId) {
      const selfRatingResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM agent_feedbacks
         WHERE agent_id = $1 AND consumer_id = $2`,
        [agentId, agentCallerId]
      );
      selfRatingCount = parseInt(selfRatingResult.rows[0]?.count || '0');
    }

    const selfRatingPercentage = total > 0 ? (selfRatingCount / total) * 100 : 0;

    return {
      total,
      selfRatingCount,
      selfRatingPercentage,
    };
  }

  // Calcula padrões suspeitos de rating
  async getRatingPatternStats(agentId: string): Promise<{
    total: number;
    extremeRatings: number;
    extremePercentage: number;
  }> {
    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks WHERE agent_id = $1`,
      [agentId]
    );
    const total = parseInt(totalResult.rows[0]?.count || '0');

    // Conta ratings extremos (0.0 ou 1.0)
    const extremeResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_feedbacks
       WHERE agent_id = $1 AND (rating = 0 OR rating = 1)`,
      [agentId]
    );
    const extremeRatings = parseInt(extremeResult.rows[0]?.count || '0');

    const extremePercentage = total > 0 ? (extremeRatings / total) * 100 : 0;

    return {
      total,
      extremeRatings,
      extremePercentage,
    };
  }
}
