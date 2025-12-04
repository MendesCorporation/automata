import { AgentRepository } from '../repositories/agent.repository.js';
import { StatsRepository } from '../repositories/stats.repository.js';
import { FeedbackRepository } from '../repositories/feedback.repository.js';
import { FraudDetectionService } from './fraud-detection.service.js';
import { AgentStatus, AgentHealthMetrics } from '../types/agent.types.js';
import { db } from '../database/client.js';

export class QuarantineService {
  private agentRepo: AgentRepository;
  private statsRepo: StatsRepository;
  private feedbackRepo: FeedbackRepository;
  private fraudService: FraudDetectionService;

  constructor() {
    this.agentRepo = new AgentRepository();
    this.statsRepo = new StatsRepository();
    this.feedbackRepo = new FeedbackRepository();
    this.fraudService = new FraudDetectionService();
  }

  private isProductionMode(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Checks agent health and returns metrics
   */
  async checkAgentHealth(agentId: string): Promise<AgentHealthMetrics | null> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) return null;

    const stats = await this.statsRepo.findByAgentId(agentId);
    if (!stats) {
      return {
        agent_id: agentId,
        status: (agent.status as AgentStatus) || 'active',
        health_score: 1.0,
        metrics: {
          success_rate: 0,
          avg_rating: 0,
          avg_latency_ms: 0,
          total_feedbacks: 0,
          fraud_detected: 0,
          fraud_percentage: 0,
          self_rating_percentage: 0,
        },
        warnings: [],
        quarantine_risk: 'low',
      };
    }

    const successRate = stats.calls_total > 0 ? stats.calls_success / stats.calls_total : 0;
    const avgRating = Number(stats.avg_rating) || 0;
    const avgLatency = Number(stats.avg_latency_ms) || 0;

    const fraudPercentage = await this.fraudService.calculateFraudPercentage(agentId);
    const fraudStats = await this.feedbackRepo.getFraudStats(agentId);

    const healthScore = (
      successRate * 0.4 +
      avgRating * 0.3 +
      (1 - Math.min(avgLatency / 10000, 1)) * 0.1 +
      (1 - fraudPercentage / 100) * 0.2
    );

    const warnings: string[] = [];
    let quarantineRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (stats.calls_total >= 20 && successRate < 0.40) {
      warnings.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
      quarantineRisk = 'high';
    }
    if (stats.calls_total >= 15 && avgRating < 0.3) {
      warnings.push(`Low average rating: ${avgRating.toFixed(2)}`);
      quarantineRisk = 'high';
    }
    if (stats.calls_total >= 10 && avgLatency > 30000) {
      warnings.push(`High latency: ${avgLatency.toFixed(0)}ms`);
      quarantineRisk = 'high';
    }
    if (fraudPercentage > 50) {
      warnings.push(`Fraud detected: ${fraudPercentage.toFixed(1)}%`);
      quarantineRisk = 'high';
    }

    if (stats.calls_total >= 40 && successRate < 0.20) {
      warnings.push(`CRITICAL: Very low success rate: ${(successRate * 100).toFixed(1)}%`);
      quarantineRisk = 'critical';
    }
    if (stats.calls_total >= 30 && avgRating < 0.15) {
      warnings.push(`CRITICAL: Very low rating: ${avgRating.toFixed(2)}`);
      quarantineRisk = 'critical';
    }
    if (fraudPercentage > 70) {
      warnings.push(`CRITICAL: Excessive fraud: ${fraudPercentage.toFixed(1)}%`);
      quarantineRisk = 'critical';
    }
    if (fraudStats.selfRatingPercentage > 80) {
      warnings.push(`CRITICAL: Excessive self-rating: ${fraudStats.selfRatingPercentage.toFixed(1)}%`);
      quarantineRisk = 'critical';
    }

