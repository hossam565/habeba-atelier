// Fills a running server with demo data (for testing/screenshots only). Usage: BASE=http://localhost:3000 node seed-demo.js
const BASE = process.env.BASE || 'http://localhost:3000';
let cookie = '';
async function api(m, u, b, login) {
  const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + j.error); return j;
}
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const svg = (c1, c2) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="300" height="400" fill="#f6ece9"/><path d="M150 40c14 0 22 10 22 24 0 16-8 26-12 42 20 18 52 50 62 250H78c10-200 42-232 62-250-4-16-12-26-12-42 0-14 8-24 22-24z" fill="url(#g)"/><path d="M120 110q30 20 60 0" stroke="#fff6" stroke-width="3" fill="none"/></svg>`).toString('base64');
(async () => {
  await api('POST', '/api/login', { username: 'owner', password: 'owner123' });
  const cats = await api('GET', '/api/categories'); const cid = n => cats.find(c => c.name === n).id;
  const items = [['101', 'سواريه أسود ستان', 'فساتين سواريه', 'M', 'أسود', 900, 500, '#1c1c28', '#5b3a6b'], ['102', 'سواريه أحمر مزين', 'فساتين سواريه', 'L', 'أحمر', 1100, 600, '#b3122f', '#e0556c'],
    ['103', 'سواريه أزرق ملكي', 'فساتين سواريه', 'M', 'أزرق', 1000, 500, '#143a8c', '#4a7be0'], ['201', 'فستان زفاف دانتيل', 'فساتين زفاف', 'M', 'أبيض', 3500, 2000, '#e9dfd6', '#fff'],
    ['202', 'فستان زفاف أميرة', 'فساتين زفاف', 'S', 'أوف وايت', 4200, 2500, '#d8cbbd', '#f7efe6'], ['301', 'فستان خطوبة وردي', 'فساتين خطوبة', 'M', 'وردي', 1400, 800, '#d86a96', '#f6b6cd'],
    ['302', 'فستان خطوبة ذهبي', 'فساتين خطوبة', 'L', 'ذهبي', 1600, 900, '#a67c1d', '#e8c45f'], ['104', 'سواريه أخضر زمردي', 'فساتين سواريه', 'S', 'أخضر', 950, 500, '#0d5c46', '#2fa37d']];
  const ids = {};
  for (const [code, name, cat, size, color, price, deposit, c1, c2] of items) {
    const f = await api('POST', '/api/files', { data: svg(c1, c2) });
    ids[code] = (await api('POST', '/api/dresses', { code, name, category_id: cid(cat), size, color, price, deposit, photo_id: f.id })).id;
  }
  const R = (code, name, s, e, extra) => api('POST', '/api/rentals', { dress_id: ids[code], customer_name: name, phone: '010' + Math.floor(1e7 + Math.random() * 9e7), national_id: '2990' + Math.floor(1e9 + Math.random() * 9e9), address: 'القاهرة - مدينة نصر', start_date: day(s), end_date: day(e), ...extra });
  const r1 = await R('101', 'منى أحمد علي', -2, 1, { price: 900, discount: 50, paid: 850, deposit: 500, deposit_paid: 500, handover_now: true });
  const r2 = await R('102', 'سارة محمود حسن', 2, 3, { price: 1100, discount: 0, paid: 400, deposit: 600, deposit_paid: 300 });
  await R('103', 'نهى إبراهيم', 0, 1, { price: 1000, discount: 100, paid: 500, deposit: 500, deposit_paid: 500 });
  const r4 = await R('201', 'ياسمين خالد', -5, -3, { price: 3500, discount: 200, paid: 3300, deposit: 2000, deposit_paid: 2000, handover_now: true });
  await api('POST', `/api/rentals/${r4.id}/return`, { action: 'partial', deducted: 600, note: 'قطع في الذيل وبقعة صعب تتشال', send_to_washing: false });
  await R('301', 'دعاء سعيد', -9, -8, { price: 1400, paid: 1400, deposit: 800, deposit_paid: 800, handover_now: true }).then(r => api('POST', `/api/rentals/${r.id}/return`, { action: 'refund' }));
  await api('POST', `/api/dresses/${ids['202']}/maintenance`, { kind: 'washing', expected_back: day(1), note: '' });
  await api('POST', `/api/dresses/${ids['302']}/maintenance`, { kind: 'repair', expected_back: day(4), note: 'تضييق' });
  // staff actions for the activity feed
  cookie = ''; await api('POST', '/api/login', { username: 'staff', password: 'staff123' });
  await R('104', 'هدى مصطفى', 6, 7, { price: 950, discount: 0, paid: 950, deposit: 500, deposit_paid: 500 });
  console.log('seeded');
})().catch(e => { console.error(e); process.exit(1); });
