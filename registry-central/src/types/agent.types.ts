export type AgentStatus = 'active' | 'quarantine' | 'banned';

export interface Agent {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  intents: string[];
  tasks: string[]; // Available tasks for this agent
  tags: string[];
  categories: string[];
  location_scope: string;
  languages: string[];
  version: string;
  meta: Record<string, any>;
  input_schema?: Record<string, any>; // JSON Schema for input validation
  caller_id?: string; // Provider identifier (for fraud detection)
  status?: AgentStatus;
  quarantine_reason?: string;
  quarantine_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export interface AgentStats {
  agent_id: string;
  calls_total: number;
  calls_success: number;
  avg_latency_ms: number;
  avg_rating: number;
  last_feedback_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export interface RegisterAgentRequest {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  intents: string[];
  tasks?: string[]; // Optional tasks for this agent
  tags: string[];
  categories: string[];
  location_scope: string;
  languages: string[];
  version: string;
  meta?: Record<string, any>;
  input_schema?: Record<string, any>; // JSON Schema for input validation
}

export interface SearchAgentRequest {
  intent?: string | string[]; // Single intent or multiple intents
  categories: string[];
  tags?: string[];
  location?: string;
  language?: string;
  description?: string;
  limit?: number;
}

export interface SearchAgentResponse {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  caller_id?: string;
  tags: string[];
  intents: string[];
  tasks: string[]; // Available tasks for this agent
  categories: string[];
  location_scope: string;
  score: number;
  input_schema?: Record<string, any>; // JSON Schema for input validation
}

export interface FeedbackRequest {
  agent_id: string;
  success: boolean;
  latency_ms: number;
  rating: number;
}

export interface AgentWithScore extends Agent {
  stats?: AgentStats;
  score: number;
}

// ============================================================
// ANTI-FRAUD TYPES
// ============================================================

export interface AgentFeedback {
  id?: number;
  agent_id: string;
  consumer_id: string;
  success: boolean;
  latency_ms: number;
  rating: number;
  created_at?: Date;
}

export type FraudType = 'SELF_RATING' | 'SPAM' | 'RATING_PATTERN' | 'LATENCY_INCONSISTENT';
export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FraudDetection {
  id?: number;
  agent_id: string;
  consumer_id?: string;
  fraud_type: FraudType;
  severity: FraudSeverity;
  details: Record<string, any>;
  detected_at?: Date;
}

export interface AgentHealthMetrics {
  agent_id: string;
  status: AgentStatus;
  health_score: number;
  metrics: {
    success_rate: number;
    avg_rating: number;
    avg_latency_ms: number;
    total_feedbacks: number;
    fraud_detected: number;
    fraud_percentage: number;
    self_rating_percentage: number;
  };
  warnings: string[];
  quarantine_risk: 'low' | 'medium' | 'high' | 'critical';
  quarantine_reason?: string;
  quarantine_at?: Date;
}
