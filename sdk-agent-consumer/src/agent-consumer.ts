import {
  AgentConsumerConfig,
  SearchRequest,
  AgentInfo,
  ExecuteRequest,
  ExecuteResponse,
  FeedbackData,
} from './types.js';
import { LLMService } from './llm-service.js';

type EnrichedExecuteResponse = ExecuteResponse & {
  _latency?: number;
  _missingFields?: string[];
  _skipped?: boolean;
  _taskSent?: string;
};

interface ConversationMemory {
  userRequest: string;
  intent: string;
  timestamp: Date;
  agentResponses: Array<{
    agentId: string;
    agentName: string;
    endpoint?: string;
    executionKey?: string;
    response: any;
    success: boolean;
    skipped?: boolean;
  }>;
  interpretation?: string;
  skippedAgents?: Array<{
    agentId: string;
    agentName: string;
    endpoint: string;
    executionKey?: string;
    missingFields: string[];
    reason: string;
  }>;
}

export class AgentConsumer {
  private registryUrl: string;
  private llmService: LLMService;
  private memory: ConversationMemory[] = [];
  private userLanguage: string = 'en-US';
  private registryToken?: string; // JWT token for registry authentication
  private clientId: string;
  private agentCache: Map<string, AgentInfo> = new Map();
  private pendingAgents: Map<string, { agent: AgentInfo; missingFields: string[]; lastAttempt: Date }> = new Map();

  constructor(config: AgentConsumerConfig) {
    const isProd = process.env.NODE_ENV === 'production';
    this.registryUrl =
      config.registryUrl ||
      process.env.REGISTRY_URL ||
      (isProd ? 'https://automata.apptrixcloud.com' : 'https://automata-dev.apptrixcloud.com');

    this.clientId = process.env.CLIENT_ID || 'consumer-cli';

    // LLM is now required
    this.llmService = new LLMService(config.llm);

    this.userLanguage = config.userLanguage || 'en-US';
  }