    return {
      agent_id: agentId,
      status: (agent.status as AgentStatus) || 'active',
      health_score: Math.round(healthScore * 100) / 100,
      metrics: {
        success_rate: Math.round(successRate * 100) / 100,
        avg_rating: Math.round(avgRating * 100) / 100,
        avg_latency_ms: Math.round(avgLatency),
        total_feedbacks: stats.calls_total,
        fraud_detected: fraudStats.total > 0 ? Math.round(fraudStats.total * fraudPercentage / 100) : 0,
        fraud_percentage: Math.round(fraudPercentage * 10) / 10,
        self_rating_percentage: Math.round(fraudStats.selfRatingPercentage * 10) / 10,
      },
      warnings,
      quarantine_risk: quarantineRisk,
      quarantine_reason: agent.quarantine_reason,
      quarantine_at: agent.quarantine_at,
    };
  }

  /**
   * Moves agent to quarantine (Threshold 1)
   */
  async quarantineAgent(agentId: string, reason: string): Promise<void> {
    if (!this.isProductionMode()) {
      return;
    }

    await db.query(
      `UPDATE agents
       SET status = 'quarantine',
           quarantine_reason = $2,
           quarantine_at = NOW()
       WHERE id = $1`,
      [agentId, reason]
    );
  }

  /**
   * Reactivates agent (removes from quarantine)
   */
  async reactivateAgent(agentId: string): Promise<void> {
    if (!this.isProductionMode()) {
      return;
    }

    await db.query(
      `UPDATE agents
       SET status = 'active',
           quarantine_reason = NULL
       WHERE id = $1`,
      [agentId]
    );
  }

  /**
   * Permanently bans agent (Threshold 2)
   */
  async banAgent(agentId: string, reason: string): Promise<void> {
    if (!this.isProductionMode()) {
      return;
    }

    await db.query(
      `UPDATE agents
       SET status = 'banned',
           quarantine_reason = $2,
           quarantine_at = NOW()
       WHERE id = $1`,
      [agentId, reason]
    );
  }

  /**
   * Auto-review all agents (runs daily via cron)
   */
  async autoReviewAgents(): Promise<{
    quarantined: number;
    reactivated: number;
    banned: number;
  }> {
    if (!this.isProductionMode()) {
      return { quarantined: 0, reactivated: 0, banned: 0 };
    }

    let quarantined = 0;
    let reactivated = 0;
    let banned = 0;

    const agents = await this.agentRepo.findAll();

    for (const agent of agents) {
      const health = await this.checkAgentHealth(agent.id);
      if (!health) continue;

      const currentStatus = agent.status || 'active';

      if (currentStatus === 'active') {
        if (health.quarantine_risk === 'high' || health.quarantine_risk === 'critical') {
          const stats = await this.statsRepo.findByAgentId(agent.id);
          if (!stats) continue;

          const successRate = stats.calls_total > 0 ? stats.calls_success / stats.calls_total : 1;
          const avgRating = Number(stats.avg_rating) || 1;
          const avgLatency = Number(stats.avg_latency_ms) || 0;

          if (stats.calls_total >= 20 && successRate < 0.40) {
            await this.quarantineAgent(agent.id, `Success rate < 40%: ${(successRate * 100).toFixed(1)}%`);
            quarantined++;
          } else if (stats.calls_total >= 15 && avgRating < 0.3) {
            await this.quarantineAgent(agent.id, `Average rating < 0.3: ${avgRating.toFixed(2)}`);
            quarantined++;
          } else if (stats.calls_total >= 10 && avgLatency > 30000) {
            await this.quarantineAgent(agent.id, `Latency > 30s: ${avgLatency.toFixed(0)}ms`);
            quarantined++;
          } else if (health.metrics.fraud_percentage > 50) {
            await this.quarantineAgent(agent.id, `Fraud > 50%: ${health.metrics.fraud_percentage.toFixed(1)}%`);
            quarantined++;
          }
        }
      }

      else if (currentStatus === 'quarantine') {
        const stats = await this.statsRepo.findByAgentId(agent.id);
        if (!stats) continue;

        const successRate = stats.calls_total > 0 ? stats.calls_success / stats.calls_total : 0;
        const avgRating = Number(stats.avg_rating) || 0;

        if (
          (stats.calls_total >= 40 && successRate < 0.20) ||
          (stats.calls_total >= 30 && avgRating < 0.15) ||
          health.metrics.fraud_percentage > 70 ||
          health.metrics.self_rating_percentage > 80
        ) {
          let reason = 'Threshold 2 reached: ';
          if (stats.calls_total >= 40 && successRate < 0.20) {
            reason += `Success rate < 20%: ${(successRate * 100).toFixed(1)}%`;
          } else if (stats.calls_total >= 30 && avgRating < 0.15) {
            reason += `Rating < 0.15: ${avgRating.toFixed(2)}`;
          } else if (health.metrics.fraud_percentage > 70) {
            reason += `Fraud > 70%: ${health.metrics.fraud_percentage.toFixed(1)}%`;
          } else if (health.metrics.self_rating_percentage > 80) {
            reason += `Self-rating > 80%: ${health.metrics.self_rating_percentage.toFixed(1)}%`;
          }

          await this.banAgent(agent.id, reason);
          banned++;
        }
        else if (successRate >= 0.45 && avgRating >= 0.35 && health.metrics.fraud_percentage < 40) {
          await this.reactivateAgent(agent.id);
          reactivated++;
        }
      }
    }

    return { quarantined, reactivated, banned };
  }
}
