const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;
const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'consejo.json');

if (!databaseUrl) {
  console.error('DATABASE_URL es obligatorio para importar los datos.');
  process.exit(1);
}

if (!fs.existsSync(dataFile)) {
  console.error(`No existe el archivo de datos: ${dataFile}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
} catch (error) {
  console.error(`No se pudo leer el JSON local: ${error.message}`);
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS consejo_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    data jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const result = await pool.query(
    'INSERT INTO consejo_state (id, data) VALUES (true, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(data)],
  );
  console.log(result.rowCount ? 'Datos locales importados en Neon.' : 'Neon ya contiene datos; no se ha sobrescrito nada.');
})().catch((error) => {
  console.error(`No se pudo importar en Neon: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());

function loadEnvFile() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2];
    process.env[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}
