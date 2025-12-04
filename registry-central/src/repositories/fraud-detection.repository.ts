import { db } from '../database/client.js';
import { FraudDetection, FraudType, FraudSeverity } from '../types/agent.types.js';

export class FraudDetectionRepository {
  async create(fraud: FraudDetection): Promise<FraudDetection> {
    const result = await db.query<FraudDetection>(
      `INSERT INTO fraud_detection_log (
        agent_id, consumer_id, fraud_type, severity, details
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        fraud.agent_id,
        fraud.consumer_id || null,
        fraud.fraud_type,
        fraud.severity,
        JSON.stringify(fraud.details),
      ]
    );
    return result.rows[0];
  }

  async findByAgentId(agentId: string, limit = 100): Promise<FraudDetection[]> {
    const result = await db.query<FraudDetection>(
      `SELECT * FROM fraud_detection_log
       WHERE agent_id = $1
       ORDER BY detected_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
    return result.rows.map(row => ({
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    }));
  }

  async findByConsumerId(consumerId: string, limit = 100): Promise<FraudDetection[]> {
    const result = await db.query<FraudDetection>(
      `SELECT * FROM fraud_detection_log
       WHERE consumer_id = $1
       ORDER BY detected_at DESC
       LIMIT $2`,
      [consumerId, limit]
    );
    return result.rows.map(row => ({
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    }));
  }

  async countByAgentAndType(agentId: string, fraudType: FraudType): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM fraud_detection_log
       WHERE agent_id = $1 AND fraud_type = $2`,
      [agentId, fraudType]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async countByAgentAndSeverity(agentId: string, severity: FraudSeverity): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM fraud_detection_log
       WHERE agent_id = $1 AND severity = $2`,
      [agentId, severity]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async getTotalFraudCount(agentId: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM fraud_detection_log
       WHERE agent_id = $1`,
      [agentId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async cleanupOldLogs(): Promise<number> {
    const result = await db.query<{ count: string }>(
      `DELETE FROM fraud_detection_log
       WHERE detected_at < NOW() - INTERVAL '30 days'
       RETURNING 1`
    );
    return result.rows.length;
  }
}
