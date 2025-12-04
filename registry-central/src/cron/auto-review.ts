#!/usr/bin/env node
import { QuarantineService } from '../services/quarantine.service.js';

/**
 * Cron job for agent auto-review
 * Runs daily to check agents that should be quarantined or banned
 */
async function runAutoReview() {
  const quarantineService = new QuarantineService();

  try {
    await quarantineService.autoReviewAgents();
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

runAutoReview();
