import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Hotel Paulista (São Paulo) - com schema flexível
 */

const hotelSchema = {
  type: 'object',
  properties: {
    city: { type: 'string', description: 'Cidade do hotel' },
    checkIn: { type: 'string', description: 'Data de entrada (YYYY-MM-DD)' },
    checkOut: { type: 'string', description: 'Data de saída (YYYY-MM-DD)' },
    guests: { type: 'number', description: 'Quantidade de hóspedes' },
    roomType: { type: 'string', enum: ['standard', 'deluxe', 'suite'], description: 'Tipo de quarto' },
    amenities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Amenidades desejadas (ex: pool, breakfast, gym)',
    },
  },
  required: ['city', 'checkIn', 'checkOut'],
};

const agent = new AgentProvider({
  id: 'agent:hotel:paulista-sp',
  name: 'Hotel Paulista (SP)',
  description: 'Hotel business em São Paulo com café da manhã incluso e opções deluxe/suíte.',
  intents: ['booking.hotel.search', 'booking.hotel.quote', 'booking.hotel.estimation', 'travel.hotel.sao_paulo'],
  tasks: ['get_quote', 'book_room', 'check_availability'],
  tags: ['hotel', 'sao-paulo', 'business', 'breakfast', 'deluxe'],
  categories: ['booking', 'hotel', 'hotel.estimation', 'travel'],
  locationScope: 'São Paulo,SP,Brazil',
  languages: ['pt-BR', 'en-US'],
  version: '1.0.0',
  port: 4020,
  registryUrl: process.env.REGISTRY_URL,
  inputSchema: hotelSchema,
  meta: {
    stars: 4,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    breakfast: true,
    airportShuttle: true,
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as any) || 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  },
});

agent.onExecute(async (request) => {
  const { task, params } = request;
  const city = params?.city || 'São Paulo';
  const checkIn = params?.checkIn || '2025-12-10';
  const checkOut = params?.checkOut || '2025-12-12';
  const guests = params?.guests || 2;
  const roomType = params?.roomType || 'standard';
  const amenities = Array.isArray(params?.amenities) ? params.amenities : [];

  const nights = 2;
  const basePrice = roomType === 'suite' ? 520 : roomType === 'deluxe' ? 380 : 280;
  const total = basePrice * nights;

  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `Você é o Hotel Paulista em São Paulo. Responda em PT-BR, curto, com preços e condições:\n` +
      `Cidade: ${city}, Check-in: ${checkIn}, Check-out: ${checkOut}, Hóspedes: ${guests}, Tipo: ${roomType}\n` +
      `Preço por noite: R$ ${basePrice.toFixed(2)}, Total: R$ ${total.toFixed(2)}, Café da manhã incluso.`
    );
  } catch {
    llmSummary = undefined;
  }

  return {
    success: true,
    data: {
      hotel: 'Hotel Paulista (SP)',
      city,
      check_in: checkIn,
      check_out: checkOut,
      nights,
      guests,
      room_type: roomType,
      amenities,
      price_per_night: basePrice,
      total,
      currency: 'BRL',
      breakfast_included: true,
      airport_shuttle: true,
      llm_summary: llmSummary,
    },
  };
});

agent.start().then(() => {
  console.log('🟢 Hotel Paulista (SP) is running');
}).catch((err) => {
  console.error('❌ Failed to start Hotel Paulista (SP):', err);
  process.exit(1);
});
