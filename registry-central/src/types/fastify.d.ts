import 'fastify';
import { JWTPayload } from '../services/auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    caller?: JWTPayload;
  }
}
