// tools/verify_schema.js (v2)
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DBJS_PATH = path.join(__dirname, '..', 'src', 'database', 'db.js');

function makePoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || process.env.PGUSER,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
    database: process.env.DB_NAME || process.env.PGDATABASE,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10)
         : (process.env.PGPORT ? parseInt(process.env.PGPORT,10) : 5432),
  };
}

// --- Extrae bloques CREATE TABLE ... (...); ---
function extractCreateTableBlocks(fileContent) {
  const reBlock = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)([a-zA-Z0-9_]+)\1\s*\(([\s\S]*?)\);/gi;
  const blocks = [];
  let m;
  while ((m = reBlock.exec(fileContent)) !== null) {
    blocks.push({ table: m[2], body: m[3] });
  }
  return blocks;
}

function parseColumnsFromCreateBody(body) {
  const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const cols = [];
  for (const ln of lines) {
    const up = ln.toUpperCase();
    if (
      up.startsWith('CONSTRAINT ') ||
      up.startsWith('PRIMARY KEY') ||
      up.startsWith('FOREIGN KEY') ||
      up.startsWith('UNIQUE ') ||
      up.startsWith('CHECK ') ||
      up.startsWith('INDEX ') ||
      up.startsWith('REFERENCES ')
    ) continue;

    // nombre tipo ...,
    const m = ln.match(/^"?(?<name>[a-zA-Z0-9_]+)"?\s+[^,]+(,)?$/);
    if (m?.groups?.name) cols.push(m.groups.name);
  }
  return cols;
}

// --- También lee ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... ---
function extractAddColumns(fileContent) {
  // Capturar: ALTER TABLE IF EXISTS <tabla> ADD COLUMN IF NOT EXISTS <col> ...
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?)([a-zA-Z0-9_]+)\1\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)([a-zA-Z0-9_]+)\3/gi;
  const adds = []; // { table, column }
  let m;
  while ((m = re.exec(fileContent)) !== null) {
    adds.push({ table: m[2], column: m[4] });
  }
  return adds;
}

function extractExpectedSchema(dbJsPath) {
  const raw = fs.readFileSync(dbJsPath, 'utf8');
  const expected = {};

  // 1) columnas por CREATE TABLE
  for (const { table, body } of extractCreateTableBlocks(raw)) {
    expected[table] = expected[table] || new Set();
    for (const c of parseColumnsFromCreateBody(body)) expected[table].add(c);
  }
  // 2) columnas por ALTER TABLE ... ADD COLUMN ...
  for (const { table, column } of extractAddColumns(raw)) {
    expected[table] = expected[table] || new Set();
    expected[table].add(column);
  }

  // convert to plain arrays
  const out = {};
  for (const [t, set] of Object.entries(expected)) out[t] = Array.from(set);
  return out;
}

async function readActualSchema(pool) {
  const tablesRes = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE';
  `);
  const tables = tablesRes.rows.map(r => r.table_name);
  const colsMap = {};
  for (const t of tables) {
    const cRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position;
    `, [t]);
    colsMap[t] = cRes.rows.map(r => r.column_name);
  }
  return { tables, colsMap };
}

function compareSchemas(expected, actualTables, actualColsMap) {
  const expectedTables = Object.keys(expected);
  const actualSet = new Set(actualTables);
  const missingTables = expectedTables.filter(t => !actualSet.has(t));
  const extraTables = actualTables.filter(t => !expectedTables.includes(t));

  const perTable = [];
  for (const t of expectedTables) {
    if (!actualSet.has(t)) continue;
    const expCols = new Set(expected[t] || []);
    const actCols = new Set(actualColsMap[t] || []);
    const missingCols = [...expCols].filter(c => !actCols.has(c));
    const extraCols = [...actCols].filter(c => !expCols.has(c));
    perTable.push({ table: t, missingCols, extraCols });
  }

  return { missingTables, extraTables, perTable };
}

(async () => {
  console.log('[verify] Leyendo esquema esperado desde', DBJS_PATH);
  const expected = extractExpectedSchema(DBJS_PATH);

  const pool = new Pool(makePoolConfig());
  await pool.query('SELECT 1');

  console.log('[verify] Leyendo esquema REAL de Postgres...');
  const { tables, colsMap } = await readActualSchema(pool);

  const { missingTables, extraTables, perTable } =
    compareSchemas(expected, tables, colsMap);

  console.log('\n=== RESULTADOS ===');
  console.log('Tablas esperadas (db.js):', Object.keys(expected).length);
  console.log('Tablas reales (DB):       ', tables.length);

  console.log('\n- Tablas que FALTAN en la DB:');
  console.log(missingTables.length ? missingTables : 'NINGUNA');

  console.log('\n- Tablas EXTRA en la DB:');
  console.log(extraTables.length ? extraTables : 'NINGUNA');

  console.log('\n- Columnas por tabla (sólo donde hay diferencias):');
  for (const r of perTable) {
    if (!r.missingCols.length && !r.extraCols.length) continue;
    console.log(`\n  Tabla: ${r.table}`);
    if (r.missingCols.length) console.log('   • Faltan en DB:', r.missingCols);
    if (r.extraCols.length)   console.log('   • Sobran en DB:', r.extraCols);
  }

  await pool.end();
  console.log('\n[verify] Listo.');
})().catch(e => { console.error(e); process.exit(10); });
