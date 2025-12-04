export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  intents: string[];
  tasks?: string[]; // Optional - available tasks for this agent
  tags: string[];
  categories: string[];
  locationScope: string;
  languages: string[];
  version: string;
  meta?: Record<string, any>;
  port: number;
  registryUrl?: string; // Optional - defaults to dev/prod URL
  inputSchema?: JSONSchema; // Optional - defines expected input format
  publicEndpoint?: string; // Optional - usado em production para registrar HTTPS endpoint no Registry
  llm?: {
    provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter';
    apiKey: string;
    model: string;
    temperature?: number;
  };
}

export interface ExecuteRequest {
  task: string;
  params?: Record<string, any>;
}

export interface ExecuteResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export type ExecuteHandler = (request: ExecuteRequest) => Promise<ExecuteResponse>;
