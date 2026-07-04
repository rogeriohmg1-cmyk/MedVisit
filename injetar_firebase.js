// Script para injetar dados do MedVisit no Firebase
// Execute: node injetar_firebase.js

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// Carregar backup
const backupPath = path.join(__dirname, 'medvisit_backup__1_.json');
if (!fs.existsSync(backupPath)) {
  console.error('❌ Arquivo medvisit_backup__1_.json não encontrado!');
  console.error('   Coloque o backup na mesma pasta deste script.');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
console.log(`✅ Backup carregado: ${backup.visits.length} visitas, ${backup.docs.length} médicos`);

// Firebase
const DB_HOST = 'medvisit-7a564-default-rtdb.firebaseio.com';
const DB_PATH = '/medvisit/dados.json';

const payload = JSON.stringify({
  visits: backup.visits,
  docs:   backup.docs
});

const options = {
  hostname: DB_HOST,
  path:     DB_PATH,
  method:   'PUT',
  headers: {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('\n📤 Enviando dados para o Firebase...');

const req = https.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Dados injetados com sucesso no Firebase!');
      console.log('   Acesse o MedVisit no Vercel — os dados estarão lá!');
    } else {
      console.error(`❌ Erro ${res.statusCode}: ${body}`);
    }
  });
});

req.on('error', e => console.error('❌ Erro de conexão:', e.message));
req.write(payload);
req.end();
