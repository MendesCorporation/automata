import { AgentRepository } from '../repositories/agent.repository.js';
import { StatsRepository } from '../repositories/stats.repository.js';
import { FraudDetectionService } from './fraud-detection.service.js';
import { SearchAgentRequest, SearchAgentResponse, AgentWithScore, Agent } from '../types/agent.types.js';

export class SearchService {
  private agentRepo: AgentRepository;
  private statsRepo: StatsRepository;
  private fraudService: FraudDetectionService;
  private debug: boolean;

  constructor() {
    this.agentRepo = new AgentRepository();
    this.statsRepo = new StatsRepository();
    this.fraudService = new FraudDetectionService();
    this.debug = process.env.SEARCH_DEBUG === 'true';
  }

  private logDebug(message: string, data?: any) {
    if (!this.debug) return;
    if (data !== undefined) {
      console.log(`[search:debug] ${message}`, data);
    } else {
      console.log(`[search:debug] ${message}`);
    }
  }

  async search(request: SearchAgentRequest): Promise<SearchAgentResponse[]> {
    // Normaliza location quando vier como string "null"/"undefined"/"none"
    const normalizedLocation = (() => {
      if (!request.location) return undefined;
      const lower = String(request.location).toLowerCase();
      if (lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a') {
        return undefined;
      }
      return request.location;
    })();

    const normalizedRequest: SearchAgentRequest = { ...request, location: normalizedLocation };

    this.logDebug('Incoming search request', normalizedRequest);

    this.validateRequest(normalizedRequest);

    let agents = await this.agentRepo.search({
      intent: normalizedRequest.intent,
      categories: normalizedRequest.categories,
      language: normalizedRequest.language,
    });

    if (agents.length === 0 && normalizedRequest.intent) {
      agents = await this.agentRepo.search({
        intent: normalizedRequest.intent,
        language: normalizedRequest.language,
      });
    }

    // Fuzzy intent search using trigram index if still empty
    if (agents.length === 0 && request.intent) {
      // If intent is an array, use the first intent for fuzzy search
      const intentForFuzzy = Array.isArray(request.intent) ? request.intent[0] : request.intent;
      const fuzzy = await this.agentRepo.searchByIntentFuzzy(intentForFuzzy, request.limit || 50);
      agents = fuzzy;
    }

    if (agents.length === 0) {
      agents = await this.agentRepo.findAll();
    }

    this.logDebug(`Agents fetched from DB: ${agents.length}`);

    if (agents.length === 0) {
      return [];
    }

    const activeAgents = agents.filter((agent) => agent.status !== 'banned');
    this.logDebug(`Active agents (not banned): ${activeAgents.length}`);

    const agentsWithStats = await Promise.all(
      activeAgents.map(async (agent) => {
        const stats = await this.statsRepo.findByAgentId(agent.id);
        return { ...agent, stats: stats || undefined, score: 0 };
      })
    );

    const agentsWithScores = await Promise.all(
      agentsWithStats.map(async (agent) => {
        const scored = await this.calculateScore(agent, request);
        if (this.debug) {
          this.logDebug('Score breakdown', {
            agent: agent.id,
            score: scored.score,
          });
        }
        return scored;
      })
    );

    const filteredAgents = agentsWithScores.filter((agent) => {
      const hasMinScore = agent.score >= 0.4;
      const hasMinGeo =
        !normalizedLocation ||
        agent.location_scope === 'Global' ||
        this.calculateGeoScore(agent.location_scope, normalizedLocation) >= 0.3;
      return hasMinScore && hasMinGeo;
    });

    if (this.debug) {
      this.logDebug('Filtered agents after score/geo', {
        total: filteredAgents.length,
        ids: filteredAgents.map((a) => ({ id: a.id, score: a.score })),
      });
    }

    if (filteredAgents.length === 0) {
      return [];
    }

    const limit = Math.min(request.limit || 10, 10);
    filteredAgents.sort((a, b) => b.score - a.score);
    const topAgents = filteredAgents.slice(0, limit);

    return topAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      caller_id: agent.caller_id,
      endpoint: agent.endpoint,
      description: agent.description,
      tags: agent.tags,
      intents: agent.intents,
      tasks: agent.tasks || [],
      categories: agent.categories,
      location_scope: agent.location_scope,
      score: Math.round(agent.score * 100) / 100,
      input_schema: agent.input_schema,
    }));
  }

  private async calculateScore(
    agent: AgentWithScore,
    request: SearchAgentRequest
  ): Promise<AgentWithScore> {
    // Calculate individual scores for ranking algorithm
    const intentScore = this.calculateIntentScore(agent.intents, request.intent);

    const descriptionScore = this.calculateDescriptionScore(
      agent,
      request.description
    );

    const geoScore = this.calculateGeoScore(agent.location_scope, request.location);
    const categoryScore = this.calculateCategoryScore(agent.categories, request.categories);
    const tagScore = this.calculateTagScore(agent.tags, request.tags || []);

    let successRate = 0;
    let ratingScore = 0;
    let latencyScore = 0;

    if (agent.stats && agent.stats.calls_total > 0) {
      successRate = agent.stats.calls_success / agent.stats.calls_total;
      ratingScore = agent.stats.avg_rating;
      latencyScore = this.calculateLatencyScore(agent.stats.avg_latency_ms);
    }

    const fraudPercentage = await this.fraudService.calculateFraudPercentage(agent.id);
    const fraudScore = 1.0 - (fraudPercentage / 100);

    let finalScore =
      intentScore * 0.25 +
      descriptionScore * 0.10 +
      categoryScore * 0.10 +
      geoScore * 0.20 +
      successRate * 0.14 +
      ratingScore * 0.09 +
      tagScore * 0.07 +
      latencyScore * 0.03 +
      fraudScore * 0.04;

    if (agent.status === 'quarantine') {
      finalScore = Math.max(0, finalScore - 0.3);
    }

    if (this.debug) {
      this.logDebug('Score components', {
        agent: agent.id,
        intentScore,
        descriptionScore,
        categoryScore,
        geoScore,
        successRate,
        ratingScore,
        tagScore,
        latencyScore,
        fraudScore,
        finalScore,
        status: agent.status,
      });
    }

    return {
      ...agent,
      score: finalScore,
    };
  }

  private calculateDescriptionScore(agent: Agent, requestDescription?: string): number {
    if (!requestDescription || requestDescription.trim() === '') {
      return 0.5;
    }

    const tokens = this.tokenize(requestDescription);
    if (tokens.size === 0) return 0.0;

    const agentTokens = new Set<string>([
      ...this.tokenize(agent.description),
      ...agent.tags.flatMap((t: string) => Array.from(this.tokenize(t))),
      ...agent.categories.flatMap((c: string) => Array.from(this.tokenize(c))),
    ]);

    let overlap = 0;
    tokens.forEach((t) => {
      if (agentTokens.has(t)) {
        overlap++;
      }
    });

    if (overlap === 0) return 0.0;

    const norm = Math.min(tokens.size, 10);
    return Math.min(1, overlap / norm);
  }

  private calculateIntentScore(agentIntents: string[], searchIntent?: string | string[]): number {
    if (!searchIntent) {
      return 0.5; // No intent specified, medium score
    }

    // Normalize to array
    const searchIntents = Array.isArray(searchIntent) ? searchIntent : [searchIntent];

    // Calculate score for each search intent and get the best
    let bestScore = 0.0;

    for (const singleIntent of searchIntents) {
      // Hierarchical matching
      const hierarchicalScore = this.calculateHierarchicalScore(agentIntents, singleIntent);

      // Trigram fuzzy matching
      const trigramScore = this.calculateTrigramScore(agentIntents, singleIntent);

      // Best between hierarchical and trigram (trigram has 0.85 penalty)
      const intentScore = Math.max(hierarchicalScore, trigramScore * 0.85);

      bestScore = Math.max(bestScore, intentScore);
    }

    return bestScore;
  }

  private calculateHierarchicalScore(agentIntents: string[], searchIntent: string): number {
    // Exact match = 1.0
    if (agentIntents.includes(searchIntent)) {
      return 1.0;
    }

    // Partial match (same parent) = 0.6
    const searchParts = searchIntent.split('.');
    let bestScore = 0.0;

    for (const agentIntent of agentIntents) {
      const agentParts = agentIntent.split('.');

      // Check if they share the same parent (first 2 parts)
      if (searchParts[0] === agentParts[0] && searchParts[1] === agentParts[1]) {
        bestScore = Math.max(bestScore, 0.6);
      }

      // Check if they share the same category (first part)
      if (searchParts[0] === agentParts[0]) {
        bestScore = Math.max(bestScore, 0.3);
      }
    }

    return bestScore;
  }

  private calculateGeoScore(agentLocation: string, searchLocation?: string): number {
    if (!searchLocation || !agentLocation) {
      return agentLocation === 'Global' ? 0.3 : 0.5;
    }

    if (agentLocation === 'Global') {
      return 0.3;
    }

    // Quebra variantes da busca (separadas por vírgula) e partes do agentLocation
    const searchVariants = searchLocation
      .split(/[,/]/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const agentParts = agentLocation
      .split(/[,/]/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    if (searchVariants.length === 0 || agentParts.length === 0) {
      return 0.2;
    }

    // Hierarquia: city > state > country (assumindo ordem: cidade, estado/UF, país)
    const agentCity = agentParts[0];
    const agentState = agentParts[1];
    const agentCountry = agentParts[agentParts.length - 1]; // última parte como país

    let best = 0.2;
    for (const variant of searchVariants) {
      if (variant === agentCity) {
        best = Math.max(best, 1.0);
      } else if (agentState && (variant === agentState || agentState.includes(variant) || variant.includes(agentState))) {
        best = Math.max(best, 0.6);
      } else if (variant === agentCountry || agentCountry.includes(variant) || variant.includes(agentCountry)) {
        best = Math.max(best, 0.3);
      }
    }

    return best;
  }

  private calculateCategoryScore(
    agentCategories: string[],
    searchCategories: string[]
  ): number {
    return this.calculateListSimilarity(agentCategories, searchCategories);
  }

  private calculateTagScore(agentTags: string[], searchTags: string[]): number {
    return this.calculateListSimilarity(agentTags, searchTags);
  }

  private calculateLatencyScore(avgLatencyMs: number): number {
    if (avgLatencyMs <= 500) {
      return 1.0;
    } else if (avgLatencyMs <= 1500) {
      return 0.7;
    } else if (avgLatencyMs <= 3000) {
      return 0.4;
    } else {
      return 0.2;
    }
  }

  private validateRequest(request: SearchAgentRequest): void {
    if (!request.categories || request.categories.length === 0) {
      throw new Error('Field "categories" must contain at least one category');
    }
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/[^a-zA-Z0-9\u00C0-\u017F]+/)
        .filter((t) => t.length >= 3)
    );
  }

  // Trigram fuzzy matching methods
  private calculateTrigramScore(agentIntents: string[], searchIntent: string): number {
    if (!searchIntent || !agentIntents || agentIntents.length === 0) {
      return 0.0;
    }

    let maxSimilarity = 0.0;

    for (const agentIntent of agentIntents) {
      const similarity = this.calculateStringSimilarity(searchIntent, agentIntent);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    // Keep it modest so it complements discrete matching
    return Math.min(maxSimilarity, 1.0);
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    // Tokenize and normalize
    const tokens1 = str1.toLowerCase().split(/[.\s_-]+/).filter((t) => t.length > 2);
    const tokens2 = str2.toLowerCase().split(/[.\s_-]+/).filter((t) => t.length > 2);

    if (tokens1.length === 0 || tokens2.length === 0) {
      return 0.0;
    }

    // Jaccard similarity between tokens
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    const jaccardScore = union.size > 0 ? intersection.size / union.size : 0;

    // Bonus for trigram similarity across tokens
    let trigramBonus = 0.0;
    for (const t1 of tokens1) {
      for (const t2 of tokens2) {
        if (t1 !== t2) {
          const trigrams1 = this.getTrigrams(t1);
          const trigrams2 = this.getTrigrams(t2);
          const trigramSim = this.trigramSimilarity(trigrams1, trigrams2);
          trigramBonus = Math.max(trigramBonus, trigramSim * 0.3); // cap bonus
        }
      }
    }

    return Math.min(jaccardScore + trigramBonus, 1.0);
  }

  private getTrigrams(str: string): Set<string> {
    const trigrams = new Set<string>();
    const padded = `  ${str} `;

    for (let i = 0; i < padded.length - 2; i++) {
      trigrams.add(padded.substring(i, i + 3));
    }

    return trigrams;
  }

  private trigramSimilarity(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0.0;
  }

  private calculateListSimilarity(agentList: string[], searchList: string[]): number {
    if (!searchList || searchList.length === 0) {
      return 1.0;
    }
    if (!agentList || agentList.length === 0) {
      return 0.0;
    }

    const agentTokens = agentList.flatMap((item) => Array.from(this.tokenize(item)));
    const searchTokens = searchList.flatMap((item) => Array.from(this.tokenize(item)));

    if (searchTokens.length === 0) {
      return 0.5;
    }

    let matches = 0;
    for (const searchToken of searchTokens) {
      const hit = agentTokens.some(
        (agentToken) =>
          agentToken === searchToken ||
          agentToken.includes(searchToken) ||
          searchToken.includes(agentToken)
      );
      if (hit) {
        matches++;
      }
    }

    return matches / searchTokens.length;
  }
}
