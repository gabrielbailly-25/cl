const fs = require('fs');
const path = require('path');

const required = [
  'src/server.js',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/manifest.webmanifest',
  'api/index.js',
  'api/[...path].js',
  'api/auth/[...path].js',
  'api/auth/google/callback.js',
  'api/reminders/test.js',
  'api/password-reset/request.js',
  'api/password-reset/confirm.js',
  'api/uploads/[...path].js',
  'scripts/import-agreements.js',
  'vercel.json',
];

for (const file of required) {
  const absolute = path.join(__dirname, '..', file);
  if (!fs.existsSync(absolute)) {
    console.error(`Falta ${file}`);
    process.exit(1);
  }
}

require('../src/server');
JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
console.log('Validación completada');
