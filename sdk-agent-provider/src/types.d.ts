declare module '@fastify/rate-limit' {
  import { FastifyPluginAsync } from 'fastify';
  const plugin: FastifyPluginAsync<any>;
  export default plugin;
}
