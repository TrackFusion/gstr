# GST Practice Portal — Deployment & Setup Guide

> **IMPORTANT:** This portal is for educational/training purposes only.
> It has no connection to the Government of India's GSTN system.
> Never enter real taxpayer GSTIN or actual financial data.

---

## OPTION A — Local Practice (No Backend, Works Immediately)

The portal works **entirely in your browser** using `localStorage` as a database.
No internet, no server, no Google account needed.

### Steps

1. Download / clone the project folder.
2. Open `frontend/index.html` in any modern browser (Chrome, Edge, Firefox).
3. Register a new account → sign in → start practicing.

All data is stored in your browser's localStorage under the key prefix `gst_practice_portal__`.

> **Limitation:** Data is browser-specific and not shared between devices.
> Use **Admin Panel → Data Backup** to export/import sessions across machines.

---

## OPTION B — Google Sheets Backend (Shared / Multi-User)

Use this when you want:
- Data shared across multiple users / devices
- Persistent cloud storage
- Admin to manage multiple learner accounts

### Step 1 — Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
2. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  <<<SPREADSHEET_ID>>>  /edit
   ```

### Step 2 — Set Up Apps Script

1. In your Google Sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content entirely.
3. Paste the entire contents of `backend/Code.gs` from this project.
4. On **line 9**, paste your Spreadsheet ID:
   ```javascript
   const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
   ```
5. Click **Save** (💾).
6. In the function dropdown, select `setupSheets` → click **▶ Run**.
   - Grant permissions when prompted (this creates all required sheets).
   - You will see "All sheets created successfully" in the Logs panel.

### Step 3 — Deploy as Web App

1. Click **Deploy → New deployment**.
2. Click the ⚙ gear icon → select **Web App**.
3. Set:
   - **Description:** GST Practice Portal API
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/AKfyc.../exec`).

### Step 4 — Connect Frontend to Backend

1. Open `frontend/js/db.js`.
2. On line 12, paste your Web App URL:
   ```javascript
   const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/YOUR_URL/exec';
   ```
3. Save the file.

### Step 5 — Host the Frontend (optional)

For multi-user access, host `frontend/` on any static host:
- **GitHub Pages:** push to a repo, enable Pages.
- **Netlify / Vercel:** drag & drop the `frontend/` folder.
- **Local network:** use VS Code Live Server or `python -m http.server 8080`.

---

## Sheet Structure Reference

The following sheets are auto-created by `setupSheets()`:

| Sheet Name          | Purpose                              |
|---------------------|--------------------------------------|
| Users               | Login accounts & roles               |
| TaxpayerProfiles    | GSTIN & business details per user    |
| Customers           | Buyer master records                 |
| Vendors             | Supplier master records              |
| SalesInvoices       | Outward supply invoices              |
| PurchaseInvoices    | Inward supply invoices               |
| CreditDebitNotes    | Credit/Debit note records            |
| EwayBills           | E-Way Bill practice records          |
| GSTR2AData          | User-entered GSTR-2A records         |
| GSTR2BData          | User-entered GSTR-2B records         |
| GSTR1Data           | GSTR-1 auxiliary data                |
| GSTR3BData          | GSTR-3B auxiliary data               |
| ReconciliationLogs  | Recon results per run                |
| FilingHistory       | Simulated filing records             |
| AuditLogs           | User activity log                    |
| Settings            | Admin portal settings                |
| Periods             | Return periods per user              |

---

## First-Time Usage

1. Open the portal URL.
2. Click **Register** → fill your details → choose role **Learner**.
3. To create an **Admin** account, enter the Admin Access Code `ADMIN-SETUP-2025`
   (change this code in `frontend/js/auth.js` → `ADMIN_ACCESS_CODE` constant before deployment).
4. After login:
   - Go to **Taxpayer Profile** → enter a practice GSTIN (format: `27AABCT1234K1Z5`).
   - Select a return period from the top bar (e.g., June 2025).
   - Start entering transactions in **Sales Invoices** / **Purchase Invoices**.
   - Add GSTR-2B records → run **Reconciliation**.
   - File GSTR-1 and GSTR-3B (simulated) from their respective pages.

---

## Folder Structure

```
gst-practice-portal/
├── frontend/
│   ├── index.html          ← Single-page shell (open this in browser)
│   ├── css/
│   │   └── style.css       ← Complete light-theme stylesheet
│   └── js/
│       ├── db.js           ← Data layer (localStorage / GAS backend)
│       ├── auth.js         ← Login, register, session, roles
│       ├── ui.js           ← Toasts, modals, formatting helpers
│       ├── calculations.js ← GST tax engine (CGST/SGST/IGST/ITC)
│       ├── reconciliation.js ← 2B match engine
│       ├── pages.js        ← All page renderers (21 modules)
│       ├── reports.js      ← Report builders & CSV export
│       └── app.js          ← Bootstrap, auth events, period manager
├── backend/
│   └── Code.gs             ← Google Apps Script (paste into script editor)
└── docs/
    ├── DEPLOYMENT.md       ← This file
    └── SHEET_SETUP.md      ← Google Sheet column reference
```

---

## Security Notes

- Passwords are hashed client-side (simple hash, not bcrypt).
  For production, implement server-side hashing in `Code.gs`.
- The Admin Access Code is in `auth.js` — change it before sharing the portal.
- The Apps Script "Execute as: Me" means all data writes use your Google account.
- This portal is for practice only — **do not store real PAN, GSTIN, or financial data**.
