'use strict';
const sql = require('mssql');
const config = require('./config');

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config.db).connect().catch((e) => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

/** Run a parameterised query. `conn` may be a Transaction. Always use @name placeholders - never string-concat user input. */
async function q(text, params = {}, conn) {
  const req = conn ? new sql.Request(conn) : (await getPool()).request();
  for (const [k, v] of Object.entries(params)) req.input(k, v === undefined ? null : v);
  const r = await req.query(text);
  return r.recordset || [];
}
async function one(text, params, conn) { return (await q(text, params, conn))[0] || null; }

/** Run fn(tx) inside a transaction; rolls back on any error. */
async function tx(fn) {
  const t = new sql.Transaction(await getPool());
  await t.begin();
  try { const r = await fn(t); await t.commit(); return r; }
  catch (e) { try { await t.rollback(); } catch { /* already aborted */ } throw e; }
}

module.exports = { sql, getPool, q, one, tx };
