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
