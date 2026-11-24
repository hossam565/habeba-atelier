// Habeba El Aqsa - atelier management. Zero dependencies. Node >= 22.5 (node:sqlite).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DB = require('./db');
const { all, get, run, insert, tx } = DB;
const SCHEMA = [
`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE, name TEXT, role TEXT, salt TEXT, hash TEXT, active INTEGER DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created DOUBLE PRECISION)`,
`CREATE TABLE IF NOT EXISTS files(id SERIAL PRIMARY KEY, mime TEXT, data BYTEA, created TEXT)`,
`CREATE TABLE IF NOT EXISTS categories(id SERIAL PRIMARY KEY, name TEXT UNIQUE)`,
`CREATE TABLE IF NOT EXISTS dresses(id SERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT, category_id INTEGER, size TEXT, color TEXT, price DOUBLE PRECISION DEFAULT 0, deposit DOUBLE PRECISION DEFAULT 0, notes TEXT, photo_id INTEGER, deleted INTEGER DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS rentals(id SERIAL PRIMARY KEY, dress_id INTEGER, customer_name TEXT, phone TEXT, national_id TEXT, address TEXT, id_photo_id INTEGER,
  start_date TEXT, end_date TEXT, price DOUBLE PRECISION DEFAULT 0, discount DOUBLE PRECISION DEFAULT 0, deposit DOUBLE PRECISION DEFAULT 0, status TEXT, notes TEXT,
  out_at TEXT, returned_at TEXT, deposit_deducted DOUBLE PRECISION DEFAULT 0, deposit_note TEXT, created_by TEXT, created_at TEXT)`,
`CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY, rental_id INTEGER, kind TEXT, amount DOUBLE PRECISION, day TEXT, at TEXT, by_user TEXT)`,
`CREATE TABLE IF NOT EXISTS maintenance(id SERIAL PRIMARY KEY, dress_id INTEGER, kind TEXT, start_date TEXT, expected_back TEXT, note TEXT, done_at TEXT, by_user TEXT)`,
`CREATE TABLE IF NOT EXISTS activity(id SERIAL PRIMARY KEY, user_name TEXT, role TEXT, action TEXT, detail TEXT, at TEXT)`,
`CREATE INDEX IF NOT EXISTS i_rent_dress ON rentals(dress_id)`, `CREATE INDEX IF NOT EXISTS i_pay_rental ON payments(rental_id)`, `CREATE INDEX IF NOT EXISTS i_pay_day ON payments(day)`,
];
// ---------- helpers ----------
const fmtDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const today = () => fmtDay(new Date());
const mapA = (arr, f) => Promise.all(arr.map(x => f(x)));
const nowISO = () => new Date().toISOString();
const dmy = d => String(d).split('-').reverse().join('/');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
async function addUser(username, name, role, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  (await run('INSERT INTO users(username,name,role,salt,hash) VALUES(?,?,?,?,?)', [username, name, role, salt, hashPw(pw, salt)]));
}
async function seed() {
  if (await get('SELECT 1 FROM users')) return;
  {
  await addUser('owner', 'صاحبة الأتيليه', 'owner', process.env.OWNER_PASSWORD || 'owner123');
  await addUser('staff', 'الموظف', 'staff', process.env.STAFF_PASSWORD || 'staff123');
  for (const c of ['فساتين سواريه', 'فساتين زفاف', 'فساتين خطوبة', 'إكسسوارات']) (await run('INSERT INTO categories(name) VALUES(?)', [c]));
  }
}
async function log(u, action, detail) {
  (await run('INSERT INTO activity(user_name,role,action,detail,at) VALUES(?,?,?,?,?)', [u.name, u.role, action, detail || '', nowISO()]));
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = m => new HttpError(400, m);

// ---------- business logic ----------
async function conflicts(dressId, start, end, excludeRental) {
  const t = today();
  const out = [];
  for (const r of (await all("SELECT * FROM rentals WHERE dress_id=? AND status IN ('booked','out')", [dressId]))) {
    if (r.id === excludeRental) continue;
    const rEnd = r.status === 'out' && r.end_date < t ? t : r.end_date;
    if (!(rEnd < start || r.start_date > end)) out.push(`محجوز/خارج من ${r.start_date} إلى ${rEnd} (${r.customer_name})`);
  }
  for (const m of (await all('SELECT * FROM maintenance WHERE dress_id=? AND done_at IS NULL', [dressId]))) {
    const mEnd = m.expected_back < today() ? today() : m.expected_back;
    if (!(mEnd < start || m.start_date > end)) out.push(`${m.kind === 'washing' ? 'في الغسيل' : 'في التصليح'} لحد ${m.expected_back}`);
  }
  return out;
}
async function dressStatus(d) {
  const t = today();
  const out = (await get("SELECT * FROM rentals WHERE dress_id=? AND status='out' ORDER BY id DESC LIMIT 1", [d.id]));
  if (out) return { key: 'out', label: `خارج - يرجع ${out.end_date}`, overdue: out.end_date < t, rental_id: out.id, until: out.end_date };
  const m = (await get('SELECT * FROM maintenance WHERE dress_id=? AND done_at IS NULL ORDER BY id DESC LIMIT 1', [d.id]));
  if (m) return { key: m.kind, label: `${m.kind === 'washing' ? 'في الغسيل' : 'تصليح / تعديل'} - يرجع ${m.expected_back}`, until: m.expected_back, maintenance_id: m.id };
  const b = (await get("SELECT * FROM rentals WHERE dress_id=? AND status='booked' AND end_date>=? ORDER BY start_date LIMIT 1", [d.id, t]));
  if (b) return { key: 'booked', label: `محجوز ${b.start_date}`, until: b.start_date, rental_id: b.id };
  return { key: 'available', label: 'متاح' };
}
async function dressRow(d) {
  const cat = d.category_id ? (await get('SELECT name FROM categories WHERE id=?', [d.category_id])) : null;
  return { ...d, category: cat ? cat.name : '', status: await dressStatus(d) };
}
async function rentalView(r, withPayments) {
  const pay = (await all('SELECT * FROM payments WHERE rental_id=? ORDER BY id', [r.id]));
  const sum = k => pay.filter(p => p.kind === k).reduce((a, p) => a + p.amount, 0);
  const d = (await get('SELECT code,name FROM dresses WHERE id=?', [r.dress_id])) || {};
  const total = r.price - r.discount, paid = sum('rental');
  const dep_in = sum('deposit'), dep_back = sum('deposit_refund');
  const v = { ...r, dress_code: d.code, dress_name: d.name, total, paid, remaining: total - paid, deposit_paid: dep_in, deposit_refunded: dep_back,
    late_fees: sum('late_fee'), deposit_held: r.status === 'returned' || r.status === 'cancelled' ? 0 : dep_in - dep_back,
    overdue: r.status === 'out' && r.end_date < today() };
  if (withPayments) v.payments = pay;
  return v;
}
async function addPayment(rid, kind, amount, user, day) {
  if (!(amount > 0) && kind !== 'deduction') throw bad('المبلغ لازم يكون أكبر من صفر');
  if (amount <= 0) return;
  (await run('INSERT INTO payments(rental_id,kind,amount,day,at,by_user) VALUES(?,?,?,?,?,?)', [rid, kind, amount, day || today(), nowISO(), user.name]));
}
async function saveFile(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m || !/^image\//.test(m[1])) throw bad('الصورة غير صالحة');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6e6) throw bad('الصورة كبيرة قوي');
  return ((await insert('INSERT INTO files(mime,data,created) VALUES(?,?,?)', [m[1], buf, nowISO()])));
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), role, fn });

