import Fastify from 'fastify';
import { config } from './config/index.js';
import { routes } from './routes/index.js';
import { db } from './database/client.js';

const trustProxyEnv = process.env.TRUST_PROXY || 'true';
const trustProxy =
  trustProxyEnv === 'true' ||
  trustProxyEnv === '1' ||
  trustProxyEnv === 'yes' ||
  trustProxyEnv === 'on';

const fastify = Fastify({
  logger: true,
  // Needed when running behind Nginx/ALB so request.ip reflects X-Forwarded-For
  trustProxy,
});

fastify.register(routes);

const start = async () => {
  try {
    await db.query('SELECT 1');
    console.log('Conexão com banco de dados estabelecida');

    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    console.log(`Registry Central rodando em http://${config.server.host}:${config.server.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await fastify.close();
  await db.close();
  process.exit(0);
});

start();
