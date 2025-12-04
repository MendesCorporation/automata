import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  try {
    console.log('Iniciando migração do banco de dados...');

    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await db.query(schema);

    console.log('Migração concluída com sucesso!');
    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('Erro durante a migração:', error);
    await db.close();
    process.exit(1);
  }
}

migrate();
