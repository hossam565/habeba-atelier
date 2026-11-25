'use strict';
const $app = document.getElementById('app');
let ME = null, TODAY = '', TAB = 'home', pollTimer = null, lastActId = 0;
const S = { dresses: [], cats: [], filterCat: 0, filterStatus: '', q: '', rentFilter: 'active', rentQ: '' };
const STATUS_AR = { booked: 'محجوز', out: 'خارج', returned: 'تم الاسترجاع', cancelled: 'ملغي' };
const BADGE_AR = { available: 'متاح', booked: 'محجوز', out: 'خارج', washing: 'غسيل', repair: 'تصليح' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fd = s => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '';
const money = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US') + ' ج';
const ft = iso => { const d = new Date(iso); return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }); };
const isOwner = () => ME && ME.role === 'owner';

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 401 && url !== '/api/login') { ME = null; renderLogin(); throw new Error('سجّل دخول'); }
  if (!r.ok) throw new Error(j.error || 'حصلت مشكلة');
  return j;
}
function toast(msg, err) { const t = document.getElementById('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', err ? 4500 : 2200); }
async function run(fn) { try { return await fn(); } catch (e) { toast(e.message, true); } }
function modal(html) { closeModal(); const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal'; m.innerHTML = `<div class="sheet">${html}</div>`; m.addEventListener('click', e => { if (e.target === m) closeModal(); }); document.body.appendChild(m); }
function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }
const val = id => document.getElementById(id).value;

function resizeImage(file, max = 1100) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .82)); };
    img.onerror = () => rej(new Error('مقدرتش أفتح الصورة')); img.src = url;
  });
}
const photoPicker = (id, label, capture) => `<div class="photo-pick" onclick="document.getElementById('${id}_f').click()" id="${id}_box">📷 ${label}</div><input type="file" accept="image/*" ${capture ? 'capture="environment"' : ''} id="${id}_f" hidden onchange="pickPhoto('${id}',this)"><input type="hidden" id="${id}">`;
async function pickPhoto(id, inp) { if (!inp.files[0]) return; await run(async () => { const d = await resizeImage(inp.files[0]); document.getElementById(id).value = d; document.getElementById(id + '_box').innerHTML = `<img src="${d}">`; }); }

// ---------- shell ----------
function shell(title, body, opts = {}) {
  const tabs = [['home', '🏠', 'الرئيسية'], ['dresses', '👗', 'الفساتين'], ['new', '+', 'حجز'], ['handover', '🤝', 'التسليم'], ['more', '☰', 'المزيد']];
  $app.innerHTML = `<header class="top">${opts.back ? `<button onclick="${opts.back}">→</button>` : ''}<h1>${esc(title)}</h1><span class="who">${esc(ME.name)}</span></header>
  <main>${body}</main>
  <nav class="bar"><div class="in">${tabs.map(([k, ic, l]) => `<a class="${TAB === k ? 'on' : ''} ${k === 'new' ? 'plus' : ''}" onclick="go('${k}')"><b>${ic}</b>${l}</a>`).join('')}</div></nav>`;
  window.scrollTo(0, 0);
}
function go(t, arg) {
  TAB = t; clearInterval(pollTimer);
  if (t === 'home') return renderHome();
  if (t === 'dresses') return renderDresses();
  if (t === 'new') return renderNewRental(arg);
  if (t === 'rentals') return renderRentals();
  if (t === 'handover') return renderHandoverList();
  if (t === 'reports') return renderReports();
  if (t === 'more') return renderMore();
}

// ---------- login ----------
function renderLogin() {
  clearInterval(pollTimer);
  $app.innerHTML = `<div class="login"><img class="logo" src="/icon.svg"><h1>حبيبة الأقصى</h1><p>إدارة الأتيليه</p>
  <label>اسم المستخدم</label><input id="u" autocomplete="username" autocapitalize="off">
  <label>كلمة السر</label><input id="p" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
  <div style="height:16px"></div><button class="btn" onclick="doLogin()">دخول</button></div>`;
}
async function doLogin() {
  await run(async () => { const r = await api('POST', '/api/login', { username: val('u'), password: val('p') }); ME = r.user; const m = await api('GET', '/api/me'); TODAY = m.today; go('home'); });
}
async function logout() { await api('POST', '/api/logout').catch(() => {}); ME = null; renderLogin(); }

// ---------- home ----------
async function renderHome() {
  shell('حبيبة الأقصى', '<p class="mut">بيحمّل...</p>');
  await run(async () => {
    const [pick, ret, dresses] = await Promise.all([api('GET', '/api/rentals?view=pickup_today'), api('GET', '/api/rentals?view=return_due'), api('GET', '/api/dresses')]);
    const soon = await api('GET', '/api/rentals?view=tomorrow');
    S.dresses = dresses;
    const cnt = k => dresses.filter(d => d.status.key === k).length;
    let acc = '';
    if (isOwner()) { const a = await api('GET', '/api/accounts'); acc = `<h2>حسابات النهاردة</h2><div class="tiles">
      <div class="tile g"><small>تحصيل النهاردة (صافي)</small><b>${money(a.today.net_cash)}</b></div>
      <div class="tile"><small>حجوزات جديدة</small><b>${a.today.rentals}</b></div></div>`; }
    const item = r => rentalItem(r);
    shell('حبيبة الأقصى', `
      <div class="tiles">
        <div class="tile g"><small>متاح</small><b>${cnt('available')}</b></div>
        <div class="tile"><small>محجوز</small><b>${cnt('booked')}</b></div>
        <div class="tile r"><small>خارج</small><b>${cnt('out')}</b></div>
        <div class="tile"><small>غسيل / تصليح</small><b>${cnt('washing') + cnt('repair')}</b></div>
      </div>${acc}
      <h2>تسليم النهاردة (${pick.length})</h2>${pick.map(item).join('') || '<p class="mut">مفيش تسليمات النهاردة</p>'}
      <h2>مرتجعات النهاردة / متأخرة (${ret.length})</h2>${ret.map(item).join('') || '<p class="mut">مفيش مرتجعات</p>'}
      <h2>🔔 تذكير بكرة (${soon.length})</h2>${soon.map(r => rentalItem(r).replace('</div></div>', `</div><div class="s">${r.status === 'booked' ? 'تسليم بكرة' : 'رجوع بكرة'}</div></div>`)).join('') || '<p class="mut">مفيش مواعيد بكرة</p>'}
      ${isOwner() ? `<h2><span class="pulse"></span>نشاط الموظفين (مباشر)</h2><div class="card" id="feed"></div>` : ''}`);
    if (isOwner()) { lastActId = 0; await loadFeed(true); pollTimer = setInterval(() => loadFeed(false), 4000); }
  });
}
let feedRows = [];
async function loadFeed(reset) {
  try {
    const rows = await api('GET', '/api/activity?since=' + (reset ? 0 : lastActId));
    if (reset) feedRows = rows; else feedRows = [...rows, ...feedRows].slice(0, 100);
    if (rows.length) lastActId = Math.max(lastActId, rows[0].id);
    const el = document.getElementById('feed'); if (!el) return;
    el.innerHTML = feedRows.slice(0, 40).map(a => `<div class="act"><div class="a">${esc(a.action)} <span class="mut small">- ${esc(a.user_name)}</span></div><div class="d">${esc(a.detail)}</div><div class="m">${ft(a.at)}</div></div>`).join('') || '<p class="mut">لسه مفيش نشاط</p>';
  } catch {}
}
function rentalItem(r) {
  return `<div class="li" onclick="renderRental(${r.id})"><div class="grow"><div class="t">${esc(r.customer_name)} <span class="mut">- فستان ${esc(r.dress_code)}</span></div>
  <div class="s">${fd(r.start_date)} ← ${fd(r.end_date)}${r.overdue ? ' <span class="late">متأخر</span>' : ''}${r.remaining > 0 ? ' · باقي ' + money(r.remaining) : ''}</div></div>
  <span class="badge b-${r.status}">${STATUS_AR[r.status]}</span></div>`;
}

