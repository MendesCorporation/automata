import { db } from '../database/client.js';
import { AgentStats } from '../types/agent.types.js';

export class StatsRepository {
  async findByAgentId(agentId: string): Promise<AgentStats | null> {
    const result = await db.query<AgentStats>(
      'SELECT * FROM agent_stats WHERE agent_id = $1',
      [agentId]
    );
    return result.rows[0] || null;
  }

  async create(stats: AgentStats): Promise<AgentStats> {
    const result = await db.query<AgentStats>(
      `INSERT INTO agent_stats (
        agent_id, calls_total, calls_success, avg_latency_ms, avg_rating, last_feedback_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        stats.agent_id,
        stats.calls_total,
        stats.calls_success,
        stats.avg_latency_ms,
        stats.avg_rating,
        stats.last_feedback_at,
      ]
    );
    return result.rows[0];
  }

  async update(stats: AgentStats): Promise<AgentStats> {
    const result = await db.query<AgentStats>(
      `UPDATE agent_stats SET
        calls_total = $2,
        calls_success = $3,
        avg_latency_ms = $4,
        avg_rating = $5,
        last_feedback_at = $6
      WHERE agent_id = $1
      RETURNING *`,
      [
        stats.agent_id,
        stats.calls_total,
        stats.calls_success,
        stats.avg_latency_ms,
        stats.avg_rating,
        stats.last_feedback_at,
      ]
    );
    return result.rows[0];
  }

  async incrementFeedback(
    agentId: string,
    success: boolean,
    latencyMs: number,
    rating: number
  ): Promise<AgentStats> {
    return this.incrementFeedbackWeighted(agentId, success, latencyMs, rating, 1.0);
  }

  /**
   * Increments feedback with applied weight (anti-fraud)
   */
  async incrementFeedbackWeighted(
    agentId: string,
    success: boolean,
    latencyMs: number,
    rating: number,
    weight: number
  ): Promise<AgentStats> {
    const existing = await this.findByAgentId(agentId);

    if (!existing) {
      const newStats: AgentStats = {
        agent_id: agentId,
        calls_total: 1,
        calls_success: success ? 1 : 0,
        avg_latency_ms: latencyMs,
        avg_rating: rating * weight,
        last_feedback_at: new Date(),
      };
      return await this.create(newStats);
    }

    const newCallsTotal = existing.calls_total + 1;
    const newCallsSuccess = existing.calls_success + (success ? 1 : 0);

    const currentLatency = Number(existing.avg_latency_ms) || 0;
    const currentRating = Number(existing.avg_rating) || 0;

    const newAvgLatency =
      currentLatency + (latencyMs - currentLatency) / newCallsTotal;

    const weightedRating = rating * weight;
    const newAvgRating =
      currentRating + (weightedRating - currentRating) / newCallsTotal;

    const updatedStats: AgentStats = {
      agent_id: agentId,
      calls_total: newCallsTotal,
      calls_success: newCallsSuccess,
      avg_latency_ms: newAvgLatency,
      avg_rating: newAvgRating,
      last_feedback_at: new Date(),
    };

    return await this.update(updatedStats);
  }
}