  /**
   * Authenticate with Registry and get JWT token (auto caller_id)
   */
  async authenticate(): Promise<void> {
    const response = await fetch(`${this.registryUrl}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': this.clientId, // stable identifier to avoid caller_id collision
      },
      body: JSON.stringify({ type: 'consumer' }),
    });

    if (!response.ok) {
      const errorData = await response.json() as any;
      throw new Error(`Authentication failed: ${errorData.error || response.statusText}`);
    }

    const result = await response.json() as any;
    this.registryToken = result.token;
    console.log('Authenticated with Registry (consumer)');
  }

  getSystemPrompt(): string {
    return 'You are an assistant that extracts structured information from user requests. Return ONLY valid JSON, without markdown or explanations. Use dot-notation for intents like: development.agency.estimation, food.restaurant.search, booking.hotel.estimation. Include location fields when present (city, state, country). Categories must be specific to the intent (e.g., booking + hotel.estimation for hotel quotes; travel.booking; food.restaurant.search). Never return generic development categories unless the request is clearly about software.';
  }

  private sanitizeModelJSON(content: string): string {
    let text = content.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/```json\s*/i, '').replace(/```/g, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/```\s*/g, '');
    }
    return text.trim();
  }

  // ==================== MEMORY MODULE ====================

  addToMemory(entry: ConversationMemory): void {
    this.memory.push(entry);
    // Keep only last 10 conversations
    if (this.memory.length > 10) {
      this.memory.shift();
    }
  }

  getMemory(): ConversationMemory[] {
    return this.memory;
  }

  getRecentContext(limit: number = 3): string {
    const recent = this.memory.slice(-limit);
    if (recent.length === 0) return '';

    return recent.map(entry =>
      `User asked: "${entry.userRequest}" (intent: ${entry.intent}). Got ${entry.agentResponses.length} responses${entry.skippedAgents && entry.skippedAgents.length > 0 ? `, skipped ${entry.skippedAgents.length} agents (missing data)` : ''}.`
    ).join('\n');
  }

  clearMemory(): void {
    this.memory = [];
    this.pendingAgents.clear();
    this.agentCache.clear();
  }

  cacheAgents(agents: AgentInfo[]): void {
    agents.forEach((agent) => this.agentCache.set(agent.id, agent));
  }

  rememberPendingAgent(agent: AgentInfo, missingFields: string[]): void {
    this.pendingAgents.set(agent.id, { agent, missingFields, lastAttempt: new Date() });
  }

  resolvePendingAgent(agentId: string): void {
    this.pendingAgents.delete(agentId);
  }

  getPendingAgents(): Array<{ agentId: string; agentName: string; endpoint: string; executionKey?: string; missingFields: string[]; lastAttempt: Date }> {
    return Array.from(this.pendingAgents.values()).map(({ agent, missingFields, lastAttempt }) => ({
      agentId: agent.id,
      agentName: agent.name,
      endpoint: agent.endpoint,
      executionKey: agent.execution_key,
      missingFields,
      lastAttempt,
    }));
  }

  // ==================== RESPONSE INTERPRETER MODULE ====================

  async interpretResponses(
    userRequest: string,
    agentResponses: Array<{ agentId?: string; agentName: string; response: any; success: boolean }>,
    intent: string
  ): Promise<{ message: string; agentRatings: Record<string, number> }> {
    const context = this.getRecentContext(2);

    const interpretationPrompt = this.buildInterpretationPrompt(
      userRequest,
      agentResponses,
      intent,
      context,
      this.userLanguage
    );

    const result = await this.llmService.complete([
      {
        role: 'system',
        content: this.getInterpreterSystemPrompt(this.userLanguage)
      },
      {
        role: 'user',
        content: interpretationPrompt
      },
    ]);

    const sanitized = this.sanitizeModelJSON(result.content);
    try {
      const parsed = JSON.parse(sanitized);
      const message = parsed.response || parsed.message || result.content;
      const ratingsArray = parsed.agent_ratings || parsed.agentRatings || [];
      const agentRatings: Record<string, number> = {};
      if (Array.isArray(ratingsArray)) {
        ratingsArray.forEach((item: any) => {
          const key = item?.agentId || item?.agentName;
          const val = typeof item?.relevance === 'number' ? item.relevance : item?.rating;
          if (key && typeof val === 'number') {
            agentRatings[String(key)] = Math.max(0, Math.min(1, val));
          }
        });
      }
      return { message, agentRatings };
    } catch {
      return { message: result.content, agentRatings: {} };
    }
  }

  private getInterpreterSystemPrompt(language: string): string {
    return `You are a helpful assistant that interprets technical responses from multiple agents and presents them to the user in a clear, natural, and friendly way in ${language}. Be conversational, objective, and helpful. Compare options when there are multiple responses. Highlight important differences. Always return JSON:
{
  "response": "final message for the user in ${language}",
  "agent_ratings": [
    { "agentName": "<name or id>", "relevance": 0.0-1.0 }
  ]
}
Relevance = how well the agent answers the user's request (0 = irrelevant/failure, 1 = perfect).`;
  }

  private buildInterpretationPrompt(
    userRequest: string,
    agentResponses: Array<{ agentId?: string; agentName: string; response: any; success: boolean }>,
    intent: string,
    context: string,
    language: string
  ): string {
    const instruction = `Respond in ${language} in a natural and conversational way.`;

    let prompt = `${instruction}\n\n`;

    if (context) {
      prompt += `CONTEXT (previous interactions):\n${context}\n\n`;
    }

    prompt += `USER REQUEST:\n"${userRequest}"\n\n`;
    prompt += `INTENT: ${intent}\n\n`;
    prompt += `AGENT RESPONSES (${agentResponses.length} total):\n\n`;

    agentResponses.forEach((agentResp, index) => {
      prompt += `--- AGENT ${index + 1}: ${agentResp.agentName} ---\n`;

      if (!agentResp.success) {
        prompt += `Status: FAILED\n`;
        prompt += `Error: ${agentResp.response.error || 'Unknown error'}\n\n`;
      } else {
        prompt += `Status: SUCCESS\n`;
        prompt += `Response: ${JSON.stringify(agentResp.response, null, 2)}\n\n`;
      }
    });

    prompt += `\nYour tasks:\n`;
    prompt += `1. Analyze all agent responses\n`;
    prompt += `2. Compare them if there are multiple successful responses\n`;
    prompt += `3. Present a clear, natural language summary to the user\n`;
    prompt += `4. If it's a quote/estimation, highlight prices, timelines, and key differences\n`;
    prompt += `5. If it's a booking, highlight options, prices, and recommendations\n`;
    prompt += `6. Be helpful and conversational\n`;
    prompt += `7. If any agent failed, mention it briefly but focus on successful responses\n`;
    prompt += `8. For each agent, assign a relevance score 0.0-1.0 indicating how well the response satisfies the user's request (0 = irrelevant or failed, 1 = perfect).\n\n`;
    prompt += `Return ONLY JSON with fields "response" (final message) and "agent_ratings" (array of {agentName, relevance}).`;

    return prompt;
  }

  async analyzePrompt(userPrompt: string): Promise<any> {
    const analysisPrompt = `
Analyze the following user request and extract structured information:

"${userPrompt}"

Return a JSON with this exact structure:
{
  "intents": ["array of 2-3 intent alternatives using dot notation - IMPORTANT: if user mentions a specific brand/company name (like Carrefour, Apple, Microsoft, Outback, etc), ALWAYS include a brand-specific intent using format 'brand.{company}' (ex: brand.carrefour, brand.apple, brand.microsoft)"],
  "description": "project description in one sentence",
  "features": ["list", "of", "identified", "features"],
  "keywords": ["technical", "keywords"],
  "location": "primary normalized location (city/state/country or region). Always include common aliases in the SAME comma-separated string (e.g., \"United States,USA,Estados Unidos\"; \"Sao Paulo,SP,Sao Paulo,Brazil\"). If unclear, use \"Global\".",
  "language": "language code if specified (ex: pt-BR, en-US) or null",
  "categories": ["domain categories aligned to the intent, e.g., booking, hotel.estimation"],
  "tags": ["relevant", "tags"]
}

IMPORTANT RULES:
1. Generate 2-3 alternative intents to improve matching (e.g., ["food.supermarket.price.search", "food.market.price", "grocery.price.quote"])
2. If user mentions a specific establishment/brand name (Carrefour, Zona Sul, Atacadao, Apple, Microsoft, Outback, etc.), ALWAYS include a brand-specific intent: "brand.{company}" (normalized lowercase, no spaces)
3. Normalize country names when provided: Estados Unidos/USA/United States -> United States; Brasil/Brazil -> Brazil; Reino Unido/UK/United Kingdom -> United Kingdom; Canada/Canada -> Canada; France/France -> France
3. Examples:
   - "preco da banana no Carrefour" -> ["food.supermarket.price.search", "food.market.price", "brand.carrefour"]
   - "comprar no Atacadao" -> ["grocery.shopping", "food.supermarket.search", "brand.atacadao"]
   - "restaurante Outback" -> ["food.restaurant.search", "restaurant.booking", "brand.outback"]

Be specific and extract as many details as possible.
`;

    const result = await this.llmService.complete([
      { role: 'system', content: this.getSystemPrompt() },
      { role: 'user', content: analysisPrompt },
    ]);

    const content = this.sanitizeModelJSON(result.content);
    const parsed = JSON.parse(content);

    // Backward compatibility: if "intent" field exists (old format), convert to array
    if (parsed.intent && !parsed.intents) {
      parsed.intents = [parsed.intent];
    }

    return parsed;
  }

  /**
   * Validates if agents are semantically relevant to the user request
   * AND selects the appropriate task for each agent (unified LLM call)
   * Returns filtered list with only truly relevant agents, each with selectedTask property
   * NOTE: Does NOT use conversation context - only structured analysis data
   */
  async validateAgentRelevance(
    agents: AgentInfo[],
    analysis: any
  ): Promise<AgentInfo[]> {
    if (agents.length === 0) {
      return agents;
    }

    // Filtro prioritÃ¡rio por intents/tags de marca
    const brandIntents: string[] = [];
    const collectBrand = (val?: string) => {
      if (val && typeof val === 'string' && val.startsWith('brand.')) {
        brandIntents.push(val);
      }
    };
    const intentsArray = Array.isArray(analysis?.intents)
      ? analysis.intents
      : analysis?.intent
        ? [analysis.intent]
        : [];
    intentsArray.forEach(collectBrand);
    if (Array.isArray(analysis?.tags)) {
      analysis.tags.forEach(collectBrand);
    }

    if (brandIntents.length > 0) {
      const brandNames = brandIntents.map((b) => b.split('.').slice(1).join('.').toLowerCase());
      const filteredByBrand = agents.filter((a) =>
        (a.intents && a.intents.some((i) => brandIntents.includes(i))) ||
        (a.tags && a.tags.some((t) => brandNames.includes(t.toLowerCase())))
      );
      if (filteredByBrand.length > 0) {
        agents = filteredByBrand;
      }
    }

    const structuredRequest = {
      intents: analysis.intents || [analysis.intent],
      description: analysis.description,
      location: analysis.location,
      categories: analysis.categories,
      features: analysis.features || [],
    };

    const validationPrompt = `
You are a validator and task selector. For each agent, determine if it's relevant AND select the appropriate task.

IMPORTANT: Base your validation ONLY on the structured information below. Do NOT consider conversational context or references like "the same" or "again".

REQUEST DETAILS:
${JSON.stringify(structuredRequest, null, 2)}

AVAILABLE AGENTS:
${agents.map((a, i) => `
${i + 1}. ${a.name}
   ID: ${a.id}
   Description: ${a.description}
   Location: ${a.location_scope}
   Intents: ${a.intents.join(', ')}
   Tasks: ${(a.tasks || []).join(', ') || 'none specified'}
   Categories: ${a.categories.join(', ')}
`).join('\n')}

APPROVAL GUIDELINES (be permissive):
1. Geographic: If request.location is set, prefer agents that include that location OR are "Global". If ambiguous, accept.
2. Intent: Accept if agent intents match ANY of the request intents OR share the same prefix (e.g., development.*, booking.*, food.*, brand.*).
3. Service: If categories or description mention the requested domain, accept.
4. Task Selection: For each approved agent, select the MOST APPROPRIATE task from its available tasks that best fulfills the user request. Consider the request intents and description.

Return ONLY JSON:
{
  "agents": [
    {
      "agent_id": "agent-id-1",
      "selected_task": "task_name",
      "reason": "brief reason for task selection"
    }
  ]
}

If absolutely NONE can fulfill it, return:
{"agents": [], "reason": "brief explanation why"}

IMPORTANT: Only include agents that are relevant. For each agent, you MUST select one task from its available tasks.
`;

    try {
      const result = await this.llmService.complete([
        {
          role: 'system',
          content: 'You are a validator and task selector. Return ONLY valid JSON. Approve agents that are reasonably capable of fulfilling the request and select appropriate tasks.'
        },
        { role: 'user', content: validationPrompt },
      ]);

      const validation = JSON.parse(this.sanitizeModelJSON(result.content));

      if (!validation.agents || validation.agents.length === 0) {
        console.log('AI Validation: No relevant agents found');
        if (validation.reason) {
          console.log(`Reason: ${validation.reason}`);
        }
        return [];
      }

      // Build map of agent_id -> selected_task
      const taskMap = new Map<string, string>();
      validation.agents.forEach((item: any) => {
        if (item.agent_id && item.selected_task) {
          taskMap.set(item.agent_id, item.selected_task);
        }
      });

      // Filter agents and add selectedTask property
      const filtered = agents
        .filter(a => taskMap.has(a.id))
        .map(a => ({
          ...a,
          selectedTask: taskMap.get(a.id)!,
        }));

      if (filtered.length < agents.length) {
        console.log(`AI Validation: Filtered ${agents.length - filtered.length} irrelevant agents`);
      }

      console.log(`AI Validation: ${filtered.length} agents approved with tasks selected`);
      filtered.forEach(a => {
        console.log(`   - ${a.name}: task="${a.selectedTask}"`);
      });

      return filtered;

    } catch (error: any) {
      console.warn('Validation error, proceeding with all agents (no task selection):', error.message);
      return agents;
    }
  }

  async executeMultipleWithFeedback(
    agents: AgentInfo[],
    request: ExecuteRequest,
    context?: { userPrompt?: string; analysis?: any }
  ): Promise<EnrichedExecuteResponse[]> {
    const selected = agents.slice(0, Math.min(10, agents.length));
    this.cacheAgents(selected);

    const responses: EnrichedExecuteResponse[] = [];
    const fallbackTask = request.task || context?.analysis?.intents?.[0] || context?.analysis?.intent || selected[0]?.intents?.[0] || 'execute';

    for (const agent of selected) {
      const startTime = Date.now();

      // Use selectedTask from validateAgentRelevance if available, otherwise use fallback
      const taskToSend = agent.selectedTask || fallbackTask;

      let missingFields: string[] = [];
      let validationErrors: string[] = [];
      let preparedRequest: ExecuteRequest = { ...request, task: taskToSend };

      if (agent.input_schema) {
        const built = await this.buildParamsForAgent(
          agent,
          context?.userPrompt || '',
          context?.analysis,
          request.params || {}
        );

        missingFields = built.missingFields;
        validationErrors = built.validationErrors;
        preparedRequest = {
          ...request,
          params: built.params,
          task: taskToSend,
        };
      }

      if (agent.input_schema && (missingFields.length > 0 || validationErrors.length > 0)) {
        const latency = Date.now() - startTime;
        const reasonParts: string[] = [];
        if (missingFields.length > 0) {
          reasonParts.push(`missing fields: ${missingFields.join(', ')}`);
        }
        if (validationErrors.length > 0) {
          reasonParts.push(`validation errors: ${validationErrors.join('; ')}`);
        }
        const reasonText = reasonParts.join(' | ') || 'input schema validation failed';

        this.rememberPendingAgent(agent, missingFields.length > 0 ? missingFields : validationErrors);

        responses.push({
          success: false,
          error: `Skipped agent ${agent.name}: ${reasonText}. Provide the missing information and try again.`,
          _latency: latency,
          _skipped: true,
          _missingFields: missingFields,
          _taskSent: taskToSend,
        } as any);
        continue;
      }

      const result = await this.execute(agent.endpoint, preparedRequest, agent.execution_key, agent.input_schema);
      (result as any)._latency = Date.now() - startTime;
      (result as any)._taskSent = taskToSend;
      if (result.success) {
        this.resolvePendingAgent(agent.id);
      }

      responses.push(result);
    }

    // Interpret to get final message and agent relevance scores
    const agentResponsesForInterpretation = responses.map((res, index) => {
      const missingFields = (res as any)._missingFields;
      return {
        agentId: selected[index].id,
        agentName: selected[index].name,
        response: res.success ? res.data : { error: res.error, missingFields },
        success: res.success,
      };
    });

    let interpretation: { message: string; agentRatings: Record<string, number> } = { message: '', agentRatings: {} };
    try {
      interpretation = await this.interpretResponses(
        context?.userPrompt || request.task || '',
        agentResponsesForInterpretation,
        context?.analysis?.intents?.[0] || context?.analysis?.intent || request.task || ''
      );
    } catch (error: any) {
      console.warn('Interpretation failed:', error.message);
    }

    // Send feedback blending LLM relevance + heuristics
    for (let i = 0; i < selected.length; i++) {
      const agent = selected[i];
      const res = responses[i];
      const llmScore =
        interpretation.agentRatings[agent.id] ??
        interpretation.agentRatings[agent.name] ??
        undefined;
      const rating = this.computeFeedbackRating(res as EnrichedExecuteResponse, llmScore);

      try {
        await this.sendFeedback({
          agentId: agent.id,
          success: res.success,
          latencyMs: res._latency || 0,
          rating,
        });
      } catch (err: any) {
        console.warn(`Failed to send feedback for ${agent.name}: ${err.message}`);
      }
    }

    (responses as any)._interpretation = interpretation.message;
    return responses;
  }

  filterRelevantAgents(
    agents: AgentInfo[],
    criteria: Partial<SearchRequest> & { intent?: string; description?: string }
  ): AgentInfo[] {
    const normalizedLocation = (criteria.location || '').toLowerCase();
    const userCategories = criteria.categories || [];
    const userTags = criteria.tags || [];
    const userDescription = criteria.description || '';

    return agents.filter((agent) => {
      const locationScore = this.locationScore(normalizedLocation, agent.location_scope);
      const categoryScore = this.overlapScore(userCategories, agent.categories);
      const tagScore = this.overlapScore(userTags, agent.tags);
      const descriptionScore = this.textOverlapScore(
        userDescription,
        [agent.description, agent.tags?.join(' '), agent.categories?.join(' ')]
      );

      const fit =
        locationScore * 0.20 +
        categoryScore * 0.35 +
        tagScore * 0.10 +
        descriptionScore * 0.35;

      return fit >= 0.35;
    });
  }

  deriveCategoriesFromIntent(intent?: string, categories?: string[]): string[] {
    if (categories && categories.length > 0) return categories;
    if (!intent) return ['general'];

    const map: Record<string, string[]> = {
      'booking.hotel.estimation': ['booking', 'hotel.estimation'],
      'booking': ['booking'],
      'travel': ['travel', 'travel.booking'],
      'food.restaurant.search': ['food', 'restaurant.search'],
      'development.agency.estimation': ['development', 'software.estimation'],
    };

    const direct = map[intent];
    if (direct) return direct;

    const prefix = intent.split('.')[0];
    if (map[prefix]) return map[prefix];

    return ['general'];
  }

  async search(request: SearchRequest): Promise<AgentInfo[]> {
    if (!this.registryToken) {
      await this.authenticate();
    }

    const response = await fetch(`${this.registryUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.error || 'Failed to search agents');
    }

    return await response.json() as AgentInfo[];
  }

  private validateInputSchema(schema: Record<string, any>, params: any): { valid: boolean; errors: string[] } {
    // Simple JSON Schema validation (basic implementation)
    const errors: string[] = [];

    if (!schema || !schema.properties) {
      return { valid: true, errors: [] };
    }

    const properties = schema.properties;
    const required = schema.required || [];

    // Check required fields
    for (const field of required) {
      if (!(field in params)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check types (basic validation)
    for (const [key, value] of Object.entries(params)) {
      if (properties[key]) {
        const expectedType = properties[key].type;
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (expectedType && expectedType !== actualType) {
          errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async buildParamsForAgent(
    agent: AgentInfo,
    userPrompt: string,
    analysis?: any,
    baseParams: Record<string, any> = {}
  ): Promise<{ params: Record<string, any>; missingFields: string[]; validationErrors: string[] }> {
    if (!agent.input_schema) {
      return { params: baseParams, missingFields: [], validationErrors: [] };
    }

    // If we do not have natural language context, just validate existing params
    if (!userPrompt && (!analysis || Object.keys(analysis || {}).length === 0)) {
      const validation = this.validateInputSchema(agent.input_schema, baseParams);
      const missing = validation.errors
        .filter((err) => err.startsWith('Missing required field: '))
        .map((err) => err.replace('Missing required field: ', ''));
      const otherErrors = validation.errors.filter((err) => !err.startsWith('Missing required field: '));
      return { params: baseParams, missingFields: missing, validationErrors: otherErrors };
    }

    const schemaText = JSON.stringify(agent.input_schema, null, 2);
    const baseParamsText = JSON.stringify(baseParams || {}, null, 2);
    const analysisText = analysis ? JSON.stringify(analysis, null, 2) : 'null';
    const context = this.getRecentContext(2);
    const previousMissing = this.pendingAgents.get(agent.id)?.missingFields || [];

    const schemaPrompt = `
You are building the params object for an agent call and MUST follow its JSON schema.

Agent: ${agent.name}
Description: ${agent.description}
Intents: ${agent.intents?.join(', ') || 'n/d'}
Categories: ${agent.categories?.join(', ') || 'n/d'}
Tags: ${agent.tags?.join(', ') || 'n/d'}

JSON Schema:
${schemaText}

User request:
"${userPrompt}"

Structured analysis:
${analysisText}

Existing params from caller (use if still valid):
${baseParamsText}

Previous missing fields for this agent: ${previousMissing.length > 0 ? previousMissing.join(', ') : 'none'}
Recent context: ${context || 'none'}

Rules:
- Respect the schema types and required fields.
- Only fill fields you can infer confidently from the request/analysis.
- If a required field is missing or uncertain, DO NOT invent it; leave it out of params and list it in missing_fields.
- Keep values concise (no markdown or explanations).

Return ONLY valid JSON:
{
  "params": { ...object matching the schema... },
  "missing_fields": ["field1", "field2"]
}
`;

    let params: Record<string, any> = baseParams || {};
    let missingFields: string[] = [];

    try {
      const result = await this.llmService.complete([
        {
          role: 'system',
          content: 'You convert user intent into parameters that respect a JSON Schema. Always answer with JSON only.',
        },
        {
          role: 'user',
          content: schemaPrompt,
        },
      ]);

      const content = this.sanitizeModelJSON(result.content);
      const parsed = JSON.parse(content);

      if (parsed && typeof parsed === 'object') {
        if (parsed.params && typeof parsed.params === 'object') {
          params = { ...baseParams, ...parsed.params };
        }
        if (Array.isArray(parsed.missing_fields)) {
          missingFields = parsed.missing_fields.map((f: any) => String(f));
        }
      }
    } catch (error: any) {
      console.warn(`Schema mapping failed for agent ${agent.name}: ${error.message}`);
    }

    const validation = this.validateInputSchema(agent.input_schema, params);
    const schemaMissing = validation.errors
      .filter((err) => err.startsWith('Missing required field: '))
      .map((err) => err.replace('Missing required field: ', ''));
    const otherErrors = validation.errors.filter((err) => !err.startsWith('Missing required field: '));

    // Filtra missing_fields apenas para campos realmente obrigatÃ³rios do schema
    const requiredSet = new Set<string>((agent.input_schema?.required as string[]) || []);
    const filteredMissing = (missingFields || []).filter((f) => requiredSet.has(f));
    const combinedMissing = Array.from(new Set([...(filteredMissing || []), ...schemaMissing]));

    return {
      params,
      missingFields: combinedMissing,
      validationErrors: otherErrors,
    };
  }

  async execute(agentEndpoint: string, request: ExecuteRequest, executionKey?: string, inputSchema?: Record<string, any>): Promise<EnrichedExecuteResponse> {
    const startTime = Date.now();

    // Validate input schema if provided
    if (inputSchema && request.params) {
      const validation = this.validateInputSchema(inputSchema, request.params);
      if (!validation.valid) {
        return {
          success: false,
          error: `Input validation failed: ${validation.errors.join(', ')}`,
          _latency: Date.now() - startTime,
        } as any;
      }
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (executionKey) {
        headers['Authorization'] = `Bearer ${executionKey}`;
      }

      const response = await fetch(`${agentEndpoint}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const rawText = await response.text();
      const latency = Date.now() - startTime;

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        const errorMsg = parsed?.error || rawText || `HTTP ${response.status}`;
        return {
          success: false,
          error: errorMsg,
          _latency: latency,
        } as any;
      }

      if (parsed && typeof parsed === 'object') {
        const summary = this.summarizePayload(parsed);
        return {
          success: true,
          data: {
            summary,
            payload: parsed,
          },
          _latency: latency,
        } as any;
      }

      const cleaned = rawText.replace(/\s+/g, ' ').trim();
      const summary = cleaned
        ? `Agent responded with free text: ${cleaned.slice(0, 280)}${cleaned.length > 280 ? '...' : ''}`
        : 'Empty response from agent.';

      return {
        success: true,
        data: {
          summary,
          rawText,
        },
        _latency: latency,
      } as any;
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        _latency: latency,
      } as any;
    }
  }

  async sendFeedback(feedback: FeedbackData): Promise<void> {
    if (!this.registryToken) {
      await this.authenticate();
    }

    const payload = {
      agent_id: feedback.agentId,
      success: feedback.success,
      latency_ms: feedback.latencyMs,
      rating: feedback.rating,
    };

    try {
      const response = await fetch(`${this.registryUrl}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.registryToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json() as any;
        console.warn('Failed to send feedback:', error.error);
      }
    } catch (error: any) {
      console.warn('Error sending feedback:', error.message);
    }
  }

  async executeWithFeedback(
    agent: AgentInfo,
    request: ExecuteRequest
  ): Promise<EnrichedExecuteResponse> {
    const startTime = Date.now();

    try {
      const result = await this.execute(agent.endpoint, request, agent.execution_key, agent.input_schema);
      const latency = Date.now() - startTime;

      const rating = this.computeFeedbackRating(result);

      await this.sendFeedback({
        agentId: agent.id,
        success: result.success,
        latencyMs: latency,
        rating,
      });

      return result;
    } catch (error: any) {
      const latency = Date.now() - startTime;

      await this.sendFeedback({
        agentId: agent.id,
        success: false,
        latencyMs: latency,
        rating: 0.0,
      });

      throw error;
    }
  }

  private computeFeedbackRating(result: EnrichedExecuteResponse, llmScore?: number): number {
    // If not schema/missing related and failed -> zero
    if (!result.success && !(result as any)._skipped) {
      return 0;
    }

    let rating = result.success ? 1.0 : 0.2;
    const latency = (result as any)._latency || 0;

    if (latency > 8000) rating -= 0.2;
    else if (latency > 4000) rating -= 0.1;

    if ((result as any)._skipped || (result as any)._missingFields?.length) {
      rating -= 0.2;
    }

    const payload = (result as any).data?.payload ?? (result as any).data ?? null;
    const summary = (result as any).data?.summary;
    const textPayload = summary || (payload ? JSON.stringify(payload) : '');

    if (!textPayload || textPayload.length < 50) {
      rating -= 0.2;
    }

    const interestingKeys = ['price', 'total', 'quote', 'checkin', 'checkout', 'city', 'state', 'country', 'guests', 'options', 'room', 'estimate'];
    const lowerPayload = textPayload.toLowerCase();
    if (!interestingKeys.some(k => lowerPayload.includes(k))) {
      rating -= 0.1;
    }

    if (typeof llmScore === 'number' && !Number.isNaN(llmScore)) {
      // Blend with LLM relevance
      rating = (rating + llmScore) / 2;
    }

    return Math.max(0, Math.min(1, rating));
  }

  private summarizePayload(payload: any): string {
    if (payload == null) {
      return 'Empty response from agent.';
    }

    if (typeof payload === 'object' && 'data' in payload && (payload as any).data) {
      return this.summarizePayload((payload as any).data);
    }

    if (Array.isArray(payload)) {
      const preview = payload.slice(0, 3).map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object') return JSON.stringify(item);
        return String(item);
      }).join('; ');
      return `Agent returned a list with ${payload.length} items. Top items: ${preview}`;
    }

    if (typeof payload === 'object') {
      const keys = Object.keys(payload);
      if (keys.length === 0) {
        return 'Agent returned an empty object.';
      }

      const interestingKeys = ['destination', 'location', 'city', 'state', 'country', 'price', 'total', 'currency', 'checkIn', 'checkOut', 'guests', 'options', 'estimate', 'quote', 'contact'];
      const picked = keys.filter(k => interestingKeys.includes(k)).slice(0, 5);
      const contactInfo = this.extractContactInfo(payload);

      if (picked.length > 0) {
        const parts = picked.map(k => `${k}: ${formatValue((payload as any)[k])}`).join('; ');
        const contactText = contactInfo ? ` | Contact: ${contactInfo}` : '';
        return `Agent provided details: ${parts}${contactText}`;
      }

      const preview = keys.slice(0, 5).map(k => `${k}: ${formatValue((payload as any)[k])}`).join('; ');
      const contactText = contactInfo ? ` | Contact: ${contactInfo}` : '';
      return `Agent responded with: ${preview}${contactText}`;
    }

    return `Agent response: ${String(payload)}`;
  }

  private overlapScore(requestList: string[], agentList: string[]): number {
    if (!requestList || requestList.length === 0) return 0.6;
    if (!agentList || agentList.length === 0) return 0.0;
    const lowerReq = requestList.map((t) => t.toLowerCase());
    const lowerAgent = new Set(agentList.map((t) => t.toLowerCase()));
    let matches = 0;
    lowerReq.forEach((item) => {
      if (lowerAgent.has(item)) matches++;
    });
    return matches / requestList.length;
  }

  private locationScore(requestLocation: string, agentLocation: string): number {
    if (!requestLocation) return 0.5;
    if (!agentLocation || agentLocation === 'Global') return 0.4;

    const reqParts = requestLocation.split(/[,/]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const agentParts = agentLocation.toLowerCase().split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    const matches = reqParts.filter((p) =>
      agentParts.some((a) => a === p || a.includes(p) || p.includes(a))
    ).length;

    if (matches === 0) return 0.0;
    return Math.min(1, matches / reqParts.length);
  }

  private textOverlapScore(userText: string, agentTexts: (string | undefined)[]): number {
    if (!userText || userText.trim() === '') return 0.5;
    const userTokens = this.tokenize(userText);
    if (userTokens.size === 0) return 0.0;

    const agentTokens = new Set<string>();
    agentTexts.forEach((txt) => {
      if (txt) {
        this.tokenize(txt).forEach((t) => agentTokens.add(t));
      }
    });

    let overlap = 0;
    userTokens.forEach((t) => {
      if (agentTokens.has(t)) overlap++;
    });

    if (overlap === 0) return 0.0;
    const norm = Math.min(userTokens.size, 12);
    return Math.min(1, overlap / norm);
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u00c0-\u017f]+/)
        .filter((t) => t.length >= 3)
    );
  }

  private extractContactInfo(payload: any): string | null {
    const contact = payload?.contact || payload?.contactUrl || payload?.website || payload?.contact_url;
    if (!contact) return null;

    if (typeof contact === 'string') return contact;
    if (typeof contact === 'object') {
      const parts: string[] = [];
      if (contact.message) parts.push(contact.message);
      if (contact.website) parts.push(contact.website);
      if (contact.url) parts.push(contact.url);
      if (contact.contactUrl) parts.push(contact.contactUrl);
      if (contact.email) parts.push(contact.email);
      if (contact.phone) parts.push(contact.phone);
      return parts.filter(Boolean).join(' | ') || JSON.stringify(contact);
    }
    return String(contact);
  }
}

function formatValue(value: any): string {
  if (value == null) return 'n/d';
  if (Array.isArray(value)) return value.slice(0, 3).map(v => formatValue(v)).join(', ');
  if (typeof value === 'object') return Object.entries(value).slice(0, 3).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ');
  return String(value);
}



