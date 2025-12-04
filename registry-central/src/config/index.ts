import dotenv from 'dotenv';

dotenv.config();

export const config = {
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'agent_registry',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
  },
  ranking: {
    weights: {
      geo: parseFloat(process.env.WEIGHT_GEO || '0.30'),
      category: parseFloat(process.env.WEIGHT_CATEGORY || '0.20'),
      tag: parseFloat(process.env.WEIGHT_TAG || '0.10'),
      success: parseFloat(process.env.WEIGHT_SUCCESS || '0.20'),
      rating: parseFloat(process.env.WEIGHT_RATING || '0.15'),
      latency: parseFloat(process.env.WEIGHT_LATENCY || '0.05'),
    },
  },
};
