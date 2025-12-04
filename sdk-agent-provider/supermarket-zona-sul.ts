import 'dotenv/config';
import { AgentProvider } from './src/agent-provider.js';

/**
 * Supermarket Zona Sul - São Paulo
 * Premium supermarket chain
 */

const agent = new AgentProvider({
  id: 'agent:supermarket:zona-sul-sp',
  name: 'Zona Sul Supermercados',
  description: 'Premium supermarket chain in São Paulo with organic products, imported goods, and premium brands. Delivery available in Jardins, Vila Mariana, Moema.',
  intents: [
    'food.supermarket.price.search',
    'food.supermarket.price.check',
    'food.supermarket.price.quote',
    'grocery.price.quote',
    'grocery.delivery',
    'grocery.product.search',
    'brand.zonasul',
  ],
  tasks: ['get_quote', 'check_delivery'],
  categories: ['grocery', 'supermarket', 'delivery'],
  tags: ['premium', 'organic', 'imported', 'zona-sul', 'jardins', 'delivery'],
  locationScope: 'São Paulo,SP,Brazil',
  languages: ['pt-BR', 'en-US'],
  version: '1.0.0',
  port: 4010,
  registryUrl: process.env.REGISTRY_URL,
  meta: {
    deliveryTime: '2-4 hours',
    minimumOrder: 80.0,
    priceRange: 'premium',
    acceptsCards: true,
    specialties: ['organic', 'imported', 'gourmet'],
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
    price: Math.random() * 25 + 15, // R$ 15-40 (premium)
    available: Math.random() > 0.1, // 90% availability
    unit: 'kg',
    brand: 'Premium/Imported',
  }));

  // Fluxo extra: checar entrega
  if (task === 'check_delivery') {
    const address = params?.address || '';
    const premiumAreas = ['jardins', 'moema', 'vila mariana', 'itaim', 'pinheiros'];
    const delivers = premiumAreas.some((area) => address.toLowerCase().includes(area));

    return {
      success: true,
      data: {
        delivers,
        delivery_fee: delivers ? 12.0 : null,
        estimated_time: delivers ? '2-4 hours' : null,
        message: delivers
          ? 'Entregamos em sua região!'
          : 'Área fora da zona de entrega. Disponível em Jardins, Moema, Vila Mariana, Itaim e Pinheiros.',
      },
    };
  }

  let llmSummary: string | undefined;
  try {
    llmSummary = await agent.callLLM(
      `Você é o supermercado Zona Sul em São Paulo. Responda em PT-BR de forma breve, com preços e condições:\n` +
      `Itens: ${quotes.map((q: any) => `${q.product || 'item'}: R$ ${q.price.toFixed(2)}`).join(' | ')}\n` +
      `Entrega: taxa=12.0, tempo=2-4 horas, pedido mínimo=80.\n` +
      `Contexto do pedido: ${params?.description || params?.userPrompt || ''}`
    );
  } catch {
    llmSummary = undefined;
  }

  // Resposta padrão de cotação
  return {
    success: true,
    data: {
      supermarket: 'Zona Sul',
      location: 'Jardins, São Paulo',
      delivery_fee: 12.0,
      delivery_time: '2-4 hours',
      minimum_order: 80.0,
      items: quotes,
      total: quotes.reduce((sum: number, q: any) => sum + (q.available ? q.price : 0), 0),
      accepts_payment: ['credit', 'debit', 'pix'],
      llm_summary: llmSummary,
    },
  };
});

// Start agent
agent
  .start()
  .then(() => {
    console.log('🟢 Zona Sul Supermercados agent is running');
  })
  .catch((error) => {
    console.error('❌ Failed to start agent:', error);
    process.exit(1);
  });
