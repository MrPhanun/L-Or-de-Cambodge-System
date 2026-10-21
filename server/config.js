'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency). Real environment variables win over the file.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

module.exports = {
  port: num(process.env.PORT, 5500),
  sessionHours: num(process.env.SESSION_HOURS, 8),
  secureCookies: process.env.SECURE_COOKIES === '1',   // set to 1 when served over HTTPS
  db: {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'LorDeCambodgeDB',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  }
};
