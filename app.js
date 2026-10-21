/* POS Tu negocio — MVP offline-first. No external libraries or cloud dependencies. */
'use strict';

const DB_NAME = 'tu_pos_local_db';
const DB_VERSION = 1;
const APP_VERSION = '0.1.0';
const STORE_NAMES = ['settings', 'products', 'carts', 'sales'];
let db;
let state = {
  page: 'home',
  cartReturnPage: 'salon',
  activeCartId: null,
  installPrompt: null,
  reportDate: localDateKey(),
  lastSale: null,
  menu: null,
  business: null,
  products: [],
  carts: [],
  sales: [],
  backupMeta: null,
  lastStoragePersisted: false
};

const DEFAULT_MENU = {
  entries: ['Sopa a la minuta', 'Papa a la huancaína'],
  seconds: ['Ají de gallina', 'Lomo saltado'],
  drinks: ['Chicha morada', 'Refresco de maracuyá'],
  price: 10,
  menuDate: localDateKey()
};
const DEFAULT_PRODUCTS = [
  { id: 'drink-incakola', name: 'Inca Kola', price: 3.5, active: true, createdAt: new Date().toISOString() },
  { id: 'drink-cocacola', name: 'Coca-Cola', price: 3.5, active: true, createdAt: new Date().toISOString() },
  { id: 'drink-water', name: 'Agua sin gas', price: 2, active: true, createdAt: new Date().toISOString() },
  { id: 'drink-chicha', name: 'Chicha morada (vaso)', price: 2.5, active: true, createdAt: new Date().toISOString() }
];
const PAGE_META = {
  home: ['PANEL DE CONTROL', 'Resumen del día'],
  salon: ['PEDIDOS EN EL LOCAL', 'Mesas'],
  delivery: ['PEDIDOS PARA LLEVAR', 'Delivery'],
  quick: ['VENTA DIRECTA', 'Venta rápida'],
  menu: ['CARTA Y PRECIOS', 'Menú y bebidas'],
  reports: ['CONTROL DEL NEGOCIO', 'Reportes'],
  backup: ['PROTECCIÓN DE DATOS', 'Copias de seguridad'],
  settings: ['PERSONALIZA TU POS', 'Configuración'],
  cart: ['PEDIDO ACTIVO', 'Detalle del pedido']
};

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function localTime(date = new Date()) { return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(dateKey) {
  if (!dateKey) return '—';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function money(value) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function idPart() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
function makeId(prefix = 'id') { return `${prefix}-${Date.now().toString(36)}-${idPart()}`; }
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function attr(value) { return escapeHTML(value); }
function getSettingRecord(key, value) { return { key, value }; }
function channelLabel(channel) {
  return ({ salon: 'Mesa / salón', delivery: 'Delivery', counter_menu: 'Solo menú', counter_beverage: 'Bebidas', counter_mixed: 'Venta rápida' })[channel] || 'Venta';
}
function cartTitle(cart) {
  if (cart.channel === 'salon') return `Mesa ${cart.tableNumber}`;
  if (cart.channel === 'delivery') return cart.customerName ? `Delivery · ${cart.customerName}` : 'Pedido delivery';
  if (cart.channel.startsWith('counter_')) {
    const hasMenus = (cart.items || []).some(i => i.kind === 'menu');
    const hasBeverages = (cart.items || []).some(i => i.kind === 'beverage');
    if (hasMenus && hasBeverages) return 'Venta rápida';
    if (hasMenus) return 'Venta de menú';
    if (hasBeverages) return 'Venta de bebidas';
    return cart.channel === 'counter_menu' ? 'Venta de menú' : 'Venta de bebidas';
  }
  return 'Pedido';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Este navegador no ofrece almacenamiento local compatible. Actualiza Chrome.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('products')) database.createObjectStore('products', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('carts')) database.createObjectStore('carts', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('sales')) database.createObjectStore('sales', { keyPath: 'id' });
    };
    request.onsuccess = () => { db = request.result; db.onversionchange = () => { db.close(); toast('La base local cambió. Cierra y vuelve a abrir el POS.', 'warning'); }; resolve(db); };
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos local.'));
    request.onblocked = () => reject(new Error('Otra pestaña está usando una versión anterior del POS. Cierra las otras pestañas e inténtalo de nuevo.'));
  });
}
function dbRequest(storeName, mode, method, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    let result;
    try { request = value === undefined ? store[method]() : store[method](value); }
    catch (error) { reject(error); return; }
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('Error al acceder a los datos.'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Error al guardar los datos.'));
    tx.onabort = () => reject(tx.error || new Error('La operación de datos fue cancelada.'));
  });
}
const getRecord = (store, key) => dbRequest(store, 'readonly', 'get', key);
const getAllRecords = store => dbRequest(store, 'readonly', 'getAll');
const putRecord = (store, value) => dbRequest(store, 'readwrite', 'put', value);
const deleteRecord = (store, key) => dbRequest(store, 'readwrite', 'delete', key);

async function refreshData() {
  const [businessRow, menuRow, products, carts, sales, backupRow] = await Promise.all([
    getRecord('settings', 'business'), getRecord('settings', 'menu'), getAllRecords('products'),
    getAllRecords('carts'), getAllRecords('sales'), getRecord('settings', 'backupMeta')
  ]);
  state.business = businessRow?.value || null;
  state.menu = menuRow?.value || { ...DEFAULT_MENU };
  state.products = (products || []).filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  state.carts = (carts || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  state.sales = (sales || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  state.backupMeta = backupRow?.value || null;
}
async function seedDefaults() {
  const existing = await getAllRecords('products');
  if (!existing || existing.length === 0) {
    const tx = db.transaction('products', 'readwrite');
    DEFAULT_PRODUCTS.forEach(p => tx.objectStore('products').put(p));
    await txDone(tx);
  }
  if (!(await getRecord('settings', 'menu'))) await putRecord('settings', getSettingRecord('menu', { ...DEFAULT_MENU }));
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('No se pudo completar la operación.'));
    tx.onabort = () => reject(tx.error || new Error('La operación fue cancelada.'));
  });
}
async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) state.lastStoragePersisted = await navigator.storage.persist();
  } catch (_) { state.lastStoragePersisted = false; }
}

function toast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div'); el.className = `toast ${type === 'success' ? '' : type}`.trim(); el.textContent = message;
  region.appendChild(el); setTimeout(() => el.remove(), 3800);
}
function updateConnectionStatus() {
  const isOnline = navigator.onLine;
  const dot = document.getElementById('connection-dot');
  const sidebarDot = document.getElementById('sidebar-dot');
  dot?.classList.toggle('offline', !isOnline); sidebarDot?.classList.toggle('offline', !isOnline);
  const label = document.getElementById('connection-label'); if (label) label.textContent = isOnline ? 'Con conexión' : 'Modo sin internet';
  const status = document.getElementById('sidebar-status'); if (status) status.textContent = isOnline ? 'Datos guardados en local' : 'Trabajando sin internet';
  const sub = document.getElementById('sidebar-status-sub'); if (sub) sub.textContent = 'En esta tablet';
}
function setupSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('No se pudo registrar el service worker:', err));
  }
}
function showSetup() {
  document.querySelector('.app-shell').style.display = 'none';
  let setup = document.getElementById('setup-root');
  if (!setup) { setup = document.createElement('div'); setup.id = 'setup-root'; document.body.appendChild(setup); }
  setup.innerHTML = `
    <main class="setup-screen"><section class="setup-card">
      <div class="brand-mark">P</div>
      <span class="eyebrow">CONFIGURACIÓN INICIAL</span>
      <h1>Tu negocio, bajo control.</h1>
      <p>Vamos a preparar tu POS. Estos datos se guardarán en esta tablet y podrás cambiarlos más adelante.</p>
      <form id="setup-form">
        <div class="field"><label for="setup-business">Nombre del negocio *</label><input id="setup-business" name="businessName" required maxlength="80" placeholder="Ej. Restaurante El Buen Sabor" autocomplete="organization"></div>
        <div class="field" style="margin-top:13px"><label for="setup-phone">Teléfono (opcional)</label><input id="setup-phone" name="phone" type="tel" maxlength="30" placeholder="Ej. 999 999 999"></div>
        <div class="field" style="margin-top:13px"><label for="setup-tables">Número de mesas</label><input id="setup-tables" name="tableCount" type="number" min="1" max="60" value="9" required><small>Puedes cambiarlo después en Configuración.</small></div>
        <div class="setup-actions"><button class="button primary wide" type="submit">Preparar mi POS <span>→</span></button></div>
      </form>
      <p class="setup-footnote">Versión inicial de prueba. Los tickets impresos son de control interno; no reemplazan los comprobantes de pago exigidos por SUNAT.</p>
    </section></main>`;
}
async function submitSetup(form) {
  const fd = new FormData(form); const name = String(fd.get('businessName') || '').trim();
  const tableCount = Math.min(60, Math.max(1, Number(fd.get('tableCount')) || 9));
  if (!name) return toast('Escribe el nombre del negocio.', 'error');
  const business = { name, phone: String(fd.get('phone') || '').trim(), tableCount, currency: 'PEN', createdAt: new Date().toISOString() };
  await putRecord('settings', getSettingRecord('business', business));
  document.getElementById('setup-root')?.remove(); document.querySelector('.app-shell').style.display = 'flex';
  await refreshData(); render(); toast(`Configuración lista para ${name}.`);
}

