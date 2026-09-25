// Leaflet 지도, 마커, 클러스터, 범례. 전역 L (vendor/leaflet) 을 사용한다.
import { spotCategory, eventStatus, SPOT_CATEGORIES, EVENT_STATUS } from './taxonomy.js';
import { eventStatusOf } from './model.js';
import { KOREA_CENTER, KOREA_BOUNDS } from './regions.js';

const PIN_PATH = 'M13 0C5.8 0 0 5.8 0 13c0 9.6 13 21 13 21s13-11.4 13-21C26 5.8 20.2 0 13 0z';

export const BASEMAPS = {
  voyager: {
    name: '기본 (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    dark: false,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    dark: false,
  },
  dark: {
    name: '다크 (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    dark: true,
  },
};

function colorOf(item, today) {
  return item.kind === 'event' ? eventStatus(eventStatusOf(item, today)).color : spotCategory(item.category).color;
}

function makeIcon(item, today) {
  const c = colorOf(item, today);
  if (item.kind === 'spot') {
    const featured = item.featured ? ' featured' : '';
    const size = item.featured ? 17 : 14;
    return L.divIcon({
      className: 'marker-wrap',
      html: `<div class="marker-spot${featured}" style="--c:${c}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2 - 2],
    });
  }
  const status = eventStatusOf(item, today);
  const pulse = status === 'ongoing' ? '<span class="pulse"></span>' : '';
  return L.divIcon({
    className: 'marker-wrap',
    html: `<div class="marker-event" style="--c:${c}"><svg viewBox="0 0 26 34"><path d="${PIN_PATH}" fill="${c}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>${pulse}</div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

class Legend extends L.Control {
  onAdd() {
    const div = L.DomUtil.create('div', 'legend');
    const spotRows = SPOT_CATEGORIES.map((c) => `<div class="row"><span class="sw" style="--c:${c.color}"></span>${c.name}</div>`).join('');
    const evRows = EVENT_STATUS.map((s) => `<div class="row"><span class="sw pin" style="--c:${s.color}"></span>행사 · ${s.name}</div>`).join('');
    div.innerHTML = `<details><summary>범례</summary><h4>행사 (핀)</h4>${evRows}<h4 style="margin-top:6px">관광지 (점)</h4>${spotRows}</details>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  }
}

export function createMap(el, { theme = 'light', renderPopup, onSelect, onMoveEnd, onBasemapChange } = {}) {
  const map = L.map(el, {
    center: KOREA_CENTER,
    zoom: 7,
    minZoom: 6,
    maxZoom: 18,
    zoomControl: false,
    preferCanvas: false,
    worldCopyJump: false,
    maxBounds: [[KOREA_BOUNDS.south - 3, KOREA_BOUNDS.west - 6], [KOREA_BOUNDS.north + 3, KOREA_BOUNDS.east + 6]],
    maxBoundsViscosity: 0.6,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const layers = {};
  for (const [key, def] of Object.entries(BASEMAPS)) {
    layers[key] = L.tileLayer(def.url, { attribution: def.attribution, maxZoom: 19, subdomains: 'abcd', crossOrigin: true });
  }
  let currentBasemap = theme === 'dark' ? 'dark' : 'voyager';
  layers[currentBasemap].addTo(map);
  const control = L.control.layers(
    Object.fromEntries(Object.entries(BASEMAPS).map(([k, d]) => [d.name, layers[k]])),
    null,
    { position: 'topright', collapsed: true },
  ).addTo(map);
  map.on('baselayerchange', (e) => {
    currentBasemap = Object.keys(layers).find((k) => layers[k] === e.layer) || currentBasemap;
    if (onBasemapChange) onBasemapChange(currentBasemap);
  });

  new Legend({ position: 'bottomleft' }).addTo(map);

  const cluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 80,
    maxClusterRadius: 52,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: 15,
    iconCreateFunction(c) {
      const n = c.getChildCount();
      const size = n < 10 ? 's' : n < 100 ? 'm' : 'l';
      const ongoing = c.getAllChildMarkers().some((m) => m.options.item?.kind === 'event' && m.options.item.status === 'ongoing');
      return L.divIcon({ html: `<div class="cluster ${size}${ongoing ? ' has-ongoing' : ''}">${n}</div>`, className: 'cluster-wrap', iconSize: [40, 40] });
    },
  });
  map.addLayer(cluster);

  const markers = new Map(); // id -> marker
  let today = null;
  let activeId = null;
  let lastSignature = '';

  function setItems(items, ctx) {
    today = ctx.today;
    const sig = items.length + ':' + (items.length ? items[0].id + '|' + items[items.length - 1].id : '') + ':' + hashIds(items);
    if (sig === lastSignature) return;
    lastSignature = sig;
    cluster.clearLayers();
    markers.clear();
    const arr = items.map((item) => {
      const status = item.kind === 'event' ? eventStatusOf(item, today) : null;
      const m = L.marker([item.lat, item.lng], { icon: makeIcon(item, today), item: { kind: item.kind, status, id: item.id }, title: item.title, riseOnHover: true });
      m.bindPopup(() => renderPopup(item), { maxWidth: 320, minWidth: 260, autoPanPaddingTopLeft: [20, 70], autoPanPaddingBottomRight: [20, 20] });
      m.on('click', () => { if (onSelect) onSelect(item, 'map'); });
      markers.set(item.id, m);
      return m;
    });
    cluster.addLayers(arr);
  }

  function hashIds(items) {
    // 빠른 서명: 항목 id 들의 합산 해시 (재렌더 불필요 판단용)
    let h = 0;
    for (const it of items) {
      const s = it.id;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  function focus(item, { openPopup = true, zoom = 13 } = {}) {
    const m = markers.get(item.id);
    const target = [item.lat, item.lng];
    const z = Math.max(map.getZoom(), zoom);
    if (!m) { map.flyTo(target, z, { duration: 0.6 }); return; }
    map.once('moveend', () => {
      cluster.zoomToShowLayer(m, () => { if (openPopup) m.openPopup(); });
    });
    map.flyTo(target, z, { duration: 0.6 });
    setActive(item.id);
  }

  function setActive(id) {
    if (activeId && markers.get(activeId)) {
      const el = markers.get(activeId).getElement();
      if (el) el.classList.remove('active-marker');
    }
    activeId = id;
    const m = id ? markers.get(id) : null;
    const el = m && m.getElement();
    if (el) el.classList.add('active-marker');
  }

  function fitTo(items, { maxZoom = 12 } = {}) {
    if (!items.length) return;
    const b = L.latLngBounds(items.map((it) => [it.lat, it.lng]));
    map.fitBounds(b.pad(0.15), { maxZoom, padding: [30, 30] });
  }

  function anyInView(items) {
    const b = map.getBounds();
    return items.some((it) => b.contains([it.lat, it.lng]));
  }

  function setBasemap(key) {
    if (!layers[key] || key === currentBasemap) return;
    map.removeLayer(layers[currentBasemap]);
    layers[key].addTo(map);
    currentBasemap = key;
  }

  map.on('moveend zoomend', () => { if (onMoveEnd) onMoveEnd(map.getBounds()); });
  map.on('popupclose', () => setActive(null));

  return {
    map,
    cluster,
    setItems,
    focus,
    setActive,
    setBasemap,
    fitTo,
    anyInView,
    getBounds: () => map.getBounds(),
    getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
    fitKorea: () => map.fitBounds([[KOREA_BOUNDS.south, KOREA_BOUNDS.west], [KOREA_BOUNDS.north, KOREA_BOUNDS.east]], { padding: [10, 10] }),
    flyTo: (lat, lng, zoom) => map.flyTo([lat, lng], zoom, { duration: 0.6 }),
    invalidate: () => map.invalidateSize(),
    get basemap() { return currentBasemap; },
    layersControl: control,
  };
}