// ---------- dresses ----------
async function renderDresses() {
  shell('الفساتين', '<p class="mut">بيحمّل...</p>');
  await run(async () => { [S.dresses, S.cats] = await Promise.all([api('GET', '/api/dresses'), api('GET', '/api/categories')]); drawDresses(); });
}
function drawDresses() {
  const list = S.dresses.filter(d => (!S.filterCat || d.category_id === S.filterCat) && (!S.filterStatus || d.status.key === S.filterStatus)
    && (!S.q || [d.code, d.name, d.color].join(' ').toLowerCase().includes(S.q.toLowerCase())));
  const sts = [['', 'الكل'], ['available', 'متاح'], ['booked', 'محجوز'], ['out', 'خارج'], ['washing', 'غسيل'], ['repair', 'تصليح']];
  shell('الفساتين', `
    <input placeholder="🔍 دوّر برقم الفستان أو الاسم" value="${esc(S.q)}" oninput="S.q=this.value;redrawGrid()" id="sq">
    <div class="chips">${sts.map(([k, l]) => `<span class="chip ${S.filterStatus === k ? 'on' : ''}" onclick="S.filterStatus='${k}';drawDresses()">${l}</span>`).join('')}</div>
    <div class="chips"><span class="chip ${!S.filterCat ? 'on' : ''}" onclick="S.filterCat=0;drawDresses()">كل الأقسام</span>${S.cats.map(c => `<span class="chip ${S.filterCat === c.id ? 'on' : ''}" onclick="S.filterCat=${c.id};drawDresses()">${esc(c.name)} (${c.count})</span>`).join('')}</div>
    ${isOwner() ? `<button class="btn sec" onclick="dressForm()">+ إضافة فستان جديد</button><div style="height:12px"></div>` : ''}
    <div class="grid" id="grid">${dressCards(list)}</div>`);
  const i = document.getElementById('sq'); if (S.q) { i.focus(); i.setSelectionRange(S.q.length, S.q.length); }
}
function dressCards(list) {
  return list.map(d => `<div class="dress" onclick="renderDress(${d.id})"><div class="ph" style="${d.photo_id ? `background-image:url(/api/files/${d.photo_id})` : ''}">${d.photo_id ? '' : '👗'}</div>
  <div class="inf"><b>${esc(d.code)}</b> <span class="mut small">${esc(d.name)}</span><div class="small mut">${esc(d.category)}</div><span class="badge b-${d.status.key}">${esc(d.status.label)}</span></div></div>`).join('') || '<p class="mut">مفيش فساتين</p>';
}
function redrawGrid() {
  const list = S.dresses.filter(d => (!S.filterCat || d.category_id === S.filterCat) && (!S.filterStatus || d.status.key === S.filterStatus) && (!S.q || [d.code, d.name, d.color].join(' ').toLowerCase().includes(S.q.toLowerCase())));
  document.getElementById('grid').innerHTML = dressCards(list);
}
async function renderDress(id) {
  await run(async () => {
    const d = await api('GET', '/api/dresses/' + id), st = d.status;
    shell('فستان ' + d.code, `
      ${d.photo_id ? `<img class="bigph" src="/api/files/${d.photo_id}">` : ''}
      <div class="card" style="margin-top:12px"><div class="row"><h2 class="grow" style="margin:0">${esc(d.code)} ${esc(d.name)}</h2><span class="badge b-${st.key}">${esc(st.label)}</span></div>
        <div class="kv"><span>القسم</span><b>${esc(d.category) || '-'}</b></div><div class="kv"><span>المقاس</span><b>${esc(d.size) || '-'}</b></div>
        <div class="kv"><span>اللون</span><b>${esc(d.color) || '-'}</b></div><div class="kv"><span>سعر الإيجار</span><b>${money(d.price)}</b></div>
        <div class="kv"><span>التأمين</span><b>${money(d.deposit)}</b></div>${d.notes ? `<div class="kv"><span>ملاحظات</span><b>${esc(d.notes)}</b></div>` : ''}</div>
      <div class="btns">
        <button class="btn full" onclick="go('new',${d.id})">📅 احجز / أجّر الفستان ده</button>
        ${st.key === 'washing' || st.key === 'repair' ? `<button class="btn ok full" onclick="maintDone(${st.maintenance_id},${d.id})">✔ رجع من ${st.key === 'washing' ? 'الغسيل' : 'التصليح'} - بقى متاح</button>` : ''}
        ${st.key !== 'out' && st.key !== 'washing' && st.key !== 'repair' ? `<button class="btn sec" onclick="maintForm(${d.id},'washing')">🧺 غسيل</button><button class="btn sec" onclick="maintForm(${d.id},'repair')">🧵 تصليح / تعديل</button>` : ''}
        ${isOwner() ? `<button class="btn sec" onclick='dressForm(${JSON.stringify({ id: d.id, code: d.code, name: d.name, category_id: d.category_id, size: d.size, color: d.color, price: d.price, deposit: d.deposit, notes: d.notes, photo_id: d.photo_id }).replace(/'/g, '&#39;')})'>✏️ تعديل</button><button class="btn bad" onclick="delDress(${d.id},'${esc(d.code)}')">🗑 حذف</button>` : ''}
      </div>
      <h2>سجل الفستان</h2>${d.rentals.map(rentalItem).join('') || '<p class="mut">لسه متأجرش</p>'}
      ${d.maintenance.length ? `<h2>الغسيل والتصليح</h2>${d.maintenance.map(m => `<div class="li" style="cursor:default"><div class="grow"><div class="t">${m.kind === 'washing' ? '🧺 غسيل' : '🧵 تصليح'}</div><div class="s">${fd(m.start_date)} ← ${fd(m.expected_back)} ${m.done_at ? '(خلص)' : '(شغال)'} ${esc(m.note)}</div></div>${isOwner() ? `<button class="btn bad sm" onclick="delMaint(${m.id},${d.id})">🗑</button>` : ''}</div>`).join('')}` : ''}`, { back: "go('dresses')" });
  });
}
function maintForm(id, kind) {
  const tom = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  modal(`<h3>${kind === 'washing' ? '🧺 إرسال للغسيل' : '🧵 تصليح / تعديل'}</h3><label>هيرجع يوم</label><input type="date" id="mb" value="${tom}"><label>ملاحظة</label><input id="mn" placeholder="اختياري"><div style="height:14px"></div><button class="btn" onclick="saveMaint(${id},'${kind}')">تأكيد</button>`);
}
async function saveMaint(id, kind) { await run(async () => { await api('POST', `/api/dresses/${id}/maintenance`, { kind, expected_back: val('mb'), note: val('mn') }); closeModal(); toast('تم'); renderDress(id); }); }
async function maintDone(mid, id) { await run(async () => { await api('POST', `/api/maintenance/${mid}/done`); toast('الفستان بقى متاح'); renderDress(id); }); }
function dressForm(d) {
  d = d || { code: '', name: '', category_id: 0, size: '', color: '', price: '', deposit: '', notes: '' };
  modal(`<h3>${d.id ? 'تعديل الفستان' : 'فستان جديد'}</h3>
  <label>رقم الفستان *</label><input id="fc" value="${esc(d.code)}" placeholder="مثال: 101">
  <label>الاسم / الوصف</label><input id="fn" value="${esc(d.name)}" placeholder="مثال: فستان سواريه أسود">
  <label>القسم</label><select id="fcat"><option value="">بدون قسم</option>${S.cats.map(c => `<option value="${c.id}" ${c.id === d.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  <div class="two"><div><label>المقاس</label><input id="fs" value="${esc(d.size)}"></div><div><label>اللون</label><input id="fcl" value="${esc(d.color)}"></div></div>
  <div class="two"><div><label>سعر الإيجار</label><input id="fp" type="number" inputmode="decimal" value="${esc(d.price)}"></div><div><label>التأمين</label><input id="fd" type="number" inputmode="decimal" value="${esc(d.deposit)}"></div></div>
  <label>ملاحظات</label><input id="fno" value="${esc(d.notes)}">
  <label>صورة الفستان</label>${photoPicker('fph', d.photo_id ? 'غيّر الصورة' : 'اختار صورة')}
  <div style="height:14px"></div><button class="btn" onclick="saveDress(${d.id || 0})">حفظ</button>`);
}
async function saveDress(id) {
  await run(async () => {
    let photo_id = null; const ph = val('fph'); if (ph) photo_id = (await api('POST', '/api/files', { data: ph })).id;
    const body = { code: val('fc'), name: val('fn'), category_id: val('fcat') || null, size: val('fs'), color: val('fcl'), price: val('fp'), deposit: val('fd'), notes: val('fno'), photo_id };
    if (id) await api('PUT', '/api/dresses/' + id, body); else await api('POST', '/api/dresses', body);
    closeModal(); toast('تم الحفظ'); id ? renderDress(id) : renderDresses();
  });
}
async function delDress(id, code) { if (!confirm(`مسح الفستان ${code}؟ لو عليه حجوزات هتتلغي.`)) return; await run(async () => { await api('DELETE', '/api/dresses/' + id + '?force=1'); toast('تم المسح'); go('dresses'); }); }

// ---------- new rental ----------
async function renderNewRental(dressId) {
  shell('حجز فستان', '<p class="mut">بيحمّل...</p>');
  await run(async () => {
    S.dresses = await api('GET', '/api/dresses');
    const t = TODAY;
    shell('حجز فستان', bookingFields({ dress_id: dressId || '', start_date: t, end_date: t, price: '', discount: 0, paid: 0, customer_name: '', phone: '', measures: '', notes: '' }) +
      `<div class="btns"><button class="btn full" onclick="saveRental()">✅ حجز</button></div>`);
    rdPick(!dressId);
  });
}
function bookingFields(r) {
  return `<div class="card"><b>1) الفستان</b>
    <select id="rd" onchange="rdPick(true)"><option value="">اختار رقم الفستان...</option>${S.dresses.map(d => `<option value="${d.id}" ${d.id == r.dress_id ? 'selected' : ''}>${esc(d.code)} - ${esc(d.name)}</option>`).join('')}</select>
    <div id="rdphoto"></div><div id="rdinfo" class="hint"></div></div>
  <div class="card"><b>2) الفلوس</b>
    <div class="two"><div><label>سعر الإيجار</label><input id="pr" type="number" inputmode="decimal" value="${esc(r.price)}" oninput="calc()"></div><div><label>الخصم</label><input id="ds" type="number" inputmode="decimal" value="${esc(r.discount)}" oninput="calc()"></div></div>
    <div class="two"><div><label>العربون المدفوع</label><input id="pd" type="number" inputmode="decimal" value="${esc(r.paid)}" oninput="calc()"></div><div><label>الباقي</label><input id="rm" readonly></div></div>
    <div class="kv"><span>الإجمالي بعد الخصم</span><b id="tot">0 ج</b></div></div>
  <div class="card"><b>3) التسليم والعميلة</b>
    <div class="two"><div><label>يوم التسليم</label><input type="date" id="rs" value="${r.start_date}" onchange="chkAvail()"></div><div><label>يوم الرجوع</label><input type="date" id="re" value="${r.end_date}" onchange="chkAvail()"></div></div>
    <div id="avail"></div>
    <label>اسم العميلة *</label><input id="cn" value="${esc(r.customer_name)}"><label>رقم التليفون</label><input id="cp" type="tel" inputmode="tel" value="${esc(r.phone)}">
    <label>المقاسات</label><input id="ms" value="${esc(r.measures)}" placeholder="صدر / وسط / طول ..."><label>ملاحظات</label><input id="nt" value="${esc(r.notes)}"></div>`;
}
function rdPick(setPrice) {
  const d = S.dresses.find(x => x.id == val('rd')); const el = document.getElementById('rdinfo'), ph = document.getElementById('rdphoto');
  if (!d) { el.textContent = ''; ph.innerHTML = ''; calc(); return; }
  if (setPrice) document.getElementById('pr').value = d.price || '';
  ph.innerHTML = d.photo_id ? `<img class="bigph" style="max-height:260px;object-fit:cover" src="/api/files/${d.photo_id}">` : '';
  el.innerHTML = `<span class="badge b-${d.status.key}">${esc(d.status.label)}</span>`; calc(); chkAvail(true);
}
function calc() { const t = Math.max(0, (+val('pr') || 0) - (+val('ds') || 0)); document.getElementById('tot').textContent = money(t); document.getElementById('rm').value = money(t - (+val('pd') || 0)); }
async function chkAvail(skip) {
  const id = val('rd'), s = val('rs'), e = val('re'), el = document.getElementById('avail'); if (!id || !s || !e) return;
  if (e < s) { el.innerHTML = '<div class="warnbox">يوم الرجوع قبل التسليم</div>'; return; }
  try {
    const d = await api('GET', '/api/dresses/' + id); const t = TODAY; const hit = [];
    d.rentals.filter(r => (r.status === 'booked' || r.status === 'out') && r.id !== window._editId).forEach(r => { const re = r.status === 'out' && r.end_date < t ? t : r.end_date; if (!(re < s || r.start_date > e)) hit.push(`محجوز من ${fd(r.start_date)} إلى ${fd(re)} (${r.customer_name})`); });
    d.maintenance.filter(m => !m.done_at).forEach(m => { if (!(m.expected_back < s || m.start_date > e)) hit.push(`في ${m.kind === 'washing' ? 'الغسيل' : 'التصليح'} لحد ${fd(m.expected_back)}`); });
    el.innerHTML = hit.length ? `<div class="warnbox">⚠️ مش متاح في الفترة دي: ${esc(hit[0])}</div>` : '<div class="hint" style="color:var(--ok)">✔ متاح في الفترة دي</div>';
  } catch {}
}
function bookingBody() { return { dress_id: val('rd'), start_date: val('rs'), end_date: val('re'), customer_name: val('cn'), phone: val('cp'), measures: val('ms'), price: val('pr'), discount: val('ds'), paid: val('pd'), notes: val('nt') }; }
async function saveRental() {
  await run(async () => { const r = await api('POST', '/api/rentals', bookingBody()); toast('تم تسجيل الحجز ✔'); renderRental(r.id); });
}

// ---------- handover (page 2) ----------
async function renderHandoverList() { return renderHandover(0); }
async function renderHandover(id) {
  TAB = 'handover'; clearInterval(pollTimer);
  shell('التسليم', '<p class="mut">بيحمّل...</p>');
  await run(async () => {
    const [bk, out] = await Promise.all([api('GET', '/api/rentals?status=booked'), api('GET', '/api/rentals?status=out')]);
    bk.sort((a, b) => a.start_date < b.start_date ? -1 : 1); out.sort((a, b) => a.end_date < b.end_date ? -1 : 1);
    const sel = bk.find(r => r.id === id) || bk[0];
    let form = '<p class="mut">مفيش حجوزات مستنية التسليم. سجّل حجز الأول من تاب "حجز".</p>';
    if (sel) {
      const r = await api('GET', '/api/rentals/' + sel.id); const d = await api('GET', '/api/dresses/' + r.dress_id);
      form = `<div class="card">${d.photo_id ? `<img class="bigph" style="max-height:260px;object-fit:cover" src="/api/files/${d.photo_id}">` : ''}
        <div class="row" style="margin-top:8px"><div class="grow"><b style="font-size:19px">فستان ${esc(r.dress_code)}</b><div class="mut">${esc(r.dress_name)}</div></div></div>
        <div class="kv"><span>العميلة</span><b>${esc(r.customer_name)}</b></div><div class="kv"><span>التليفون</span><b>${esc(r.phone) || '-'}</b></div>
        <div class="kv"><span>المقاسات</span><b>${esc(r.measures) || '-'}</b></div>${r.notes ? `<div class="kv"><span>ملاحظات</span><b>${esc(r.notes)}</b></div>` : ''}
        <div class="kv"><span>الإجمالي</span><b>${money(r.total)}</b></div><div class="kv"><span>العربون المدفوع</span><b>${money(r.paid)}</b></div>
        <div class="kv"><span>الباقي</span><b class="late">${money(r.remaining)}</b></div></div>
      <div class="card"><b>بيانات التسليم</b>
        <label>الباقي اللي هتاخديه دلوقتي</label><input id="hp" type="number" inputmode="decimal" value="${r.remaining}">
        <label>التأمين المدفوع (بيتردّ لو الفستان رجع سليم)</label><input id="hd" type="number" inputmode="decimal" value="${r.deposit || d.deposit || 0}">
        <label>ميعاد رجوع الفستان</label><input type="date" id="he" value="${r.end_date}">
        <label>الرقم القومي</label><input id="hn" inputmode="numeric" maxlength="14" value="${esc(r.national_id)}">
        <label>صورة البطاقة</label>${photoPicker('hph', 'صوّر البطاقة', true)}</div>
      <div class="btns"><button class="btn ok full" onclick="doHandover2(${r.id})">🤝 تسليم</button>
        <button class="btn sec" onclick="renderRental(${r.id})">تفاصيل الحجز</button></div>`;
    }
    const pick = bk.length ? `<div class="card"><label>اختار الحجز اللي هتسلّمه (${bk.length})</label><select id="hsel" onchange="renderHandover(+this.value)">${bk.map(r => `<option value="${r.id}" ${sel && r.id === sel.id ? 'selected' : ''}>فستان ${esc(r.dress_code)} - ${esc(r.customer_name)} - ${fd(r.start_date)}</option>`).join('')}</select></div>` : '';
    const outL = out.length ? `<h2>فساتين خارجة (${out.length}) - اضغط للاستلام</h2>${out.map(r => rentalItem(r)).join('')}` : '';
    shell('التسليم', pick + form + outL);
  });
}
async function doHandover2(id) {
  await run(async () => { await api('POST', `/api/rentals/${id}/handover`, { paid: val('hp'), deposit_paid: val('hd'), end_date: val('he'), national_id: val('hn'), id_photo: val('hph') || null }); toast('تم التسليم ✔'); renderRental(id); });
}

// ---------- rentals ----------
async function renderRentals() {
  shell('الإيجارات', '<p class="mut">بيحمّل...</p>');
  await run(async () => {
    const rows = await api('GET', `/api/rentals?status=${S.rentFilter === 'all' ? '' : S.rentFilter}&q=${encodeURIComponent(S.rentQ)}`);
    const fl = [['active', 'الشغالة'], ['booked', 'محجوز'], ['out', 'خارج'], ['returned', 'تم الاسترجاع'], ['all', 'الكل']];
    shell('الإيجارات', `<input id="rq" placeholder="🔍 اسم العميلة أو رقم الفستان" value="${esc(S.rentQ)}" onkeydown="if(event.key==='Enter'){S.rentQ=this.value;renderRentals()}" onchange="S.rentQ=this.value;renderRentals()">
      <div class="chips">${fl.map(([k, l]) => `<span class="chip ${S.rentFilter === k ? 'on' : ''}" onclick="S.rentFilter='${k}';renderRentals()">${l}</span>`).join('')}</div>
      ${rows.map(rentalItem).join('') || '<p class="mut">مفيش نتائج</p>'}`);
  });
}
async function renderRental(id) {
  await run(async () => {
    const r = await api('GET', '/api/rentals/' + id);
    const payKind = { rental: 'دفعة إيجار', deposit: 'تأمين', deposit_refund: 'رد تأمين', late_fee: 'غرامة تأخير', deduction: 'خصم من التأمين' };
    shell('حجز #' + r.id, `
      <div class="card"><div class="row"><div class="grow"><b style="font-size:19px">${esc(r.customer_name)}</b><div class="mut">فستان ${esc(r.dress_code)} ${esc(r.dress_name)}</div></div><span class="badge b-${r.status}">${STATUS_AR[r.status]}</span></div>
        <div class="kv"><span>الاستلام</span><b>${fd(r.start_date)}</b></div><div class="kv"><span>الرجوع</span><b class="${r.overdue ? 'late' : ''}">${fd(r.end_date)}${r.overdue ? ' (متأخر)' : ''}</b></div>
        <div class="kv"><span>التليفون</span><b>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '-'}</b></div>
        <div class="kv"><span>المقاسات</span><b>${esc(r.measures) || '-'}</b></div><div class="kv"><span>الرقم القومي</span><b>${esc(r.national_id) || '-'}</b></div><div class="kv"><span>العنوان</span><b>${esc(r.address) || '-'}</b></div>
        ${r.notes ? `<div class="kv"><span>ملاحظات</span><b>${esc(r.notes)}</b></div>` : ''}
        ${r.id_photo_id ? `<p><a class="btn sec sm" onclick="showId(${r.id_photo_id})">🪪 عرض صورة البطاقة</a></p>` : ''}</div>
      <div class="card"><b>الحساب</b>
        <div class="kv"><span>السعر</span><b>${money(r.price)}</b></div><div class="kv"><span>الخصم</span><b>${money(r.discount)}</b></div>
        <div class="kv"><span>الإجمالي</span><b>${money(r.total)}</b></div><div class="kv"><span>المدفوع</span><b>${money(r.paid)}</b></div>
        <div class="kv"><span>المتبقي</span><b class="${r.remaining > 0 ? 'late' : ''}">${money(r.remaining)}</b></div>${r.late_fees ? `<div class="kv"><span>غرامة تأخير</span><b class="late">${money(r.late_fees)}</b></div>` : ''}
        <hr><div class="kv"><span>التأمين المطلوب</span><b>${money(r.deposit)}</b></div><div class="kv"><span>التأمين المدفوع</span><b>${money(r.deposit_paid)}</b></div>
        ${r.status === 'returned' ? `<div class="kv"><span>اترد</span><b>${money(r.deposit_refunded)}</b></div><div class="kv"><span>اتخصم</span><b class="${r.deposit_deducted ? 'late' : ''}">${money(r.deposit_deducted)}</b></div>${r.deposit_note ? `<div class="kv"><span>سبب الخصم</span><b>${esc(r.deposit_note)}</b></div>` : ''}` : `<div class="kv"><span>تأمين معانا دلوقتي</span><b>${money(r.deposit_held)}</b></div>`}</div>
      <div class="btns">
        ${r.status === 'booked' ? `<button class="btn ok full" onclick="renderHandover(${r.id})">🤝 تسليم الفستان للعميلة</button>` : ''}
        ${r.status === 'out' ? `<button class="btn warn full" onclick="returnForm(${r.id})">↩️ استلام الفستان (رجوع)</button>` : ''}
        ${r.status === 'booked' || r.status === 'out' ? `${r.remaining > 0 ? `<button class="btn blue" onclick="payForm(${r.id},'rental',${r.remaining})">💵 دفعة إيجار</button>` : ''}${r.deposit_paid < r.deposit ? `<button class="btn blue" onclick="payForm(${r.id},'deposit',${r.deposit - r.deposit_paid})">🔒 دفع التأمين</button>` : ''}` : ''}
        <button class="btn sec" onclick="renderInvoice(${r.id})">🧾 الفاتورة</button>
        ${isOwner() && r.status === 'booked' ? `<button class="btn bad" onclick="cancelRental(${r.id})">إلغاء الحجز</button>` : ''}
        ${isOwner() ? `<button class="btn sec" onclick="editRental(${r.id})">✏️ تعديل</button><button class="btn sec" onclick="statusForm(${r.id})">🔄 تغيير الحالة</button><button class="btn bad" onclick="delRental(${r.id})">🗑 مسح العملية</button>` : ''}
      </div>
      <h2>الدفعات</h2>${r.payments.map(p => `<div class="kv"><span>${payKind[p.kind]} <span class="mut small">${ft(p.at)} - ${esc(p.by_user)}</span></span><b>${money(p.amount)}${isOwner() ? ` <a onclick="editPay(${p.id},${p.amount},'${p.day}',${r.id})" style="cursor:pointer">✏️</a> <a onclick="delPay(${p.id},${r.id})" style="cursor:pointer">🗑</a>` : ''}</b></div>`).join('') || '<p class="mut">مفيش دفعات</p>'}`, { back: "go('rentals')" });
    window._r = r;
  });
}
function showId(id) { modal(`<h3>صورة البطاقة</h3><img src="/api/files/${id}" style="width:100%;border-radius:10px"><div style="height:12px"></div><button class="btn sec" onclick="closeModal()">إغلاق</button>`); }
async function doHandover(id) { await run(async () => { await api('POST', `/api/rentals/${id}/handover`); toast('تم التسليم'); renderRental(id); }); }
function payForm(id, kind, max) {
  modal(`<h3>${kind === 'rental' ? 'دفعة إيجار' : 'دفع التأمين'}</h3><label>المبلغ</label><input id="pa" type="number" inputmode="decimal" value="${max}"><div style="height:14px"></div><button class="btn" onclick="savePay(${id},'${kind}')">تسجيل</button>`);
}
async function savePay(id, kind) { await run(async () => { await api('POST', `/api/rentals/${id}/pay`, { kind, amount: val('pa') }); closeModal(); toast('تم التسجيل'); renderRental(id); }); }
function returnForm(id) {
  const r = window._r, held = r.deposit_held;
  modal(`<h3>استلام الفستان ${esc(r.dress_code)}</h3>
  <div class="card">التأمين المدفوع: <b>${money(held)}</b></div>
  <label>حالة الفستان</label>
  <select id="ra" onchange="retChange(${held})"><option value="refund">سليم - رد التأمين كامل</option><option value="partial">فيه ضرر - خصم جزء من التأمين</option><option value="deduct_all">فيه ضرر - خصم التأمين كله</option></select>
  <div id="rpart" style="display:none"><label>المبلغ المخصوم</label><input id="rded" type="number" inputmode="decimal"></div>
  <div id="rnote" style="display:none"><label>سبب الخصم (إجباري)</label><input id="rn" placeholder="مثال: قطع في الذيل"></div>
  <label>غرامة تأخير ${r.overdue ? `(متأخر ${Math.round((new Date(TODAY) - new Date(r.end_date)) / 864e5)} يوم)` : '(لو فيه)'}</label><input id="rlf" type="number" inputmode="decimal" value="0">
  <div class="kv"><span>هيترد للعميلة</span><b id="rback">${money(held)}</b></div>
  <label><input type="checkbox" id="rw" style="width:auto"> ابعت الفستان للغسيل بعد الرجوع</label>
  <div style="height:14px"></div><button class="btn warn" onclick="doReturn(${id},${held})">تأكيد الاستلام</button>`);
  const d = document.getElementById('rded'); if (d) d.oninput = () => retChange(held);
}
function retChange(held) {
  const a = val('ra'); document.getElementById('rpart').style.display = a === 'partial' ? 'block' : 'none'; document.getElementById('rnote').style.display = a === 'refund' ? 'none' : 'block';
  const ded = a === 'refund' ? 0 : a === 'deduct_all' ? held : (+val('rded') || 0); document.getElementById('rback').textContent = money(Math.max(0, held - ded));
}
async function doReturn(id, held) {
  await run(async () => { const a = val('ra'); const x = await api('POST', `/api/rentals/${id}/return`, { action: a === 'refund' ? 'refund' : a === 'deduct_all' ? 'deduct_all' : 'partial', deducted: val('rded'), note: val('rn'), late_fee: val('rlf'), send_to_washing: document.getElementById('rw').checked });
    closeModal(); toast(`تم الاستلام. اترد ${money(x.refunded)}${x.deducted ? ' واتخصم ' + money(x.deducted) : ''}`); renderRental(id); });
}
async function cancelRental(id) { if (!confirm('إلغاء الحجز؟')) return; await run(async () => { await api('POST', `/api/rentals/${id}/cancel`); toast('تم الإلغاء'); renderRental(id); }); }
async function editRental(id) {
  const r = window._r; S.dresses = await api('GET', '/api/dresses'); window._editId = r.id;
  modal(`<h3>تعديل الحجز #${r.id}</h3>${bookingFields({ ...r, paid: r.paid })}
    <label>التأمين المطلوب</label><input id="edp" type="number" inputmode="decimal" value="${r.deposit}"><label>الرقم القومي</label><input id="eid" value="${esc(r.national_id)}">
    <div style="height:14px"></div><button class="btn" onclick="saveEdit(${id})">حفظ التعديل</button>`);
  rdPick(false);
}
async function saveEdit(id) { await run(async () => { await api('PUT', '/api/rentals/' + id, { ...bookingBody(), deposit: val('edp'), national_id: val('eid') }); closeModal(); toast('تم التعديل'); renderRental(id); }); }
function statusForm(id) { modal(`<h3>تغيير حالة العملية</h3><select id="stv"><option value="booked">محجوز</option><option value="out">خارج</option><option value="returned">تم الاسترجاع</option><option value="cancelled">ملغي</option></select><div style="height:14px"></div><button class="btn" onclick="saveStatus(${id})">حفظ</button>`); }
async function saveStatus(id) { await run(async () => { await api('PUT', `/api/rentals/${id}/status`, { status: val('stv') }); closeModal(); toast('تم'); renderRental(id); }); }
async function delRental(id) { if (!confirm('مسح العملية دي نهائي مع كل دفعاتها؟')) return; await run(async () => { await api('DELETE', '/api/rentals/' + id); toast('تم المسح'); go('rentals'); }); }
function editPay(pid, amt, day, rid) { modal(`<h3>تعديل دفعة</h3><label>المبلغ</label><input id="epa" type="number" inputmode="decimal" value="${amt}"><label>اليوم</label><input type="date" id="epd" value="${day}"><div style="height:14px"></div><button class="btn" onclick="savePayEdit(${pid},${rid})">حفظ</button>`); }
async function savePayEdit(pid, rid) { await run(async () => { await api('PUT', '/api/payments/' + pid, { amount: val('epa'), day: val('epd') }); closeModal(); toast('تم'); renderRental(rid); }); }
async function delPay(pid, rid) { if (!confirm('مسح الدفعة دي؟')) return; await run(async () => { await api('DELETE', '/api/payments/' + pid); toast('تم المسح'); renderRental(rid); }); }
async function delMaint(mid, did) { if (!confirm('مسح السجل ده؟')) return; await run(async () => { await api('DELETE', '/api/maintenance/' + mid); renderDress(did); }); }

async function renderInvoice(id) {
  await run(async () => {
    const r = await api('GET', '/api/rentals/' + id);
    shell('فاتورة #' + r.id, `<div class="invoice"><h2>حبيبة الأقصى</h2><p style="text-align:center" class="mut">أتيليه تأجير فساتين السواريه</p><hr>
      <div class="kv"><span>رقم الفاتورة</span><b>${r.id}</b></div><div class="kv"><span>التاريخ</span><b>${fd(r.created_at)}</b></div>
      <div class="kv"><span>العميلة</span><b>${esc(r.customer_name)}</b></div><div class="kv"><span>التليفون</span><b>${esc(r.phone) || '-'}</b></div>
      <div class="kv"><span>الفستان</span><b>${esc(r.dress_code)} ${esc(r.dress_name)}</b></div>
      <div class="kv"><span>من</span><b>${fd(r.start_date)}</b></div><div class="kv"><span>إلى</span><b>${fd(r.end_date)}</b></div><hr>
      <div class="kv"><span>سعر الإيجار</span><b>${money(r.price)}</b></div><div class="kv"><span>الخصم</span><b>${money(r.discount)}</b></div>
      <div class="kv"><span>الإجمالي</span><b>${money(r.total)}</b></div><div class="kv"><span>المدفوع</span><b>${money(r.paid)}</b></div><div class="kv"><span>المتبقي</span><b>${money(r.remaining)}</b></div><hr>
      <div class="kv"><span>التأمين المدفوع</span><b>${money(r.deposit_paid)}</b></div>
      ${r.status === 'returned' ? `<div class="kv"><span>التأمين المردود</span><b>${money(r.deposit_refunded)}</b></div>${r.deposit_deducted ? `<div class="kv"><span>مخصوم من التأمين (${esc(r.deposit_note)})</span><b>${money(r.deposit_deducted)}</b></div>` : ''}` : '<p class="small mut">التأمين بيترد عند استلام الفستان سليم.</p>'}
      </div><div class="btns noprint"><button class="btn" onclick="window.print()">🖨 طباعة / حفظ PDF</button><button class="btn sec" onclick="renderRental(${r.id})">رجوع</button></div>`, { back: `renderRental(${r.id})` });
  });
}

// ---------- more / owner ----------
function renderMore() {
  const o = isOwner();
  shell('المزيد', `<div class="li" onclick="go('rentals')"><span style="font-size:26px">📋</span><div class="grow t">كل الإيجارات والحجوزات</div></div>${o ? `<div class="li" onclick="go('reports')"><span style="font-size:26px">📊</span><div class="grow t">التقارير (يوم / شهر)</div></div><div class="li" onclick="renderAccounts()"><span style="font-size:26px">💰</span><div class="grow t">الحسابات والفواتير</div></div>
    <div class="li" onclick="renderActivity()"><span style="font-size:26px">👁</span><div class="grow t">سجل نشاط الموظفين</div></div>
    <div class="li" onclick="renderCats()"><span style="font-size:26px">🗂</span><div class="grow t">أقسام الفساتين</div></div>
    <div class="li" onclick="renderUsers()"><span style="font-size:26px">👤</span><div class="grow t">الحسابات وكلمات السر</div></div>`
    : `<div class="li" onclick="renderInvoices()"><span style="font-size:26px">🧾</span><div class="grow t">فواتير النهاردة</div></div>`}
    <div style="height:16px"></div><button class="btn sec" onclick="logout()">تسجيل خروج</button>`);
}
async function renderInvoices() { await run(async () => { const rows = await api('GET', '/api/rentals?status=&q='); const t = TODAY; shell('الفواتير', rows.filter(r => r.created_at.slice(0, 10) === t || true).slice(0, 40).map(rentalItem).join(''), { back: "go('more')" }); }); }
async function renderAccounts(date, month) {
  await run(async () => {
    const a = await api('GET', `/api/accounts?date=${date || ''}&month=${month || ''}`);
    const block = (t, s) => `<div class="tiles"><div class="tile g"><small>صافي الفلوس الداخلة</small><b>${money(s.net_cash)}</b></div><div class="tile"><small>إيراد (إيجار + مخصوم + غرامات)</small><b>${money(s.revenue)}</b></div>
      <div class="tile"><small>إيجارات محصّلة</small><b>${money(s.rental_income)}</b></div><div class="tile"><small>تأمينات مستلمة</small><b>${money(s.deposits_in)}</b></div>
      <div class="tile"><small>تأمينات مردودة</small><b>${money(s.deposits_refunded)}</b></div><div class="tile r"><small>تأمين مخصوم (ضرر)</small><b>${money(s.deposits_kept)}</b></div><div class="tile"><small>غرامات تأخير</small><b>${money(s.late_fees)}</b></div>
      <div class="tile"><small>حجوزات جديدة</small><b>${s.rentals}</b></div>${s.returned != null ? `<div class="tile"><small>فساتين اترجعت</small><b>${s.returned}</b></div>` : ''}</div>`;
    shell('الحسابات', `<div class="two"><div><label>اليوم</label><input type="date" id="ad" value="${a.day}" onchange="renderAccounts(this.value,'')"></div><div><label>الشهر</label><input type="month" id="am" value="${a.month}" onchange="renderAccounts('',this.value)"></div></div>
      <h2>حسابات يوم ${fd(a.day)}</h2>${block('', a.today)}
      <h2>حسابات شهر ${a.month}</h2>${block('', a.month_totals)}
      <h2>أرقام عامة دلوقتي</h2><div class="tiles"><div class="tile"><small>تأمينات معانا</small><b>${money(a.open_deposits)}</b></div><div class="tile r"><small>متبقي على عملاء</small><b>${money(a.unpaid)}</b></div></div>
      <h2>أعلى الفواتير في الشهر</h2>${a.top_invoices.map(rentalItem).join('') || '<p class="mut">-</p>'}
      <h2>فواتير اليوم (${a.invoices_today.length})</h2>${a.invoices_today.map(rentalItem).join('') || '<p class="mut">-</p>'}
      <h2>كل فواتير الشهر (${a.invoices_month.length})</h2>${a.invoices_month.map(rentalItem).join('') || '<p class="mut">-</p>'}`, { back: "go('more')" });
  });
}
async function renderActivity() {
  shell('نشاط الموظفين', '<div class="card" id="feed"></div>', { back: "go('more')" }); lastActId = 0; await loadFeed(true); pollTimer = setInterval(() => loadFeed(false), 4000);
}
async function renderCats() {
  await run(async () => { S.cats = await api('GET', '/api/categories');
    shell('الأقسام', `<div class="card"><label>قسم جديد</label><div class="row"><input id="cname" class="grow" placeholder="اسم القسم"><button class="btn sm" onclick="addCat()">إضافة</button></div></div>
    ${S.cats.map(c => `<div class="li" style="cursor:default"><div class="grow t">${esc(c.name)} <span class="mut small">(${c.count} فستان)</span></div><button class="btn bad sm" onclick="delCat(${c.id})">حذف</button></div>`).join('')}`, { back: "go('more')" }); });
}
async function addCat() { await run(async () => { await api('POST', '/api/categories', { name: val('cname') }); renderCats(); }); }
async function delCat(id) { if (!confirm('حذف القسم؟ الفساتين هتفضل بدون قسم')) return; await run(async () => { await api('DELETE', '/api/categories/' + id); renderCats(); }); }
async function renderUsers() {
  await run(async () => { const us = await api('GET', '/api/users');
    shell('الحسابات', `${us.map(u => `<div class="li" style="cursor:default"><div class="grow"><div class="t">${esc(u.name)} <span class="mut small">(${esc(u.username)})</span></div><div class="s">${u.role === 'owner' ? 'مالكة - كل الصلاحيات' : 'موظف - صلاحيات محدودة'}${u.active ? '' : ' - موقوف'}</div></div>
      <button class="btn sec sm" onclick="pwForm(${u.id},'${esc(u.username)}')">كلمة سر</button>${u.role !== 'owner' ? `<button class="btn ${u.active ? 'bad' : 'ok'} sm" onclick="toggleUser(${u.id},${u.active ? 0 : 1})">${u.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}</div>`).join('')}
      <button class="btn sec" onclick="newUserForm()">+ موظف جديد</button>`, { back: "go('more')" }); });
}
function pwForm(id, un) { modal(`<h3>كلمة سر جديدة لـ ${un}</h3><input id="npw" type="text" placeholder="كلمة السر الجديدة"><div style="height:14px"></div><button class="btn" onclick="savePw(${id})">حفظ</button>`); }
async function savePw(id) { await run(async () => { await api('PUT', '/api/users/' + id, { password: val('npw') }); closeModal(); toast('تم تغيير كلمة السر'); }); }
async function toggleUser(id, a) { await run(async () => { await api('PUT', '/api/users/' + id, { active: a }); renderUsers(); }); }
function newUserForm() { modal(`<h3>موظف جديد</h3><label>الاسم</label><input id="nn"><label>اسم المستخدم</label><input id="nu" autocapitalize="off"><label>كلمة السر</label><input id="np"><div style="height:14px"></div><button class="btn" onclick="saveUser()">إضافة</button>`); }
async function saveUser() { await run(async () => { await api('POST', '/api/users', { name: val('nn'), username: val('nu'), password: val('np') }); closeModal(); renderUsers(); }); }

// ---------- reports ----------
const KIND_AR = { rental: 'دفعة إيجار', deposit: 'تأمين مستلم', deposit_refund: 'تأمين مردود', late_fee: 'غرامة تأخير', deduction: 'مخصوم من التأمين' };
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const mlabel = m => MONTHS_AR[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
function renderReports() {
  shell('التقارير', `<div class="card"><label>اليوم</label><input type="date" id="rpd" value="${TODAY}"><div style="height:10px"></div><button class="btn full" onclick="showDayReport()">📅 تقرير يوم</button>
    <div style="height:14px"></div><label>الشهر</label><input type="month" id="rpm" value="${TODAY.slice(0, 7)}"><div style="height:10px"></div><button class="btn blue full" onclick="showMonthReport()">🗓 تقرير شهر (ومقارنة بالشهور اللي قبله)</button></div><div id="rpout"></div>`, { back: "go('more')" });
}
async function showDayReport() {
  await run(async () => {
    const day = val('rpd'); const r = await api('GET', '/api/report?date=' + day), t = r.day_totals;
    document.getElementById('rpout').innerHTML = `<h2>تقرير يوم ${fd(day)}</h2><div class="tiles">
      <div class="tile g"><small>صافي الفلوس الداخلة</small><b>${money(t.net_cash)}</b></div><div class="tile"><small>إيراد اليوم</small><b>${money(t.revenue)}</b></div>
      <div class="tile"><small>إيجارات / عربون</small><b>${money(t.rental)}</b></div><div class="tile"><small>تأمينات مستلمة</small><b>${money(t.deposits_in)}</b></div>
      <div class="tile"><small>تأمينات مردودة</small><b>${money(t.deposits_refunded)}</b></div><div class="tile r"><small>مخصوم من التأمين</small><b>${money(t.deposits_kept)}</b></div>
      <div class="tile"><small>غرامات تأخير</small><b>${money(t.late_fees)}</b></div><div class="tile"><small>حجوزات جديدة</small><b>${t.bookings}</b></div>
      <div class="tile"><small>تسليمات</small><b>${t.handovers}</b></div><div class="tile"><small>فساتين اترجعت</small><b>${t.returns}</b></div></div>
      <h2>حركة الفلوس (${r.day_payments.length})</h2>${r.day_payments.map(p => `<div class="kv"><span>${KIND_AR[p.kind]} - ${esc(p.customer_name || '')} <span class="mut small">فستان ${esc(p.code || '')}</span></span><b>${money(p.amount)}</b></div>`).join('') || '<p class="mut">مفيش حركة</p>'}
      <h2>عمليات اليوم (${r.day_events.length})</h2>${r.day_events.map(e => `<div class="li" onclick="renderRental(${e.id})"><div class="grow"><div class="t">${esc(e.customer_name)} <span class="mut">- فستان ${esc(e.code)}</span></div><div class="s">${fd(e.start_date)} ← ${fd(e.end_date)}</div></div><span class="badge b-${e.status}">${STATUS_AR[e.status]}</span></div>`).join('') || '<p class="mut">-</p>'}`;
  });
}
async function showMonthReport() {
  await run(async () => {
    const mo = val('rpm'); const r = await api('GET', `/api/report?month=${mo}`), t = r.month_totals;
    const max = Math.max(1, ...r.compare.map(c => c.revenue));
    const diff = (a, b) => b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a - b) / b * 100))}%` : '';
    document.getElementById('rpout').innerHTML = `<h2>تقرير شهر ${mlabel(mo)}</h2><div class="tiles">
      <div class="tile g"><small>صافي الفلوس الداخلة</small><b>${money(t.net_cash)}</b></div><div class="tile"><small>إيراد الشهر</small><b>${money(t.revenue)}</b></div>
      <div class="tile"><small>إيجارات / عربون</small><b>${money(t.rental)}</b></div><div class="tile"><small>تأمينات مستلمة</small><b>${money(t.deposits_in)}</b></div>
      <div class="tile"><small>تأمينات مردودة</small><b>${money(t.deposits_refunded)}</b></div><div class="tile r"><small>مخصوم من التأمين</small><b>${money(t.deposits_kept)}</b></div>
      <div class="tile"><small>غرامات تأخير</small><b>${money(t.late_fees)}</b></div><div class="tile"><small>حجوزات</small><b>${t.bookings}</b></div></div>
      <h2>مقارنة الشهور (إيراد)</h2><div class="card">${r.compare.map((c, i) => `<div style="margin:8px 0"><div class="row"><b class="grow">${mlabel(c.month)}</b><span>${money(c.revenue)} <span class="${r.compare[i + 1] && c.revenue < r.compare[i + 1].revenue ? 'late' : 'mut'} small">${diff(c.revenue, (r.compare[i + 1] || {}).revenue)}</span></span></div>
        <div style="background:#eee;border-radius:6px;height:10px"><div style="background:${i === 0 ? 'var(--p)' : '#b99'};height:10px;border-radius:6px;width:${Math.round(c.revenue / max * 100)}%"></div></div>
        <div class="small mut">${c.bookings} حجز · صافي ${money(c.net_cash)}</div></div>`).join('')}</div>
      <h2>أيام الشهر (صافي)</h2>${r.month_days.map(d => `<div class="kv"><span>${fd(d.day)}</span><b>${money(d.net)}</b></div>`).join('') || '<p class="mut">مفيش حركة</p>'}`;
  });
}

// ---------- boot ----------
(async () => { try { const m = await api('GET', '/api/me'); ME = m.user; TODAY = m.today; go('home'); } catch { renderLogin(); } })();