function setPage(page) {
  if (!PAGE_META[page]) page = 'home';
  state.page = page;
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page || (page === 'cart' && button.dataset.page === state.cartReturnPage)));
  document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('mobile-overlay')?.classList.remove('show');
  render();
}
function render() {
  if (!state.business) return showSetup();
  const meta = PAGE_META[state.page] || PAGE_META.home;
  document.getElementById('page-kicker').textContent = meta[0];
  document.getElementById('page-title').textContent = state.page === 'cart' && state.activeCartId ? 'Detalle del pedido' : meta[1];
  document.getElementById('brand-name').textContent = state.business.name || 'Tu negocio';
  document.getElementById('today-label').textContent = new Date().toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
  const deliveryCount = state.carts.filter(c => c.channel === 'delivery').length;
  const dc = document.getElementById('delivery-count'); dc.textContent = deliveryCount; dc.classList.toggle('hidden', deliveryCount === 0);
  updateConnectionStatus();
  const main = document.getElementById('main-content');
  const pages = { home: renderHome, salon: renderSalon, delivery: renderDelivery, quick: renderQuick, menu: renderMenu, reports: renderReports, backup: renderBackup, settings: renderSettings, cart: renderCart };
  main.innerHTML = (pages[state.page] || renderHome)();
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.page === state.page || (state.page === 'cart' && button.dataset.page === state.cartReturnPage)));
  if (state.installPrompt && state.page === 'home') {
    const banner = document.createElement('div'); banner.className = 'install-prompt'; banner.innerHTML = `<p><strong>Instala el POS en esta tablet</strong>Abre desde su icono y úsalo como una aplicación.</p><button class="button primary small" data-action="install-pwa">Instalar</button>`;
    main.prepend(banner);
  }
}
function renderHome() {
  const today = localDateKey(); const todaysSales = state.sales.filter(s => s.dateKey === today);
  const total = todaysSales.reduce((sum, s) => sum + s.total, 0);
  const menus = todaysSales.reduce((sum, s) => sum + (s.items || []).filter(i => i.kind === 'menu').reduce((a, i) => a + (i.qty || 1), 0), 0);
  const openCarts = state.carts.filter(c => c.channel === 'salon' || c.channel === 'delivery');
  const lastSales = todaysSales.slice(0, 5);
  const menuIsOld = state.menu?.menuDate && state.menu.menuDate !== today;
  return `
    <div class="page-intro"><div><span class="eyebrow">${escapeHTML(formatDate(today))}</span><h2>Hola, ${escapeHTML(state.business.name)}.</h2><p>Este es el estado de tu negocio hoy. Las ventas se guardan localmente en esta tablet.</p></div><button class="button primary" data-page="quick">＋ Registrar venta</button></div>
    ${menuIsOld ? `<div class="alert-note warning"><span class="alert-symbol">◷</span><div><strong>Revisa el menú del día</strong><p>La carta guardada es del ${escapeHTML(formatDate(state.menu.menuDate))}. Actualízala en Menú y bebidas si hoy cambió.</p></div><button class="button secondary small" data-page="menu">Actualizar</button></div>` : ''}
    <section class="grid stats-grid">
      <article class="stat-card"><div class="stat-head">Ventas de hoy <span class="stat-icon">S/</span></div><div class="stat-value">${money(total)}</div><div class="stat-note">${todaysSales.length} operación${todaysSales.length === 1 ? '' : 'es'} registrada${todaysSales.length === 1 ? '' : 's'}</div></article>
      <article class="stat-card"><div class="stat-head">Menús vendidos <span class="stat-icon">☷</span></div><div class="stat-value">${menus}</div><div class="stat-note">Menús completos de hoy</div></article>
      <article class="stat-card"><div class="stat-head">Pedidos abiertos <span class="stat-icon">▦</span></div><div class="stat-value">${openCarts.length}</div><div class="stat-note">Mesas y delivery pendientes</div></article>
      <article class="stat-card"><div class="stat-head">Ticket promedio <span class="stat-icon">↗</span></div><div class="stat-value">${money(todaysSales.length ? total / todaysSales.length : 0)}</div><div class="stat-note">Por operación cerrada</div></article>
    </section>
    <section class="grid home-grid">
      <article class="panel"><div class="panel-head"><div><h3>Últimas ventas</h3><p>Operaciones cerradas hoy</p></div><button class="link-button" data-page="reports">Ver reporte →</button></div>
        ${lastSales.length ? `<div class="sale-list">${lastSales.map(s => `<div class="sale-row"><div class="sale-mark">${s.channel === 'delivery' ? '↗' : s.channel === 'salon' ? '▦' : 'S/'}</div><div class="sale-info"><strong>${escapeHTML(s.label || channelLabel(s.channel))}</strong><span>${escapeHTML(localTime(new Date(s.createdAt)))} · ${escapeHTML(s.payment || 'Sin método')}</span></div><div class="sale-amount">${money(s.total)}</div></div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">◷</div><strong>Aún no hay ventas registradas</strong><p>Cuando cierres tu primera venta, aparecerá aquí.</p></div>`}
      </article>
      <article class="panel"><div class="panel-head"><div><h3>Accesos rápidos</h3><p>Lo que necesitas para atender</p></div></div><div class="grid actions-grid">
        <button class="action-card" data-page="salon"><span class="action-icon">▦</span><strong>Abrir una mesa</strong><small>Tomar pedidos en el local</small></button>
        <button class="action-card" data-action="new-delivery"><span class="action-icon">↗</span><strong>Nuevo delivery</strong><small>Registrar el nombre del cliente</small></button>
        <button class="action-card" data-page="quick"><span class="action-icon">＋</span><strong>Venta rápida</strong><small>Menú o bebida por separado</small></button>
        <button class="action-card" data-page="backup"><span class="action-icon">↥</span><strong>Crear una copia</strong><small>Protege los datos de tu negocio</small></button>
      </div></article>
    </section>
    <div class="alert-note" style="margin-top:18px"><span class="alert-symbol">✓</span><div><strong>Modo offline preparado</strong><p>${navigator.onLine ? 'La interfaz trabaja con datos locales. Una vez instalada y cargada, la PWA puede abrirse sin internet.' : 'Estás sin internet; puedes registrar ventas porque los datos se guardan localmente.'} Crea copias de seguridad periódicas y guárdalas fuera de la tablet.</p></div></div>`;
}
function renderSalon() {
  const count = Number(state.business.tableCount) || 9;
  const tableCards = Array.from({ length: count }, (_, i) => {
    const number = i + 1; const cart = state.carts.find(c => c.channel === 'salon' && Number(c.tableNumber) === number);
    const amount = cartTotal(cart);
    return `<button class="table-card ${cart ? 'occupied' : ''}" data-action="open-table" data-table="${number}"><div class="table-card-top"><strong>Mesa ${number}</strong><span class="status-chip ${cart ? 'busy' : ''}">${cart ? 'En atención' : 'Libre'}</span></div><p>${cart ? `${cart.items.length} detalle${cart.items.length === 1 ? '' : 's'} en el pedido` : 'Toca para iniciar un pedido'}</p><div class="table-card-bottom"><span class="tag">${cart ? money(amount) : 'Disponible'}</span><span class="text-button">${cart ? 'Continuar →' : 'Abrir →'}</span></div></button>`;
  }).join('');
  return `<div class="page-intro"><div><h2>Control de mesas</h2><p>Selecciona una mesa para registrar menús y bebidas. Los pedidos abiertos se guardan automáticamente.</p></div><span class="status-chip neutral">${count} mesas configuradas</span></div><div class="grid table-grid">${tableCards}</div>`;
}
function renderDelivery() {
  const deliveries = state.carts.filter(c => c.channel === 'delivery');
  return `<div class="page-intro"><div><h2>Pedidos para delivery</h2><p>Identifica el pedido con el nombre del cliente. Puedes retomarlo si cierras o recargas la aplicación.</p></div><button class="button primary" data-action="new-delivery">＋ Nuevo delivery</button></div>
    ${deliveries.length ? `<div class="grid delivery-grid">${deliveries.map(c => `<article class="delivery-card"><div class="table-card-top"><span class="status-chip busy">Pendiente</span><span class="muted" style="font-size:10px">${escapeHTML(localTime(new Date(c.createdAt)))}</span></div><h3 style="margin-top:14px">${escapeHTML(c.customerName || 'Cliente sin nombre')}</h3><p>${c.items.length} detalle${c.items.length === 1 ? '' : 's'} · Pedido abierto</p><div class="delivery-meta"><strong>${money(cartTotal(c))}</strong><span class="tag">${escapeHTML(c.id.slice(-6).toUpperCase())}</span></div><button class="button secondary wide" data-action="open-cart" data-cart-id="${attr(c.id)}">Continuar pedido →</button></article>`).join('')}</div>` : `<div class="panel"><div class="empty-state"><div class="empty-icon">↗</div><strong>No hay delivery pendientes</strong><p>Cuando recibas un pedido, crea uno y agrega primero la cantidad de menús y luego sus detalles.</p><button class="button primary" style="margin-top:15px" data-action="new-delivery">Crear primer delivery</button></div></div>`}`;
}
function renderQuick() {
  const pending = state.carts.filter(c => c.channel.startsWith('counter_'));
  return `<div class="page-intro"><div><h2>Registrar una venta directa</h2><p>Para ventas que no necesitan quedarse asociadas a una mesa. Elige qué vendiste y registra el pago.</p></div></div>
    <div class="grid actions-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:850px">
      <button class="action-card" data-action="new-quick-menu" style="min-height:185px;padding:20px"><span class="action-icon">☷</span><strong>Vender menú(s)</strong><small>Primero indica cuántos menús. Después selecciona la entrada, el segundo y el refresco de cada menú.</small><span class="text-button" style="margin-top:15px">Empezar venta →</span></button>
      <button class="action-card" data-action="new-quick-beverage" style="min-height:185px;padding:20px"><span class="action-icon">◉</span><strong>Vender bebidas</strong><small>Registra gaseosas, agua u otras bebidas sin asociarlas a un pedido de menú.</small><span class="text-button" style="margin-top:15px">Empezar venta →</span></button>
    </div>
    ${pending.length ? `<section class="panel" style="max-width:850px;margin-top:17px"><div class="panel-head"><div><h3>Ventas rápidas pendientes</h3><p>También se conservan si cierras la aplicación o reinicias la tablet.</p></div><span class="status-chip busy">${pending.length} abiertas</span></div><div class="sale-list">${pending.map(c => `<div class="sale-row"><div class="sale-mark">S/</div><div class="sale-info"><strong>${escapeHTML(cartTitle(c))}</strong><span>${c.items.length} detalle(s) · ${escapeHTML(localTime(new Date(c.updatedAt || c.createdAt)))}</span></div><div class="sale-amount">${money(cartTotal(c))}</div><button class="button small secondary" data-action="open-cart" data-cart-id="${attr(c.id)}">Continuar →</button></div>`).join('')}</div></section>` : ''}
    <div class="alert-note" style="max-width:850px;margin-top:18px"><span class="alert-symbol">i</span><div><strong>Precios del menú completo</strong><p>El precio base del menú es ${money(state.menu.price || 10)}. Puedes cambiarlo en Menú y bebidas si tu negocio lo necesita.</p></div></div>`;
}
function renderMenu() {
  const menu = state.menu || DEFAULT_MENU;
  const activeProducts = state.products;
  const entries = (menu.entries || []).join(', '); const seconds = (menu.seconds || []).join(', '); const drinks = (menu.drinks || []).join(', ');
  return `<div class="page-intro"><div><h2>Organiza la carta de hoy</h2><p>Estos valores se guardan en la tablet. Al registrar un menú, el sistema captura los detalles elegidos para que no cambien en una venta antigua.</p></div><span class="status-chip neutral">Precio base: ${money(menu.price || 10)}</span></div>
    <div class="grid section-grid">
      <section class="panel"><div class="panel-head"><div><h3>Menú del día</h3><p>Entrada, segundo y refresco incluidos en el precio base.</p></div></div>
        <form id="menu-config-form"><div class="field-grid">
          <div class="field"><label for="menu-price">Precio del menú completo (S/)</label><input id="menu-price" name="price" type="number" min="0" step="0.5" required value="${attr(menu.price ?? 10)}"></div>
          <div class="field"><label for="menu-date">Fecha de esta carta</label><input id="menu-date" name="menuDate" type="date" required value="${attr(menu.menuDate || localDateKey())}"></div>
          <div class="field full"><label for="menu-entries">Entradas</label><textarea id="menu-entries" name="entries" required placeholder="Sopa, papa a la huancaína">${escapeHTML(entries)}</textarea><small>Separa cada opción con una coma. Ej.: Sopa, Papa a la huancaína.</small></div>
          <div class="field full"><label for="menu-seconds">Segundos</label><textarea id="menu-seconds" name="seconds" required placeholder="Ají de gallina, Lomo saltado">${escapeHTML(seconds)}</textarea></div>
          <div class="field full"><label for="menu-drinks">Refrescos incluidos</label><textarea id="menu-drinks" name="drinks" required placeholder="Chicha morada, Maracuyá">${escapeHTML(drinks)}</textarea></div>
        </div><div class="form-actions"><button type="submit" class="button primary">Guardar carta</button></div></form>
      </section>
      <section class="panel"><div class="panel-head"><div><h3>Bebidas por separado</h3><p>Productos y precios que se podrán agregar a una mesa o vender individualmente.</p></div></div>
        <form id="product-form"><div class="field-grid"><div class="field"><label for="product-name">Nombre</label><input id="product-name" name="name" maxlength="60" required placeholder="Ej. Inca Kola personal"></div><div class="field"><label for="product-price">Precio (S/)</label><input id="product-price" name="price" type="number" min="0.1" step="0.1" required placeholder="3.50"></div></div><div class="form-actions"><button class="button secondary" type="submit">＋ Agregar bebida</button></div></form>
        <div class="subsection"><h4>Productos activos (${activeProducts.length})</h4><div class="product-list">${activeProducts.length ? activeProducts.map(p => `<div class="product-row"><div><strong>${escapeHTML(p.name)}</strong><span>Se puede agregar a pedidos</span></div><div style="display:flex;align-items:center;gap:10px"><span class="product-price">${money(p.price)}</span><button class="button small ghost" data-action="edit-product" data-product-id="${attr(p.id)}">Editar</button><button class="button small danger" data-action="archive-product" data-product-id="${attr(p.id)}" aria-label="Desactivar ${attr(p.name)}">×</button></div></div>`).join('') : `<div class="empty-state"><strong>No hay bebidas configuradas</strong><p>Agrega el primer producto arriba.</p></div>`}</div></div>
      </section>
    </div>`;
}
function renderReports() {
  const date = state.reportDate || localDateKey(); const sales = state.sales.filter(s => s.dateKey === date).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = sales.reduce((sum, s) => sum + s.total, 0);
  const countKind = kind => sales.reduce((sum, sale) => sum + (sale.items || []).filter(i => i.kind === kind).reduce((a, item) => a + (item.qty || 1), 0), 0);
  const menus = countKind('menu'); const drinks = countKind('beverage'); const menuRevenue = sales.reduce((sum, sale) => sum + (sale.items || []).filter(i => i.kind === 'menu').reduce((part, item) => part + Number(item.unitPrice || 0) * Number(item.qty || 1), 0), 0);
  const channels = ['salon', 'delivery', 'counter_menu', 'counter_beverage', 'counter_mixed'];
  const channelRows = channels.map(channel => ({ channel, rows: sales.filter(s => s.channel === channel), amount: sales.filter(s => s.channel === channel).reduce((a, s) => a + s.total, 0) })).filter(x => x.rows.length > 0 || ['salon','delivery','counter_menu','counter_beverage'].includes(x.channel));
  return `<div class="page-intro"><div><h2>Resumen de ventas</h2><p>Consulta las operaciones registradas en esta tablet. Los reportes reflejan ventas cerradas, no pedidos todavía abiertos.</p></div></div>
    <section class="panel"><div class="toolbar"><div class="toolbar-left"><div class="report-filter"><div class="field"><label for="report-date">Fecha del reporte</label><input class="input" type="date" id="report-date" value="${attr(date)}"></div></div></div><div class="toolbar-right"><button class="button secondary" data-action="export-report" data-date="${attr(date)}">Exportar CSV</button></div></div>
      <div class="grid report-tiles"><article class="stat-card"><div class="stat-head">Ingresos del día</div><div class="stat-value">${money(total)}</div><div class="stat-note">${sales.length} ventas cerradas</div></article><article class="stat-card"><div class="stat-head">Menús vendidos</div><div class="stat-value">${menus}</div><div class="stat-note">${money(menuRevenue)} de ventas registradas en menús</div></article><article class="stat-card"><div class="stat-head">Bebidas registradas</div><div class="stat-value">${drinks}</div><div class="stat-note">Unidades en pedidos y venta rápida</div></article><article class="stat-card"><div class="stat-head">Ticket promedio</div><div class="stat-value">${money(sales.length ? total / sales.length : 0)}</div><div class="stat-note">Por venta cerrada</div></article></div>
      <div class="subsection"><h4>Ingresos por tipo de venta</h4><p>Estos montos se reparten por canal y suman el ingreso total del día. No sumes esta tabla con el detalle de productos, porque son dos vistas distintas de las mismas ventas.</p><div style="overflow-x:auto"><table class="report-table"><thead><tr><th>Canal</th><th>Operaciones</th><th>Ingreso</th></tr></thead><tbody>${channelRows.map(row => `<tr><td>${escapeHTML(channelLabel(row.channel))}</td><td>${row.rows.length}</td><td class="money">${money(row.amount)}</td></tr>`).join('')}<tr><td><strong>Total</strong></td><td><strong>${sales.length}</strong></td><td class="money">${money(total)}</td></tr></tbody></table></div></div>
      <div class="subsection"><div class="panel-head"><div><h4>Ventas registradas</h4><p>Selecciona imprimir para recuperar el ticket de control interno.</p></div></div>${sales.length ? `<div style="overflow-x:auto"><table class="report-table"><thead><tr><th>Hora</th><th>Descripción</th><th>Pago</th><th>Total</th><th></th></tr></thead><tbody>${sales.map(s => `<tr><td class="nowrap">${escapeHTML(localTime(new Date(s.createdAt)))}</td><td>${escapeHTML(s.label || channelLabel(s.channel))}</td><td>${escapeHTML(s.payment || '—')}</td><td class="money">${money(s.total)}</td><td><button class="button small ghost" data-action="print-sale" data-sale-id="${attr(s.id)}">Ticket</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><strong>No hay ventas para esta fecha</strong><p>Registra y cierra una venta para que aparezca en este reporte.</p></div>`}</div>
    </section>`;
}
function renderBackup() {
  const meta = state.backupMeta;
  const last = meta?.lastExportAt ? new Date(meta.lastExportAt).toLocaleString('es-PE') : 'Aún no se ha generado una copia desde esta versión.';
  return `<div class="page-intro"><div><h2>Protege las ventas de tu negocio</h2><p>Los datos principales están en esta tablet. Una copia guardada solamente dentro de la misma aplicación no te protege si pierdes el dispositivo.</p></div></div>
    <div class="alert-note warning"><span class="alert-symbol">!</span><div><strong>Importante: la copia descargada no se sube automáticamente a internet</strong><p>Cuando exportes el archivo, guárdalo en otro lugar seguro (por ejemplo, un ordenador o una memoria externa). El archivo contiene los datos del negocio; no lo compartas públicamente.</p></div></div>
    <div class="grid backup-grid"><article class="backup-card"><div class="backup-icon">↥</div><h3>Crear copia de seguridad</h3><p>Descarga un archivo JSON con la configuración, productos, pedidos abiertos y ventas guardadas. Puedes conservar varias versiones.</p><div class="backup-status"><span class="status-dot"></span><span>Última exportación registrada: ${escapeHTML(last)}</span></div><button class="button primary wide" data-action="backup-export">Descargar copia (.json)</button></article>
      <article class="backup-card"><div class="backup-icon">↧</div><h3>Restaurar una copia</h3><p>Usa un archivo creado por este POS. La restauración reemplaza los datos actuales de la aplicación, así que primero exporta una copia del estado actual.</p><div class="backup-status"><span class="status-dot ${meta?.lastRestoreAt ? '' : 'offline'}"></span><span>${meta?.lastRestoreAt ? `Última restauración: ${escapeHTML(new Date(meta.lastRestoreAt).toLocaleString('es-PE'))}` : 'No se registra ninguna restauración reciente.'}</span></div><button class="button secondary wide" data-action="backup-restore">Elegir archivo para restaurar</button></article>
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Estado de almacenamiento</h3><p>Una guía para entender dónde están tus datos y los límites actuales.</p></div></div><div class="product-list">
      <div class="product-row"><div><strong>Base de datos local</strong><span>Ventas y configuración en IndexedDB de este navegador</span></div><span class="status-chip">Activa</span></div>
      <div class="product-row"><div><strong>Funcionamiento sin conexión</strong><span>El archivo de la aplicación debe haberse cargado e instalado antes de perder internet</span></div><span class="status-chip">${'serviceWorker' in navigator ? 'Navegador compatible' : 'Revisar navegador'}</span></div>
      <div class="product-row"><div><strong>Almacenamiento persistente</strong><span>${state.lastStoragePersisted ? 'El navegador concedió la solicitud de persistencia.' : 'El navegador no confirmó la persistencia exclusiva de los datos. Sigue haciendo copias.'}</span></div><span class="status-chip ${state.lastStoragePersisted ? '' : 'neutral'}">${state.lastStoragePersisted ? 'Concedido' : 'No confirmado'}</span></div>
      <div class="product-row"><div><strong>Respaldo automático en la nube</strong><span>No está activado en esta versión; la copia es manual</span></div><span class="status-chip neutral">Pendiente</span></div>
    </div></section>`;
}
function renderSettings() {
  const b = state.business;
  return `<div class="page-intro"><div><h2>Datos del negocio</h2><p>Personaliza la identidad que aparecerá en la pantalla y en los tickets internos.</p></div></div>
    <div class="grid settings-grid"><section class="panel"><div class="panel-head"><div><h3>Información general</h3><p>Se guarda localmente en esta tablet.</p></div></div>
      <form id="settings-form"><div class="field-grid"><div class="field full"><label for="business-name">Nombre del negocio *</label><input id="business-name" name="name" required maxlength="80" value="${attr(b.name)}"></div><div class="field"><label for="business-phone">Teléfono</label><input id="business-phone" name="phone" type="tel" maxlength="30" value="${attr(b.phone || '')}"></div><div class="field"><label for="table-count">Número de mesas</label><input id="table-count" name="tableCount" type="number" min="1" max="60" required value="${attr(b.tableCount || 9)}"><small>Si reduces el número, primero cierra los pedidos en las mesas que vayan a desaparecer.</small></div></div><div class="form-actions"><button class="button primary" type="submit">Guardar configuración</button></div></form>
    </section><section class="panel"><div class="panel-head"><div><h3>Sobre tus datos</h3><p>Ten en cuenta esto para operar con seguridad.</p></div></div><div class="product-list"><div class="product-row"><div><strong>Almacenamiento</strong><span>En este navegador y dispositivo</span></div><span class="status-chip">Local</span></div><div class="product-row"><div><strong>Conexión necesaria para vender</strong><span>No, una vez instalada y cargada la PWA</span></div><span class="status-chip">Offline</span></div><div class="product-row"><div><strong>Copia de seguridad</strong><span>Debe exportarse fuera de la tablet</span></div><button class="button small secondary" data-page="backup">Abrir</button></div></div><div class="settings-warning"><strong>Esta versión es un MVP.</strong> No guarda contraseñas ni datos sensibles del cliente, y no implementa todavía un PIN de administrador. Mantén bloqueada físicamente la tablet, protege las copias y no la uses como único registro oficial de obligaciones tributarias.</div></section></div>`;
}
function renderCart() {
  const cart = state.carts.find(c => c.id === state.activeCartId);
  if (!cart) { state.page = state.cartReturnPage || 'salon'; return (state.page === 'delivery' ? renderDelivery() : state.page === 'quick' ? renderQuick() : renderSalon()); }
  const items = cart.items || []; const total = cartTotal(cart); const menus = items.filter(i => i.kind === 'menu').length; const beverageCount = items.filter(i => i.kind === 'beverage').reduce((n, i) => n + Number(i.qty || 1), 0);
  return `<div class="page-intro"><div><h2>${escapeHTML(cartTitle(cart))}</h2><p>${cart.channel === 'salon' ? 'Agrega los pedidos que soliciten en esta mesa.' : cart.channel === 'delivery' ? 'El nombre del cliente te ayuda a identificar el pedido.' : 'Revisa el pedido antes de cobrar.'}</p></div><button class="button secondary" data-action="back-to-list">← Volver</button></div>
    ${cart.channel === 'delivery' ? `<div class="alert-note"><span class="alert-symbol">↗</span><div><strong>Cliente: ${escapeHTML(cart.customerName || 'Sin nombre')}</strong><p>Pedido delivery. El total completo se reportará en el canal delivery.</p></div></div>` : ''}
    <div class="split-layout"><section class="panel"><div class="panel-head"><div><h3>Agregar al pedido</h3><p>Los cambios se guardan automáticamente en la tablet.</p></div><span class="status-chip">${items.length} líneas</span></div><div class="cart-add-grid"><button class="mini-add" data-action="add-menus" data-cart-id="${attr(cart.id)}">＋ Agregar menú(s)<span>Elegir cantidad, entrada, segundo y refresco.</span></button><button class="mini-add" data-action="add-beverage" data-cart-id="${attr(cart.id)}">＋ Agregar bebida<span>Productos y precios configurados.</span></button></div><div class="subsection"><h4>Detalle del pedido</h4>${items.length ? `<div>${items.map((item, idx) => `<div class="cart-item"><div class="cart-item-copy"><strong>${escapeHTML(item.kind === 'menu' ? `Menú completo · ${idx + 1}` : `${item.qty} × ${item.name}`)}</strong><span>${item.kind === 'menu' ? `Entrada: ${escapeHTML(item.entry)} · Segundo: ${escapeHTML(item.second)} · Refresco: ${escapeHTML(item.drink)}` : 'Bebida por separado'}</span></div><div class="cart-item-price">${money(Number(item.unitPrice) * Number(item.qty || 1))}</div><button class="remove-item" title="Quitar línea" aria-label="Quitar línea" data-action="remove-cart-item" data-cart-id="${attr(cart.id)}" data-item-id="${attr(item.id)}">×</button></div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">☷</div><strong>El pedido está vacío</strong><p>Agrega los menús o bebidas que te pidió el cliente.</p></div>`}</div></section>
    <aside class="panel cart-panel"><div class="cart-title-line"><div><span class="eyebrow">RESUMEN</span><h3>Cuenta del pedido</h3></div><span class="status-chip neutral">${escapeHTML(channelLabel(cart.channel))}</span></div><div class="subsection" style="margin-top:14px"><div class="total-row"><span>Menús completos</span><strong>${menus}</strong></div><div class="total-row" style="margin-top:10px"><span>Bebidas individuales</span><strong>${beverageCount}</strong></div></div><div class="cart-totals"><div class="total-row"><span>Subtotal</span><strong>${money(total)}</strong></div><div class="total-row grand"><span>Total</span><span>${money(total)}</span></div><p class="muted" style="font-size:10px;line-height:1.5;margin:0">Elegirás el método de pago al confirmar el cobro.</p></div><div class="cart-action-grid"><button class="button secondary" data-action="print-open-cart" data-cart-id="${attr(cart.id)}" ${items.length ? '' : 'disabled'}>Imprimir pedido</button><button class="button primary" data-action="checkout" data-cart-id="${attr(cart.id)}" ${items.length ? '' : 'disabled'}>Cobrar y cerrar</button><button class="button ghost" data-action="back-to-list">Guardar y volver después</button></div><p class="muted" style="font-size:10px;line-height:1.5;margin:12px 0 0">Cobrar registra la venta en el historial y cierra el pedido. Un ticket impreso aquí es un documento de control interno.</p></aside></div>`;
}
function cartTotal(cart) { return (cart?.items || []).reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.qty || 1), 0); }

function modal(content, className = '') {
  document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function modalHeader(title, subtitle, close = true) { return `<div class="modal-header"><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle || '')}</p></div>${close ? '<button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button>' : ''}</div>`; }
function optionsHTML(options, selected = '') {
  const valid = (options || []).filter(Boolean);
  if (!valid.length) return '<option value="">Configura esta opción en Menú y bebidas</option>';
  return `<option value="">Selecciona una opción</option>${valid.map(option => `<option value="${attr(option)}" ${option === selected ? 'selected' : ''}>${escapeHTML(option)}</option>`).join('')}`;
}
function showMenuQuantityModal(cartId) {
  const cart = state.carts.find(c => c.id === cartId);
  if (!cart) return toast('No encontramos ese pedido.', 'error');
  modal(`${modalHeader('¿Cuántos menús vas a registrar?', `${cartTitle(cart)} · Cada menú incluye entrada, segundo y refresco.`)}<form id="menu-qty-form" data-cart-id="${attr(cartId)}"><div class="field"><label for="menu-qty">Cantidad de menús</label><input id="menu-qty" name="qty" type="number" min="1" max="30" step="1" value="1" required></div><div class="alert-note" style="margin:15px 0 0"><span class="alert-symbol">i</span><div><strong>Precio por menú: ${money(state.menu.price || 10)}</strong><p>En la siguiente pantalla podrás elegir los detalles de cada menú por separado.</p></div></div><div class="modal-footer"><button type="button" class="button ghost" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">Continuar →</button></div></form>`);
}
function showMenuDetailsModal(cartId, qty) {
  const menu = state.menu || DEFAULT_MENU;
  const count = Math.min(30, Math.max(1, Number(qty) || 1));
  const rows = Array.from({ length: count }, (_, i) => `<div class="menu-step-card"><h4>Menú ${i + 1}</h4><div class="field-grid"><div class="field"><label for="entry-${i}">Entrada *</label><select id="entry-${i}" name="entry-${i}" required>${optionsHTML(menu.entries)}</select></div><div class="field"><label for="second-${i}">Segundo *</label><select id="second-${i}" name="second-${i}" required>${optionsHTML(menu.seconds)}</select></div><div class="field full"><label for="drink-${i}">Refresco incluido *</label><select id="drink-${i}" name="drink-${i}" required>${optionsHTML(menu.drinks)}</select></div></div></div>`).join('');
  const hasOptions = menu.entries?.length && menu.seconds?.length && menu.drinks?.length;
  if (!hasOptions) { modal(`${modalHeader('Falta configurar la carta', 'Antes de registrar menús, agrega al menos una entrada, un segundo y un refresco en Menú y bebidas.')}<div class="modal-footer"><button class="button secondary" data-action="close-modal">Cerrar</button><button class="button primary" data-page="menu">Ir a la carta</button></div>`); return; }
  modal(`${modalHeader('Detalles de cada menú', `${count} menú(s) · ${money(count * Number(menu.price || 10))} en total`)}<form id="menu-details-form" data-cart-id="${attr(cartId)}" data-qty="${count}"><div>${rows}</div><div class="modal-footer"><button type="button" class="button ghost" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">Agregar al pedido</button></div></form>`);
}
function showBeverageModal(cartId, existing = null) {
  const product = existing ? state.products.find(p => p.id === existing.productId) : null;
  modal(`${modalHeader(existing ? 'Editar bebida' : 'Agregar bebida', 'Bebidas por separado, con precio y cantidad.')}<form id="beverage-form" data-cart-id="${attr(cartId)}" ${existing ? `data-item-id="${attr(existing.id)}"` : ''}><div class="field"><label for="bev-product">Producto *</label><select id="bev-product" name="productId" required>${state.products.map(p => `<option value="${attr(p.id)}" ${p.id === product?.id ? 'selected' : ''}>${escapeHTML(p.name)} · ${money(p.price)}</option>`).join('')}</select></div><div class="field" style="margin-top:13px"><label for="bev-qty">Cantidad *</label><input id="bev-qty" name="qty" type="number" min="1" max="99" value="${attr(existing?.qty || 1)}" required></div><div class="modal-footer"><button type="button" class="button ghost" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">${existing ? 'Guardar cambios' : 'Agregar bebida'}</button></div></form>`);
  if (!state.products.length) { modal(`${modalHeader('No hay bebidas configuradas', 'Primero agrega una bebida y su precio en Menú y bebidas.')}<div class="modal-footer"><button class="button secondary" data-action="close-modal">Cerrar</button><button class="button primary" data-page="menu">Configurar bebidas</button></div>`); }
}
function showNewDeliveryModal() {
  modal(`${modalHeader('Crear delivery', 'Registra el cliente o una referencia para identificar el pedido.')}<form id="delivery-create-form"><div class="field"><label for="delivery-customer">Nombre del cliente o referencia *</label><input id="delivery-customer" name="customerName" required maxlength="80" placeholder="Ej. Ana / pedido de la calle 8" autofocus></div><div class="field" style="margin-top:13px"><label for="delivery-note">Nota de entrega (opcional)</label><textarea id="delivery-note" name="notes" maxlength="250" placeholder="Dirección o referencia breve"></textarea></div><div class="modal-footer"><button class="button ghost" type="button" data-action="close-modal">Cancelar</button><button class="button primary" type="submit">Crear pedido</button></div></form>`);
}
function showProductEditModal(productId) {
  const p = state.products.find(x => x.id === productId); if (!p) return;
  modal(`${modalHeader('Editar bebida', 'Cambia el nombre o el precio. Los pedidos ya cerrados conservarán su precio original.')}<form id="product-edit-form" data-product-id="${attr(p.id)}"><div class="field"><label for="edit-product-name">Nombre *</label><input id="edit-product-name" name="name" maxlength="60" required value="${attr(p.name)}"></div><div class="field" style="margin-top:13px"><label for="edit-product-price">Precio (S/) *</label><input id="edit-product-price" name="price" type="number" min="0.1" step="0.1" required value="${attr(p.price)}"></div><div class="modal-footer"><button type="button" class="button ghost" data-action="close-modal">Cancelar</button><button class="button primary" type="submit">Guardar cambios</button></div></form>`);
}
function showCheckoutConfirm(cartId) {
  const cart = state.carts.find(c => c.id === cartId); if (!cart || !cart.items.length) return toast('Agrega al menos un producto antes de cobrar.', 'warning');
  const total = cartTotal(cart);
  modal(`${modalHeader('Confirmar cobro', `${cartTitle(cart)} · revisa el total antes de cerrar la venta.`)}<div class="alert-note"><span class="alert-symbol">S/</span><div><strong>Total a registrar: ${money(total)}</strong><p>Al confirmar, el pedido se guardará en el historial de ventas y dejará de estar abierto.</p></div></div><div class="field" style="margin-top:15px"><label for="checkout-payment">Método de pago</label><select id="checkout-payment"><option>Efectivo</option><option>Yape / Plin</option><option>Tarjeta</option><option>Otro</option></select></div><div class="modal-footer"><button class="button ghost" data-action="close-modal">Volver al pedido</button><button class="button primary" data-action="confirm-checkout" data-cart-id="${attr(cartId)}">Confirmar y registrar</button></div>`);
}

async function openTable(tableNumber) {
  const id = `table-${tableNumber}`; let cart = await getRecord('carts', id);
  if (!cart) {
    cart = { id, channel: 'salon', tableNumber: Number(tableNumber), customerName: '', notes: '', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await putRecord('carts', cart);
  }
  await openCart(id, 'salon');
}
async function createCart(channel, attrs = {}) {
  const cart = { id: attrs.id || makeId(channel), channel, items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...attrs };
  await putRecord('carts', cart); return cart;
}
async function openCart(cartId, returnPage) {
  const cart = await getRecord('carts', cartId);
  if (!cart) { toast('No encontramos el pedido.', 'error'); await refreshData(); render(); return; }
  state.activeCartId = cartId; state.cartReturnPage = returnPage || (cart.channel === 'delivery' ? 'delivery' : cart.channel === 'salon' ? 'salon' : 'quick');
  await refreshData(); state.page = 'cart'; render();
}
async function mutateCart(cartId, mutator) {
  const cart = await getRecord('carts', cartId); if (!cart) throw new Error('El pedido ya no existe.');
  const updated = mutator(cart); updated.updatedAt = new Date().toISOString(); await putRecord('carts', updated); await refreshData(); render();
}
async function addMenusFromForm(form) {
  const fd = new FormData(form); const qty = Number(form.dataset.qty); const cartId = form.dataset.cartId;
  const currentPrice = Number(state.menu.price || 10); const newItems = [];
  for (let i = 0; i < qty; i++) {
    const entry = String(fd.get(`entry-${i}`) || '').trim(); const second = String(fd.get(`second-${i}`) || '').trim(); const drink = String(fd.get(`drink-${i}`) || '').trim();
    if (!entry || !second || !drink) throw new Error(`Completa entrada, segundo y refresco del menú ${i + 1}.`);
    newItems.push({ id: makeId('item'), kind: 'menu', name: 'Menú completo', entry, second, drink, unitPrice: currentPrice, qty: 1 });
  }
  const cart = await getRecord('carts', cartId); if (!cart) throw new Error('El pedido ya no existe.');
  cart.items = [...(cart.items || []), ...newItems]; cart.updatedAt = new Date().toISOString(); await putRecord('carts', cart);
  closeModal(); await refreshData(); render(); toast(`${qty} menú(s) agregado(s) al pedido.`);
}
async function addBeverageFromForm(form) {
  const fd = new FormData(form); const productId = String(fd.get('productId') || ''); const qty = Math.min(99, Math.max(1, Number(fd.get('qty')) || 1));
  const product = state.products.find(p => p.id === productId); if (!product) throw new Error('Selecciona una bebida válida.');
  const cartId = form.dataset.cartId; const existingId = form.dataset.itemId;
  const cart = await getRecord('carts', cartId); if (!cart) throw new Error('El pedido ya no existe.');
  if (existingId) {
    cart.items = cart.items.map(item => item.id === existingId ? { ...item, productId: product.id, name: product.name, unitPrice: product.price, qty } : item);
  } else {
    cart.items = [...(cart.items || []), { id: makeId('item'), kind: 'beverage', productId: product.id, name: product.name, unitPrice: Number(product.price), qty }];
  }
  cart.updatedAt = new Date().toISOString(); await putRecord('carts', cart); closeModal(); await refreshData(); render(); toast('Bebida agregada al pedido.');
}
async function removeCartItem(cartId, itemId) {
  await mutateCart(cartId, cart => ({ ...cart, items: cart.items.filter(i => i.id !== itemId) })); toast('Detalle quitado del pedido.');
}
async function finalizeCart(cartId, payment) {
  const cart = await getRecord('carts', cartId); if (!cart || !cart.items?.length) throw new Error('Este pedido está vacío o ya fue cerrado.');
  const now = new Date(); const total = cartTotal(cart);
  const hasMenus = cart.items.some(i => i.kind === 'menu');
  const hasBeverages = cart.items.some(i => i.kind === 'beverage');
  const saleChannel = cart.channel.startsWith('counter_') ? (hasMenus && hasBeverages ? 'counter_mixed' : hasBeverages ? 'counter_beverage' : 'counter_menu') : cart.channel;
  const saleLabel = saleChannel === 'counter_mixed' ? 'Venta rápida' : saleChannel === 'counter_menu' ? 'Venta de menú' : saleChannel === 'counter_beverage' ? 'Venta de bebidas' : cartTitle(cart);
  const sale = {
    id: makeId('sale'), dateKey: localDateKey(now), createdAt: now.toISOString(), channel: saleChannel,
    label: saleLabel, customerName: cart.customerName || '', tableNumber: cart.tableNumber || null,
    notes: cart.notes || '', businessName: state.business.name, payment: payment || 'Efectivo',
    items: cart.items.map(item => ({ ...item })), total,
    numberOfMenus: cart.items.filter(i => i.kind === 'menu').length,
    beverageUnits: cart.items.filter(i => i.kind === 'beverage').reduce((sum, i) => sum + Number(i.qty || 1), 0)
  };
  // Sale creation and cart removal share one IndexedDB transaction: no half-closed orders.
  const tx = db.transaction(['sales', 'carts'], 'readwrite');
  tx.objectStore('sales').put(sale); tx.objectStore('carts').delete(cartId);
  await txDone(tx);
  state.lastSale = sale; state.activeCartId = null; closeModal(); await refreshData();
  modal(`${modalHeader('Venta registrada', `${sale.label} · ${escapeHTML(localTime(now))}`)}<div class="empty-state" style="padding:10px"><div class="empty-icon">✓</div><strong style="font-size:24px;color:var(--green)">${money(sale.total)}</strong><p>La venta ya está guardada en el historial de esta tablet.</p></div><div class="modal-footer"><button class="button ghost" data-action="finish-no-print">Listo</button><button class="button primary" data-action="print-last-sale">Imprimir ticket</button></div><p class="muted" style="font-size:10px;line-height:1.5;margin-top:13px">El ticket es de control interno y no reemplaza un comprobante de pago electrónico autorizado.</p>`);
}
function receiptMarkup(sale) {
  const lines = (sale.items || []).map(item => {
    const description = item.kind === 'menu' ? `Menú: ${item.entry} / ${item.second} / ${item.drink}` : `${item.qty} × ${item.name}`;
    const amount = Number(item.unitPrice || 0) * Number(item.qty || 1);
    return `<div class="receipt-line"><span class="receipt-desc">${escapeHTML(description)}</span><span>${money(amount)}</span></div>`;
  }).join('');
  const d = new Date(sale.createdAt);
  return `<div class="receipt"><div class="receipt-header"><h2>${escapeHTML(sale.businessName || state.business.name)}</h2>${state.business.phone ? `<p>Tel. ${escapeHTML(state.business.phone)}</p>` : ''}<p>CONTROL INTERNO · NO ES COMPROBANTE DE PAGO</p><p>${escapeHTML(d.toLocaleDateString('es-PE'))} ${escapeHTML(localTime(d))}</p><p>Operación: ${escapeHTML(sale.id)}</p></div><div class="receipt-lines"><div class="receipt-line"><strong>${escapeHTML(sale.label || channelLabel(sale.channel))}</strong><span></span></div>${lines}</div><div class="receipt-total"><span>TOTAL</span><span>${money(sale.total)}</span></div><div class="receipt-line"><span>Pago</span><span>${escapeHTML(sale.payment || 'Efectivo')}</span></div><div class="receipt-note">Gracias por tu compra.<br>Este documento es solo para control interno del negocio.</div></div>`;
}
function printSale(sale) {
  if (!sale) return toast('No encontramos la venta para imprimir.', 'error');
  document.getElementById('print-area').innerHTML = receiptMarkup(sale);
  window.print();
}
function printOpenCart(cartId) {
  const cart = state.carts.find(c => c.id === cartId); if (!cart || !cart.items.length) return toast('El pedido está vacío.', 'warning');
  const saleLike = { ...cart, id: `PEDIDO-${cart.id.slice(-8).toUpperCase()}`, label: cartTitle(cart), businessName: state.business.name, payment: 'Pendiente', total: cartTotal(cart), createdAt: cart.updatedAt || cart.createdAt };
  printSale(saleLike);
}
function exportCSV(date) {
  const rows = state.sales.filter(s => s.dateKey === date);
  const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const data = [['ID','Fecha','Hora','Canal','Descripción','Método de pago','Producto','Cantidad','Precio unitario','Importe']];
  rows.forEach(sale => (sale.items || []).forEach(item => data.push([sale.id, sale.dateKey, localTime(new Date(sale.createdAt)), channelLabel(sale.channel), sale.label, sale.payment, item.kind === 'menu' ? `Menú: ${item.entry} / ${item.second} / ${item.drink}` : item.name, item.qty || 1, item.unitPrice, Number(item.unitPrice || 0) * Number(item.qty || 1)])));
  const csv = '\ufeff' + data.map(row => row.map(esc).join(';')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `ventas_${date}.csv`);
  toast('Reporte CSV exportado.');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBackup() {
  const [settings, products, carts, sales] = await Promise.all([getAllRecords('settings'), getAllRecords('products'), getAllRecords('carts'), getAllRecords('sales')]);
  const backup = { format: 'tu-pos-backup', schemaVersion: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: { settings, products, carts, sales } };
  const filename = `respaldo_pos_${localDateKey()}_${new Date().toTimeString().slice(0,8).replace(/:/g,'-')}.json`;
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), filename);
  const old = await getRecord('settings', 'backupMeta'); const meta = { ...(old?.value || {}), lastExportAt: new Date().toISOString() };
  await putRecord('settings', getSettingRecord('backupMeta', meta)); await refreshData(); render(); toast('Copia creada. Guárdala fuera de la tablet.');
}
async function importBackup(file) {
  if (!file) return;
  let backup;
  try { backup = JSON.parse(await file.text()); } catch (_) { throw new Error('El archivo no contiene JSON válido.'); }
  if (backup?.format !== 'tu-pos-backup' || !backup.data || !Array.isArray(backup.data.settings) || !Array.isArray(backup.data.products) || !Array.isArray(backup.data.carts) || !Array.isArray(backup.data.sales)) {
    throw new Error('El archivo no parece una copia válida de este POS.');
  }
  if (!backup.data.settings.some(row => row.key === 'business')) throw new Error('La copia no contiene la configuración del negocio.');
  if (!confirm('ATENCIÓN: restaurar reemplazará los datos actuales de este POS. ¿Ya guardaste una copia de los datos actuales? ¿Deseas continuar?')) return;
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  try {
    STORE_NAMES.forEach(name => tx.objectStore(name).clear());
    backup.data.settings.forEach(row => tx.objectStore('settings').put(row));
    backup.data.products.forEach(row => tx.objectStore('products').put(row));
    backup.data.carts.forEach(row => tx.objectStore('carts').put(row));
    backup.data.sales.forEach(row => tx.objectStore('sales').put(row));
    await txDone(tx);
  } catch (error) { try { tx.abort(); } catch (_) {} throw error; }
  const old = await getRecord('settings', 'backupMeta');
  const meta = { ...(old?.value || {}), lastRestoreAt: new Date().toISOString() };
  await putRecord('settings', getSettingRecord('backupMeta', meta));
  await refreshData();
  document.getElementById('setup-root')?.remove(); document.querySelector('.app-shell').style.display = 'flex';
  if (!state.business) return showSetup();
  state.page = 'home'; state.activeCartId = null; render(); toast('Copia restaurada correctamente. Verifica ventas y totales.', 'success');
}

async function handleClick(event) {
  const pageBtn = event.target.closest('[data-page]');
  const actionBtn = event.target.closest('[data-action]');
  if (pageBtn && !actionBtn) { setPage(pageBtn.dataset.page); return; }
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  // A click on the backdrop only closes the dialog if the backdrop itself was clicked.
  if (action === 'backdrop-close') { if (event.target === actionBtn) closeModal(); return; }
  try {
    switch (action) {
      case 'close-modal': closeModal(); break;
      case 'open-table': await openTable(Number(actionBtn.dataset.table)); break;
      case 'open-cart': { const found = state.carts.find(c => c.id === actionBtn.dataset.cartId); const backPage = found?.channel === 'delivery' ? 'delivery' : found?.channel === 'salon' ? 'salon' : 'quick'; await openCart(actionBtn.dataset.cartId, backPage); break; }
      case 'new-delivery': showNewDeliveryModal(); break;
      case 'new-quick-menu': { const c = await createCart('counter_menu'); await openCart(c.id, 'quick'); showMenuQuantityModal(c.id); break; }
      case 'new-quick-beverage': { const c = await createCart('counter_beverage'); await openCart(c.id, 'quick'); showBeverageModal(c.id); break; }
      case 'add-menus': showMenuQuantityModal(actionBtn.dataset.cartId); break;
      case 'add-beverage': showBeverageModal(actionBtn.dataset.cartId); break;
      case 'remove-cart-item': await removeCartItem(actionBtn.dataset.cartId, actionBtn.dataset.itemId); break;
      case 'checkout': showCheckoutConfirm(actionBtn.dataset.cartId); break;
      case 'confirm-checkout': await finalizeCart(actionBtn.dataset.cartId, document.getElementById('checkout-payment')?.value || 'Efectivo'); break;
      case 'back-to-list': { closeModal(); const openCartId = state.activeCartId; const openCartRow = state.carts.find(c => c.id === openCartId); if (openCartRow && openCartRow.channel.startsWith('counter_') && !(openCartRow.items || []).length) await deleteRecord('carts', openCartId); state.activeCartId = null; await refreshData(); setPage(state.cartReturnPage || 'salon'); break; }
      case 'finish-no-print': closeModal(); state.activeCartId = null; await refreshData(); setPage(state.cartReturnPage || 'home'); break;
      case 'print-last-sale': { const sale = state.lastSale; closeModal(); printSale(sale); state.activeCartId = null; await refreshData(); setPage(state.cartReturnPage || 'home'); break; }
      case 'print-sale': printSale(state.sales.find(s => s.id === actionBtn.dataset.saleId)); break;
      case 'print-open-cart': printOpenCart(actionBtn.dataset.cartId); break;
      case 'new-delivery-confirm': break;
      case 'edit-product': showProductEditModal(actionBtn.dataset.productId); break;
      case 'archive-product': {
        const p = state.products.find(x => x.id === actionBtn.dataset.productId); if (!p) break;
        if (!confirm(`¿Desactivar “${p.name}”? No aparecerá en ventas nuevas; el historial se conserva.`)) break;
        await putRecord('products', { ...p, active: false }); await refreshData(); render(); toast('Bebida desactivada.'); break;
      }
      case 'backup-export': await exportBackup(); break;
      case 'backup-restore': document.getElementById('restore-file').click(); break;
      case 'export-report': exportCSV(actionBtn.dataset.date || state.reportDate); break;
      case 'install-pwa': await installPWA(); break;
    }
  } catch (error) { console.error(error); toast(error.message || 'Ocurrió un error. Inténtalo nuevamente.', 'error'); }
}
async function installPWA() {
  if (!state.installPrompt) { toast('En Chrome, abre el menú ⋮ y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.'); return; }
  state.installPrompt.prompt(); const choice = await state.installPrompt.userChoice; state.installPrompt = null; if (choice?.outcome === 'accepted') toast('Instalación aceptada.'); render();
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  try {
    if (form.id === 'setup-form') { await submitSetup(form); return; }
    if (form.id === 'menu-qty-form') { const qty = Number(new FormData(form).get('qty')); if (!Number.isInteger(qty) || qty < 1 || qty > 30) throw new Error('La cantidad debe ser de 1 a 30 menús.'); showMenuDetailsModal(form.dataset.cartId, qty); return; }
    if (form.id === 'menu-details-form') { await addMenusFromForm(form); return; }
    if (form.id === 'beverage-form') { await addBeverageFromForm(form); return; }
    if (form.id === 'delivery-create-form') {
      const fd = new FormData(form); const customerName = String(fd.get('customerName') || '').trim(); if (!customerName) throw new Error('Escribe el nombre o referencia del cliente.');
      const cart = await createCart('delivery', { customerName, notes: String(fd.get('notes') || '').trim() }); closeModal(); await refreshData(); state.cartReturnPage = 'delivery'; await openCart(cart.id, 'delivery'); toast('Delivery creado. Registra los menús pedidos.'); return;
    }
    if (form.id === 'menu-config-form') {
      const fd = new FormData(form); const parseOptions = key => String(fd.get(key) || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean).slice(0, 50);
      const menu = { entries: parseOptions('entries'), seconds: parseOptions('seconds'), drinks: parseOptions('drinks'), price: Number(fd.get('price')), menuDate: String(fd.get('menuDate') || localDateKey()) };
      if (!menu.entries.length || !menu.seconds.length || !menu.drinks.length) throw new Error('Agrega al menos una entrada, un segundo y un refresco.');
      if (!(menu.price > 0)) throw new Error('El precio debe ser mayor que cero.');
      await putRecord('settings', getSettingRecord('menu', menu)); await refreshData(); render(); toast('Carta del día guardada.'); return;
    }
    if (form.id === 'product-form') {
      const fd = new FormData(form); const name = String(fd.get('name') || '').trim(); const price = Number(fd.get('price'));
      if (!name || !(price > 0)) throw new Error('Completa el nombre y un precio mayor que cero.');
      await putRecord('products', { id: makeId('drink'), name, price, active: true, createdAt: new Date().toISOString() }); await refreshData(); render(); toast('Bebida agregada.'); return;
    }
    if (form.id === 'product-edit-form') {
      const fd = new FormData(form); const current = (await getAllRecords('products')).find(p => p.id === form.dataset.productId); if (!current) throw new Error('No encontramos esa bebida.');
      const name = String(fd.get('name') || '').trim(); const price = Number(fd.get('price')); if (!name || !(price > 0)) throw new Error('Completa el nombre y un precio mayor que cero.');
      await putRecord('products', { ...current, name, price }); closeModal(); await refreshData(); render(); toast('Bebida actualizada.'); return;
    }
    if (form.id === 'settings-form') {
      const fd = new FormData(form); const name = String(fd.get('name') || '').trim(); const tableCount = Math.min(60, Math.max(1, Number(fd.get('tableCount')) || 9));
      if (!name) throw new Error('El nombre del negocio es obligatorio.');
      const tablesThatWouldDisappear = state.carts.filter(c => c.channel === 'salon' && Number(c.tableNumber) > tableCount);
      if (tablesThatWouldDisappear.length && !confirm(`Hay ${tablesThatWouldDisappear.length} pedido(s) abierto(s) en mesas con número mayor que ${tableCount}. Si continúas, esos pedidos se conservarán, pero sus mesas no aparecerán hasta que aumentes de nuevo el número. ¿Continuar?`)) return;
      await putRecord('settings', getSettingRecord('business', { ...state.business, name, phone: String(fd.get('phone') || '').trim(), tableCount })); await refreshData(); render(); toast('Configuración guardada.'); return;
    }
  } catch (error) { console.error(error); toast(error.message || 'No se pudo guardar.', 'error'); }
}
async function handleChange(event) {
  if (event.target.id === 'report-date') { state.reportDate = event.target.value || localDateKey(); render(); return; }
}
function makeMobileOverlay() {
  if (document.getElementById('mobile-overlay')) return;
  const overlay = document.createElement('div'); overlay.id = 'mobile-overlay'; overlay.className = 'mobile-overlay'; document.body.appendChild(overlay);
  overlay.addEventListener('click', () => { document.getElementById('sidebar').classList.remove('open'); overlay.classList.remove('show'); });
}

async function init() {
  try {
    await openDatabase(); await seedDefaults(); await refreshData(); await requestPersistentStorage();
    setupSW(); makeMobileOverlay(); updateConnectionStatus();
    if (!state.business) showSetup(); else { document.querySelector('.app-shell').style.display = 'flex'; document.getElementById('setup-root')?.remove(); render(); }
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `<main class="setup-screen"><section class="setup-card"><div class="brand-mark">!</div><h1>No se pudo iniciar el POS</h1><p>${escapeHTML(error.message || 'Hubo un problema al abrir la base de datos local.')} Revisa el navegador o abre la aplicación desde una dirección HTTPS/localhost en Chrome actualizado.</p><button class="button primary wide" onclick="location.reload()">Volver a intentar</button></section></main>`;
  }
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-page]');
  if (nav && !event.target.closest('[data-action]')) { event.preventDefault(); if (nav.closest('#modal-root')) closeModal(); setPage(nav.dataset.page); return; }
  if (event.target.closest('[data-action]')) { event.preventDefault(); handleClick(event); }
});
document.addEventListener('submit', handleSubmit);
document.addEventListener('change', handleChange);
document.getElementById('mobile-menu').addEventListener('click', () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('show'); });
document.getElementById('restore-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try { await importBackup(file); } catch (error) { console.error(error); toast(error.message || 'No se pudo restaurar la copia.', 'error'); }
});
window.addEventListener('online', updateConnectionStatus); window.addEventListener('offline', updateConnectionStatus);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; if (state.page === 'home') render(); });
window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('POS instalado en la tablet.'); render(); });
window.addEventListener('error', event => { console.error('Error de aplicación:', event.error || event.message); });
init();