route('POST', '/api/login', null, async (c) => {
  const { username, password } = c.body;
  const u = (await get('SELECT * FROM users WHERE username=? AND active=1', [String(username || '').trim()]));
  if (!u || hashPw(password || '', u.salt) !== u.hash) throw new HttpError(401, 'اسم المستخدم أو كلمة السر غلط');
  const token = crypto.randomBytes(32).toString('hex');
  (await run('INSERT INTO sessions VALUES(?,?,?)', [token, u.id, Date.now()]));
  await log(u, 'دخول', 'سجّل دخول');
  c.headers['Set-Cookie'] = `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  return { user: { name: u.name, role: u.role, username: u.username } };
});
route('POST', '/api/logout', 'any', async (c) => {
  (await run('DELETE FROM sessions WHERE token=?', [c.token]));
  c.headers['Set-Cookie'] = 'sid=; Path=/; Max-Age=0';
  return { ok: true };
});
route('GET', '/api/me', 'any', async c => ({ user: { name: c.user.name, role: c.user.role, username: c.user.username }, today: today() }));

route('POST', '/api/files', 'any', async c => ({ id: await saveFile(c.body.data) }));

route('GET', '/api/categories', 'any', async () => (await all('SELECT c.*,(SELECT COUNT(*)::int FROM dresses d WHERE d.category_id=c.id AND d.deleted=0) AS count FROM categories c ORDER BY name')));
route('POST', '/api/categories', 'owner', async c => {
  const name = String(c.body.name || '').trim(); if (!name) throw bad('اكتب اسم القسم');
  try { (await run('INSERT INTO categories(name) VALUES(?)', [name])); } catch { throw bad('القسم موجود بالفعل'); }
  await log(c.user, 'إضافة قسم', name); return { ok: true };
});
route('DELETE', '/api/categories/:id', 'owner', async c => {
  (await run('UPDATE dresses SET category_id=NULL WHERE category_id=?', [c.params.id]));
  (await run('DELETE FROM categories WHERE id=?', [c.params.id]));
  await log(c.user, 'حذف قسم', '#' + c.params.id); return { ok: true };
});

route('GET', '/api/dresses', 'any', async () => await mapA(await all('SELECT * FROM dresses WHERE deleted=0 ORDER BY code'), dressRow));
route('GET', '/api/dresses/:id', 'any', async c => {
  const d = (await get('SELECT * FROM dresses WHERE id=? AND deleted=0', [c.params.id])); if (!d) throw new HttpError(404, 'الفستان مش موجود');
  const rentals = (await mapA((await all("SELECT * FROM rentals WHERE dress_id=? ORDER BY start_date DESC LIMIT 30", [d.id])), rentalView));
  const maintenance = (await all('SELECT * FROM maintenance WHERE dress_id=? ORDER BY id DESC LIMIT 15', [d.id]));
  return { ...dressRow(d), rentals, maintenance };
});
function dressInput(b) {
  const code = String(b.code || '').trim(); if (!code) throw bad('اكتب رقم الفستان');
  return [code, String(b.name || '').trim(), b.category_id || null, String(b.size || ''), String(b.color || ''), num(b.price), num(b.deposit), String(b.notes || ''), b.photo_id || null];
}
route('POST', '/api/dresses', 'owner', async c => {
  try {
    const id = ((await insert('INSERT INTO dresses(code,name,category_id,size,color,price,deposit,notes,photo_id) VALUES(?,?,?,?,?,?,?,?,?)', [...dressInput(c.body)])));
    await log(c.user, 'إضافة فستان', `رقم ${c.body.code}`); return { id };
  } catch (e) { if (e instanceof HttpError) throw e; throw bad('رقم الفستان ده مستخدم قبل كده'); }
});
route('PUT', '/api/dresses/:id', 'owner', async c => {
  try { (await run('UPDATE dresses SET code=?,name=?,category_id=?,size=?,color=?,price=?,deposit=?,notes=?,photo_id=COALESCE(?,photo_id) WHERE id=?', [...dressInput(c.body), c.params.id])); }
  catch (e) { if (e instanceof HttpError) throw e; throw bad('رقم الفستان ده مستخدم قبل كده'); }
  await log(c.user, 'تعديل فستان', `رقم ${c.body.code}`); return { ok: true };
});
route('DELETE', '/api/dresses/:id', 'owner', async c => {
  const d = (await get('SELECT * FROM dresses WHERE id=?', [c.params.id])); if (!d) throw new HttpError(404, 'مش موجود');
  if ((await get("SELECT 1 FROM rentals WHERE dress_id=? AND status IN ('booked','out')", [d.id]))) throw bad('الفستان عليه حجز أو خارج، خلّصه الأول');
  (await run("UPDATE dresses SET deleted=1, code=code||'#del'||id WHERE id=?", [d.id]));
  await log(c.user, 'حذف فستان', `رقم ${d.code}`); return { ok: true };
});

route('POST', '/api/dresses/:id/maintenance', 'any', async c => {
  const d = (await get('SELECT * FROM dresses WHERE id=? AND deleted=0', [c.params.id])); if (!d) throw new HttpError(404, 'مش موجود');
  const kind = c.body.kind === 'repair' ? 'repair' : 'washing';
  if (!isDate(c.body.expected_back)) throw bad('اختار ميعاد الرجوع');
  if ((await get("SELECT 1 FROM rentals WHERE dress_id=? AND status='out'", [d.id]))) throw bad('الفستان خارج مع عميلة حاليا');
  (await run('INSERT INTO maintenance(dress_id,kind,start_date,expected_back,note,by_user) VALUES(?,?,?,?,?,?)', [d.id, kind, today(), c.body.expected_back, String(c.body.note || ''), c.user.name]));
  await log(c.user, kind === 'washing' ? 'غسيل' : 'تصليح', `فستان ${d.code} يرجع ${dmy(c.body.expected_back)}`); return { ok: true };
});
route('POST', '/api/maintenance/:id/done', 'any', async c => {
  const m = (await get('SELECT * FROM maintenance WHERE id=?', [c.params.id])); if (!m) throw new HttpError(404, 'مش موجود');
  (await run('UPDATE maintenance SET done_at=? WHERE id=?', [nowISO(), m.id]));
  const d = (await get('SELECT code FROM dresses WHERE id=?', [m.dress_id]));
  await log(c.user, 'رجع من ' + (m.kind === 'washing' ? 'الغسيل' : 'التصليح'), `فستان ${d.code} بقى متاح`); return { ok: true };
});

route('GET', '/api/rentals', 'any', async c => {
  const q = c.query, t = today();
  let rows = (await mapA((await all('SELECT * FROM rentals ORDER BY id DESC LIMIT 500')), rentalView));
  if (q.status === 'active') rows = rows.filter(r => r.status === 'booked' || r.status === 'out');
  else if (q.status) rows = rows.filter(r => r.status === q.status);
  if (q.view === 'pickup_today') rows = rows.filter(r => r.status === 'booked' && r.start_date <= t);
  if (q.view === 'tomorrow') { const tm = fmtDay(new Date(Date.now() + 864e5)); rows = rows.filter(r => (r.status === 'booked' && r.start_date === tm) || (r.status === 'out' && r.end_date === tm)); }
  if (q.view === 'return_due') rows = rows.filter(r => r.status === 'out' && r.end_date <= t);
  if (q.q) { const s = q.q.toLowerCase(); rows = rows.filter(r => [r.customer_name, r.phone, r.dress_code, r.dress_name, r.national_id].join(' ').toLowerCase().includes(s)); }
  return rows;
});
route('GET', '/api/rentals/:id', 'any', async c => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id])); if (!r) throw new HttpError(404, 'مش موجود');
  return await rentalView(r, true);
});
route('POST', '/api/rentals', 'any', async c => tx(async () => {
  const b = c.body, t = today();
  const d = (await get('SELECT * FROM dresses WHERE id=? AND deleted=0', [b.dress_id])); if (!d) throw bad('اختار الفستان');
  if (!String(b.customer_name || '').trim()) throw bad('اكتب اسم العميلة');
  if (!isDate(b.start_date) || !isDate(b.end_date)) throw bad('اختار تاريخ الاستلام والرجوع');
  if (b.end_date < b.start_date) throw bad('تاريخ الرجوع قبل تاريخ الاستلام');
  const price = num(b.price), discount = num(b.discount);
  if (discount > price) throw bad('الخصم أكبر من السعر');
  const cf = await conflicts(d.id, b.start_date, b.end_date);
  if (cf.length) throw bad('الفستان مش متاح في الفترة دي: ' + cf[0]);
  const idPhoto = b.id_photo ? await saveFile(b.id_photo) : null;
  const handover = !!b.handover_now;
  const rid = ((await insert(`INSERT INTO rentals(dress_id,customer_name,phone,national_id,address,id_photo_id,start_date,end_date,price,discount,deposit,status,notes,out_at,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [d.id, String(b.customer_name).trim(), String(b.phone || ''), String(b.national_id || ''), String(b.address || ''), idPhoto,
    b.start_date, b.end_date, price, discount, num(b.deposit), handover ? 'out' : 'booked', String(b.notes || ''), handover ? nowISO() : null, c.user.name, nowISO()])));
  if (num(b.paid) > 0) await addPayment(rid, 'rental', Math.min(num(b.paid), price - discount), c.user);
  if (num(b.deposit_paid) > 0) await addPayment(rid, 'deposit', num(b.deposit_paid), c.user);
  await log(c.user, handover ? 'تسليم فستان' : 'حجز جديد', `فستان ${d.code} للعميلة ${b.customer_name} من ${dmy(b.start_date)} إلى ${dmy(b.end_date)} (إجمالي ${price - discount})`);
  return { id: rid };
}));
route('POST', '/api/rentals/:id/pay', 'any', async c => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id])); if (!r) throw new HttpError(404, 'مش موجود');
  const kind = c.body.kind === 'deposit' ? 'deposit' : 'rental';
  const amt = num(c.body.amount);
  if (kind === 'rental') { const v = await rentalView(r); if (amt > v.remaining + 0.001) throw bad('المبلغ أكبر من المتبقي ' + v.remaining); }
  await addPayment(r.id, kind, amt, c.user);
  await log(c.user, kind === 'rental' ? 'دفعة إيجار' : 'دفع تأمين', `${amt} جنيه - ${r.customer_name}`); return { ok: true };
});
route('POST', '/api/rentals/:id/handover', 'any', async c => tx(async () => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id]));
  if (!r || r.status !== 'booked') throw bad('الحجز ده مش في حالة حجز');
  const m = (await get('SELECT * FROM maintenance WHERE dress_id=? AND done_at IS NULL', [r.dress_id]));
  if (m) throw bad('الفستان لسه في الغسيل أو التصليح، رجّعه الأول');
  if ((await get("SELECT 1 FROM rentals WHERE dress_id=? AND status='out'", [r.dress_id]))) throw bad('الفستان لسه خارج مع عميلة تانية');
  (await run("UPDATE rentals SET status='out', out_at=? WHERE id=?", [nowISO(), r.id]));
  const d = (await get('SELECT code FROM dresses WHERE id=?', [r.dress_id]));
  await log(c.user, 'تسليم فستان', `فستان ${d.code} للعميلة ${r.customer_name}`); return { ok: true };
}));
route('POST', '/api/rentals/:id/return', 'any', async c => tx(async () => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id]));
  if (!r || r.status !== 'out') throw bad('الفستان مش خارج');
  const v = await rentalView(r), held = v.deposit_paid - v.deposit_refunded;
  let ded = Math.max(0, num(c.body.deducted));
  if (c.body.action === 'refund') ded = 0; else if (c.body.action === 'deduct_all') ded = held;
  if (ded > held + 0.001) throw bad('الخصم أكبر من التأمين المدفوع (' + held + ')');
  if (ded > 0 && !String(c.body.note || '').trim()) throw bad('اكتب سبب الخصم من التأمين');
  const back = held - ded;
  (await run("UPDATE rentals SET status='returned', returned_at=?, deposit_deducted=?, deposit_note=? WHERE id=?", [nowISO(), ded, String(c.body.note || ''), r.id]));
  if (back > 0) await addPayment(r.id, 'deposit_refund', back, c.user);
  if (ded > 0) await addPayment(r.id, 'deduction', ded, c.user);
  const lateFee = Math.max(0, num(c.body.late_fee));
  if (lateFee > 0) await addPayment(r.id, 'late_fee', lateFee, c.user);
  const d = (await get('SELECT code FROM dresses WHERE id=?', [r.dress_id]));
  if (c.body.send_to_washing) {
    const eb = isDate(c.body.washing_back) ? c.body.washing_back : fmtDay(new Date(Date.now() + 2 * 864e5));
    (await run('INSERT INTO maintenance(dress_id,kind,start_date,expected_back,note,by_user) VALUES(?,?,?,?,?,?)', [r.dress_id, 'washing', today(), eb, 'بعد الإرجاع', c.user.name]));
  }
  await log(c.user, 'استلام فستان', `فستان ${d.code} من ${r.customer_name} - تأمين مردود ${back}${lateFee ? '، غرامة تأخير ' + lateFee : ''}${ded ? '، مخصوم ' + ded + ' (' + c.body.note + ')' : ''}`);
  return { ok: true, refunded: back, deducted: ded, late_fee: lateFee };
}));
route('POST', '/api/rentals/:id/cancel', 'owner', async c => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id]));
  if (!r || r.status !== 'booked') throw bad('الإلغاء للحجوزات بس');
  const v = await rentalView(r);
  (await run("UPDATE rentals SET status='cancelled' WHERE id=?", [r.id]));
  if (v.deposit_paid - v.deposit_refunded > 0) await addPayment(r.id, 'deposit_refund', v.deposit_paid - v.deposit_refunded, c.user);
  await log(c.user, 'إلغاء حجز', `${r.customer_name}`); return { ok: true };
});
route('PUT', '/api/rentals/:id', 'owner', async c => {
  const r = (await get('SELECT * FROM rentals WHERE id=?', [c.params.id])); if (!r) throw new HttpError(404, 'مش موجود');
  const b = c.body;
  if (isDate(b.start_date) && isDate(b.end_date)) {
    const cf = await conflicts(r.dress_id, b.start_date, b.end_date, r.id); if (cf.length) throw bad('تعارض: ' + cf[0]);
  }
  (await run('UPDATE rentals SET customer_name=?,phone=?,national_id=?,address=?,start_date=?,end_date=?,price=?,discount=?,deposit=?,notes=? WHERE id=?', [b.customer_name ?? r.customer_name, b.phone ?? r.phone, b.national_id ?? r.national_id, b.address ?? r.address, isDate(b.start_date) ? b.start_date : r.start_date, isDate(b.end_date) ? b.end_date : r.end_date,
      b.price != null ? num(b.price) : r.price, b.discount != null ? num(b.discount) : r.discount, b.deposit != null ? num(b.deposit) : r.deposit, b.notes ?? r.notes, r.id]));
  await log(c.user, 'تعديل حجز', `#${r.id} ${r.customer_name}`); return { ok: true };
});

