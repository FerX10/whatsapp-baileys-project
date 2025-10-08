// src/config/env.js
// Centraliza la carga de variables de entorno y expone un objeto de configuración.
// Carga `.env` y opcionalmente `.env.local` (si existe) para entornos locales.

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const rootDir = process.cwd();
const envPath = path.resolve(rootDir, '.env');
const envLocalPath = path.resolve(rootDir, '.env.local');

// Carga ordenada: primero .env, luego .env.local si existe (permite overrides locales).
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || null,

  databaseUrl: process.env.DATABASE_URL || null,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    pass: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'whatsapp_baileys_db'
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    organization: process.env.OPENAI_ORGANIZATION || ''
  },

  gmail: {
    tokenPath: process.env.GMAIL_TOKEN_PATH || '',
    tokenJSON: process.env.GMAIL_TOKEN_JSON || '',
    enabled: typeof process.env.GMAIL_ENABLED === 'string'
      ? ['1', 'true', 'yes', 'on'].includes(process.env.GMAIL_ENABLED.toLowerCase())
      : process.env.GMAIL_ENABLED === undefined ? true : !!process.env.GMAIL_ENABLED
  }
};

module.exports = { config };
