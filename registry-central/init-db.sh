#!/bin/bash

# Script para aguardar o PostgreSQL e executar migração

set -e

echo "Aguardando PostgreSQL estar pronto..."

until PGPASSWORD=$DATABASE_PASSWORD psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c '\q'; do
  >&2 echo "PostgreSQL indisponível - aguardando..."
  sleep 1
done

>&2 echo "PostgreSQL pronto - executando migração..."

PGPASSWORD=$DATABASE_PASSWORD psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -f /app/src/database/schema.sql

>&2 echo "Migração concluída!"

# Iniciar aplicação
exec "$@"
