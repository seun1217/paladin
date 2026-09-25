// 앱 진입점: 상태 관리와 화면·지도·데이터 연결.
import { REGIONS, regionByCode } from './regions.js';
import { SPOT_CATEGORIES, EVENT_TYPES, EVENT_STATUS } from './taxonomy.js';
import {
  todayKST, defaultFilters, applyFilters, matchesFilters, sortItems, SORTS, PERIOD_PRESETS, presetRange, detectPreset,
  monthlyEventCounts, nextMonths, filtersToQuery, filtersFromQuery, isValidYmd, eventStatusOf,
} from './model.js';
import { loadDataset, fetchLiveEventsFromBrowser, assemble, watchForUpdates, loadGeo } from './data.js';
import { fetchDetail } from './tourapi.js';
import { createMap } from './map.js';
import { renderChips, renderListItem, renderPopup, toast, formatDateTime, h } from './ui.js';

const LS = { settings: 'ktm:settings', favorites: 'ktm:favorites', theme: 'ktm:theme', sort: 'ktm:sort', bounds: 'ktm:boundsOnly' };
const $ = (id) => document.getElementById(id);

function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 무시 */ }
}

const state = {
  today: todayKST(),
  items: [],
  raw: null,
  sources: null,
  filters: null,
  sort: readLS(LS.sort, 'relevance'),
  boundsOnly: readLS(LS.bounds, true),
  favorites: new Set(readLS(LS.favorites, [])),
  settings: Object.assign({ apiKey: '', baseUrl: '', directFetch: false, pollMin: 30 }, readLS(LS.settings, {})),
  listLimit: 120,
  activeId: null,
  tagOptions: [],
  stopWatch: null,
  loading: false,
};
state.filters = filtersFromQuery(location.hash.replace(/^#/, ''), state.today);

// ---------- 테마 ----------
let mapApi = null;
let userPickedBasemap = false;
function currentTheme() {
  const saved = readLS(LS.theme, null);
  if (saved) return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (mapApi && !userPickedBasemap) mapApi.setBasemap(theme === 'dark' ? 'dark' : 'voyager');
}
applyTheme(currentTheme());

// ---------- 지도 ----------
function popupCtx() {
  return {
    today: state.today,
    favorites: state.favorites,
    onToggleFavorite: toggleFavorite,
    canLoadDetail: Boolean(state.settings.apiKey),
    onLoadDetail: (item) => fetchDetail(item.contentId, { key: state.settings.apiKey, baseUrl: state.settings.baseUrl || undefined, mobileOS: 'WEB' }),
  };
}

let listRenderTimer = null;
function scheduleListRender() {
  clearTimeout(listRenderTimer);
  listRenderTimer = setTimeout(renderList, 120);
}

mapApi = createMap($('map'), {
  theme: currentTheme(),
  renderPopup: (item) => renderPopup(item, popupCtx()),
  onSelect: (item) => setActive(item.id, 'map'),
  onMoveEnd: () => { if (state.boundsOnly) scheduleListRender(); },
  onBasemapChange: () => { userPickedBasemap = true; },
  onVectorModeChange: (on) => {
    if (on) toast('지도 타일을 불러올 수 없어 시·도 경계 지도로 표시합니다. 네트워크가 연결되면 자동으로 전환됩니다.', { timeout: 6000 });
  },
});
loadGeo().then((geo) => { if (geo) mapApi.setVectorBasemap(geo); });

// ---------- 즐겨찾기 ----------
function toggleFavorite(item) {
  if (state.favorites.has(item.id)) state.favorites.delete(item.id); else state.favorites.add(item.id);
  writeLS(LS.favorites, Array.from(state.favorites));
  $('fav-count').textContent = state.favorites.size ? `(${state.favorites.size})` : '';
  if (state.filters.favoritesOnly) render(); else renderList();
  return state.favorites.has(item.id);
}

// ---------- 활성 항목 ----------
function setActive(id, from) {
  state.activeId = id;
  const list = $('result-list');
  for (const li of list.children) li.classList.toggle('active', li.dataset.id === id);
  const li = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (li && from === 'map') li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  mapApi.setActive(id);
}

function selectItem(item, from) {
  setActive(item.id, from);
  if (from === 'list') {
    mapApi.focus(item);
    if (window.matchMedia('(max-width: 860px)').matches) toggleSheet(false);
  }
}

// ---------- 필터 UI ----------
function setFilters(patch, { rerender = true } = {}) {
  Object.assign(state.filters, patch);
  if (rerender) render();
}

function toggleInList(listKey, value, exclusive) {
  const list = state.filters[listKey].slice();
  const i = list.indexOf(value);
  if (exclusive) setFilters({ [listKey]: i >= 0 && list.length === 1 ? [] : [value] });
  else { if (i >= 0) list.splice(i, 1); else list.push(value); setFilters({ [listKey]: list }); }
}

function buildStaticControls() {
  // 기간 프리셋
  $('period-presets').replaceChildren(...PERIOD_PRESETS.map((p) => h('button', { type: 'button', class: 'chip', dataset: { key: p.key }, 'aria-pressed': 'false',
    onClick: () => { const r = presetRange(p.key, state.today); setFilters({ from: r.from, to: r.to }); } }, p.name)));
  $('date-from').addEventListener('change', (e) => setFilters({ from: isValidYmd(e.target.value) ? e.target.value : null }));
  $('date-to').addEventListener('change', (e) => setFilters({ to: isValidYmd(e.target.value) ? e.target.value : null }));
  $('btn-fit-results').addEventListener('click', () => mapApi.fitTo(filtered));

  // 정렬
  $('sort-select').replaceChildren(...SORTS.map((s) => h('option', { value: s.key, selected: s.key === state.sort }, s.name)));
  $('sort-select').addEventListener('change', (e) => { state.sort = e.target.value; writeLS(LS.sort, state.sort); renderList(); });

  // 옵션
  $('opt-featured').addEventListener('change', (e) => setFilters({ featuredOnly: e.target.checked }));
  $('opt-favorites').addEventListener('change', (e) => setFilters({ favoritesOnly: e.target.checked }));
  $('opt-bounds').checked = state.boundsOnly;
  $('opt-bounds').addEventListener('change', (e) => { state.boundsOnly = e.target.checked; writeLS(LS.bounds, state.boundsOnly); renderList(); });
  $('near-km').addEventListener('change', (e) => { if (state.filters.near) setFilters({ near: { ...state.filters.near, km: Number(e.target.value) } }); });
  $('btn-near').addEventListener('click', onNearMe);

  // 검색
  let t = null;
  $('search-input').value = state.filters.q || '';
  $('search-input').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => setFilters({ q: e.target.value }), 200); });

  $('btn-reset').addEventListener('click', () => {
    state.filters = defaultFilters(state.today);
    $('search-input').value = '';
    $('btn-near').setAttribute('aria-pressed', 'false');
    $('near-status').textContent = '';
    render();
  });
  if (window.__KTM_INLINE_DATA__) $('btn-share').hidden = true;
  $('btn-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('현재 필터가 담긴 링크를 복사했습니다.', { type: 'ok', timeout: 2500 }); }
    catch { toast('클립보드 복사에 실패했습니다. 주소창의 링크를 직접 복사하세요.', { type: 'err' }); }
  });
  $('btn-more').addEventListener('click', () => { state.listLimit += 120; renderList(); });

  // 상단 버튼
  $('btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    writeLS(LS.theme, next); applyTheme(next);
  });
  $('btn-refresh').addEventListener('click', () => reload({ reason: 'manual' }));
  $('btn-toggle-panel').addEventListener('click', () => toggleSheet());
  $('sheet-handle').addEventListener('click', () => toggleSheet());
  $('sheet-handle').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSheet(); } });

  // 설정
  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); $('settings-dialog').close(); });
  $('btn-fetch-now').addEventListener('click', fetchNowFromBrowser);
  let clearArmed = null;
  $('btn-clear-storage').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!clearArmed) {
      btn.textContent = '다시 누르면 삭제됩니다';
      btn.classList.add('danger');
      clearArmed = setTimeout(() => { clearArmed = null; btn.textContent = '저장된 설정·즐겨찾기 삭제'; btn.classList.remove('danger'); }, 4000);
      return;
    }
    clearTimeout(clearArmed);
    try { for (const k of Object.values(LS)) localStorage.removeItem(k); } catch { /* 무시 */ }
    state.favorites = new Set();
    state.settings = { apiKey: '', baseUrl: '', directFetch: false, pollMin: 30 };
    state.filters = defaultFilters(state.today);
    $('search-input').value = '';
    $('settings-dialog').close();
    render();
    toast('저장된 설정과 즐겨찾기를 삭제했습니다.', { type: 'ok', timeout: 2500 });
  });

  window.addEventListener('hashchange', () => {
    const f = filtersFromQuery(location.hash.replace(/^#/, ''), state.today);
    if (filtersToQuery(f, state.today) !== filtersToQuery(state.filters, state.today)) { state.filters = f; $('search-input').value = f.q || ''; render(); }
  });
  window.addEventListener('resize', () => mapApi.invalidate());
}

function toggleSheet(force) {
  const sb = $('sidebar');
  const open = force === undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open);
  $('btn-toggle-panel').setAttribute('aria-expanded', String(open));
}

