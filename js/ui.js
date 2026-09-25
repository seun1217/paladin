// DOM 렌더링 헬퍼: 칩, 목록, 팝업, 토스트. 상태는 app.js 가 관리한다.
import { SPOT_CATEGORIES, EVENT_TYPES, EVENT_STATUS, spotCategory, eventType, eventStatus } from './taxonomy.js';
import { regionByCode } from './regions.js';
import { eventStatusOf, eventBadge, formatDateRange } from './model.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// 칩 그룹 렌더링. options: [{key, name, color?}], selected: Set/Array, counts: Map(key -> n)
export function renderChips(container, options, selected, { onToggle, counts, showZero = true, exclusive = false } = {}) {
  const sel = new Set(selected || []);
  container.replaceChildren(...options.map((o) => {
    const n = counts ? counts.get(o.key) || 0 : null;
    if (counts && !showZero && n === 0 && !sel.has(o.key)) return null;
    const chip = h('button', {
      type: 'button', class: 'chip', 'aria-pressed': sel.has(o.key) ? 'true' : 'false', dataset: { key: o.key },
      onClick: () => onToggle(o.key, exclusive),
    },
    o.color ? h('span', { class: 'swatch', style: { '--c': o.color } }) : null,
    o.name,
    n !== null ? h('span', { class: 'count' }, n) : null);
    return chip;
  }).filter(Boolean));
}

function placeholderThumb(item, color) {
  return h('div', { class: 'thumb placeholder', style: { background: color } }, item.title.trim().charAt(0));
}

function thumb(item, color) {
  if (!item.thumb && !item.img) return placeholderThumb(item, color);
  const img = h('img', { class: 'thumb', src: item.thumb || item.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(placeholderThumb(item, color)), { once: true });
  return img;
}

export function itemColor(item, today) {
  return item.kind === 'event' ? eventStatus(eventStatusOf(item, today)).color : spotCategory(item.category).color;
}

export function renderListItem(item, { today, favorites, onSelect, onToggleFavorite, active }) {
  const color = itemColor(item, today);
  const region = regionByCode(item.region);
  const isFav = favorites.has(item.id);
  let pills;
  let sub;
  if (item.kind === 'event') {
    const st = eventStatusOf(item, today);
    pills = [
      h('span', { class: 'pill', style: { '--c': eventStatus(st).color } }, eventBadge(item, today)),
      item.dateBasis === 'estimated' ? h('span', { class: 'pill est', title: '예년 일정 기준 추정. 공식 일정 확인 필요' }, '예상') : null,
    ];
    sub = `${formatDateRange(item.start, item.end)} · ${eventType(item.type).name}${region ? ' · ' + region.name : ''}`;
  } else {
    pills = [h('span', { class: 'pill outline', style: { '--c': color } }, spotCategory(item.category).name)];
    sub = `${region ? region.name + ' · ' : ''}${item.addr || ''}`;
  }
  const li = h('li', { class: `result-item${active ? ' active' : ''}`, dataset: { id: item.id }, tabindex: '0', role: 'button',
    onClick: () => onSelect(item, 'list'),
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item, 'list'); } } },
  thumb(item, color),
  h('div', { class: 'body' },
    h('p', { class: 'title' },
      h('span', { class: 't', title: item.title }, item.title),
      item.featured ? h('span', { class: 'pill outline', style: { '--c': '#b98b00' }, title: '주요 관광지·축제' }, '주요') : null,
      h('button', { type: 'button', class: `fav${isFav ? ' on' : ''}`, 'aria-label': isFav ? '즐겨찾기 해제' : '즐겨찾기 추가', 'aria-pressed': isFav ? 'true' : 'false',
        onClick: (e) => { e.stopPropagation(); onToggleFavorite(item); } }, isFav ? '★' : '☆')),
    h('div', { class: 'sub', title: sub }, sub),
    h('div', { class: 'tags' }, ...pills, ...(item.tags || []).slice(0, 3).map((t) => h('span', { class: 'tag' }, t)))));
  return li;
}

function mapLinks(item) {
  const name = encodeURIComponent(item.title);
  return {
    kakao: `https://map.kakao.com/link/map/${name},${item.lat},${item.lng}`,
    kakaoTo: `https://map.kakao.com/link/to/${name},${item.lat},${item.lng}`,
    naver: `https://map.naver.com/p/search/${name}`,
    visitkorea: `https://korean.visitkorea.or.kr/search/search_list.do?keyword=${name}`,
  };
}

