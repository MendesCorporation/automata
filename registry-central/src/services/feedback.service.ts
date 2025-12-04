import { AgentRepository } from '../repositories/agent.repository.js';
import { StatsRepository } from '../repositories/stats.repository.js';
import { FeedbackRepository } from '../repositories/feedback.repository.js';
import { FraudDetectionService } from './fraud-detection.service.js';
import { FeedbackRequest } from '../types/agent.types.js';

export class FeedbackService {
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

  async submitFeedback(request: FeedbackRequest & { consumer_id: string }): Promise<{ success: true }> {
    this.validateRequest(request);

    // Rate limit: max 60 feedbacks por minuto por caller/consumer
    const recentCount = await this.feedbackRepo.countRecentByConsumer(request.consumer_id, 1);
    if (recentCount >= 60) {
      throw new Error('Feedback rate limit exceeded: max 60 per minute');
    }

    const agent = await this.agentRepo.findById(request.agent_id);
    if (!agent) {
      throw new Error(`Agent with id "${request.agent_id}" not found`);
    }

    const fraudAnalysis = await this.fraudService.analyzeFeedback(
      request.consumer_id,
      request.agent_id
    );

    if (fraudAnalysis.shouldBlock) {
      throw new Error('Feedback blocked: spam detected');
    }

    await this.feedbackRepo.create({
      agent_id: request.agent_id,
      consumer_id: request.consumer_id,
      success: request.success,
      latency_ms: request.latency_ms,
      rating: request.rating,
    });

    await this.statsRepo.incrementFeedbackWeighted(
      request.agent_id,
      request.success,
      request.latency_ms,
      request.rating,
      fraudAnalysis.totalWeight
    );

    return { success: true };
  }

  private validateRequest(request: FeedbackRequest): void {
    if (!request.agent_id || request.agent_id.trim() === '') {
      throw new Error('Field "agent_id" is required');
    }
    if (typeof request.success !== 'boolean') {
      throw new Error('Field "success" must be a boolean');
    }
    if (typeof request.latency_ms !== 'number' || request.latency_ms < 0) {
      throw new Error('Field "latency_ms" must be a non-negative number');
    }
    if (typeof request.rating !== 'number' || request.rating < 0 || request.rating > 1) {
      throw new Error('Field "rating" must be a number between 0 and 1');
    }
  }
}
