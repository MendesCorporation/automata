import 'dotenv/config';
import { AgentConsumer } from './src/index.js';
import * as readline from 'readline';

// LLM configuration
const LLM_CONFIG = {
  provider: (process.env.LLM_PROVIDER as any) || 'openai',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'gpt-4o-mini',
  temperature: 0.7,
};

const REGISTRY_URL = process.env.REGISTRY_URL;

const consumer = new AgentConsumer({
  registryUrl: REGISTRY_URL,
  llm: LLM_CONFIG,
  userLanguage: 'pt-BR',
});

function printBanner(): void {
  console.log('\n============================================================');
  console.log('AI Agent Orchestrator (schema-aware)');
  console.log('Commands: type your request, or use "memory", "clear", "exit"');
  console.log('============================================================\n');
}

async function processUserRequest(userPrompt: string): Promise<void> {
  console.log('\n============================================================');
  console.log('🚀 PROCESSAMENTO INICIADO');
  console.log('============================================================');
  console.log(`📝 User prompt: "${userPrompt}"`);
  console.log('');

  const totalStart = Date.now();

  try {
    // ==================== STEP 1: ANALYZE PROMPT ====================
    console.log('📊 STEP 1: ANALISANDO INTENÇÃO COM LLM');
    console.log('------------------------------------------------------------');
    const step1Start = Date.now();

    const analysis = await consumer.analyzePrompt(userPrompt);
    const step1Duration = Date.now() - step1Start;

    console.log(`✅ Análise concluída em ${step1Duration}ms`);
    console.log(`   📍 Intents gerados: ${JSON.stringify(analysis.intents || [analysis.intent])}`);
    console.log(`   📦 Categorias: ${(analysis.categories || []).join(', ') || '-'}`);
    console.log(`   🏷️  Tags: ${(analysis.tags || []).join(', ') || '-'}`);
    console.log(`   📍 Location: ${analysis.location || 'não especificado'}`);
    console.log(`   📝 Description: ${analysis.description || 'n/d'}`);
    console.log('');

    // ==================== STEP 2: SEARCH AGENTS ====================
    console.log('🔍 STEP 2: BUSCANDO AGENTES NO REGISTRY');
    console.log('------------------------------------------------------------');
    const step2Start = Date.now();

    const searchRequest = {
      intent: analysis.intents || [analysis.intent],
      categories: analysis.categories || ['development'],
      tags: analysis.tags || [],
      description: analysis.description,
      location: analysis.location,
      limit: 10,
    };

    console.log(`📤 Search request enviado:`, JSON.stringify(searchRequest, null, 2));

    const agents = await consumer.search(searchRequest);
    const step2Duration = Date.now() - step2Start;

    console.log(`✅ Search concluído em ${step2Duration}ms`);
    console.log(`   📥 Encontrados ${agents.length} agente(s)\n`);

    if (agents.length > 0) {
      console.log('   Lista de agentes encontrados:');
      agents.forEach((agent, i) => {
        console.log(`   ${i + 1}. ${agent.name}`);
        console.log(`      - ID: ${agent.id}`);
        console.log(`      - Score: ${agent.score.toFixed(2)}`);
        console.log(`      - Intents: ${agent.intents.join(', ')}`);
        console.log(`      - Tasks: ${(agent.tasks || []).join(', ') || 'none'}`);
        console.log(`      - Endpoint: ${agent.endpoint}`);
      });
    }
    console.log('');

    if (agents.length === 0) {
      console.log('❌ Nenhum agente encontrado para essa busca.');
      console.log('============================================================\n');
      return;
    }

    // ==================== STEP 3: VALIDATE RELEVANCE ====================
    console.log('🎯 STEP 3: VALIDANDO RELEVÂNCIA E SELECIONANDO TASKS (LLM)');
    console.log('------------------------------------------------------------');
    const step3Start = Date.now();

    const validAgents = await consumer.validateAgentRelevance(agents, analysis);
    const step3Duration = Date.now() - step3Start;

    console.log(`✅ Validação concluída em ${step3Duration}ms`);

    if (validAgents.length === 0) {
      console.log('❌ Nenhum agente considerado relevante após validação.');
      console.log('============================================================\n');
      return;
    }

    if (validAgents.length < agents.length) {
      console.log(`   🚫 Filtrados ${agents.length - validAgents.length} agente(s) irrelevante(s)`);
    }

    console.log(`   ✅ ${validAgents.length} agente(s) aprovado(s) com tasks:\n`);
    validAgents.forEach((agent, i) => {
      console.log(`   ${i + 1}. ${agent.name}`);
      console.log(`      - Task selecionada: "${agent.selectedTask || 'não selecionada'}"`);
      console.log(`      - Endpoint: ${agent.endpoint}`);
    });
    console.log('');

    // ==================== STEP 4: EXECUTE AGENTS ====================
    console.log('⚡ STEP 4: EXECUTANDO AGENTES');
    console.log('------------------------------------------------------------');
    const step4Start = Date.now();

    console.log('   Payload que será enviado para os providers:');
    console.log(JSON.stringify({
      task: analysis.intents?.[0] || analysis.intent,
      params: {
        userPrompt,
        description: analysis.description,
        features: analysis.features,
        location: analysis.location,
        language: analysis.language,
      },
    }, null, 2));

    const results = await consumer.executeMultipleWithFeedback(
      validAgents,
      {
        task: analysis.intents?.[0] || analysis.intent,
        params: {
          userPrompt,
          description: analysis.description,
          features: analysis.features,
          location: analysis.location,
          language: analysis.language,
        },
      },
      { userPrompt, analysis }
    );

    const step4Duration = Date.now() - step4Start;
    console.log(`✅ Execução concluída em ${step4Duration}ms\n`);

    console.log('   Detalhes de execução por agente:');
    results.forEach((result, i) => {
      const agent = validAgents[i];
      const taskSent = (result as any)._taskSent;
      const latency = (result as any)._latency || 0;

      console.log(`\n   ${i + 1}. ${agent.name}`);
      console.log(`      - Task enviada: "${taskSent}"`);
      console.log(`      - Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      console.log(`      - Latency: ${latency}ms`);

      if ((result as any)._skipped) {
        console.log(`      - Motivo: SKIPPED - ${result.error}`);
        const missing = (result as any)._missingFields;
        if (missing && missing.length > 0) {
          console.log(`      - Campos faltando: ${missing.join(', ')}`);
        }
      } else if (!result.success) {
        console.log(`      - Erro: ${result.error || 'unknown'}`);
      } else {
        const dataPreview = JSON.stringify(result.data).substring(0, 200);
        console.log(`      - Response preview: ${dataPreview}...`);
      }
    });
    console.log('');

    const skipped = results
      .map((res, idx) => ({ res, agent: validAgents[idx] }))
      .filter(({ res }) => (res as any)._skipped);

    if (skipped.length > 0) {
      console.log(`   ⚠️  ${skipped.length} agente(s) ignorado(s) por falta de dados`);
    }

    // ==================== STEP 5: INTERPRET RESPONSES ====================
    console.log('🤖 STEP 5: INTERPRETANDO RESPOSTAS COM LLM');
    console.log('------------------------------------------------------------');
    const step5Start = Date.now();

    const agentResponses = results.map((result, index) => {
      const missingFields = (result as any)._missingFields;
      return {
        agentId: validAgents[index].id,
        agentName: validAgents[index].name,
        response: result.success ? result.data : { error: result.error, missingFields },
        success: result.success,
      };
    });

    const interpretationObj = await consumer.interpretResponses(
      userPrompt,
      agentResponses,
      analysis.intents?.[0] || analysis.intent
    );
    const interpretation = interpretationObj.message || (interpretationObj as any);

    const step5Duration = Date.now() - step5Start;
    console.log(`✅ Interpretação concluída em ${step5Duration}ms\n`);

    const pendingAgents = consumer.getPendingAgents();

    consumer.addToMemory({
      userRequest: userPrompt,
      intent: analysis.intents?.[0] || analysis.intent,
      timestamp: new Date(),
      agentResponses: agentResponses.map((ar, i) => ({
        agentId: validAgents[i].id,
        agentName: ar.agentName,
        endpoint: validAgents[i].endpoint,
        executionKey: validAgents[i].execution_key,
        response: ar.response,
        success: ar.success,
        missingFields: (results[i] as any)._missingFields,
        skipped: (results[i] as any)._skipped === true,
      })),
      skippedAgents: pendingAgents.map((pending) => ({
        agentId: pending.agentId,
        agentName: pending.agentName,
        endpoint: pending.endpoint,
        executionKey: pending.executionKey,
        missingFields: pending.missingFields,
        reason: 'Missing required fields',
      })),
      interpretation,
    });

    // ==================== FINAL RESULTS ====================
    const totalDuration = Date.now() - totalStart;

    console.log('============================================================');
    console.log('💬 RESPOSTA DA IA');
    console.log('============================================================\n');
    console.log(interpretation);
    console.log('\n============================================================');
    console.log('📈 RESUMO DA EXECUÇÃO');
    console.log('============================================================');
    console.log(`⏱️  Tempo total: ${totalDuration}ms`);
    console.log(`   - Step 1 (Análise): ${step1Duration}ms`);
    console.log(`   - Step 2 (Busca): ${step2Duration}ms`);
    console.log(`   - Step 3 (Validação + Task Selection): ${step3Duration}ms`);
    console.log(`   - Step 4 (Execução): ${step4Duration}ms`);
    console.log(`   - Step 5 (Interpretação): ${step5Duration}ms`);
    console.log('');
    console.log(`📊 Estatísticas:`);
    console.log(`   - Intents gerados: ${(analysis.intents || [analysis.intent]).length}`);
    console.log(`   - Agentes encontrados: ${agents.length}`);
    console.log(`   - Agentes validados: ${validAgents.length}`);
    console.log(`   - Agentes chamados: ${validAgents.length}`);
    console.log(`   - Sucesso: ${agentResponses.filter((r) => r.success).length}`);
    console.log(`   - Falha/pendente: ${agentResponses.filter((r) => !r.success).length}`);

    if (pendingAgents.length > 0) {
      console.log('\n⚠️  Agentes pendentes (dados incompletos):');
      pendingAgents.forEach((p) => {
        console.log(`   - ${p.agentName}: faltando ${p.missingFields.join(', ')}`);
      });
    }
    console.log('============================================================\n');
  } catch (error: any) {
    console.error('\n❌ ERRO DURANTE PROCESSAMENTO:', error.message);
    console.error('Stack trace:', error.stack);
    console.log('============================================================\n');
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function showMemory(): void {
  const memory = consumer.getMemory();
  console.log(`\nMemória (${memory.length} interações):\n`);
  memory.forEach((entry, i) => {
    console.log(`${i + 1}. [${entry.timestamp.toLocaleTimeString()}] intent=${entry.intent}`);
    console.log(`   Pedido: "${entry.userRequest.substring(0, 80)}"`);
    console.log(`   Respostas: ${entry.agentResponses.length} | Skipped: ${entry.skippedAgents?.length || 0}`);
  });

  const pending = consumer.getPendingAgents();
  if (pending.length > 0) {
    console.log('\nAgentes pendentes (faltou informação):');
    pending.forEach((p) => {
      console.log(`- ${p.agentName} (${p.agentId}) -> campos: ${p.missingFields.join(', ')} | endpoint: ${p.endpoint}`);
    });
  }
  console.log('');
}

function askPrompt(): void {
  rl.question('\nO que você precisa? (ou "exit" / "memory" / "clear"): ', async (userInput) => {
    const trimmed = userInput.trim();

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'sair') {
      console.log('\nAté mais!');
      rl.close();
      process.exit(0);
    }

    if (trimmed.toLowerCase() === 'memory' || trimmed.toLowerCase() === 'memoria') {
      showMemory();
      askPrompt();
      return;
    }

    if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'limpar') {
      consumer.clearMemory();
      console.log('\nMemória limpa.\n');
      askPrompt();
      return;
    }

    if (trimmed.length < 6) {
      console.log('\nDescreva com mais detalhes (mínimo 6 caracteres).\n');
      askPrompt();
      return;
    }

    await processUserRequest(trimmed);
    askPrompt();
  });
}

printBanner();
askPrompt();