// 팝업 HTML (Leaflet 은 DOM 노드도 받는다). 즐겨찾기·상세 버튼은 app.js 콜백으로 처리한다.
export function renderPopup(item, { today, favorites, onToggleFavorite, onLoadDetail, canLoadDetail }) {
  const color = itemColor(item, today);
  const region = regionByCode(item.region);
  const links = mapLinks(item);
  const isFav = favorites.has(item.id);
  const pills = [];
  if (item.kind === 'event') {
    const st = eventStatusOf(item, today);
    pills.push(h('span', { class: 'pill', style: { '--c': eventStatus(st).color } }, eventStatus(st).name));
    pills.push(h('span', { class: 'pill', style: { '--c': eventType(item.type).color } }, eventType(item.type).name));
  } else {
    pills.push(h('span', { class: 'pill', style: { '--c': color } }, spotCategory(item.category).name));
  }
  if (item.featured) pills.push(h('span', { class: 'pill', style: { '--c': '#b98b00' } }, '주요'));

  const hero = h('div', { class: `hero${item.img ? '' : ' none'}`, style: item.img ? { backgroundImage: `url("${item.img}")` } : { '--c': color } }, h('div', { class: 'pills' }, ...pills));
  const lines = [];
  if (item.kind === 'event') {
    lines.push(h('div', { class: 'line' }, h('span', {}, '일정'), h('strong', {}, formatDateRange(item.start, item.end)),
      h('span', { class: 'pill', style: { '--c': eventStatus(eventStatusOf(item, today)).color } }, eventBadge(item, today)),
      item.dateBasis === 'estimated' ? h('span', { class: 'pill est' }, '예년 기준 추정') : null));
  }
  if (item.addr) lines.push(h('div', { class: 'line' }, h('span', {}, '주소'), h('span', {}, `${item.addr}`)));
  else if (region) lines.push(h('div', { class: 'line' }, h('span', {}, '지역'), h('span', {}, region.full)));
  if (item.tel) lines.push(h('div', { class: 'line' }, h('span', {}, '문의'), h('a', { href: `tel:${item.tel.replace(/[^\d+]/g, '')}` }, item.tel)));

  const detailBox = h('div', { class: 'detail', hidden: true });
  const favBtn = h('button', { type: 'button', class: `fav${isFav ? ' on' : ''}`, onClick: () => {
    const on = onToggleFavorite(item);
    favBtn.classList.toggle('on', on);
    favBtn.textContent = on ? '★ 즐겨찾기' : '☆ 즐겨찾기';
  } }, isFav ? '★ 즐겨찾기' : '☆ 즐겨찾기');
  const actions = h('div', { class: 'actions' },
    favBtn,
    h('a', { href: links.kakao, target: '_blank', rel: 'noopener' }, '카카오맵'),
    h('a', { href: links.naver, target: '_blank', rel: 'noopener' }, '네이버지도'),
    h('a', { href: links.kakaoTo, target: '_blank', rel: 'noopener' }, '길찾기'),
    item.homepage ? h('a', { href: item.homepage, target: '_blank', rel: 'noopener' }, '홈페이지') : null,
    h('a', { href: links.visitkorea, target: '_blank', rel: 'noopener' }, '대한민국 구석구석'),
    item.contentId && canLoadDetail ? h('button', { type: 'button', onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '불러오는 중…';
      try {
        const d = await onLoadDetail(item);
        detailBox.hidden = false;
        detailBox.replaceChildren(
          d?.overview ? h('p', { style: { margin: 0 } }, d.overview) : h('p', { style: { margin: 0 } }, '추가 설명이 없습니다.'),
          d?.homepage ? h('a', { href: d.homepage, target: '_blank', rel: 'noopener' }, d.homepage) : null,
        );
        btn.remove();
      } catch (err) {
        btn.disabled = false; btn.textContent = '상세 정보';
        detailBox.hidden = false; detailBox.textContent = `상세 정보를 불러오지 못했습니다: ${err.message}`;
      }
    } }, '상세 정보') : null,
  );

  return h('div', { class: 'popup', style: { '--c': color } },
    hero,
    h('div', { class: 'content' },
      h('h3', {}, item.title),
      ...lines,
      item.description ? h('p', { class: 'desc' }, item.description) : null,
      (item.tags || []).length ? h('div', { class: 'tags' }, ...item.tags.slice(0, 8).map((t) => h('span', { class: 'tag' }, t))) : null,
      actions,
      detailBox,
      item.source && item.source.startsWith('tourapi') && item.modified ? h('div', { class: 'line', style: { marginTop: '6px' } }, h('span', {}, `TourAPI · 수정 ${item.modified}`)) : null,
    ));
}

let toastRoot;
export function toast(message, { type = '', timeout = 5000, action } = {}) {
  toastRoot = toastRoot || document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`.trim(), role: 'status' }, h('span', {}, message));
  if (action) el.append(h('button', { type: 'button', onClick: () => { action.fn(); el.remove(); } }, action.label));
  toastRoot.append(el);
  if (timeout > 0) setTimeout(() => el.remove(), timeout);
  return el;
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(d);
}

export const OPTION_SETS = { SPOT_CATEGORIES, EVENT_TYPES, EVENT_STATUS };
