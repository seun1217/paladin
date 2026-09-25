/* 쿠팡 특가 알리미 front-end (no framework). */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ------------------------------------------------------------------ identity
function getUserId() {
  let id = null;
  try { id = localStorage.getItem('dealalerts.userId'); } catch { /* ignore */ }
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
    try { localStorage.setItem('dealalerts.userId', id); } catch { /* ignore */ }
  }
  return id;
}
const userId = getUserId();
const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } }).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || j.message || `HTTP ${r.status}`); e.status = r.status; e.code = j.code; throw e; }
  return j;
});
const userApi = (suffix, opts) => api(`/api/users/${encodeURIComponent(userId)}${suffix}`, opts);

// ------------------------------------------------------------------ state
let config = { vapidPublicKey: null, channels: [], providerMode: 'fixture', telegramBotUsername: null };
let taxonomy = { categories: [] };
let prefs = { subcategoryIds: [], sensitivity: 'normal', dailyCap: 10, quietHours: { startHour: 23, endHour: 8 } };
let channels = { webpush: 0, telegram: false };
let dealFilter = 'mine';
let saveTimer = null;

// ------------------------------------------------------------------ helpers
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '방금'; if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; return `${Math.floor(s / 86400)}일 전`;
}
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hasPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ taxonomy UI
function renderTaxonomy() {
  const root = $('#taxonomy');
  const selected = new Set(prefs.subcategoryIds);
  root.innerHTML = '';
  for (const c of taxonomy.categories) {
    const subIds = c.subcategories.map((s) => s.id);
    const n = subIds.filter((id) => selected.has(id)).length;
    const det = document.createElement('details');
    det.className = 'cat';
    det.dataset.id = c.id;
    if (n > 0) det.open = true;
    const products = c.subcategories.reduce((a, s) => a + s.productCount, 0);
    const deals = c.subcategories.reduce((a, s) => a + s.dealsLast7d, 0);
    det.innerHTML = `
      <summary>
        <input type="checkbox" class="cat-check" data-id="${c.id}" aria-label="${esc(c.name)} 전체">
        <span class="name">${esc(c.name)}</span>
        <span class="count">${n}/${subIds.length} 선택 · 상품 ${products}${deals ? ` · 특가 ${deals}` : ''}</span>
        <span class="chev">›</span>
      </summary>
      <div class="subs">
        ${c.subcategories.map((s) => `
          <label>
            <input type="checkbox" class="sub-check" data-id="${s.id}" ${selected.has(s.id) ? 'checked' : ''}>
            <span>${esc(s.name)}</span>
            <span class="meta">${s.productCount}${s.dealsLast7d ? ` · <span class="hot">특가 ${s.dealsLast7d}</span>` : ''}</span>
          </label>`).join('')}
      </div>`;
    const catCheck = $('.cat-check', det);
    catCheck.checked = n === subIds.length && n > 0;
    catCheck.indeterminate = n > 0 && n < subIds.length;
    catCheck.addEventListener('click', (e) => e.stopPropagation());
    catCheck.addEventListener('change', () => {
      const on = catCheck.checked;
      for (const id of subIds) on ? selected.add(id) : selected.delete(id);
      prefs.subcategoryIds = [...selected];
      renderTaxonomy(); scheduleSave();
    });
    for (const cb of $$('.sub-check', det)) {
      cb.addEventListener('change', () => {
        cb.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id);
        prefs.subcategoryIds = [...selected];
        const k = subIds.filter((id) => selected.has(id)).length;
        catCheck.checked = k === subIds.length; catCheck.indeterminate = k > 0 && k < subIds.length;
        $('.count', det).textContent = `${k}/${subIds.length} 선택 · 상품 ${products}${deals ? ` · 특가 ${deals}` : ''}`;
        scheduleSave();
      });
    }
    root.appendChild(det);
  }
}

