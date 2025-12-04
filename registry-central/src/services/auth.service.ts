import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../database/client.js';

const JWT_SECRET = process.env.JWT_SECRET || 'automata-registry-secret-change-in-production';
const JWT_EXPIRATION = '24h';
const EXECUTION_KEY_EXPIRATION = 300; // 5 minutes

export interface Caller {
  caller_id: string;
  type: 'consumer' | 'provider';
  identifier: string;
  jwt_token?: string; // stores hash (consumer) or encrypted provider secret
  token_expires_at?: Date;
  is_active: boolean;
}

export interface JWTPayload {
  caller_id: string;
  type: 'consumer' | 'provider';
  identifier: string;
}

export interface ExecutionKeyPayload {
  consumer_caller_id: string;
  agent_id: string;
  key_id: string;
}

export class AuthService {
  /**
   * Generate a unique caller_id based on identifier
   */
  private generateCallerId(type: 'consumer' | 'provider', identifier: string): string {
    const hash = crypto.createHash('sha256').update(`${type}:${identifier}`).digest('hex').substring(0, 16);
    return `${type}-${hash}`;
  }

  /**
   * Get or create caller and return JWT token
   * Automatically registers caller based on identifier (IP, endpoint, etc)
   */
  async getOrCreateToken(
    type: 'consumer' | 'provider',
    identifier: string,
    providerSecret?: string
  ): Promise<string> {
    if (type === 'provider' && (!providerSecret || providerSecret.trim() === '')) {
      throw new Error('Provider execution secret is required (header x-provider-secret)');
    }
    const existingResult = await db.query<Caller>(
      'SELECT * FROM callers WHERE type = $1 AND identifier = $2',
      [type, identifier]
    );

    // Prevent spoof: if a caller with same client_id prefix but different IP exists, reject
    const [clientIdPart] = identifier.split('|');
    if (clientIdPart && clientIdPart !== identifier) {
      const conflict = await db.query<Caller>(
        'SELECT * FROM callers WHERE type = $1 AND identifier LIKE $2',
        [type, `${clientIdPart}|%`]
      );
      if (conflict.rows.length > 0 && conflict.rows[0].identifier !== identifier) {
        throw new Error('Identifier/IP mismatch for this client_id');
      }
    }

    let caller: Caller;

    if (existingResult.rows.length > 0) {
      caller = existingResult.rows[0];
      if (type === 'provider' && providerSecret) {
        const encrypted = this.encryptSecret(providerSecret);
        await db.query(
          `UPDATE callers SET jwt_token = $1, updated_at = CURRENT_TIMESTAMP WHERE caller_id = $2`,
          [encrypted, caller.caller_id]
        );
        caller.jwt_token = encrypted;
      }
    } else {
      const callerId = this.generateCallerId(type, identifier);
      const encrypted = type === 'provider' && providerSecret ? this.encryptSecret(providerSecret) : null;
      const insertResult = await db.query<Caller>(
        `INSERT INTO callers (caller_id, type, identifier, is_active, jwt_token)
         VALUES ($1, $2, $3, true, $4)
         RETURNING *`,
        [callerId, type, identifier, encrypted]
      );
      caller = insertResult.rows[0];
    }

    const payload: JWTPayload = {
      caller_id: caller.caller_id,
      type: caller.type,
      identifier: caller.identifier,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    if (type === 'consumer') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await db.query(
        `UPDATE callers SET jwt_token = $1, token_expires_at = $2 WHERE caller_id = $3`,
        [tokenHash, expiresAt, caller.caller_id]
      );
    } else {
      await db.query(
        `UPDATE callers SET token_expires_at = $1 WHERE caller_id = $2`,
        [expiresAt, caller.caller_id]
      );
    }

    return token;
  }

  /**
   * Verify JWT token and return payload
   */
  verifyToken(token: string): JWTPayload {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
      return payload;
    } catch (error: any) {
      throw new Error(`Invalid or expired token: ${error.message}`);
    }
  }

  /**
   * Generate execution key for Consumer -> Provider communication
   * Returns: { key, expires_at }
   */
  async generateExecutionKey(
    consumerCallerId: string,
    agentId: string,
    executionSecret?: string
  ): Promise<{ key: string; expires_at: Date }> {
    const keyId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + EXECUTION_KEY_EXPIRATION * 1000);

    const payload: ExecutionKeyPayload = {
      consumer_caller_id: consumerCallerId,
      agent_id: agentId,
      key_id: keyId,
    };

    const secret = executionSecret || JWT_SECRET;
    const executionKey = jwt.sign(payload, secret, {
      expiresIn: EXECUTION_KEY_EXPIRATION,
    });

    return { key: executionKey, expires_at: expiresAt };
  }

  /**
   * Verify execution key (called by Provider)
   */
  async verifyExecutionKey(executionKey: string, agentId: string, executionSecret?: string): Promise<ExecutionKeyPayload> {
    try {
      const secret = executionSecret || JWT_SECRET;
      const payload = jwt.verify(executionKey, secret) as ExecutionKeyPayload;

      if (payload.agent_id !== agentId) {
        throw new Error('Key not valid for this agent');
      }

      return payload;
    } catch (error: any) {
      throw new Error(`Invalid execution key: ${error.message}`);
    }
  }

  /**
   * Get caller by JWT token
   */
  async getCallerByToken(token: string): Promise<Caller | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await db.query<Caller>(
      'SELECT * FROM callers WHERE jwt_token = $1',
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  /**
   * Clean up expired keys (should be called periodically)
   */
  async cleanupExpiredKeys(): Promise<number> {
    // No-op: execution keys are stateless JWTs
    return 0;
  }

  /**
   * Extract identifier from Fastify request (IP or custom header)
   */
  extractIdentifier(request: any): string {
    const customId = request.headers['x-client-id'];
    const forwarded = request.headers['x-forwarded-for'] as string | undefined;
    const realIp = request.headers['x-real-ip'] as string | undefined;

    // Fastify resolves request.ip when trustProxy is enabled; keep fallbacks
    const ip =
      (forwarded ? forwarded.split(',')[0].trim() : undefined) ||
      realIp ||
      request.ip ||
      request.socket?.remoteAddress ||
      'unknown';

    if (customId) return `${customId as string}|${ip}`;

    return ip;
  }

  async getProviderSecret(callerId: string): Promise<string | null> {
    const result = await db.query<Caller>(
      'SELECT jwt_token, type FROM callers WHERE caller_id = $1',
      [callerId]
    );
    const row = result.rows[0];
    if (!row || row.type !== 'provider' || !row.jwt_token) return null;
    try {
      return this.decryptSecret(row.jwt_token);
    } catch (err) {
      // Se estiver corrompido ou em formato hash (consumer), ignora e cai no segredo padrão
      console.warn(`getProviderSecret: unable to decrypt for caller ${callerId}: ${(err as any).message}`);
      return null;
    }
  }

  private encryptSecret(secret: string): string {
    const key = crypto.createHash('sha256').update(JWT_SECRET).digest().subarray(0, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptSecret(encrypted: string): string {
    const [ivHex, dataHex] = encrypted.split(':');
    if (!ivHex || !dataHex) throw new Error('Invalid encrypted secret format');
    const key = crypto.createHash('sha256').update(JWT_SECRET).digest().subarray(0, 32);
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
