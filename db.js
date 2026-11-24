// Async DB layer. Production: Postgres via DATABASE_URL (Neon/Supabase/Render). Local dev/test: embedded Postgres (PGlite) in DATA_DIR.
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();
let impl;
const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };

async function init() {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { Pool } = require('pg');
    const pool = new Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : { host: process.env.PGHOST, user: process.env.PGUSER, database: process.env.PGDATABASE, password: process.env.PGPASSWORD, port: +(process.env.PGPORT || 5432) }), max: 5, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
    impl = {
      query: async (sql, p) => (await (als.getStore() || pool).query(sql, p)).rows,
      tx: async fn => {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const r = await als.run(c, fn); await c.query('COMMIT'); return r; }
        catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; } finally { c.release(); }
      },
    };
  } else {
    if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL or PGHOST is required in production');
    const { PGlite } = require('@electric-sql/pglite');
    const fs = require('node:fs'); const dir = process.env.DATA_DIR || path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
    const pg = new PGlite(path.join(dir, 'pgdata')); await pg.waitReady;
    let lock = Promise.resolve();
    impl = {
      query: async (sql, p) => (await pg.query(sql, p)).rows,
      tx: fn => { const run = lock.then(async () => { await pg.query('BEGIN'); try { const r = await fn(); await pg.query('COMMIT'); return r; } catch (e) { await pg.query('ROLLBACK'); throw e; } }); lock = run.catch(() => {}); return run; },
    };
  }
}
const all = async (sql, p = []) => impl.query(conv(sql), p);
const get = async (sql, p = []) => (await all(sql, p))[0];
const run = async (sql, p = []) => { await all(sql, p); };
const insert = async (sql, p = []) => Number((await all(sql + ' RETURNING id', p))[0].id);
const tx = fn => impl.tx(fn);
const exec = async sql => impl.query(sql, undefined);
module.exports = { init, all, get, run, insert, tx, exec };