let editVersion = 0; // bumps on every local edit so an in-flight save cannot overwrite newer edits
let saving = false;
function scheduleSave() {
  editVersion++;
  $('#save-state').textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePrefs, 500);
}
async function savePrefs() {
  if (saving) { saveTimer = setTimeout(savePrefs, 300); return; }
  saving = true;
  const v = editVersion;
  try {
    const r = await userApi('/prefs', { method: 'PUT', body: JSON.stringify({
      subcategoryIds: prefs.subcategoryIds, sensitivity: prefs.sensitivity, dailyCap: prefs.dailyCap, quietHours: prefs.quietHours }) });
    if (v === editVersion) {
      prefs = r.prefs;
      $('#save-state').textContent = `저장됨 · ${prefs.subcategoryIds.length}개 세부 카테고리`;
      if (dealFilter === 'mine') renderDeals();
    } else {
      saveTimer = setTimeout(savePrefs, 0); // newer local edits exist: send them too
    }
  } catch (e) {
    $('#save-state').textContent = `저장 실패: ${e.message}`;
  } finally { saving = false; }
}

// ------------------------------------------------------------------ settings UI
function renderSettings() {
  for (const b of $$('#sensitivity button')) { b.classList.toggle('on', b.dataset.v === prefs.sensitivity); b.setAttribute('aria-checked', String(b.dataset.v === prefs.sensitivity)); }
  $('#daily-cap').value = String(prefs.dailyCap);
  const qs = $('#quiet-start'), qe = $('#quiet-end');
  if (!qs.options.length) {
    for (let h = 0; h < 24; h++) {
      qs.add(new Option(`${String(h).padStart(2, '0')}:00`, h)); qe.add(new Option(`${String(h).padStart(2, '0')}:00`, h));
    }
  }
  const q = prefs.quietHours;
  $('#quiet-on').checked = !!q;
  qs.value = String(q ? q.startHour : 23); qe.value = String(q ? q.endHour : 8);
  qs.disabled = qe.disabled = !q;
}
function bindSettings() {
  for (const b of $$('#sensitivity button')) b.addEventListener('click', () => { prefs.sensitivity = b.dataset.v; renderSettings(); scheduleSave(); });
  $('#daily-cap').addEventListener('change', (e) => { prefs.dailyCap = Number(e.target.value); scheduleSave(); });
  const upd = () => {
    prefs.quietHours = $('#quiet-on').checked ? { startHour: Number($('#quiet-start').value), endHour: Number($('#quiet-end').value) } : null;
    renderSettings(); scheduleSave();
  };
  $('#quiet-on').addEventListener('change', upd); $('#quiet-start').addEventListener('change', upd); $('#quiet-end').addEventListener('change', upd);
  $('#btn-all').addEventListener('click', () => { prefs.subcategoryIds = taxonomy.categories.flatMap((c) => c.subcategories.map((s) => s.id)); renderTaxonomy(); scheduleSave(); });
  $('#btn-none').addEventListener('click', () => { prefs.subcategoryIds = []; renderTaxonomy(); scheduleSave(); });
  for (const b of $$('#deal-filter button')) b.addEventListener('click', () => { dealFilter = b.dataset.v; $$('#deal-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderDeals(); });
}

// ------------------------------------------------------------------ deals
async function renderDeals() {
  const box = $('#deals');
  let deals = [];
  try {
    if (dealFilter === 'mine') {
      if (prefs.subcategoryIds.length === 0) { box.innerHTML = '<div class="empty">세부 카테고리를 선택하면 해당 특가가 여기에 표시됩니다.</div>'; return; }
      // server applies the saved subscriptions + sensitivity threshold (exactly what would be notified)
      deals = (await userApi('/deals?limit=60')).deals;
    } else {
      deals = (await api('/api/deals?limit=60')).deals;
    }
  } catch (e) { box.innerHTML = `<div class="empty">불러오기 실패: ${esc(e.message)}</div>`; return; }
  if (!deals.length) { box.innerHTML = '<div class="empty">최근 7일간 감지된 특가가 없습니다. 가격 이력이 쌓이면(보통 3일 이상) 알림이 시작됩니다.</div>'; return; }
  box.innerHTML = deals.map((d) => `
    <a class="deal" href="/go/${d.id}" target="_blank" rel="noopener sponsored">
      ${d.imageUrl ? `<img src="${esc(d.imageUrl)}" alt="" loading="lazy">` : '<div></div>'}
      <div>
        <div class="name">${esc(d.productName)}</div>
        <div class="meta">${esc(d.categoryName || '')} › ${esc(d.subcategoryName || '')} · 인기 ${d.rank}위${d.isRocket ? ' · 🚀로켓' : ''} · ${ago(d.detectedAt)}</div>
        <div class="meta">${esc(d.reason)}</div>
      </div>
      <div class="price">
        <div class="was">${won(d.baselinePrice)}</div>
        <div class="now">${won(d.price)}</div>
        <div class="off">-${Math.round(d.discountPct * 100)}%</div>
      </div>
    </a>`).join('');
}

// ------------------------------------------------------------------ push
function setStatus(kind, text) { $('#push-status').innerHTML = `<span class="dot ${kind}"></span>${esc(text)}`; }
async function refreshPushUI() {
  const btn = $('#btn-push'), off = $('#btn-push-off'), test = $('#btn-test');
  $('#ios-help').hidden = !(isIOS && !isStandalone);
  const anyChannel = channels.webpush > 0 || channels.telegram;
  test.hidden = !anyChannel;
  if (!config.vapidPublicKey) {
    setStatus('warn', '서버에 웹푸시(VAPID) 키가 설정되지 않아 브라우저 알림을 사용할 수 없습니다.');
    btn.disabled = true; off.hidden = true;
  } else if (isIOS && !isStandalone) {
    setStatus('warn', '홈 화면에 추가한 뒤 알림을 켤 수 있어요.'); btn.disabled = true; off.hidden = true;
  } else if (!hasPush) {
    setStatus('bad', '이 브라우저는 푸시 알림을 지원하지 않습니다. 텔레그램 연결을 이용해 주세요.'); btn.disabled = true; off.hidden = true;
  } else if (Notification.permission === 'denied') {
    setStatus('bad', '알림 권한이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.'); btn.disabled = true; off.hidden = true;
  } else {
    let sub = null;
    try { const reg = await navigator.serviceWorker.getRegistration(); sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* ignore */ }
    if (sub && Notification.permission === 'granted') {
      setStatus('ok', `이 기기에서 알림을 받고 있어요${channels.webpush > 1 ? ` (총 ${channels.webpush}개 기기)` : ''}.`);
      btn.hidden = true; off.hidden = false;
    } else {
      setStatus('', channels.webpush > 0 ? '다른 기기에서 알림을 받고 있어요. 이 기기에서도 받으려면 알림을 켜 주세요.' : '아직 알림이 꺼져 있어요.');
      btn.hidden = false; btn.disabled = false; off.hidden = true;
    }
  }
  const tgOn = config.channels.includes('telegram');
  $('#btn-telegram').hidden = !tgOn || channels.telegram;
  $('#btn-telegram-off').hidden = !tgOn || !channels.telegram;
  if (channels.telegram) { $('#telegram-box').hidden = false; $('#telegram-box').textContent = '텔레그램이 연결되어 있어요. 특가 알림을 채팅으로도 보내드립니다.'; }
}
async function enablePush() {
  const btn = $('#btn-push'); btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.');
    const key = urlBase64ToUint8Array(config.vapidPublicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (cur && (cur.length !== key.length || cur.some((b, i) => b !== key[i]))) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    let r;
    try {
      r = await userApi('/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch (e) {
      if (e.code !== 'endpoint_owned_by_other_user') throw e;
      // this browser's subscription was registered under a previous anonymous id: get a fresh endpoint
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      r = await userApi('/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    }
    channels.webpush = r.count;
    if (reg.active) reg.active.postMessage({ type: 'set-user-id', userId });
    toast('알림이 켜졌어요 🎉');
    if (prefs.subcategoryIds.length === 0) toast('세부 카테고리를 선택해 주세요', 3000);
  } catch (e) {
    toast(`알림 설정 실패: ${e.message}`, 4000);
  } finally { btn.disabled = false; await refreshPushUI(); }
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await userApi('/push', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
      channels.webpush = Math.max(0, channels.webpush - 1);
    }
    toast('이 기기의 알림을 꺼습니다');
  } catch (e) { toast(`실패: ${e.message}`); }
  await refreshPushUI();
}
async function resyncSubscription() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // always register: needed for PWA install and for receiving pushes once VAPID is configured
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (reg.active) reg.active.postMessage({ type: 'set-user-id', userId });
    if (!hasPush || !config.vapidPublicKey) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      try {
        const r = await userApi('/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
        channels.webpush = r.count;
      } catch (e) {
        if (e.code === 'endpoint_owned_by_other_user') await sub.unsubscribe(); // stale: user will re-enable
        else throw e;
      }
    }
  } catch (e) { console.warn('sw/resync failed', e); }
}
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'get-user-id' && e.ports && e.ports[0]) e.ports[0].postMessage({ userId });
});

