import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Carrefour Express - São Paulo
 * Mid-range supermarket with fast delivery
 */

const agent = new AgentProvider({
  id: 'agent:supermarket:carrefour-express-sp',
  name: 'Carrefour Express SP',
  description: 'Mid-range supermarket with express delivery in 1-2 hours. Wide product selection, competitive prices, and reliable service across São Paulo.',
  intents: [
    'food.supermarket.price.search',
    'food.supermarket.price.check',
    'food.supermarket.price.quote',
    'grocery.price.quote',
    'grocery.delivery',
    'grocery.express.delivery',
    'brand.carrefour',
  ],
  tasks: ['get_quote', 'check_delivery', 'schedule_delivery'],
  categories: ['grocery', 'supermarket', 'express', 'delivery'],
  tags: ['carrefour', 'express', 'fast-delivery', 'mid-range', 'citywide', 'delivery'],
  locationScope: 'São Paulo,SP,Brazil',
  languages: ['pt-BR', 'en-US'],
  version: '1.0.0',
  port: 4012,
  registryUrl: process.env.REGISTRY_URL,

  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of products to quote',
      },
      delivery_type: {
        type: 'string',
        enum: ['express', 'scheduled'],
        description: 'Delivery type: express (1-2h) or scheduled (choose time)',
      },
      address: {
        type: 'string',
        description: 'Delivery address in São Paulo',
      },
    },
    required: ['items'],
  },

  meta: {
    deliveryTime: '1-2 hours',
    minimumOrder: 50.0,
    priceRange: 'mid-range',
    acceptsCards: true,
    specialties: ['express', 'variety', 'reliable'],
  },

  llm: {
    provider: (process.env.LLM_PROVIDER as any) || 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  },
});

// Handler sem validar task: sempre retorna cotação e usa LLM para resumo
agent.onExecute(async (request) => {
  const { task, params } = request;
  const items = params?.items || [];
  const deliveryType = params?.delivery_type || 'express';

  const quotes: any[] = items.map((item: string) => ({
    product: item,
    price: Math.random() * 18 + 8,
    available: Math.random() > 0.08,
    unit: 'kg',
    brand: 'Carrefour/National',
    express_available: Math.random() > 0.2,
  }));

  const deliveryFee = deliveryType === 'express' ? 8.0 : 5.0;
  const deliveryTime = deliveryType === 'express' ? '1-2 hours' : '4-6 hours';

  // Checar entrega (opcional)
  if (task === 'check_delivery') {
    const address = params?.address || '';
    const expressAreas = ['centro', 'zona sul', 'zona oeste', 'zona leste'];
    const hasExpress = expressAreas.some((area) => address.toLowerCase().includes(area));

    return {
      success: true,
      data: {
        delivers: true,
        express_available: hasExpress,
        delivery_fee: hasExpress && deliveryType === 'express' ? 8.0 : 5.0,
        estimated_time: hasExpress && deliveryType === 'express' ? '1-2 hours' : '4-6 hours',
        message: hasExpress
          ? 'Entrega expressa disponível em 1-2 horas!'
          : 'Entrega programada disponível em 4-6 horas.',
      },
    };
  }

  // Agendar entrega (opcional)
  if (task === 'schedule_delivery') {
    const preferredTime = params?.preferred_time || 'next-available';

    return {
      success: true,
      data: {
        scheduled: true,
        delivery_slot: preferredTime,
        confirmation_code: `CAR-${Math.random().toString(36).substring(7).toUpperCase()}`,
        items_count: items.length,
        message: 'Entrega programada com sucesso!',
      },
    };
  }

  // LLM para resposta natural
  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `Você é o supermercado Carrefour Express em São Paulo. Responda em PT-BR de forma breve, com preços e condições:\n` +
      `Itens: ${quotes.map((q: any) => `${q.product || 'item'}: R$ ${q.price.toFixed(2)}`).join(' | ')}\n` +
      `Entrega: tipo=${deliveryType}, taxa=${deliveryFee}, tempo=${deliveryTime}, pedido mínimo=50.`
    );
  } catch {
    llmSummary = undefined;
  }

  // Resposta padrão de cotação
  return {
    success: true,
    data: {
      supermarket: 'Carrefour Express',
      location: 'São Paulo',
      delivery_type: deliveryType,
      delivery_fee: deliveryFee,
      delivery_time: deliveryTime,
      minimum_order: 50.0,
      items: quotes,
      total: quotes.reduce((sum: number, q: any) => sum + (q.available ? q.price : 0), 0),
      express_items: quotes.filter((q: any) => q.express_available).length,
      accepts_payment: ['credit', 'debit', 'pix', 'meal-voucher'],
      llm_summary: llmSummary,
    },
  };
});

// Start agent
agent
  .start()
  .then(() => {
    console.log('🟢 Carrefour Express SP agent is running');
  })
  .catch((error) => {
    console.error('❌ Failed to start agent:', error);
    process.exit(1);
  });
