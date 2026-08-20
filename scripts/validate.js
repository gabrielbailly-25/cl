const fs = require('fs');
const path = require('path');

const required = [
  'src/server.js',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'Dockerfile',
];

for (const file of required) {
  const absolute = path.join(__dirname, '..', file);
  if (!fs.existsSync(absolute)) {
    console.error(`Falta ${file}`);
    process.exit(1);
  }
}

require('../src/server');
console.log('Validación completada');
