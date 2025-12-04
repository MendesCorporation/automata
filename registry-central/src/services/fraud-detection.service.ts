import { FeedbackRepository } from '../repositories/feedback.repository.js';
import { FraudDetectionRepository } from '../repositories/fraud-detection.repository.js';
import { AgentRepository } from '../repositories/agent.repository.js';

export class FraudDetectionService {
  private feedbackRepo: FeedbackRepository;
  private fraudRepo: FraudDetectionRepository;
  private agentRepo: AgentRepository;

  constructor() {
    this.feedbackRepo = new FeedbackRepository();
    this.fraudRepo = new FraudDetectionRepository();
    this.agentRepo = new AgentRepository();
  }

  private isProductionMode(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Detects if feedback is self-rating (provider rating their own agent)
   */
  async detectSelfRating(consumerId: string, agentId: string): Promise<{ isFraud: boolean; weight: number }> {
    if (!this.isProductionMode()) {
      return { isFraud: false, weight: 1.0 };
    }

    const agent = await this.agentRepo.findById(agentId);
    if (!agent || !agent.caller_id) {
      return { isFraud: false, weight: 1.0 };
    }

    const isSelfRating = consumerId === agent.caller_id;

    if (isSelfRating) {
      await this.fraudRepo.create({
        agent_id: agentId,
        consumer_id: consumerId,
        fraud_type: 'SELF_RATING',
        severity: 'HIGH',
        details: {
          message: 'Provider rating their own agent',
          consumer_id: consumerId,
          agent_caller_id: agent.caller_id,
        },
      });

      return { isFraud: true, weight: 0.1 };
    }

    return { isFraud: false, weight: 1.0 };
  }

  /**
   * Detects feedback spam (> 10 feedbacks/hour from same consumer to same agent)
   */
  async detectSpam(consumerId: string, agentId: string): Promise<{ isFraud: boolean }> {
    if (!this.isProductionMode()) {
      return { isFraud: false };
    }

    const recentCount = await this.feedbackRepo.countRecentByConsumerAndAgent(consumerId, agentId, 1);

    if (recentCount > 10) {
      await this.fraudRepo.create({
        agent_id: agentId,
        consumer_id: consumerId,
        fraud_type: 'SPAM',
        severity: 'HIGH',
        details: {
          message: 'Feedback spam detected',
          feedbacks_last_hour: recentCount,
        },
      });

      return { isFraud: true };
    }

    return { isFraud: false };
  }

  /**
   * Detects suspicious rating patterns (> 80% extreme ratings: 0.0 or 1.0)
   */
  async detectRatingPatterns(agentId: string): Promise<{ isFraud: boolean }> {
    if (!this.isProductionMode()) {
      return { isFraud: false };
    }

    const stats = await this.feedbackRepo.getRatingPatternStats(agentId);

    if (stats.total >= 10 && stats.extremePercentage > 80) {
      await this.fraudRepo.create({
        agent_id: agentId,
        fraud_type: 'RATING_PATTERN',
        severity: 'MEDIUM',
        details: {
          message: 'Suspicious pattern of extreme ratings',
          total: stats.total,
          extreme_ratings: stats.extremeRatings,
          extreme_percentage: stats.extremePercentage.toFixed(2),
        },
      });

      return { isFraud: true };
    }

    return { isFraud: false };
  }

  /**
   * Calculates feedback weight based on previous feedbacks from same consumer
   * Formula: weight = 1.0 / (1 + log(1 + count))
   */
  async calculateFeedbackWeight(consumerId: string, agentId: string): Promise<number> {
    if (!this.isProductionMode()) {
      return 1.0;
    }

    const count = await this.feedbackRepo.countByConsumerAndAgent(consumerId, agentId);

    if (count === 0) {
      return 1.0;
    }

    const weight = 1.0 / (1 + Math.log(1 + count));
    return Math.max(0.1, weight);
  }

  /**
   * Complete fraud analysis for feedback
   */
  async analyzeFeedback(consumerId: string, agentId: string): Promise<{
    totalWeight: number;
    fraudDetected: boolean;
    shouldBlock: boolean;
  }> {
    if (!this.isProductionMode()) {
      return {
        totalWeight: 1.0,
        fraudDetected: false,
        shouldBlock: false,
      };
    }

    const selfRating = await this.detectSelfRating(consumerId, agentId);

    const spam = await this.detectSpam(consumerId, agentId);
    if (spam.isFraud) {
      return {
        totalWeight: 0,
        fraudDetected: true,
        shouldBlock: true,
      };
    }

    const decreasingWeight = await this.calculateFeedbackWeight(consumerId, agentId);

    let totalWeight = selfRating.weight * decreasingWeight;

    await this.detectRatingPatterns(agentId);

    return {
      totalWeight,
      fraudDetected: selfRating.isFraud,
      shouldBlock: false,
    };
  }

  /**
   * Calculates fraud percentage for an agent
   */
  async calculateFraudPercentage(agentId: string): Promise<number> {
    if (!this.isProductionMode()) {
      return 0;
    }

    const fraudStats = await this.feedbackRepo.getFraudStats(agentId);
    const totalFraudCount = await this.fraudRepo.getTotalFraudCount(agentId);

    if (fraudStats.total === 0) {
      return 0;
    }

    const fraudPercentage = (totalFraudCount / fraudStats.total) * 100;
    return Math.min(100, fraudPercentage);
  }
}
