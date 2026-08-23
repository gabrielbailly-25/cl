const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

loadEnvFile();

const sourceFile = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!sourceFile || !fs.existsSync(sourceFile)) {
  console.error('Indica la ruta de un CSV existente.');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(sourceFile, 'utf8'));
const headers = rows.shift().map(text);
const agreements = rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, text(values[index])]))).filter((row) => row['Categoría'].toLowerCase() === 'acuerdo' && row.Asunto).map(toAgreement);

if (dryRun) {
  console.log(JSON.stringify({
    total: agreements.length,
    sanMiguel: agreements.filter((item) => item.dashboardId === 'san-miguel').length,
    sanRafael: agreements.filter((item) => item.dashboardId === 'san-rafael').length,
    items: agreements.map(({ dashboardId, date, title }) => ({ dashboardId, date, title })),
  }, null, 2));
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL es obligatorio para importar acuerdos en Neon.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT data FROM consejo_state WHERE id = true FOR UPDATE');
    if (!result.rowCount) throw new Error('No existe el estado inicial de Consejo local en Neon.');
    const data = result.rows[0].data;
    let added = 0;
    let skipped = 0;
    for (const item of agreements) {
      const dashboard = data.dashboards && data.dashboards[item.dashboardId];
      if (!dashboard) throw new Error(`No existe la reunión ${item.dashboardId}.`);
      dashboard.agreements = Array.isArray(dashboard.agreements) ? dashboard.agreements : [];
      if (dashboard.agreements.some((agreement) => agreement.title === item.title && agreement.date === item.date)) {
        skipped += 1;
        continue;
      }
      dashboard.agreements.push({ id: crypto.randomBytes(8).toString('hex'), date: item.date, title: item.title, description: item.description });
      added += 1;
    }
    await client.query('UPDATE consejo_state SET data = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = true', [JSON.stringify(data)]);
    await client.query('COMMIT');
    console.log(`Acuerdos importados: ${added}. Omitidos por existir ya: ${skipped}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
})().catch((error) => {
  console.error(`No se pudieron importar los acuerdos: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());

function toAgreement(row) {
  const group = row.cl.toUpperCase();
  const title = row.Asunto;
  const dashboardId = group === 'SR' || (!group && /\b(?:sr|san rafael)\b/i.test(title)) ? 'san-rafael' : 'san-miguel';
  const attachment = row.Adjunto ? `\n\nAdjunto: ${row.Adjunto}` : '';
  return { dashboardId, date: parseDate(row['Fecha acuerdo'] || row.Fecha), title, description: `${row.Desarrollo}${attachment}`.trim() };
}

function parseDate(value) {
  const numeric = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!numeric) return '';
  const [, day, month, rawYear] = numeric;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((item) => item)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  row.push(value);
  if (row.some((item) => item)) rows.push(row);
  return rows;
}

function text(value) {
  return String(value || '').trim();
}

function loadEnvFile() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = /^(['"]).*\1$/.test(match[2]) ? match[2].slice(1, -1) : match[2];
  }
}
