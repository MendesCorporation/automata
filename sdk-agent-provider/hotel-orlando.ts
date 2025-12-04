import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Orlando Resort - voltado para famílias e parques
 */

const agent = new AgentProvider({
  id: 'agent:hotel:orlando-resort',
  name: 'Orlando Family Resort',
  description: 'Resort em Orlando próximo aos parques, com transporte e quartos familiares.',
  intents: ['booking.hotel.search', 'booking.hotel.estimation', 'travel.hotel.orlando', 'booking.hotel.family'],
  tasks: ['get_quote', 'book_room', 'check_availability'],
  tags: ['orlando', 'family', 'parks', 'usa', 'resort'],
  categories: ['booking', 'hotel', 'hotel.estimation', 'travel'],
  locationScope: 'Orlando,FL,USA',
  languages: ['en-US', 'pt-BR'],
  version: '1.0.0',
  port: 4022,
  registryUrl: process.env.REGISTRY_URL,
  meta: {
    stars: 4,
    shuttle: true,
    breakfast: true,
    kids_friendly: true,
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as any) || 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  },
});

agent.onExecute(async (request) => {
  const { params } = request;
  const rawContext = JSON.stringify(params || {}, null, 2);

  // Deixa a LLM decidir preços/condições com base no que chegou
  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `Você é o Orlando Family Resort, próximo aos parques.\n` +
      `Use o contexto a seguir (JSON) para responder em PT-BR, de forma breve, inventando preços plausíveis em USD e condições (noite/total, datas, hóspedes, tipo de quarto, café da manhã, shuttle):\n` +
      `${rawContext}\n` +
      `Retorne um texto amigável com preço por noite, total estimado e condições.`
    );
  } catch {
    llmSummary = undefined;
  }

  return {
    success: true,
    data: {
      hotel: 'Orlando Family Resort',
      raw_params: params || {},
      llm_summary: llmSummary || 'Resumo indisponível. Forneça datas, hóspedes e tipo de quarto.',
    },
  };
});

agent.start().then(() => {
  console.log('🟢 Orlando Family Resort is running');
}).catch((err) => {
  console.error('❌ Failed to start Orlando Family Resort:', err);
  process.exit(1);
});
