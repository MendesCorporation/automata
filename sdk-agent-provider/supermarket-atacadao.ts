import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Atacadão - São Paulo
 * Wholesale supermarket with budget prices
 */

const agent = new AgentProvider({
  id: 'agent:supermarket:atacadao-sp',
  name: 'Atacadão São Paulo',
  description: 'Wholesale supermarket with lowest prices in São Paulo. Bulk purchases, budget-friendly, and wide coverage. Delivery available citywide.',
  intents: [
    'food.supermarket.price.search',
    'food.supermarket.price.check',
    'food.supermarket.price.quote',
    'grocery.price.quote',
    'grocery.delivery',
    'grocery.bulk.purchase',
  ],
  tasks: ['get_quote', 'check_delivery', 'get_bulk_quote'],
  categories: ['grocery', 'supermarket', 'wholesale', 'delivery'],
  tags: ['budget', 'wholesale', 'bulk', 'atacadao', 'cheap', 'citywide', 'delivery'],
  locationScope: 'São Paulo,SP,Brazil',
  languages: ['pt-BR'],
  version: '1.0.0',
  port: 4011,
  registryUrl: process.env.REGISTRY_URL,
  meta: {
    deliveryTime: '24-48 hours',
    minimumOrder: 150.0,
    priceRange: 'budget',
    acceptsCards: true,
    specialties: ['bulk', 'wholesale', 'budget'],
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as any) || 'openai',
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  },
});

// Handler sem validar task; cotação por padrão + LLM
agent.onExecute(async (request) => {
  const { task, params } = request;
  const rawItems = Array.isArray(params?.items) ? params.items : [];
  const descTokens =
    typeof params?.description === 'string'
      ? params.description.split(/[,;/]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
  const promptTokens =
    typeof params?.userPrompt === 'string'
      ? [params.userPrompt.trim()]
      : [];
  const fallbackItems = rawItems.length > 0 ? rawItems : (descTokens.length > 0 ? descTokens : promptTokens);
  const items = fallbackItems.length > 0 ? fallbackItems : ['produto'];

  // Cotação padrão (sempre responde)
  const quotes: any[] = items.map((item: string) => ({
    product: item,
    price: Math.random() * 10 + 5,
    available: Math.random() > 0.05,
    unit: 'kg',
    brand: 'National/Generic',
    bulk_price: Math.random() * 8 + 4,
    bulk_quantity: '10+ units',
  }));

  // Fluxo extra: checar entrega
  if (task === 'check_delivery') {
    return {
      success: true,
      data: {
        delivers: true,
        delivery_fee: 20.0,
        estimated_time: '24-48 hours',
        message: 'Entregamos em toda a cidade de São Paulo! Pedido mínimo R$ 150.',
      },
    };
  }

  // Fluxo extra: cotação em lote
  if (task === 'get_bulk_quote') {
    const quantity = params?.quantity || 10;

    const bulkQuotes: any[] = items.map((item: string) => ({
      product: item,
      unit_price: Math.random() * 10 + 5,
      bulk_price: (Math.random() * 8 + 4) * quantity,
      quantity,
      discount: '15-20%',
      total: (Math.random() * 8 + 4) * quantity,
    }));

    return {
      success: true,
      data: {
        supermarket: 'Atacadão',
        bulk_quote: true,
        items: bulkQuotes,
        total_savings: bulkQuotes.reduce(
          (sum: number, q: any) => sum + (q.unit_price - q.bulk_price / quantity) * quantity,
          0
        ),
      },
    };
  }

  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `Você é o supermercado Atacadão em São Paulo. Responda em PT-BR de forma breve, com preços e condições:\n` +
      `Itens: ${quotes.map((q: any) => `${q.product || 'item'}: R$ ${q.price.toFixed(2)}`).join(' | ')}\n` +
      `Entrega: taxa=20.0, tempo=24-48 horas, pedido mínimo=150.\n` +
      `Contexto do pedido: ${params?.description || params?.userPrompt || ''}`
    );
  } catch {
    llmSummary = undefined;
  }

  // Resposta padrão de cotação
  return {
    success: true,
    data: {
      supermarket: 'Atacadão',
      location: 'Citywide São Paulo',
      delivery_fee: 20.0,
      delivery_time: '24-48 hours',
      minimum_order: 150.0,
      items: quotes,
      total: quotes.reduce((sum: number, q: any) => sum + (q.available ? q.price : 0), 0),
      bulk_discount: 'Compre 10+ unidades e economize até 20%',
      accepts_payment: ['credit', 'debit', 'pix', 'boleto'],
      llm_summary: llmSummary,
    },
  };
});

// Start agent
agent
  .start()
  .then(() => {
    console.log('🟢 Atacadão São Paulo agent is running');
  })
  .catch((error) => {
    console.error('❌ Failed to start agent:', error);
    process.exit(1);
  });
