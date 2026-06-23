// ============================================================
//  GST PRACTICE PORTAL — Google Apps Script Backend
//  File: Code.gs
//
//  Deployment:
//    1. Open script.google.com → New Project
//    2. Paste this entire file into Code.gs
//    3. Run setupSheets() ONCE (manually from script editor)
//    4. Deploy → New deployment → Web App
//       Execute as: Me | Who has access: Anyone
//    5. Copy the Web App URL into frontend/js/db.js → GAS_WEB_APP_URL
// ============================================================

const SPREADSHEET_ID = '1fynXrSqqspChMM4BPnulJVk6lG2dQvbWWkvZkPFuhI0'; // ← Paste your Google Sheet ID here after step below:
//   Create a blank Google Sheet, copy its ID from the URL, paste above.

const SHEET_HEADERS = {
  Users:              ['id','firstName','lastName','email','username','passwordHash','role','status','createdAt','updatedAt'],
  TaxpayerProfiles:   ['id','userId','gstin','legalName','tradeName','regType','state','address','industry','turnoverBracket','createdAt','updatedAt'],
  Customers:          ['id','taxpayerId','name','gstin','state','address','contact','createdAt','updatedAt'],
  Vendors:            ['id','taxpayerId','name','gstin','state','address','contact','category','createdAt','updatedAt'],
  SalesInvoices:      ['id','taxpayerId','period','invoiceNumber','invoiceDate','buyerName','buyerGSTIN','hsnCode','description','supplyType','taxableValue','gstRate','cgst','sgst','igst','cess','invoiceTotal','createdAt','updatedAt'],
  PurchaseInvoices:   ['id','taxpayerId','period','invoiceNumber','invoiceDate','vendorName','vendorGSTIN','category','supplyType','taxableValue','gstRate','cgst','sgst','igst','cess','invoiceTotal','isRCM','isBlockedCredit','blockedReason','itcMatchStatus','createdAt','updatedAt'],
  CreditDebitNotes:   ['id','taxpayerId','period','noteNumber','noteDate','noteType','againstInvoice','partyName','partyGSTIN','reason','taxableValue','gstRate','cgst','sgst','igst','createdAt','updatedAt'],
  EwayBills:          ['id','taxpayerId','period','ewbNumber','invoiceNumber','consignmentValue','fromPlace','toPlace','transporterName','vehicleNumber','transportMode','distance','validityDays','generatedOn','validUntil','status','createdAt','updatedAt'],
  GSTR1Data:          ['id','taxpayerId','period','dataType','invoiceRef','createdAt','updatedAt'],
  GSTR3BData:         ['id','taxpayerId','period','section','head','value','createdAt','updatedAt'],
  GSTR2AData:         ['id','taxpayerId','period','vendorName','vendorGSTIN','invoiceNumber','invoiceDate','taxableValue','gstRate','cgst','sgst','igst','vendorFilingStatus','createdAt','updatedAt'],
  GSTR2BData:         ['id','taxpayerId','period','vendorName','vendorGSTIN','invoiceNumber','invoiceDate','taxableValue','gstRate','cgst','sgst','igst','createdAt','updatedAt'],
  ReconciliationLogs: ['id','taxpayerId','period','purchaseInvoiceId','gstr2bId','status','diffTaxable','diffCgst','diffSgst','diffIgst','note','createdAt','updatedAt'],
  FilingHistory:      ['id','taxpayerId','period','returnType','status','filedOn','arn','createdAt','updatedAt'],
  AuditLogs:          ['id','action','description','userId','timestamp'],
  Settings:           ['id','key','value','createdAt','updatedAt'],
  Periods:            ['id','userId','value','createdAt','updatedAt'],
};

// ── SHEET ACCESS HELPERS ──

function getSpreadsheet() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = SHEET_HEADERS[name];
    if (headers) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function setupSheets() {
  // Run this ONCE from the Apps Script editor to create all required sheets.
  Object.keys(SHEET_HEADERS).forEach(name => getOrCreateSheet(name));
  Logger.log('All sheets created successfully.');
}

function sheetToObjects(sheet) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  if (!headers || headers.length === 0) return [];
  return rows
    .filter(row => row[0]) // skip blank rows
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let v = row[i];
        if (v instanceof Date) v = v.toISOString();
        obj[h] = v === null || v === undefined ? '' : v;
      });
      return obj;
    });
}

function appendRow(sheet, headers, obj) {
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sheet.appendRow(row);
}

function findRowIndex(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function updateRow(sheet, headers, rowIndex, patch) {
  const existing = {};
  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => existing[h] = row[i]);
  const merged = Object.assign({}, existing, patch);
  const newRow = headers.map(h => merged[h] !== undefined && merged[h] !== null ? merged[h] : '');
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([newRow]);
}

function generateId(prefix) {
  const ts  = new Date().getTime().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

// ── WEB APP ENTRY POINT ──

function doPost(e) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const body    = JSON.parse(e.postData.contents);
    const result  = dispatch(body.action, body.sheet, body.payload || {});
    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Allow CORS preflight
  return ContentService.createTextOutput(JSON.stringify({ status: 'GST Practice Portal API online' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, sheetName, payload) {
  const sheet   = getOrCreateSheet(sheetName);
  const headers = SHEET_HEADERS[sheetName];
  if (!headers) throw new Error('Unknown sheet: ' + sheetName);

  switch (action) {

    case 'create': {
      const now = new Date().toISOString();
      const id  = payload.id || generateId(sheetName.slice(0, 3).toUpperCase());
      const obj = Object.assign({}, payload, { id, createdAt: payload.createdAt || now, updatedAt: now });
      appendRow(sheet, headers, obj);
      return obj;
    }

    case 'read': {
      const idx = findRowIndex(sheet, payload.id);
      if (idx === -1) return null;
      const row    = sheet.getRange(idx, 1, 1, headers.length).getValues()[0];
      const result = {};
      headers.forEach((h, i) => { result[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
      return result;
    }

    case 'query': {
      // Return all rows — filtering is done client-side
      return sheetToObjects(sheet);
    }

    case 'update': {
      const idx = findRowIndex(sheet, payload.id);
      if (idx === -1) throw new Error('Record not found: ' + payload.id);
      const patch = Object.assign({}, payload.patch, { updatedAt: new Date().toISOString() });
      updateRow(sheet, headers, idx, patch);
      return dispatch('read', sheetName, { id: payload.id });
    }

    case 'delete': {
      const idx = findRowIndex(sheet, payload.id);
      if (idx === -1) return false;
      sheet.deleteRow(idx);
      return true;
    }

    default:
      throw new Error('Unknown action: ' + action);
  }
}