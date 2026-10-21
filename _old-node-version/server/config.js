'use strict';
const fs = require('fs');
const path = require('path');

// Environment: --env=production|development (npm scripts), else APP_ENV, else NODE_ENV. Default is development.
const argEnv = (process.argv.find(a => a.startsWith('--env=')) || '').slice(6);
const rawEnv = argEnv || process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const env = rawEnv === 'production' ? 'production' : 'development';

// Minimal env-file loader (no dependency). Real environment variables (e.g. set on Render) always win over the file.
for (const name of [`.env.${env}`, '.env']) {
  const envPath = path.join(__dirname, '..', name);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(String.fromCharCode(10))) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

module.exports = {
  env, isProd: env === 'production',
  port: num(process.env.PORT, 5500),
  sessionHours: num(process.env.SESSION_HOURS, 8),
  secureCookies: process.env.SECURE_COOKIES === '1',   // set to 1 when served over HTTPS
  trustProxy: num(process.env.TRUST_PROXY, 0),          // set to 1 behind one proxy (Render, nginx) so req.ip is the real visitor
  db: {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'LorDeCambodgeDB',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: process.env.DB_TRUST_CERT !== '0', enableArithAbort: true },   // DB_TRUST_CERT=0 for Azure SQL / hosted servers with a real certificate
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  }
};
