export interface SearchRequest {
  intent?: string | string[]; // Single intent or multiple intents
  categories: string[];
  tags?: string[];
  location?: string;
  language?: string;
  description?: string;
  limit?: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  tags: string[];
  intents: string[];
  tasks: string[]; // Available tasks for this agent
  categories: string[];
  location_scope: string;
  score: number;
  execution_key?: string; // JWT for Consumer -> Provider communication
  key_expires_at?: Date;
  input_schema?: Record<string, any>; // JSON Schema for input validation
  selectedTask?: string; // Task selected by LLM for this agent (used after validation)
}

export interface ExecuteRequest {
  task: string;
  params?: Record<string, any>;
}

export interface ExecuteResponse {
  success: boolean;
  data?: any;
  error?: string;
  _taskSent?: string; // Task that was sent to the agent (for debugging)
  _latency?: number; // Execution latency in ms
  _missingFields?: string[];
  _skipped?: boolean;
}

export interface FeedbackData {
  agentId: string;
  success: boolean;
  latencyMs: number;
  rating: number;
}

export interface AgentConsumerConfig {
  registryUrl?: string; // Optional - defaults to dev/prod URL
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter';
    apiKey: string;
    model: string;
    temperature?: number;
  }; // REQUIRED - SDK needs LLM for core features
  userLanguage?: string; // Optional - defaults to 'en-US'
}