// ------------------------------------------------------------------ telegram
async function linkTelegram() {
  try {
    const r = await userApi('/telegram/link-code', { method: 'POST' });
    const box = $('#telegram-box'); box.hidden = false;
    box.innerHTML = r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">👉 텔레그램 봇 열기</a> 를 누르고 <b>시작</b>을 누르면 연결됩니다. (코드 <code>${esc(r.code)}</code>, 15분 유효)<br>연결 후 이 페이지를 새로 고치면 상태가 갱신됩니다.`
      : `봇에서 <code>/start ${esc(r.code)}</code> 를 보내 주세요. (15분 유효)`;
  } catch (e) { toast(`텔레그램 연결 실패: ${e.message}`, 4000); }
}
async function unlinkTelegram() {
  try { await userApi('/telegram', { method: 'DELETE' }); channels.telegram = false; $('#telegram-box').hidden = true; toast('텔레그램 연결을 해제했어요'); } catch (e) { toast(e.message); }
  await refreshPushUI();
}

// ------------------------------------------------------------------ status
async function renderStatus() {
  try {
    const s = await api('/api/status');
    const pill = $('#mode-pill'); pill.hidden = false;
    pill.textContent = s.providerMode === 'coupang' ? '실시간 쿠팡 데이터' : '데모 데이터 (합성)';
    const next = s.scheduler && s.scheduler.nextSweepAt ? new Date(s.scheduler.nextSweepAt).toLocaleTimeString('ko-KR') : '-';
    $('#status-json').textContent = JSON.stringify({
      provider: s.providerMode, nextSweepAt: next, products: s.counts.products, observations: s.counts.observations,
      dealsLast24h: s.counts.dealsLast24h, paused: s.scheduler ? s.scheduler.paused : undefined,
      lastPolls: s.lastPolls.map((p) => ({ cat: p.coupangCategoryId, ok: p.ok, products: p.productCount, deals: p.dealCount, at: new Date(p.startedAt).toLocaleString('ko-KR'), error: p.error || undefined })),
    }, null, 1);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ boot
async function boot() {
  bindSettings();
  $('#btn-push').addEventListener('click', enablePush);
  $('#btn-push-off').addEventListener('click', disablePush);
  $('#btn-test').addEventListener('click', async () => {
    try {
      const r = await userApi('/test-notification', { method: 'POST' });
      toast(r.ok ? '테스트 알림을 보냈어요. 잠시 후 도착합니다.' : (r.error || '전송할 채널이 없습니다.'), 4000);
    } catch (e) { toast(`실패: ${e.message}`, 4000); }
  });
  $('#btn-telegram').addEventListener('click', linkTelegram);
  $('#btn-telegram-off').addEventListener('click', unlinkTelegram);

  const [cfg, tax, me] = await Promise.all([api('/api/config'), api('/api/taxonomy'), userApi('/prefs')]);
  config = cfg; taxonomy = tax; prefs = me.prefs; channels = me.channels;
  if (cfg.disclosure) $('#disclosure').textContent = cfg.disclosure;
  renderTaxonomy(); renderSettings(); renderDeals(); renderStatus();
  await resyncSubscription();
  await refreshPushUI();
  setInterval(() => { renderDeals(); renderStatus(); }, 5 * 60_000);
}
boot().catch((e) => { console.error(e); toast(`초기화 실패: ${e.message}`, 6000); });