route('GET', '/api/accounts', 'owner', async c => {
  const day = isDate(c.query.date) ? c.query.date : today();
  const month = /^\d{4}-\d{2}$/.test(c.query.month || '') ? c.query.month : day.slice(0, 7);
  const sumFor = async (cond, arg) => {
    const rows = (await all(`SELECT kind, SUM(amount)::float8 s, COUNT(*)::int n FROM payments WHERE ${cond} GROUP BY kind`, [arg]));
    const g = k => (rows.find(r => r.kind === k) || { s: 0 }).s;
    const rental = g('rental'), dep = g('deposit'), refund = g('deposit_refund'), ded = g('deduction'), late = g('late_fee');
    return { rental_income: rental, deposits_in: dep, deposits_refunded: refund, deposits_kept: ded, late_fees: late, net_cash: rental + dep - refund + late, revenue: rental + ded + late };
  };
  const dayS = await sumFor('day=?', day), monS = await sumFor("substr(day,1,7)=?", month);
  const cnt = async (cond, arg) => (await get(`SELECT COUNT(*)::int n FROM rentals WHERE ${cond} AND status!='cancelled'`, [arg])).n;
  dayS.rentals = await cnt("substr(created_at,1,10)=?", day); monS.rentals = await cnt("substr(created_at,1,7)=?", month);
  dayS.returned = (await get("SELECT COUNT(*)::int n FROM rentals WHERE status='returned' AND substr(returned_at,1,10)=?", [day])).n;
  const inv = (await mapA((await all("SELECT * FROM rentals WHERE status!='cancelled' AND (substr(created_at,1,7)=? OR id IN (SELECT rental_id FROM payments WHERE substr(day,1,7)=?)) ORDER BY id DESC", [month, month])), rentalView));
  const open_deposits = (await mapA((await all("SELECT * FROM rentals WHERE status IN ('booked','out')")), rentalView)).reduce((a, r) => a + r.deposit_held, 0);
  const unpaid = (await mapA((await all("SELECT * FROM rentals WHERE status IN ('booked','out')")), rentalView)).filter(r => r.remaining > 0).reduce((a, r) => a + r.remaining, 0);
  const todayInv = (await mapA((await all("SELECT * FROM rentals WHERE status!='cancelled' AND (substr(created_at,1,10)=? OR id IN (SELECT rental_id FROM payments WHERE day=?)) ORDER BY id DESC", [day, day])), rentalView));
  const top = [...inv].sort((a, b) => b.total - a.total).slice(0, 5);
  return { day, month, today: dayS, month_totals: monS, invoices_today: todayInv, invoices_month: inv, top_invoices: top, open_deposits, unpaid };
});
route('GET', '/api/activity', 'owner', async c => {
  const since = Number(c.query.since || 0);
  return (await all('SELECT * FROM activity WHERE id>? ORDER BY id DESC LIMIT 100', [since]));
});
route('GET', '/api/users', 'owner', async () => (await all('SELECT id,username,name,role,active FROM users')));
route('POST', '/api/users', 'owner', async c => {
  const { username, name, password } = c.body;
  if (!username || !password || String(password).length < 4) throw bad('اسم المستخدم وكلمة سر (4 حروف على الأقل)');
  try { await addUser(String(username).trim(), name || username, 'staff', password); } catch { throw bad('اسم المستخدم موجود'); }
  await log(c.user, 'إضافة موظف', username); return { ok: true };
});
route('PUT', '/api/users/:id', 'owner', async c => {
  const u = (await get('SELECT * FROM users WHERE id=?', [c.params.id])); if (!u) throw new HttpError(404, 'مش موجود');
  if (c.body.password) {
    if (String(c.body.password).length < 4) throw bad('كلمة السر قصيرة');
    const salt = crypto.randomBytes(16).toString('hex');
    (await run('UPDATE users SET salt=?,hash=? WHERE id=?', [salt, hashPw(c.body.password, salt), u.id]));
    (await run('DELETE FROM sessions WHERE user_id=?', [u.id]));
  }
  if (c.body.name) (await run('UPDATE users SET name=? WHERE id=?', [String(c.body.name), u.id]));
  if (c.body.active != null && u.role !== 'owner') { (await run('UPDATE users SET active=? WHERE id=?', [c.body.active ? 1 : 0, u.id])); if (!c.body.active) (await run('DELETE FROM sessions WHERE user_id=?', [u.id])); }
  await log(c.user, 'تعديل حساب', u.username); return { ok: true };
});

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(__dirname, 'public');
const attempts = new Map();

