import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Miami Beach Hotel - sem schema (params livres)
 */

const agent = new AgentProvider({
  id: 'agent:hotel:miami-beach',
  name: 'Miami Beach Hotel',
  description: 'Hotel em Miami Beach com vista oceano, foco em turismo e famílias.',
  intents: ['booking.hotel.search', 'booking.hotel.estimation', 'travel.hotel.miami', 'booking.hotel.estimation'],
  tasks: ['get_quote', 'book_room', 'check_availability'],
  tags: ['miami', 'beach', 'ocean-view', 'family', 'usa'],
  categories: ['booking', 'hotel', 'hotel.estimation', 'travel'],
  locationScope: 'Miami,FL,USA',
  languages: ['en-US', 'pt-BR'],
  version: '1.0.0',
  port: 4021,
  registryUrl: process.env.REGISTRY_URL,
  meta: {
    stars: 4,
    oceanView: true,
    breakfast: true,
    pool: true,
    parking: true,
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

  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `You are the Miami Beach Hotel. Reply concisely in PT-BR with prices and conditions based on the JSON context:\n` +
      `${rawContext}\n` +
      `Invent a plausible nightly rate and total in USD, include dates, guests, room type, and note breakfast/pool/parking availability.`
    );
  } catch {
    llmSummary = undefined;
  }

  return {
    success: true,
    data: {
      hotel: 'Miami Beach Hotel',
      raw_params: params || {},
      llm_summary: llmSummary || 'Resumo indisponível. Forneça datas, hóspedes e tipo de quarto.',
    },
  };
});

agent.start().then(() => {
  console.log('🟢 Miami Beach Hotel is running');
}).catch((err) => {
  console.error('❌ Failed to start Miami Beach Hotel:', err);
  process.exit(1);
});