function onNearMe() {
  if (state.filters.near) {
    setFilters({ near: null });
    $('btn-near').setAttribute('aria-pressed', 'false');
    $('near-status').textContent = '';
    return;
  }
  if (!navigator.geolocation) { toast('이 브라우저는 위치 정보를 지원하지 않습니다.', { type: 'err' }); return; }
  $('near-status').textContent = '위치 확인 중…';
  navigator.geolocation.getCurrentPosition((pos) => {
    const near = { lat: pos.coords.latitude, lng: pos.coords.longitude, km: Number($('near-km').value) };
    $('btn-near').setAttribute('aria-pressed', 'true');
    $('near-status').textContent = `${near.lat.toFixed(3)}, ${near.lng.toFixed(3)}`;
    setFilters({ near });
    mapApi.flyTo(near.lat, near.lng, near.km <= 10 ? 12 : near.km <= 30 ? 10 : 9);
  }, (err) => {
    $('near-status').textContent = '';
    toast(`위치를 가져오지 못했습니다 (${err.message}). 지도 중심 기준으로 정렬하려면 정렬을 "거리순"으로 바꾸세요.`, { type: 'err', timeout: 7000 });
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

// ---------- 집계 (다른 조건을 유지한 채 특정 차원만 제외하고 센다) ----------
function countBy(dimensionKey, getter, extraPatch = {}) {
  const f = { ...state.filters, [dimensionKey]: [], ...extraPatch };
  const ctx = { today: state.today, favorites: state.favorites };
  const counts = new Map();
  for (const it of state.items) {
    if (!matchesFilters(it, f, ctx)) continue;
    const k = getter(it);
    if (k === null || k === undefined) continue;
    if (Array.isArray(k)) for (const kk of k) counts.set(kk, (counts.get(kk) || 0) + 1);
    else counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function renderFilterControls() {
  const f = state.filters;
  const preset = detectPreset(f.from, f.to, state.today);
  for (const chip of $('period-presets').children) chip.setAttribute('aria-pressed', String(chip.dataset.key === preset));
  $('date-from').value = f.from || '';
  $('date-to').value = f.to || '';
  $('period-summary').textContent = !f.from && !f.to ? '전체 기간' : `${f.from || '…'} ~ ${f.to || '…'}`;

  const kindCounts = countBy('kinds', (it) => it.kind);
  renderChips($('kind-chips'), [{ key: 'spot', name: '관광지' }, { key: 'event', name: '축제·행사' }], f.kinds, { counts: kindCounts, onToggle: (k) => toggleInList('kinds', k) });
  $('kind-summary').textContent = f.kinds.length === 2 || f.kinds.length === 0 ? '전체' : (f.kinds[0] === 'spot' ? '관광지' : '축제·행사');

  const regionCounts = countBy('regions', (it) => it.region);
  renderChips($('region-chips'), REGIONS.map((r) => ({ key: r.code, name: r.name })), f.regions, { counts: regionCounts, onToggle: (k) => toggleInList('regions', k) });
  $('region-summary').textContent = f.regions.length ? f.regions.map((c) => regionByCode(c)?.name).join(', ') : '전국';

  const catCounts = countBy('spotCats', (it) => (it.kind === 'spot' ? it.category : null));
  renderChips($('spotcat-chips'), SPOT_CATEGORIES, f.spotCats, { counts: catCounts, onToggle: (k) => toggleInList('spotCats', k) });
  $('spotcat-summary').textContent = f.spotCats.length ? f.spotCats.map((k) => SPOT_CATEGORIES.find((c) => c.key === k)?.name).join(', ') : '전체';

  const typeCounts = countBy('eventTypes', (it) => (it.kind === 'event' ? it.type : null));
  renderChips($('eventtype-chips'), EVENT_TYPES, f.eventTypes, { counts: typeCounts, onToggle: (k) => toggleInList('eventTypes', k) });
  const statusCounts = countBy('statuses', (it) => (it.kind === 'event' ? eventStatusOfSafe(it) : null));
  renderChips($('status-chips'), EVENT_STATUS, f.statuses, { counts: statusCounts, onToggle: (k) => toggleInList('statuses', k) });
  const evSummary = [
    f.eventTypes.length ? f.eventTypes.map((k) => EVENT_TYPES.find((c) => c.key === k)?.name).join(', ') : null,
    f.statuses.length ? f.statuses.map((k) => EVENT_STATUS.find((c) => c.key === k)?.name).join(', ') : null,
  ].filter(Boolean).join(' · ');
  $('event-summary').textContent = evSummary || '전체';

  const tagCounts = countBy('tags', (it) => it.tags || []);
  const tagOptions = state.tagOptions.filter((t) => (tagCounts.get(t.key) || 0) > 0 || f.tags.includes(t.key)).slice(0, 36);
  renderChips($('tag-chips'), tagOptions, f.tags, { counts: tagCounts, onToggle: (k) => toggleInList('tags', k) });
  $('tag-summary').textContent = f.tags.length ? f.tags.join(', ') : '전체';

  $('opt-featured').checked = f.featuredOnly;
  $('opt-favorites').checked = f.favoritesOnly;
  $('fav-count').textContent = state.favorites.size ? `(${state.favorites.size})` : '';
  const opts = [f.featuredOnly ? '주요만' : null, f.favoritesOnly ? '즐겨찾기' : null, f.near ? `내 주변 ${f.near.km}km` : null].filter(Boolean);
  $('option-summary').textContent = opts.join(' · ');
  if (f.near) { $('btn-near').setAttribute('aria-pressed', 'true'); $('near-km').value = String(f.near.km); }

  renderMonthStrip();
}

function eventStatusOfSafe(it) { return eventStatusOf(it, state.today); }

function renderMonthStrip() {
  const f = { ...state.filters, from: null, to: null, statuses: [], kinds: ['event'] };
  const ctx = { today: state.today, favorites: state.favorites };
  const events = state.items.filter((it) => it.kind === 'event' && matchesFilters(it, f, ctx));
  const months = nextMonths(state.today, 12);
  const counts = monthlyEventCounts(events, months);
  const max = Math.max(1, ...counts);
  const selFrom = state.filters.from;
  const selTo = state.filters.to;
  // 연도 행: 같은 연도의 달을 하나의 칸으로 묶는다.
  const years = [];
  for (const m of months) {
    const last = years[years.length - 1];
    if (last && last.year === m.year) last.span += 1; else years.push({ year: m.year, span: 1 });
  }
  $('month-years').replaceChildren(...years.map((y) => h('span', { style: { gridColumn: `span ${y.span}` } }, `${y.year}년`)));
  $('month-bars').replaceChildren(...months.map((m, i) => {
    const n = counts[i];
    const active = selFrom && selTo && !(m.to < selFrom || m.from > selTo);
    return h('button', { type: 'button', class: `month-bar${active ? ' active' : ''}`, title: `${m.year}년 ${m.month}월 행사 ${n}건`, onClick: () => setFilters({ from: m.from, to: m.to }) },
      h('div', { class: 'bar', style: { height: `${Math.round((n / max) * 40) + 3}px` } }),
      h('span', { class: 'lbl' }, m.month));
  }));
}

// ---------- 렌더링 ----------
let filtered = [];
function render() {
  const ctx = { today: state.today, favorites: state.favorites };
  filtered = applyFilters(state.items, state.filters, ctx);
  try { history.replaceState(null, '', `#${filtersToQuery(state.filters, state.today)}`); } catch { /* 샌드박스 환경에서는 URL 갱신 생략 */ }
  renderFilterControls();
  mapApi.setItems(filtered, ctx);
  state.listLimit = 120;
  // 필터 결과가 현재 화면 밖에만 있으면 지도를 결과 위치로 맞춘다 (지도 이동에 의한 재렌더는 renderList 만 호출).
  if (filtered.length && !mapApi.anyInView(filtered)) mapApi.fitTo(filtered);
  renderList();
}

function renderList() {
  const bounds = state.boundsOnly ? mapApi.getBounds() : null;
  let visible = bounds ? filtered.filter((it) => bounds.contains([it.lat, it.lng])) : filtered;
  visible = sortItems(visible, state.sort, { today: state.today, center: state.filters.near || mapApi.getCenter() });
  const total = visible.length;
  const shown = visible.slice(0, state.listLimit);
  $('result-count').textContent = total.toLocaleString('ko-KR');
  $('result-count-badge').textContent = filtered.length.toLocaleString('ko-KR');
  const spots = filtered.filter((i) => i.kind === 'spot').length;
  $('result-count-detail').textContent = bounds && total !== filtered.length
    ? `(전체 ${filtered.length.toLocaleString('ko-KR')}개 중 지도 영역 내)`
    : `(관광지 ${spots.toLocaleString('ko-KR')} · 행사 ${(filtered.length - spots).toLocaleString('ko-KR')})`;
  const ctx = { today: state.today, favorites: state.favorites, onSelect: selectItem, onToggleFavorite: toggleFavorite };
  $('result-list').replaceChildren(...shown.map((it) => renderListItem(it, { ...ctx, active: it.id === state.activeId })));
  $('btn-more').hidden = shown.length >= total;
  $('btn-more').textContent = `더 보기 (${(total - shown.length).toLocaleString('ko-KR')}개 남음)`;
  $('results-empty').hidden = !(filtered.length === 0);
  $('results-outside').hidden = !(filtered.length > 0 && total === 0);
}

function buildTagOptions() {
  const freq = new Map();
  for (const it of state.items) for (const t of it.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
  state.tagOptions = Array.from(freq.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => ({ key: t, name: t }));
}

// ---------- 데이터 상태 표시 ----------
function renderDataStatus() {
  const s = state.sources;
  const dot = $('data-status-dot');
  const text = $('data-status-text');
  if (!s) { text.textContent = '데이터 불러오는 중…'; dot.className = 'dot'; return; }
  const live = state.items.filter((i) => i.source && i.source.startsWith('tourapi')).length;
  if (s.browserFetchedAt) { dot.className = 'dot ok'; text.textContent = `TourAPI 직접 조회 ${formatDateTime(s.browserFetchedAt)}`; }
  else if (s.repoUpdatedAt) { dot.className = 'dot ok'; text.textContent = `데이터 기준 ${formatDateTime(s.repoUpdatedAt)}`; }
  else { dot.className = 'dot warn'; text.textContent = '기본(시드) 데이터 · TourAPI 미연동'; }
  $('data-status').title = [
    `항목 ${state.items.length.toLocaleString('ko-KR')}개 (TourAPI ${live.toLocaleString('ko-KR')}개)`,
    s.repoCheckedAt ? `마지막 자동 확인 ${formatDateTime(s.repoCheckedAt)}` : '자동 갱신 미실행',
    s.browserError ? `직접 조회 오류: ${s.browserError}` : null,
  ].filter(Boolean).join('\n');
}

function renderMetaList() {
  const s = state.sources || {};
  const rows = [
    ['오늘 (KST)', state.today],
    ['전체 항목', `${state.items.length.toLocaleString('ko-KR')}개`],
    ['저장소 데이터 갱신', formatDateTime(s.repoUpdatedAt)],
    ['마지막 자동 확인', formatDateTime(s.repoCheckedAt)],
    ['브라우저 직접 조회', s.browserFetchedAt ? formatDateTime(s.browserFetchedAt) : (s.browserError ? `실패: ${s.browserError}` : '-')],
    ['즐겨찾기', `${state.favorites.size}개`],
  ];
  $('meta-list').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

// ---------- 설정 ----------
function openSettings() {
  $('set-api-key').value = state.settings.apiKey || '';
  $('set-base-url').value = state.settings.baseUrl || '';
  $('set-direct').checked = Boolean(state.settings.directFetch);
  $('set-poll').value = String(state.settings.pollMin ?? 30);
  $('fetch-status').textContent = '';
  renderMetaList();
  $('settings-dialog').showModal();
}

function readSettingsForm() {
  return {
    apiKey: $('set-api-key').value.trim(),
    baseUrl: $('set-base-url').value.trim(),
    directFetch: $('set-direct').checked,
    pollMin: Number($('set-poll').value),
  };
}

function saveSettings() {
  const prev = state.settings;
  state.settings = readSettingsForm();
  writeLS(LS.settings, state.settings);
  if (prev.pollMin !== state.settings.pollMin) startWatching();
  if (state.settings.directFetch && state.settings.apiKey && (!prev.directFetch || prev.apiKey !== state.settings.apiKey)) reload({ reason: 'settings' });
  toast('설정을 저장했습니다.', { type: 'ok', timeout: 2000 });
}

async function fetchNowFromBrowser() {
  const s = readSettingsForm();
  if (!s.apiKey) { $('fetch-status').textContent = '서비스 키를 먼저 입력하세요.'; return; }
  const btn = $('btn-fetch-now');
  btn.disabled = true;
  $('fetch-status').textContent = 'TourAPI 조회 중…';
  try {
    const events = await fetchLiveEventsFromBrowser(s, state.today);
    state.settings = s; writeLS(LS.settings, s);
    state.raw.events = events;
    state.items = assemble(state.raw, state.today);
    state.sources.browserFetchedAt = new Date().toISOString();
    state.sources.browserError = null;
    buildTagOptions();
    render();
    renderDataStatus();
    renderMetaList();
    $('fetch-status').textContent = `행사 ${events.length.toLocaleString('ko-KR')}건을 받아왔습니다.`;
    toast(`TourAPI 에서 행사 ${events.length.toLocaleString('ko-KR')}건을 받아왔습니다.`, { type: 'ok' });
  } catch (e) {
    state.sources.browserError = e.message;
    $('fetch-status').textContent = `실패: ${e.message}`;
    renderDataStatus();
  } finally {
    btn.disabled = false;
  }
}

// ---------- 로드·갱신 ----------
async function reload({ reason } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('btn-refresh').classList.add('spin');
  $('map-loading').hidden = state.items.length > 0;
  try {
    const { items, raw, sources, warnings } = await loadDataset({ settings: state.settings, today: state.today });
    state.items = items;
    state.raw = raw;
    state.sources = sources;
    buildTagOptions();
    render();
    // 공유 링크 등으로 지역·내 주변 조건을 갖고 첫 로드된 경우 결과 위치로 지도를 맞춘다.
    if (reason === 'init' && (state.filters.regions.length || state.filters.near) && filtered.length) mapApi.fitTo(filtered);
    renderDataStatus();
    for (const w of warnings) console.warn('[data]', w);
    if (reason === 'manual') toast(`데이터를 다시 불러왔습니다 (${items.length.toLocaleString('ko-KR')}개).`, { type: 'ok', timeout: 2500 });
    if (sources.browserError) toast(`TourAPI 직접 조회 실패: ${sources.browserError}`, { type: 'err', timeout: 8000 });
  } catch (e) {
    console.error(e);
    toast(`데이터를 불러오지 못했습니다: ${e.message}`, { type: 'err', timeout: 8000 });
  } finally {
    state.loading = false;
    $('btn-refresh').classList.remove('spin');
    $('map-loading').hidden = true;
  }
}

function startWatching() {
  if (state.stopWatch) state.stopWatch();
  state.stopWatch = watchForUpdates({
    intervalMin: state.settings.pollMin,
    getCurrentUpdatedAt: () => state.sources?.repoUpdatedAt || null,
    onChange: (meta) => {
      toast(`새 데이터가 있습니다 (${formatDateTime(meta.updatedAt)} 갱신).`, {
        type: 'ok', timeout: 0, action: { label: '적용', fn: () => reload({ reason: 'update' }) },
      });
    },
  });
}

// ---------- 시작 ----------
buildStaticControls();
render();
reload({ reason: 'init' }).then(() => {
  startWatching();
  // 자정(KST)이 지나면 '오늘' 이 바뀌므로 상태 뱃지를 다시 계산한다.
  setInterval(() => { const t = todayKST(); if (t !== state.today) { state.today = t; render(); } }, 60 * 1000);
});