function readBody(req) {
  if (req.body !== undefined && req.body !== null && !(typeof req.on === 'function' && req.readable && req.body === '')) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(req.body.length ? JSON.parse(String(req.body)) : {}); } catch { return Promise.reject(bad('طلب غير صالح')); }
  }
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > 10e6) { rej(bad('الملف كبير')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { rej(bad('طلب غير صالح')); } });
  });
}
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };

let ready;
const boot = () => ready || (ready = (async () => {
  await DB.init();
  for (const q of SCHEMA) await DB.exec(q);
  await seed();
})());

const handler = async (req, res) => {
  await boot();
  const url = new URL(req.url, 'http://x'); if (url.searchParams.get('__dbg')) return send(res, 200, { url: req.url, method: req.method, n: routes.length });
  try {
    if (url.pathname.startsWith('/api/')) {
      const cookie = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).map(s => s.split('=')).filter(a => a[0]));
      const token = cookie.sid;
      const sess = token && (await get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1 AND s.created>?', [token, Date.now() - 30 * 864e5]));
      const m = url.pathname.match(/^\/api\/files\/(\d+)$/);
      if (m && req.method === 'GET') {
        if (!sess) return send(res, 401, { error: 'سجّل دخول' });
        const f = (await get('SELECT * FROM files WHERE id=?', [m[1]]));
        if (!f) return send(res, 404, { error: 'مش موجود' });
        res.writeHead(200, { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(Buffer.from(f.data));
      }
      const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'مش موجود' });
      if (r.role && !sess) return send(res, 401, { error: 'سجّل دخول' });
      if (r.role === 'owner' && sess.role !== 'owner') return send(res, 403, { error: 'الصلاحية للمالكة بس' });
      if (r.fn === routes[0].fn) {
        const ip = req.socket.remoteAddress, a = attempts.get(ip) || { n: 0, t: Date.now() };
        if (Date.now() - a.t > 6e5) { a.n = 0; a.t = Date.now(); }
        if (a.n >= 15) return send(res, 429, { error: 'محاولات كتير، استنى شوية' });
        a.n++; attempts.set(ip, a);
      }
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const ctx = { body, params: m ? {} : r.re.exec(url.pathname).groups || {}, query: Object.fromEntries(url.searchParams), user: sess, token, headers: {} };
      const out = await r.fn(ctx);
      return send(res, 200, out, ctx.headers);
    }
    // static
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    if (e && e.code === '22P02') return send(res, 400, { error: 'بيانات غير صالحة، راجع الخانات' });
    console.error(e); send(res, 500, { error: 'حصلت مشكلة في السيرفر' });
  }
};

module.exports = handler;
if (require.main === module) {
  boot().then(() => http.createServer(handler).listen(PORT, () => console.log('Habeba El Aqsa running on port ' + PORT))).catch(e => { console.error(e); process.exit(1); });
}
