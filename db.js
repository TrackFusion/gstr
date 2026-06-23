/* ============================================================
   db.js — DATA LAYER
   Talks to the Google Apps Script Web App backend.
   Every table is empty until the user creates records — no
   hardcoded GST data of any kind lives in this file.

   Backend contract (see backend/Code.gs):
     POST { action: 'create'|'read'|'update'|'delete'|'query', sheet, payload }
     -> { success: true, data: ... }  or  { success: false, error: '...' }

   If GAS_WEB_APP_URL is not configured, db.js transparently falls
   back to a localStorage-backed store with the IDENTICAL API, so
   the portal still works for local practice without any backend
   deployed. Swap to the real backend by setting GAS_WEB_APP_URL.
   ============================================================ */

const DB = (() => {

  // ── CONFIGURE THIS after deploying the Apps Script Web App ──
  // Example: 'https://script.google.com/macros/s/AKfycb.../exec'
  const GAS_WEB_APP_URL = '';

  const SHEETS = {
    USERS: 'Users',
    TAXPAYER_PROFILES: 'TaxpayerProfiles',
    CUSTOMERS: 'Customers',
    VENDORS: 'Vendors',
    SALES_INVOICES: 'SalesInvoices',
    PURCHASE_INVOICES: 'PurchaseInvoices',
    CREDIT_DEBIT_NOTES: 'CreditDebitNotes',
    EWAY_BILLS: 'EwayBills',
    GSTR1_DATA: 'GSTR1Data',
    GSTR3B_DATA: 'GSTR3BData',
    GSTR2A_DATA: 'GSTR2AData',
    GSTR2B_DATA: 'GSTR2BData',
    RECONCILIATION_LOGS: 'ReconciliationLogs',
    FILING_HISTORY: 'FilingHistory',
    AUDIT_LOGS: 'AuditLogs',
    SETTINGS: 'Settings',
    PERIODS: 'Periods',
  };

  const isRemoteConfigured = () => !!GAS_WEB_APP_URL && GAS_WEB_APP_URL.startsWith('http');

  // ── LOCAL FALLBACK STORE ──
  const LS_PREFIX = 'gst_practice_portal__';

  function lsKey(sheet) { return LS_PREFIX + sheet; }

  function lsGetAll(sheet) {
    try {
      const raw = localStorage.getItem(lsKey(sheet));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('DB local read error', sheet, e);
      return [];
    }
  }

  function lsSaveAll(sheet, rows) {
    try {
      localStorage.setItem(lsKey(sheet), JSON.stringify(rows));
      return true;
    } catch (e) {
      console.error('DB local write error', sheet, e);
      return false;
    }
  }

  function genId(prefix) {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${ts}-${rnd}`;
  }

  // ── LOCAL CRUD ──
  function localCreate(sheet, payload) {
    const rows = lsGetAll(sheet);
    const id = payload.id || genId(sheet.slice(0, 3).toUpperCase());
    const now = new Date().toISOString();
    const record = Object.assign({}, payload, { id, createdAt: now, updatedAt: now });
    rows.push(record);
    lsSaveAll(sheet, rows);
    return record;
  }

  function localRead(sheet, id) {
    const rows = lsGetAll(sheet);
    return rows.find(r => r.id === id) || null;
  }

  function localQuery(sheet, filterFn) {
    const rows = lsGetAll(sheet);
    return typeof filterFn === 'function' ? rows.filter(filterFn) : rows;
  }

  function localUpdate(sheet, id, patch) {
    const rows = lsGetAll(sheet);
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return null;
    rows[idx] = Object.assign({}, rows[idx], patch, { id, updatedAt: new Date().toISOString() });
    lsSaveAll(sheet, rows);
    return rows[idx];
  }

  function localDelete(sheet, id) {
    const rows = lsGetAll(sheet);
    const next = rows.filter(r => r.id !== id);
    lsSaveAll(sheet, next);
    return next.length !== rows.length;
  }

  // ── REMOTE (Google Apps Script) CRUD ──
  async function remoteCall(action, sheet, payload) {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
      body: JSON.stringify({ action, sheet, payload }),
    });
    if (!res.ok) throw new Error(`Backend error: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown backend error');
    return json.data;
  }

  // ── PUBLIC API (sync-looking via async/await everywhere) ──
  async function create(sheet, payload) {
    if (isRemoteConfigured()) return remoteCall('create', sheet, payload);
    return Promise.resolve(localCreate(sheet, payload));
  }

  async function read(sheet, id) {
    if (isRemoteConfigured()) return remoteCall('read', sheet, { id });
    return Promise.resolve(localRead(sheet, id));
  }

  async function query(sheet, filterFn) {
    if (isRemoteConfigured()) {
      // Remote query: backend returns full sheet rows; filter client-side
      const all = await remoteCall('query', sheet, {});
      return typeof filterFn === 'function' ? all.filter(filterFn) : all;
    }
    return Promise.resolve(localQuery(sheet, filterFn));
  }

  async function update(sheet, id, patch) {
    if (isRemoteConfigured()) return remoteCall('update', sheet, { id, patch });
    return Promise.resolve(localUpdate(sheet, id, patch));
  }

  async function remove(sheet, id) {
    if (isRemoteConfigured()) return remoteCall('delete', sheet, { id });
    return Promise.resolve(localDelete(sheet, id));
  }

  async function clearAll() {
    Object.values(SHEETS).forEach(s => localStorage.removeItem(lsKey(s)));
    return true;
  }

  function backendMode() {
    return isRemoteConfigured() ? 'Google Sheets (remote)' : 'Local Browser Storage (offline practice)';
  }

  return { SHEETS, create, read, query, update, remove, clearAll, genId, backendMode, isRemoteConfigured };
})();
