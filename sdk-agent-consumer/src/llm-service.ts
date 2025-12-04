/**
 * Multi-LLM Service
 * Supports: OpenAI, Claude (Anthropic), Gemini (Google), DeepSeek, OpenRouter
 */

export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  temperature?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class LLMService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    switch (this.config.provider) {
      case 'openai':
        return this.completeOpenAI(messages);
      case 'claude':
        return this.completeClaude(messages);
      case 'gemini':
        return this.completeGemini(messages);
      case 'deepseek':
        return this.completeDeepSeek(messages);
      case 'openrouter':
        return this.completeOpenRouter(messages);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  private async completeOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content.trim(),
      usage: data.usage,
    };
  }

  private async completeClaude(messages: LLMMessage[]): Promise<LLMResponse> {
    // Anthropic API format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        system: systemMessage?.content || '',
        messages: conversationMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.content[0].text,
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  private async completeGemini(messages: LLMMessage[]): Promise<LLMResponse> {
    // Google Gemini API format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const contents = conversationMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMessage
            ? { parts: [{ text: systemMessage.content }] }
            : undefined,
          generationConfig: {
            temperature: this.config.temperature ?? 0.7,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.candidates[0].content.parts[0].text,
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  private async completeDeepSeek(messages: LLMMessage[]): Promise<LLMResponse> {
    // DeepSeek uses OpenAI-compatible API
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content.trim(),
      usage: data.usage,
    };
  }

  private async completeOpenRouter(messages: LLMMessage[]): Promise<LLMResponse> {
    // OpenRouter uses OpenAI-compatible API
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://automata.io',
        'X-Title': 'Automata Agent System',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content.trim(),
      usage: data.usage,
    };
  }
}

/**
 * Popular models for each provider 
 */
export const POPULAR_MODELS = {
  openai: [
    'gpt-5',
    'gpt-5.1',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
  ],

  claude: [
    'claude-4-opus',
    'claude-4.5-opus',
    'claude-4.5-sonnet',
  ],

  gemini: [
    'gemini-3-pro',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],

  deepseek: [
    'deepseek-chat',
    'deepseek-coder',
  ],

  openrouter: [
    'openai/gpt-5',
    'anthropic/claude-4.5-opus',
    'google/gemini-3-pro',
    'meta-llama/llama-3.1-405b-instruct',
  ],
};

