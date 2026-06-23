/* ============================================================
   pages.js — PAGE RENDERERS
   Every module starts empty. All data is fetched live from DB
   for the currently selected period/taxpayer — nothing is
   pre-filled. Split across logical sections for maintainability.
   ============================================================ */

const Pages = {};

// ── ROUTER ──
async function showPage(pageId, navEl) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (navEl) navEl.classList.add('active');
  else {
    const match = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (match) match.classList.add('active');
  }

  const container = document.getElementById('pageContainer');
  container.innerHTML = `<div class="page-container">${emptyState('⏳', 'Loading...', '')}</div>`;

  const renderer = Pages[pageId];
  if (!renderer) {
    container.innerHTML = `<div class="page-container">${emptyState('🚧', 'Page not found', pageId)}</div>`;
    return;
  }
  try {
    await renderer(container);
  } catch (e) {
    console.error('Page render error:', pageId, e);
    container.innerHTML = `<div class="page-container"><div class="form-error">Failed to load this page: ${escapeHtml(e.message)}</div></div>`;
  }

  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
  window.scrollTo(0, 0);
}

// ── SHARED HELPERS ──
function currentPeriod() {
  const sel = document.getElementById('globalPeriod');
  return sel ? sel.value : '';
}

function periodLabel(periodValue) {
  if (!periodValue) return 'No period selected';
  const [year, month] = periodValue.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

async function getActiveTaxpayer() {
  const session = AUTH.getSession();
  if (!session) return null;
  const profiles = await DB.query(DB.SHEETS.TAXPAYER_PROFILES, p => p.userId === session.id);
  return profiles[0] || null;
}

function requirePeriodNotice() {
  return `<div class="warning-box">⚠ No return period selected. Choose or add a period using the <strong>Return Period</strong> selector at the top of the page before entering transactions.</div>`;
}

function requireTaxpayerNotice() {
  return `<div class="warning-box">⚠ No taxpayer profile configured yet. Go to <strong>Taxpayer Profile</strong> to set up your GSTIN before recording transactions.</div>`;
}

// ============================================================
// DASHBOARD
// ============================================================
Pages.dashboard = async function (container) {
  const session = AUTH.getSession();
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();

  let salesCount = 0, purchaseCount = 0, gstr1Status = 'not-started', gstr3bStatus = 'not-started';
  let salesAgg = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
  let purchaseAgg = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
  let reconSummary = null;

  if (taxpayer && period) {
    const sales = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
    const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
    salesCount = sales.length;
    purchaseCount = purchases.length;
    salesAgg = GSTCalc.aggregate(sales);
    purchaseAgg = GSTCalc.aggregate(purchases);

    const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);
    if (purchases.length || gstr2b.length) {
      reconSummary = Recon.reconcile(purchases, gstr2b).summary;
    }

    const filings = await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id && r.period === period);
    const gstr1Filing = filings.find(f => f.returnType === 'GSTR-1');
    const gstr3bFiling = filings.find(f => f.returnType === 'GSTR-3B');
    gstr1Status = gstr1Filing ? gstr1Filing.status : (salesCount > 0 ? 'draft' : 'not-started');
    gstr3bStatus = gstr3bFiling ? gstr3bFiling.status : (purchaseCount > 0 || salesCount > 0 ? 'draft' : 'not-started');
  }

  const netLiability = GSTCalc.computeNetLiability(
    { cgst: salesAgg.cgst, sgst: salesAgg.sgst, igst: salesAgg.igst, cess: salesAgg.cess },
    { cgst: purchaseAgg.cgst, sgst: purchaseAgg.sgst, igst: purchaseAgg.igst, cess: purchaseAgg.cess }
  );
  const totalCashPayable = netLiability.cashPayable.cgst + netLiability.cashPayable.sgst + netLiability.cashPayable.igst + netLiability.cashPayable.cess;

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Dashboard</div>
          <div class="page-subtitle">${taxpayer ? escapeHtml(taxpayer.legalName) + ' · ' : ''}${period ? periodLabel(period) : 'Select a return period to see period-wise figures'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline" onclick="showPage('reports')">View Reports</button>
        </div>
      </div>

      ${!taxpayer ? `<div class="warning-box mb-16">⚠ <strong>Get started:</strong> You haven't set up a Taxpayer Profile yet. <a href="#" onclick="showPage('taxpayer');return false;">Set up your GSTIN now →</a></div>` : ''}
      ${taxpayer && !period ? `<div class="warning-box mb-16">⚠ Select or create a return period from the top bar to start entering transactions.</div>` : ''}

      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-card-icon blue">🧾</div>
          <div class="stat-card-value">${salesCount}</div>
          <div class="stat-card-label">Sales Invoices</div>
          <div class="stat-card-sub">${formatCurrency(salesAgg.taxableValue)} taxable value</div>
        </div>
        <div class="stat-card teal">
          <div class="stat-card-icon teal">📦</div>
          <div class="stat-card-value">${purchaseCount}</div>
          <div class="stat-card-label">Purchase Invoices</div>
          <div class="stat-card-sub">${formatCurrency(purchaseAgg.taxableValue)} taxable value</div>
        </div>
        <div class="stat-card green">
          <div class="stat-card-icon green">💰</div>
          <div class="stat-card-value">${formatCurrency(purchaseAgg.cgst + purchaseAgg.sgst + purchaseAgg.igst)}</div>
          <div class="stat-card-label">Total ITC (Books)</div>
          <div class="stat-card-sub">Before reconciliation</div>
        </div>
        <div class="stat-card orange">
          <div class="stat-card-icon orange">💳</div>
          <div class="stat-card-value">${formatCurrency(totalCashPayable)}</div>
          <div class="stat-card-label">Est. Cash Payable</div>
          <div class="stat-card-sub">After ITC set-off</div>
        </div>
      </div>

      <div class="card mb-24">
        <div class="card-header"><div class="card-title">📅 Return Filing Status — ${period ? periodLabel(period) : 'No period selected'}</div></div>
        <div class="card-body">
          <div class="filing-timeline">
            <div class="timeline-step">
              <div class="timeline-dot ${salesCount > 0 ? 'done' : 'pending'}">${salesCount > 0 ? '✓' : '1'}</div>
              <div class="timeline-label">Record Sales</div>
            </div>
            <div class="timeline-line"></div>
            <div class="timeline-step">
              <div class="timeline-dot ${purchaseCount > 0 ? 'done' : 'pending'}">${purchaseCount > 0 ? '✓' : '2'}</div>
              <div class="timeline-label">Record Purchases</div>
            </div>
            <div class="timeline-line"></div>
            <div class="timeline-step">
              <div class="timeline-dot ${gstr1Status === 'filed' ? 'done' : gstr1Status === 'draft' ? 'current' : 'pending'}">${gstr1Status === 'filed' ? '✓' : '3'}</div>
              <div class="timeline-label">File GSTR-1</div>
            </div>
            <div class="timeline-line"></div>
            <div class="timeline-step">
              <div class="timeline-dot ${reconSummary ? 'current' : 'pending'}">${reconSummary ? '✓' : '4'}</div>
              <div class="timeline-label">Reconcile 2B</div>
            </div>
            <div class="timeline-line"></div>
            <div class="timeline-step">
              <div class="timeline-dot ${gstr3bStatus === 'filed' ? 'done' : gstr3bStatus === 'draft' ? 'current' : 'pending'}">${gstr3bStatus === 'filed' ? '✓' : '5'}</div>
              <div class="timeline-label">File GSTR-3B</div>
            </div>
          </div>
          <div class="d-flex gap-12 flex-wrap mt-16">
            <span class="badge ${badgeForStatus(gstr1Status)}">GSTR-1: ${gstr1Status.replace('-', ' ')}</span>
            <span class="badge ${badgeForStatus(gstr3bStatus)}">GSTR-3B: ${gstr3bStatus.replace('-', ' ')}</span>
          </div>
        </div>
      </div>

      <div class="d-flex gap-12 flex-wrap" style="align-items:stretch;">
        <div class="card flex-1" style="min-width:300px;">
          <div class="card-header"><div class="card-title">⚡ Pending Actions</div></div>
          <div class="card-body">
            ${renderPendingActions(taxpayer, period, salesCount, purchaseCount, reconSummary, gstr1Status, gstr3bStatus)}
          </div>
        </div>
        <div class="card flex-1" style="min-width:300px;">
          <div class="card-header"><div class="card-title">🔄 Reconciliation Snapshot</div></div>
          <div class="card-body">
            ${reconSummary ? `
              <div class="recon-summary-grid">
                <div class="recon-count-card"><div class="recon-count text-success">${reconSummary.matchedCount}</div><div class="recon-label">Matched</div></div>
                <div class="recon-count-card"><div class="recon-count text-warning">${reconSummary.mismatchCount}</div><div class="recon-label">Mismatch</div></div>
                <div class="recon-count-card"><div class="recon-count text-danger">${reconSummary.missingIn2BCount}</div><div class="recon-label">Missing in 2B</div></div>
              </div>
              <button class="btn btn-outline-primary btn-full mt-8" onclick="showPage('reconciliation')">View Full Reconciliation</button>
            ` : emptyState('🔄', 'No reconciliation data yet', 'Add purchase invoices and GSTR-2B records to see a match summary here.')}
          </div>
        </div>
      </div>
    </div>
  `;
};

function renderPendingActions(taxpayer, period, salesCount, purchaseCount, reconSummary, gstr1Status, gstr3bStatus) {
  const actions = [];
  if (!taxpayer) actions.push({ type: 'urgent', icon: '🏢', text: 'Set up your Taxpayer Profile (GSTIN, legal name) to begin.', page: 'taxpayer' });
  if (taxpayer && !period) actions.push({ type: 'urgent', icon: '📅', text: 'Select or create a return period from the top bar.', page: null });
  if (taxpayer && period && salesCount === 0) actions.push({ type: 'pending', icon: '🧾', text: 'No sales invoices recorded for this period yet.', page: 'sales-invoice' });
  if (taxpayer && period && purchaseCount === 0) actions.push({ type: 'pending', icon: '📦', text: 'No purchase invoices recorded for this period yet.', page: 'purchase-invoice' });
  if (reconSummary && reconSummary.mismatchCount > 0) actions.push({ type: 'pending', icon: '⚠', text: `${reconSummary.mismatchCount} invoice(s) have value mismatches with GSTR-2B.`, page: 'reconciliation' });
  if (reconSummary && reconSummary.missingIn2BCount > 0) actions.push({ type: 'urgent', icon: '❌', text: `${reconSummary.missingIn2BCount} invoice(s) in your books are missing from GSTR-2B.`, page: 'reconciliation' });
  if (taxpayer && period && salesCount > 0 && gstr1Status !== 'filed') actions.push({ type: 'info', icon: '📋', text: 'GSTR-1 is ready to be reviewed and filed (simulated).', page: 'gstr1' });
  if (taxpayer && period && gstr1Status === 'filed' && gstr3bStatus !== 'filed') actions.push({ type: 'info', icon: '📝', text: 'GSTR-3B can now be filed (simulated) for this period.', page: 'gstr3b' });
  if (actions.length === 0) actions.push({ type: 'done', icon: '✅', text: 'All caught up for this period — nice work!', page: null });

  return actions.map(a => `
    <div class="action-item ${a.type}" ${a.page ? `style="cursor:pointer;" onclick="showPage('${a.page}')"` : ''}>
      <span style="font-size:16px;">${a.icon}</span>
      <span style="font-size:12px;">${escapeHtml(a.text)}</span>
    </div>
  `).join('');
}

// ============================================================
// TAXPAYER PROFILE
// ============================================================
Pages.taxpayer = async function (container) {
  const session = AUTH.getSession();
  const profile = await getActiveTaxpayer();

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Taxpayer Profile</div>
          <div class="page-subtitle">Configure the business profile used across this practice portal</div>
        </div>
      </div>

      <div class="card" style="max-width:680px;">
        <div class="card-header"><div class="card-title">🏢 Business Details</div></div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">GSTIN <span class="required">*</span></label>
            <input type="text" id="tp_gstin" class="form-control" maxlength="15" placeholder="15-character GSTIN" value="${escapeHtml(profile?.gstin || '')}" oninput="this.value=this.value.toUpperCase()">
            <div class="form-hint" id="tp_gstin_hint">Format: 2-digit state code + 10-char PAN + entity code + Z + checksum</div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Legal Name <span class="required">*</span></label>
              <input type="text" id="tp_legalName" class="form-control" placeholder="As per GST registration" value="${escapeHtml(profile?.legalName || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Trade Name</label>
              <input type="text" id="tp_tradeName" class="form-control" placeholder="Trade / brand name" value="${escapeHtml(profile?.tradeName || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Registration Type</label>
              <select id="tp_regType" class="form-control form-select">
                <option value="regular" ${profile?.regType === 'regular' ? 'selected' : ''}>Regular</option>
                <option value="composition" ${profile?.regType === 'composition' ? 'selected' : ''}>Composition</option>
                <option value="casual" ${profile?.regType === 'casual' ? 'selected' : ''}>Casual Taxable Person</option>
                <option value="nri" ${profile?.regType === 'nri' ? 'selected' : ''}>Non-Resident Taxable Person</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">State</label>
              <input type="text" id="tp_state" class="form-control" placeholder="Auto-fills from GSTIN" value="${escapeHtml(profile?.state || '')}" readonly>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Principal Place of Business (Address)</label>
            <textarea id="tp_address" class="form-control" rows="2" placeholder="Registered address">${escapeHtml(profile?.address || '')}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Industry / Business Type</label>
              <input type="text" id="tp_industry" class="form-control" placeholder="e.g. Manufacturing, EPC, Trading" value="${escapeHtml(profile?.industry || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Annual Turnover Bracket</label>
              <select id="tp_turnoverBracket" class="form-control form-select">
                <option value="">— Select —</option>
                <option value="below_1.5cr" ${profile?.turnoverBracket === 'below_1.5cr' ? 'selected' : ''}>Below ₹1.5 Cr</option>
                <option value="1.5cr_5cr" ${profile?.turnoverBracket === '1.5cr_5cr' ? 'selected' : ''}>₹1.5 Cr – ₹5 Cr</option>
                <option value="above_5cr" ${profile?.turnoverBracket === 'above_5cr' ? 'selected' : ''}>Above ₹5 Cr</option>
              </select>
            </div>
          </div>
          <div id="tp_error" class="form-error" style="display:none;"></div>
          <div id="tp_success" class="form-success" style="display:none;"></div>
          <button class="btn btn-primary mt-8" onclick="saveTaxpayerProfile('${profile ? profile.id : ''}')">
            ${profile ? 'Update Profile' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('tp_gstin').addEventListener('input', (e) => {
    const v = e.target.value;
    const hint = document.getElementById('tp_gstin_hint');
    const stateInput = document.getElementById('tp_state');
    if (v.length === 15) {
      if (isValidGSTINFormat(v)) {
        hint.textContent = '✓ Valid GSTIN format — State: ' + gstinStateName(v);
        hint.style.color = 'var(--success)';
        stateInput.value = gstinStateName(v);
      } else {
        hint.textContent = '✗ Invalid GSTIN format. Check structure.';
        hint.style.color = 'var(--danger)';
      }
    } else {
      hint.textContent = 'Format: 2-digit state code + 10-char PAN + entity code + Z + checksum';
      hint.style.color = '';
    }
  });
};

async function saveTaxpayerProfile(existingId) {
  const gstin = document.getElementById('tp_gstin').value.trim().toUpperCase();
  const legalName = document.getElementById('tp_legalName').value.trim();
  const tradeName = document.getElementById('tp_tradeName').value.trim();
  const regType = document.getElementById('tp_regType').value;
  const state = document.getElementById('tp_state').value;
  const address = document.getElementById('tp_address').value.trim();
  const industry = document.getElementById('tp_industry').value.trim();
  const turnoverBracket = document.getElementById('tp_turnoverBracket').value;

  const errEl = document.getElementById('tp_error');
  const okEl = document.getElementById('tp_success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  if (!gstin || !legalName) { errEl.style.display = 'block'; errEl.textContent = 'GSTIN and Legal Name are required.'; return; }
  if (!isValidGSTINFormat(gstin)) { errEl.style.display = 'block'; errEl.textContent = 'GSTIN format is invalid. Please check and re-enter.'; return; }

  const session = AUTH.getSession();
  const payload = { userId: session.id, gstin, legalName, tradeName, regType, state, address, industry, turnoverBracket };

  showLoading('Saving profile...');
  try {
    if (existingId) {
      await DB.update(DB.SHEETS.TAXPAYER_PROFILES, existingId, payload);
    } else {
      await DB.create(DB.SHEETS.TAXPAYER_PROFILES, payload);
    }
    await AUTH.logAudit('TAXPAYER_PROFILE_SAVED', `Profile saved for GSTIN ${gstin}`);
    hideLoading();
    okEl.style.display = 'block';
    okEl.textContent = 'Profile saved successfully.';
    showToast('Taxpayer profile saved', 'success');
    await refreshSidebarGSTIN();
    setTimeout(() => showPage('dashboard'), 700);
  } catch (e) {
    hideLoading();
    errEl.style.display = 'block';
    errEl.textContent = e.message || 'Failed to save profile.';
  }
}

// ============================================================
// GSTIN MANAGEMENT (multiple registrations practice)
// ============================================================
Pages['gstin-mgmt'] = async function (container) {
  const session = AUTH.getSession();
  const profiles = await DB.query(DB.SHEETS.TAXPAYER_PROFILES, p => p.userId === session.id);

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">GSTIN Management</div>
          <div class="page-subtitle">Practice managing multiple GST registrations under one PAN</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="showPage('taxpayer')">+ Add GSTIN Profile</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Registered GSTINs (${profiles.length})</div></div>
        <div class="table-wrap">
          ${profiles.length === 0 ? emptyState('🔑', 'No GSTIN profiles yet', 'Create your first taxpayer profile to get started.') : `
          <table class="data-table">
            <thead><tr><th>GSTIN</th><th>Legal Name</th><th>Trade Name</th><th>State</th><th>Reg. Type</th><th>Created</th></tr></thead>
            <tbody>
              ${profiles.map(p => `
                <tr>
                  <td class="td-gstin">${escapeHtml(p.gstin)}</td>
                  <td>${escapeHtml(p.legalName)}</td>
                  <td>${escapeHtml(p.tradeName || '—')}</td>
                  <td>${escapeHtml(p.state || '—')}</td>
                  <td><span class="badge badge-info">${escapeHtml(p.regType || 'regular')}</span></td>
                  <td>${formatDate(p.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    </div>
  `;
};

// ============================================================
// CUSTOMER MASTER
// ============================================================
Pages.customers = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const customers = taxpayer ? await DB.query(DB.SHEETS.CUSTOMERS, c => c.taxpayerId === taxpayer.id) : [];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Customer Master</div>
          <div class="page-subtitle">Buyers you issue sales invoices to</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openCustomerForm()" ${!taxpayer ? 'disabled' : ''}>+ Add Customer</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : ''}
      <div class="card mt-16">
        <div class="table-toolbar card-body" style="padding-bottom:0;">
          <div class="search-box"><input type="text" class="form-control" id="custSearch" placeholder="Search by name or GSTIN..." oninput="filterCustomerTable()"></div>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="customerTable">
            <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Type</th><th>Contact</th><th></th></tr></thead>
            <tbody id="customerTableBody">
              ${customers.length === 0 ? `<tr><td colspan="6">${emptyState('👥', 'No customers added yet', 'Add a customer to start creating sales invoices.')}</td></tr>` :
                customers.map(c => customerRow(c)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  window._customersCache = customers;
};

function customerRow(c) {
  return `<tr data-name="${escapeHtml((c.name || '').toLowerCase())}" data-gstin="${escapeHtml((c.gstin || '').toLowerCase())}">
    <td class="fw-600">${escapeHtml(c.name)}</td>
    <td class="td-gstin">${c.gstin ? escapeHtml(c.gstin) : '<span class="badge badge-neutral">Unregistered</span>'}</td>
    <td>${escapeHtml(c.state || '—')}</td>
    <td><span class="badge ${c.gstin ? 'badge-info' : 'badge-neutral'}">${c.gstin ? 'B2B' : 'B2C'}</span></td>
    <td>${escapeHtml(c.contact || '—')}</td>
    <td>
      <button class="btn-icon primary" title="Edit" onclick="openCustomerForm('${c.id}')">✎</button>
      <button class="btn-icon danger" title="Delete" onclick="deleteCustomer('${c.id}')">🗑</button>
    </td>
  </tr>`;
}

function filterCustomerTable() {
  const q = document.getElementById('custSearch').value.toLowerCase();
  document.querySelectorAll('#customerTableBody tr[data-name]').forEach(row => {
    const match = row.dataset.name.includes(q) || row.dataset.gstin.includes(q);
    row.style.display = match ? '' : 'none';
  });
}

async function openCustomerForm(id) {
  const taxpayer = await getActiveTaxpayer();
  if (!taxpayer) { showToast('Set up your taxpayer profile first.', 'warning'); return; }
  const existing = id ? await DB.read(DB.SHEETS.CUSTOMERS, id) : null;

  openFormModal({
    title: existing ? 'Edit Customer' : 'Add Customer',
    submitLabel: existing ? 'Update Customer' : 'Add Customer',
    fields: [
      { name: 'name', label: 'Customer Name', required: true, placeholder: 'Legal / trade name' },
      { name: 'gstin', label: 'GSTIN (leave blank for B2C / unregistered)', placeholder: '15-character GSTIN',
        validate: (v) => v && !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'state', label: 'State', placeholder: 'e.g. Maharashtra' },
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'contact', label: 'Contact (phone/email)', placeholder: 'Optional' },
    ],
    initialValues: existing || {},
    onSubmit: async (values) => {
      const payload = Object.assign({}, values, { taxpayerId: taxpayer.id, gstin: (values.gstin || '').toUpperCase() });
      if (existing) await DB.update(DB.SHEETS.CUSTOMERS, existing.id, payload);
      else await DB.create(DB.SHEETS.CUSTOMERS, payload);
      showToast(existing ? 'Customer updated' : 'Customer added', 'success');
      showPage('customers');
    },
  });
}

function deleteCustomer(id) {
  confirmAction('Delete Customer', 'This will permanently remove this customer record. Continue?', async () => {
    await DB.remove(DB.SHEETS.CUSTOMERS, id);
    showToast('Customer deleted', 'success');
    showPage('customers');
  });
}

// ============================================================
// VENDOR MASTER
// ============================================================
Pages.vendors = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const vendors = taxpayer ? await DB.query(DB.SHEETS.VENDORS, v => v.taxpayerId === taxpayer.id) : [];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Vendor Master</div>
          <div class="page-subtitle">Suppliers you record purchase invoices from</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openVendorForm()" ${!taxpayer ? 'disabled' : ''}>+ Add Vendor</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : ''}
      <div class="card mt-16">
        <div class="table-toolbar card-body" style="padding-bottom:0;">
          <div class="search-box"><input type="text" class="form-control" id="vendSearch" placeholder="Search by name or GSTIN..." oninput="filterVendorTable()"></div>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="vendorTable">
            <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Registered?</th><th>Contact</th><th></th></tr></thead>
            <tbody id="vendorTableBody">
              ${vendors.length === 0 ? `<tr><td colspan="6">${emptyState('🏭', 'No vendors added yet', 'Add a vendor to start recording purchase invoices.')}</td></tr>` :
                vendors.map(v => vendorRow(v)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

function vendorRow(v) {
  return `<tr data-name="${escapeHtml((v.name || '').toLowerCase())}" data-gstin="${escapeHtml((v.gstin || '').toLowerCase())}">
    <td class="fw-600">${escapeHtml(v.name)}</td>
    <td class="td-gstin">${v.gstin ? escapeHtml(v.gstin) : '<span class="badge badge-neutral">Unregistered</span>'}</td>
    <td>${escapeHtml(v.state || '—')}</td>
    <td><span class="badge ${v.gstin ? 'badge-success' : 'badge-warning'}">${v.gstin ? 'Registered' : 'Unregistered (RCM)'}</span></td>
    <td>${escapeHtml(v.contact || '—')}</td>
    <td>
      <button class="btn-icon primary" title="Edit" onclick="openVendorForm('${v.id}')">✎</button>
      <button class="btn-icon danger" title="Delete" onclick="deleteVendor('${v.id}')">🗑</button>
    </td>
  </tr>`;
}

function filterVendorTable() {
  const q = document.getElementById('vendSearch').value.toLowerCase();
  document.querySelectorAll('#vendorTableBody tr[data-name]').forEach(row => {
    const match = row.dataset.name.includes(q) || row.dataset.gstin.includes(q);
    row.style.display = match ? '' : 'none';
  });
}

async function openVendorForm(id) {
  const taxpayer = await getActiveTaxpayer();
  if (!taxpayer) { showToast('Set up your taxpayer profile first.', 'warning'); return; }
  const existing = id ? await DB.read(DB.SHEETS.VENDORS, id) : null;

  openFormModal({
    title: existing ? 'Edit Vendor' : 'Add Vendor',
    submitLabel: existing ? 'Update Vendor' : 'Add Vendor',
    fields: [
      { name: 'name', label: 'Vendor Name', required: true, placeholder: 'Legal / trade name' },
      { name: 'gstin', label: 'GSTIN (leave blank if unregistered — triggers RCM)', placeholder: '15-character GSTIN',
        validate: (v) => v && !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'state', label: 'State', placeholder: 'e.g. Maharashtra' },
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'contact', label: 'Contact (phone/email)', placeholder: 'Optional' },
      { name: 'category', label: 'Supply Category', type: 'select', placeholder: '— Select —',
        options: ['Goods Supplier', 'GTA (Freight)', 'Labour Contractor', 'Professional Services', 'Capital Goods', 'Other Services'] },
    ],
    initialValues: existing || {},
    onSubmit: async (values) => {
      const payload = Object.assign({}, values, { taxpayerId: taxpayer.id, gstin: (values.gstin || '').toUpperCase() });
      if (existing) await DB.update(DB.SHEETS.VENDORS, existing.id, payload);
      else await DB.create(DB.SHEETS.VENDORS, payload);
      showToast(existing ? 'Vendor updated' : 'Vendor added', 'success');
      showPage('vendors');
    },
  });
}

function deleteVendor(id) {
  confirmAction('Delete Vendor', 'This will permanently remove this vendor record. Continue?', async () => {
    await DB.remove(DB.SHEETS.VENDORS, id);
    showToast('Vendor deleted', 'success');
    showPage('vendors');
  });
}

// ============================================================
// SALES INVOICES
// ============================================================
Pages['sales-invoice'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const invoices = (taxpayer && period) ? await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period) : [];
  const agg = GSTCalc.aggregate(invoices);

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Sales Invoices</div>
          <div class="page-subtitle">B2B / B2C outward supply invoices · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openSalesInvoiceForm()" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Add Sales Invoice</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}

      <div class="stats-grid">
        <div class="stat-card blue"><div class="stat-card-icon blue">🧾</div><div class="stat-card-value">${invoices.length}</div><div class="stat-card-label">Invoices</div></div>
        <div class="stat-card teal"><div class="stat-card-icon teal">💵</div><div class="stat-card-value">${formatCurrency(agg.taxableValue)}</div><div class="stat-card-label">Taxable Value</div></div>
        <div class="stat-card green"><div class="stat-card-icon green">📊</div><div class="stat-card-value">${formatCurrency(agg.cgst + agg.sgst + agg.igst + agg.cess)}</div><div class="stat-card-label">Total GST Collected</div></div>
      </div>

      <div class="card">
        <div class="table-toolbar card-body" style="padding-bottom:0;">
          <div class="search-box"><input type="text" class="form-control" id="salesSearch" placeholder="Search invoice no. or buyer..." oninput="filterTable('salesTableBody','salesSearch')"></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Inv. No.</th><th>Date</th><th>Buyer</th><th>GSTIN</th><th>Type</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th class="right">Total</th><th></th></tr></thead>
            <tbody id="salesTableBody">
              ${invoices.length === 0 ? `<tr><td colspan="11">${emptyState('🧾', 'No sales invoices recorded', 'Add your first sales invoice for this period.')}</td></tr>` :
                invoices.map(inv => salesInvoiceRow(inv)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

function salesInvoiceRow(inv) {
  const total = (parseFloat(inv.taxableValue)||0) + (parseFloat(inv.cgst)||0) + (parseFloat(inv.sgst)||0) + (parseFloat(inv.igst)||0) + (parseFloat(inv.cess)||0);
  return `<tr data-search="${escapeHtml(((inv.invoiceNumber||'')+' '+(inv.buyerName||'')).toLowerCase())}">
    <td class="mono">${escapeHtml(inv.invoiceNumber)}</td>
    <td>${formatDate(inv.invoiceDate)}</td>
    <td>${escapeHtml(inv.buyerName)}</td>
    <td class="td-gstin">${inv.buyerGSTIN ? escapeHtml(inv.buyerGSTIN) : '<span class="badge badge-neutral">B2C</span>'}</td>
    <td><span class="badge ${inv.supplyType === 'inter' ? 'badge-info' : 'badge-neutral'}">${inv.supplyType === 'inter' ? 'Inter-State' : 'Intra-State'}</span></td>
    <td class="td-num">${formatCurrency(inv.taxableValue)}</td>
    <td class="td-num">${parseFloat(inv.cgst) > 0 ? formatCurrency(inv.cgst) : '—'}</td>
    <td class="td-num">${parseFloat(inv.sgst) > 0 ? formatCurrency(inv.sgst) : '—'}</td>
    <td class="td-num">${parseFloat(inv.igst) > 0 ? formatCurrency(inv.igst) : '—'}</td>
    <td class="td-num fw-bold">${formatCurrency(total)}</td>
    <td>
      <button class="btn-icon primary" title="Edit" onclick="openSalesInvoiceForm('${inv.id}')">✎</button>
      <button class="btn-icon danger" title="Delete" onclick="deleteSalesInvoice('${inv.id}')">🗑</button>
    </td>
  </tr>`;
}

function filterTable(bodyId, searchId) {
  const q = document.getElementById(searchId).value.toLowerCase();
  document.querySelectorAll(`#${bodyId} tr[data-search]`).forEach(row => {
    row.style.display = row.dataset.search.includes(q) ? '' : 'none';
  });
}

async function openSalesInvoiceForm(id) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }
  const existing = id ? await DB.read(DB.SHEETS.SALES_INVOICES, id) : null;
  const customers = await DB.query(DB.SHEETS.CUSTOMERS, c => c.taxpayerId === taxpayer.id);

  openFormModal({
    title: existing ? 'Edit Sales Invoice' : 'Add Sales Invoice',
    submitLabel: existing ? 'Update Invoice' : 'Add Invoice',
    maxWidth: '720px',
    fields: [
      { name: 'invoiceNumber', label: 'Invoice Number', required: true, half: true },
      { name: 'invoiceDate', label: 'Invoice Date', type: 'date', required: true, half: true },
      { name: 'buyerName', label: 'Buyer Name', required: true,
        hint: customers.length ? 'Tip: type exact customer name, or manage customers in Customer Master' : 'No customers in master yet — type freely or add one in Customer Master' },
      { name: 'buyerGSTIN', label: 'Buyer GSTIN (blank = B2C)', placeholder: '15-character GSTIN',
        validate: (v) => v && !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'hsnCode', label: 'HSN/SAC Code', required: true, placeholder: 'e.g. 73089090' },
      { name: 'description', label: 'Description of Goods/Service', placeholder: 'e.g. Steel tower structure' },
      { name: 'supplyType', label: 'Supply Type', type: 'select', required: true,
        options: [{value:'intra',label:'Intra-State (CGST+SGST)'},{value:'inter',label:'Inter-State (IGST)'}] },
      { name: 'taxableValue', label: 'Taxable Value (₹)', type: 'number', step: '0.01', required: true, half: true,
        onInput: (id) => recalcInvoiceFields(id) },
      { name: 'gstRate', label: 'GST Rate (%)', type: 'select', required: true, half: true,
        options: ['0','5','12','18','28'], onInput: (id) => recalcInvoiceFields(id) },
      { name: 'cgst', label: 'CGST (₹) — auto', readonly: true, half: true },
      { name: 'sgst', label: 'SGST (₹) — auto', readonly: true, half: true },
      { name: 'igst', label: 'IGST (₹) — auto', readonly: true, half: true },
      { name: 'invoiceTotal', label: 'Invoice Total (₹) — auto', readonly: true, half: true },
    ],
    initialValues: existing || {},
    onSubmit: async (values) => {
      const calc = GSTCalc.computeTax(values.taxableValue, values.gstRate, document.getElementById('dynamicModal_supplyType').value);
      const payload = Object.assign({}, values, {
        taxpayerId: taxpayer.id, period,
        buyerGSTIN: (values.buyerGSTIN || '').toUpperCase(),
        cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, cess: calc.cess,
      });
      if (existing) await DB.update(DB.SHEETS.SALES_INVOICES, existing.id, payload);
      else await DB.create(DB.SHEETS.SALES_INVOICES, payload);
      await AUTH.logAudit('SALES_INVOICE_SAVED', `Sales invoice ${values.invoiceNumber} for ${period}`);
      showToast(existing ? 'Sales invoice updated' : 'Sales invoice added', 'success');
      showPage('sales-invoice');
    },
  });

  // Re-attach select-element listener (select doesn't fire 'input' reliably in all browsers)
  setTimeout(() => {
    const rateEl = document.getElementById('dynamicModal_gstRate');
    const typeEl = document.getElementById('dynamicModal_supplyType');
    if (rateEl) rateEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
    if (typeEl) typeEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
    if (existing) recalcInvoiceFields('dynamicModal');
  }, 0);
}

function recalcInvoiceFields(modalId) {
  const taxableEl = document.getElementById(`${modalId}_taxableValue`);
  const rateEl = document.getElementById(`${modalId}_gstRate`);
  const typeEl = document.getElementById(`${modalId}_supplyType`);
  if (!taxableEl || !rateEl) return;
  const taxable = parseFloat(taxableEl.value) || 0;
  const rate = parseFloat(rateEl.value) || 0;
  const supplyType = typeEl ? typeEl.value : 'intra';
  const calc = GSTCalc.computeTax(taxable, rate, supplyType);
  const cgstEl = document.getElementById(`${modalId}_cgst`);
  const sgstEl = document.getElementById(`${modalId}_sgst`);
  const igstEl = document.getElementById(`${modalId}_igst`);
  const totalEl = document.getElementById(`${modalId}_invoiceTotal`);
  if (cgstEl) cgstEl.value = calc.cgst.toFixed(2);
  if (sgstEl) sgstEl.value = calc.sgst.toFixed(2);
  if (igstEl) igstEl.value = calc.igst.toFixed(2);
  if (totalEl) totalEl.value = calc.invoiceTotal.toFixed(2);
}

function deleteSalesInvoice(id) {
  confirmAction('Delete Sales Invoice', 'This will permanently remove this invoice. Continue?', async () => {
    await DB.remove(DB.SHEETS.SALES_INVOICES, id);
    showToast('Sales invoice deleted', 'success');
    showPage('sales-invoice');
  });
}

// ============================================================
// PURCHASE INVOICES
// ============================================================
Pages['purchase-invoice'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const invoices = (taxpayer && period) ? await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period) : [];
  const agg = GSTCalc.aggregate(invoices);
  const duplicates = Recon.detectDuplicates(invoices);

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Purchase Invoices</div>
          <div class="page-subtitle">Inward supplies / purchase register · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openPurchaseInvoiceForm()" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Add Purchase Invoice</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}
      ${duplicates.length > 0 ? `<div class="warning-box mb-16">⚠ <strong>${duplicates.length} possible duplicate invoice(s) detected</strong> — same vendor GSTIN + invoice number appears more than once. Review before filing.</div>` : ''}

      <div class="stats-grid">
        <div class="stat-card teal"><div class="stat-card-icon teal">📦</div><div class="stat-card-value">${invoices.length}</div><div class="stat-card-label">Invoices</div></div>
        <div class="stat-card blue"><div class="stat-card-icon blue">💵</div><div class="stat-card-value">${formatCurrency(agg.taxableValue)}</div><div class="stat-card-label">Taxable Value</div></div>
        <div class="stat-card green"><div class="stat-card-icon green">🧮</div><div class="stat-card-value">${formatCurrency(agg.cgst + agg.sgst + agg.igst + agg.cess)}</div><div class="stat-card-label">Total ITC (Books)</div></div>
      </div>

      <div class="card">
        <div class="table-toolbar card-body" style="padding-bottom:0;">
          <div class="search-box"><input type="text" class="form-control" id="purchSearch" placeholder="Search invoice no. or vendor..." oninput="filterTable('purchTableBody','purchSearch')"></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Inv. No.</th><th>Date</th><th>Vendor</th><th>GSTIN</th><th>Category</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th>RCM</th><th>ITC Status</th><th></th></tr></thead>
            <tbody id="purchTableBody">
              ${invoices.length === 0 ? `<tr><td colspan="12">${emptyState('📦', 'No purchase invoices recorded', 'Add your first purchase invoice for this period.')}</td></tr>` :
                invoices.map(inv => purchaseInvoiceRow(inv)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

function purchaseInvoiceRow(inv) {
  const itcStatus = inv.isBlockedCredit ? 'blocked' : (inv.itcMatchStatus || 'pending');
  return `<tr data-search="${escapeHtml(((inv.invoiceNumber||'')+' '+(inv.vendorName||'')).toLowerCase())}">
    <td class="mono">${escapeHtml(inv.invoiceNumber)}</td>
    <td>${formatDate(inv.invoiceDate)}</td>
    <td>${escapeHtml(inv.vendorName)}</td>
    <td class="td-gstin">${inv.vendorGSTIN ? escapeHtml(inv.vendorGSTIN) : '<span class="badge badge-neutral">Unregistered</span>'}</td>
    <td>${escapeHtml(inv.category || '—')}</td>
    <td class="td-num">${formatCurrency(inv.taxableValue)}</td>
    <td class="td-num">${parseFloat(inv.cgst) > 0 ? formatCurrency(inv.cgst) : '—'}</td>
    <td class="td-num">${parseFloat(inv.sgst) > 0 ? formatCurrency(inv.sgst) : '—'}</td>
    <td class="td-num">${parseFloat(inv.igst) > 0 ? formatCurrency(inv.igst) : '—'}</td>
    <td>${inv.isRCM ? '<span class="badge badge-warning">RCM</span>' : '—'}</td>
    <td><span class="badge ${badgeForStatus(itcStatus)}">${itcStatus}</span></td>
    <td>
      <button class="btn-icon primary" title="Edit" onclick="openPurchaseInvoiceForm('${inv.id}')">✎</button>
      <button class="btn-icon danger" title="Delete" onclick="deletePurchaseInvoice('${inv.id}')">🗑</button>
    </td>
  </tr>`;
}

async function openPurchaseInvoiceForm(id) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }
  const existing = id ? await DB.read(DB.SHEETS.PURCHASE_INVOICES, id) : null;

  openFormModal({
    title: existing ? 'Edit Purchase Invoice' : 'Add Purchase Invoice',
    submitLabel: existing ? 'Update Invoice' : 'Add Invoice',
    maxWidth: '720px',
    fields: [
      { name: 'invoiceNumber', label: 'Invoice Number', required: true, half: true },
      { name: 'invoiceDate', label: 'Invoice Date', type: 'date', required: true, half: true },
      { name: 'vendorName', label: 'Vendor Name', required: true },
      { name: 'vendorGSTIN', label: 'Vendor GSTIN (blank = unregistered, triggers RCM)', placeholder: '15-character GSTIN',
        validate: (v) => v && !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'category', label: 'Expense Category', type: 'select', placeholder: '— Select —',
        options: ['Raw Material / Goods', 'Capital Goods', 'Freight (GTA)', 'Labour Charges', 'Professional Fees', 'Job Work / Galvanization', 'Rent', 'Other Services'] },
      { name: 'supplyType', label: 'Supply Type', type: 'select', required: true,
        options: [{value:'intra',label:'Intra-State (CGST+SGST)'},{value:'inter',label:'Inter-State (IGST)'}] },
      { name: 'taxableValue', label: 'Taxable Value (₹)', type: 'number', step: '0.01', required: true, half: true,
        onInput: (id) => recalcInvoiceFields(id) },
      { name: 'gstRate', label: 'GST Rate (%)', type: 'select', required: true, half: true,
        options: ['0','5','12','18','28'], onInput: (id) => recalcInvoiceFields(id) },
      { name: 'cgst', label: 'CGST (₹) — auto', readonly: true, half: true },
      { name: 'sgst', label: 'SGST (₹) — auto', readonly: true, half: true },
      { name: 'igst', label: 'IGST (₹) — auto', readonly: true, half: true },
      { name: 'invoiceTotal', label: 'Invoice Total (₹) — auto', readonly: true, half: true },
      { name: 'isRCM', label: 'Reverse Charge Mechanism (RCM) applicable', type: 'checkbox' },
      { name: 'isBlockedCredit', label: 'Block ITC under Section 17(5) (e.g. personal vehicle, food, club)', type: 'checkbox' },
      { name: 'blockedReason', label: 'Blocked credit reason (if blocked)', placeholder: 'e.g. Motor vehicle for personal use' },
    ],
    initialValues: existing || {},
    onSubmit: async (values) => {
      const calc = GSTCalc.computeTax(values.taxableValue, values.gstRate, document.getElementById('dynamicModal_supplyType').value);
      const payload = Object.assign({}, values, {
        taxpayerId: taxpayer.id, period,
        vendorGSTIN: (values.vendorGSTIN || '').toUpperCase(),
        cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, cess: calc.cess,
        itcMatchStatus: existing ? existing.itcMatchStatus : 'pending',
      });
      if (existing) await DB.update(DB.SHEETS.PURCHASE_INVOICES, existing.id, payload);
      else await DB.create(DB.SHEETS.PURCHASE_INVOICES, payload);
      await AUTH.logAudit('PURCHASE_INVOICE_SAVED', `Purchase invoice ${values.invoiceNumber} for ${period}`);
      showToast(existing ? 'Purchase invoice updated' : 'Purchase invoice added', 'success');
      showPage('purchase-invoice');
    },
  });

  setTimeout(() => {
    const rateEl = document.getElementById('dynamicModal_gstRate');
    const typeEl = document.getElementById('dynamicModal_supplyType');
    if (rateEl) rateEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
    if (typeEl) typeEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
    if (existing) recalcInvoiceFields('dynamicModal');
  }, 0);
}

function deletePurchaseInvoice(id) {
  confirmAction('Delete Purchase Invoice', 'This will permanently remove this invoice. Continue?', async () => {
    await DB.remove(DB.SHEETS.PURCHASE_INVOICES, id);
    showToast('Purchase invoice deleted', 'success');
    showPage('purchase-invoice');
  });
}

// ============================================================
// CREDIT / DEBIT NOTES
// ============================================================
Pages['credit-debit-notes'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const notes = (taxpayer && period) ? await DB.query(DB.SHEETS.CREDIT_DEBIT_NOTES, r => r.taxpayerId === taxpayer.id && r.period === period) : [];
  const credits = notes.filter(n => n.noteType === 'credit');
  const debits = notes.filter(n => n.noteType === 'debit');

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Credit & Debit Notes</div>
          <div class="page-subtitle">Adjustments to previously issued invoices · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline-primary" onclick="openCDNForm('debit')" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Debit Note</button>
          <button class="btn btn-primary" onclick="openCDNForm('credit')" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Credit Note</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}

      <div class="stats-grid">
        <div class="stat-card red"><div class="stat-card-icon red">↓</div><div class="stat-card-value">${credits.length}</div><div class="stat-card-label">Credit Notes</div></div>
        <div class="stat-card orange"><div class="stat-card-icon orange">↑</div><div class="stat-card-value">${debits.length}</div><div class="stat-card-label">Debit Notes</div></div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Note No.</th><th>Date</th><th>Type</th><th>Against Inv.</th><th>Party</th><th>Reason</th><th class="right">Taxable Adj.</th><th class="right">CGST</th><th class="right">SGST</th><th></th></tr></thead>
            <tbody>
              ${notes.length === 0 ? `<tr><td colspan="10">${emptyState('↔', 'No credit/debit notes recorded', 'Issue a credit or debit note against an existing invoice.')}</td></tr>` :
                notes.map(n => cdnRow(n)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

function cdnRow(n) {
  const isCredit = n.noteType === 'credit';
  const sign = isCredit ? '-' : '+';
  return `<tr>
    <td class="mono">${escapeHtml(n.noteNumber)}</td>
    <td>${formatDate(n.noteDate)}</td>
    <td><span class="badge ${isCredit ? 'badge-danger' : 'badge-warning'}">${isCredit ? 'CREDIT' : 'DEBIT'}</span></td>
    <td class="mono">${escapeHtml(n.againstInvoice)}</td>
    <td>${escapeHtml(n.partyName)}</td>
    <td>${escapeHtml(n.reason || '—')}</td>
    <td class="td-num ${isCredit ? 'text-danger' : 'text-warning'}">${sign}${formatCurrency(n.taxableValue)}</td>
    <td class="td-num ${isCredit ? 'text-danger' : 'text-warning'}">${sign}${formatCurrency(n.cgst)}</td>
    <td class="td-num ${isCredit ? 'text-danger' : 'text-warning'}">${sign}${formatCurrency(n.sgst)}</td>
    <td><button class="btn-icon danger" title="Delete" onclick="deleteCDN('${n.id}')">🗑</button></td>
  </tr>`;
}

async function openCDNForm(noteType) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }

  openFormModal({
    title: noteType === 'credit' ? 'Issue Credit Note' : 'Issue Debit Note',
    submitLabel: 'Save Note',
    fields: [
      { name: 'noteNumber', label: 'Note Number', required: true, half: true },
      { name: 'noteDate', label: 'Note Date', type: 'date', required: true, half: true },
      { name: 'againstInvoice', label: 'Against Original Invoice No.', required: true },
      { name: 'partyName', label: 'Party Name (Buyer/Vendor)', required: true },
      { name: 'partyGSTIN', label: 'Party GSTIN', validate: (v) => v && !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'reason', label: 'Reason', type: 'select', placeholder: '— Select —',
        options: ['Goods Returned', 'Rate Revision', 'Quality Deduction', 'Quantity Mismatch', 'Post-Sale Discount', 'Other'] },
      { name: 'taxableValue', label: 'Taxable Value Adjustment (₹)', type: 'number', step: '0.01', required: true, half: true,
        onInput: (id) => recalcInvoiceFields(id) },
      { name: 'gstRate', label: 'GST Rate (%)', type: 'select', required: true, half: true,
        options: ['0','5','12','18','28'], onInput: (id) => recalcInvoiceFields(id) },
      { name: 'cgst', label: 'CGST (₹) — auto', readonly: true, half: true },
      { name: 'sgst', label: 'SGST (₹) — auto', readonly: true, half: true },
    ],
    onSubmit: async (values) => {
      const calc = GSTCalc.computeTax(values.taxableValue, values.gstRate, 'intra');
      const payload = Object.assign({}, values, {
        taxpayerId: taxpayer.id, period, noteType,
        partyGSTIN: (values.partyGSTIN || '').toUpperCase(),
        cgst: calc.cgst, sgst: calc.sgst,
      });
      await DB.create(DB.SHEETS.CREDIT_DEBIT_NOTES, payload);
      showToast(`${noteType === 'credit' ? 'Credit' : 'Debit'} note saved`, 'success');
      showPage('credit-debit-notes');
    },
  });

  setTimeout(() => {
    const rateEl = document.getElementById('dynamicModal_gstRate');
    if (rateEl) rateEl.addEventListener('change', () => {
      const taxableEl = document.getElementById('dynamicModal_taxableValue');
      const calc = GSTCalc.computeTax(taxableEl.value, rateEl.value, 'intra');
      document.getElementById('dynamicModal_cgst').value = calc.cgst.toFixed(2);
      document.getElementById('dynamicModal_sgst').value = calc.sgst.toFixed(2);
    });
  }, 0);
}

function deleteCDN(id) {
  confirmAction('Delete Note', 'This will permanently remove this credit/debit note. Continue?', async () => {
    await DB.remove(DB.SHEETS.CREDIT_DEBIT_NOTES, id);
    showToast('Note deleted', 'success');
    showPage('credit-debit-notes');
  });
}

// ============================================================
// E-WAY BILL PRACTICE
// ============================================================
Pages['eway-bill'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const bills = (taxpayer && period) ? await DB.query(DB.SHEETS.EWAY_BILLS, r => r.taxpayerId === taxpayer.id && r.period === period) : [];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">E-Way Bill Practice</div>
          <div class="page-subtitle">Practice generating e-way bills for goods movement · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openEwayBillForm()" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Generate E-Way Bill</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}
      <div class="info-box mb-16">ℹ E-Way Bill is mandatory for movement of goods where consignment value exceeds ₹50,000 (rules vary by state for intra-state movement).</div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>EWB No.</th><th>Invoice No.</th><th>Generated On</th><th>From</th><th>To</th><th>Transporter</th><th>Vehicle No.</th><th class="right">Value</th><th>Validity</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${bills.length === 0 ? `<tr><td colspan="11">${emptyState('🚛', 'No e-way bills generated', 'Generate a practice e-way bill linked to an invoice.')}</td></tr>` :
                bills.map(b => ewayRow(b)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

function ewayRow(b) {
  const expired = b.validUntil && new Date(b.validUntil) < new Date();
  const status = b.status === 'cancelled' ? 'cancelled' : (expired ? 'expired' : 'active');
  const statusClass = status === 'active' ? 'eway-status-active' : status === 'expired' ? 'eway-status-expired' : 'eway-status-cancelled';
  return `<tr>
    <td class="mono">${escapeHtml(b.ewbNumber)}</td>
    <td class="mono">${escapeHtml(b.invoiceNumber)}</td>
    <td>${formatDate(b.generatedOn)}</td>
    <td>${escapeHtml(b.fromPlace)}</td>
    <td>${escapeHtml(b.toPlace)}</td>
    <td>${escapeHtml(b.transporterName || '—')}</td>
    <td class="mono">${escapeHtml(b.vehicleNumber || '—')}</td>
    <td class="td-num">${formatCurrency(b.consignmentValue)}</td>
    <td>${formatDate(b.validUntil)}</td>
    <td class="${statusClass}">${status.toUpperCase()}</td>
    <td>${status === 'active' ? `<button class="btn-icon danger" title="Cancel" onclick="cancelEwayBill('${b.id}')">✕</button>` : ''}</td>
  </tr>`;
}

async function openEwayBillForm() {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }

  openFormModal({
    title: 'Generate E-Way Bill (Practice)',
    submitLabel: 'Generate',
    maxWidth: '680px',
    fields: [
      { name: 'invoiceNumber', label: 'Invoice Number', required: true, half: true },
      { name: 'consignmentValue', label: 'Consignment Value (₹)', type: 'number', step: '0.01', required: true, half: true },
      { name: 'fromPlace', label: 'From (Place/State)', required: true, half: true },
      { name: 'toPlace', label: 'To (Place/State)', required: true, half: true },
      { name: 'transporterName', label: 'Transporter Name', placeholder: 'Optional' },
      { name: 'vehicleNumber', label: 'Vehicle Number', placeholder: 'e.g. MH12AB1234' },
      { name: 'transportMode', label: 'Mode of Transport', type: 'select',
        options: ['Road', 'Rail', 'Air', 'Ship'] },
      { name: 'distance', label: 'Approx. Distance (km)', type: 'number', half: true },
      { name: 'validityDays', label: 'Validity (days, auto by distance if blank)', type: 'number', half: true, placeholder: 'e.g. 1' },
    ],
    onSubmit: async (values) => {
      const ewbNumber = 'EWB' + Math.floor(100000000000 + Math.random() * 899999999999);
      const days = parseFloat(values.validityDays) || Math.max(1, Math.ceil((parseFloat(values.distance) || 100) / 200));
      const generatedOn = new Date();
      const validUntil = new Date(generatedOn.getTime() + days * 24 * 60 * 60 * 1000);
      const payload = Object.assign({}, values, {
        taxpayerId: taxpayer.id, period, ewbNumber,
        generatedOn: generatedOn.toISOString(),
        validUntil: validUntil.toISOString(),
        status: 'active',
      });
      await DB.create(DB.SHEETS.EWAY_BILLS, payload);
      showToast(`E-Way Bill ${ewbNumber} generated (practice)`, 'success');
      showPage('eway-bill');
    },
  });
}

function cancelEwayBill(id) {
  confirmAction('Cancel E-Way Bill', 'This will mark the e-way bill as cancelled. Continue?', async () => {
    await DB.update(DB.SHEETS.EWAY_BILLS, id, { status: 'cancelled' });
    showToast('E-Way Bill cancelled', 'success');
    showPage('eway-bill');
  });
}

// ============================================================
// GSTR-1
// ============================================================
Pages.gstr1 = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">GSTR-1</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }

  const sales = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const notes = await DB.query(DB.SHEETS.CREDIT_DEBIT_NOTES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const b2b = sales.filter(s => s.buyerGSTIN);
  const b2c = sales.filter(s => !s.buyerGSTIN);
  const b2cLarge = b2c.filter(s => s.supplyType === 'inter' && parseFloat(s.taxableValue) > 250000);
  const b2cSmall = b2c.filter(s => !(s.supplyType === 'inter' && parseFloat(s.taxableValue) > 250000));

  const agg = GSTCalc.aggregate(sales);
  const filings = await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id && r.period === period && r.returnType === 'GSTR-1');
  const filing = filings[0];

  // HSN summary built dynamically from entered invoices
  const hsnMap = {};
  sales.forEach(s => {
    const key = s.hsnCode || 'UNSPECIFIED';
    if (!hsnMap[key]) hsnMap[key] = { hsn: key, description: s.description || '', taxableValue: 0, cgst: 0, sgst: 0, igst: 0, count: 0 };
    hsnMap[key].taxableValue += parseFloat(s.taxableValue) || 0;
    hsnMap[key].cgst += parseFloat(s.cgst) || 0;
    hsnMap[key].sgst += parseFloat(s.sgst) || 0;
    hsnMap[key].igst += parseFloat(s.igst) || 0;
    hsnMap[key].count += 1;
  });
  const hsnRows = Object.values(hsnMap);

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">GSTR-1 — Outward Supplies</div>
          <div class="page-subtitle">${escapeHtml(taxpayer.legalName)} · ${periodLabel(period)}</div>
        </div>
        <div class="page-actions">
          <span class="badge ${badgeForStatus(filing ? filing.status : 'draft')}">${filing ? filing.status : 'draft'}</span>
          ${!filing || filing.status !== 'filed' ? `<button class="btn btn-primary" onclick="fileReturn('GSTR-1')">Submit GSTR-1 (Simulated)</button>` : ''}
        </div>
      </div>

      <div class="tab-nav">
        <button class="tab-btn active" onclick="switchTab('gstr1','b2b',this)">B2B Invoices (${b2b.length})</button>
        <button class="tab-btn" onclick="switchTab('gstr1','b2cl',this)">B2C Large (${b2cLarge.length})</button>
        <button class="tab-btn" onclick="switchTab('gstr1','b2cs',this)">B2C Small (${b2cSmall.length})</button>
        <button class="tab-btn" onclick="switchTab('gstr1','cdn',this)">Credit/Debit Notes (${notes.length})</button>
        <button class="tab-btn" onclick="switchTab('gstr1','hsn',this)">HSN Summary (${hsnRows.length})</button>
      </div>

      <div data-tabgroup="gstr1" data-tabid="b2b" class="tab-panel active">
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Inv. No.</th><th>Date</th><th>Buyer GSTIN</th><th>Buyer Name</th><th>HSN</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th></tr></thead>
              <tbody>
                ${b2b.length === 0 ? `<tr><td colspan="9">${emptyState('🏢', 'No B2B invoices', 'B2B invoices appear here automatically once you add sales invoices with a buyer GSTIN.')}</td></tr>` :
                  b2b.map(s => `<tr><td class="mono">${escapeHtml(s.invoiceNumber)}</td><td>${formatDate(s.invoiceDate)}</td><td class="td-gstin">${escapeHtml(s.buyerGSTIN)}</td><td>${escapeHtml(s.buyerName)}</td><td class="mono">${escapeHtml(s.hsnCode||'—')}</td><td class="td-num">${formatCurrency(s.taxableValue)}</td><td class="td-num">${formatCurrency(s.cgst)}</td><td class="td-num">${formatCurrency(s.sgst)}</td><td class="td-num">${formatCurrency(s.igst)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div data-tabgroup="gstr1" data-tabid="b2cl" class="tab-panel">
        <div class="info-box mb-16">B2C Large = inter-state invoices to unregistered buyers where taxable value exceeds ₹2,50,000. Reported invoice-wise.</div>
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Inv. No.</th><th>Date</th><th>Place of Supply</th><th class="right">Taxable</th><th class="right">IGST</th></tr></thead>
              <tbody>
                ${b2cLarge.length === 0 ? `<tr><td colspan="5">${emptyState('👤', 'No B2C Large invoices', '')}</td></tr>` :
                  b2cLarge.map(s => `<tr><td class="mono">${escapeHtml(s.invoiceNumber)}</td><td>${formatDate(s.invoiceDate)}</td><td>${escapeHtml(s.buyerName)}</td><td class="td-num">${formatCurrency(s.taxableValue)}</td><td class="td-num">${formatCurrency(s.igst)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div data-tabgroup="gstr1" data-tabid="b2cs" class="tab-panel">
        <div class="info-box mb-16">B2C Small = all other unregistered-buyer supplies, consolidated state-wise.</div>
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Inv. No.</th><th>Date</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th></tr></thead>
              <tbody>
                ${b2cSmall.length === 0 ? `<tr><td colspan="6">${emptyState('👤', 'No B2C Small invoices', '')}</td></tr>` :
                  b2cSmall.map(s => `<tr><td class="mono">${escapeHtml(s.invoiceNumber)}</td><td>${formatDate(s.invoiceDate)}</td><td class="td-num">${formatCurrency(s.taxableValue)}</td><td class="td-num">${formatCurrency(s.cgst)}</td><td class="td-num">${formatCurrency(s.sgst)}</td><td class="td-num">${formatCurrency(s.igst)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div data-tabgroup="gstr1" data-tabid="cdn" class="tab-panel">
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Note No.</th><th>Date</th><th>Type</th><th>Against Inv.</th><th class="right">Taxable Adj.</th></tr></thead>
              <tbody>
                ${notes.length === 0 ? `<tr><td colspan="5">${emptyState('↔', 'No credit/debit notes this period', '')}</td></tr>` :
                  notes.map(n => `<tr><td class="mono">${escapeHtml(n.noteNumber)}</td><td>${formatDate(n.noteDate)}</td><td><span class="badge ${n.noteType==='credit'?'badge-danger':'badge-warning'}">${n.noteType}</span></td><td class="mono">${escapeHtml(n.againstInvoice)}</td><td class="td-num">${formatCurrency(n.taxableValue)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div data-tabgroup="gstr1" data-tabid="hsn" class="tab-panel">
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>HSN/SAC</th><th>Description</th><th class="right">Invoices</th><th class="right">Taxable Value</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th></tr></thead>
              <tbody>
                ${hsnRows.length === 0 ? `<tr><td colspan="7">${emptyState('🏷', 'No HSN data', 'HSN summary builds automatically from your sales invoices.')}</td></tr>` :
                  hsnRows.map(h => `<tr><td class="mono">${escapeHtml(h.hsn)}</td><td>${escapeHtml(h.description)}</td><td class="td-num">${h.count}</td><td class="td-num">${formatCurrency(h.taxableValue)}</td><td class="td-num">${formatCurrency(h.cgst)}</td><td class="td-num">${formatCurrency(h.sgst)}</td><td class="td-num">${formatCurrency(h.igst)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mt-24">
        <div class="card-header"><div class="card-title">Summary</div></div>
        <div class="card-body tax-breakdown">
          <div class="tax-row"><span class="tax-row-label">Total Taxable Value</span><span class="tax-row-value">${formatCurrency(agg.taxableValue)}</span></div>
          <div class="tax-row"><span class="tax-row-label">Total CGST</span><span class="tax-row-value">${formatCurrency(agg.cgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">Total SGST</span><span class="tax-row-value">${formatCurrency(agg.sgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">Total IGST</span><span class="tax-row-value">${formatCurrency(agg.igst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">Total Tax Liability</span><span class="tax-row-value">${formatCurrency(agg.cgst + agg.sgst + agg.igst + agg.cess)}</span></div>
        </div>
      </div>
    </div>
  `;
};

// ============================================================
// GSTR-3B
// ============================================================
Pages.gstr3b = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">GSTR-3B</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }

  const sales = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);

  const salesAgg = GSTCalc.aggregate(sales);
  const reconResult = Recon.reconcile(purchases, gstr2b);

  // ITC available = only matched invoices, minus blocked credits
  const eligiblePurchases = reconResult.matched.map(m => m.book).filter(p => !p.isBlockedCredit);
  const blockedPurchases = purchases.filter(p => p.isBlockedCredit);
  const itcAgg = GSTCalc.aggregate(eligiblePurchases);
  const blockedAgg = GSTCalc.aggregate(blockedPurchases);

  const netLiability = GSTCalc.computeNetLiability(
    { cgst: salesAgg.cgst, sgst: salesAgg.sgst, igst: salesAgg.igst, cess: salesAgg.cess },
    { cgst: itcAgg.cgst, sgst: itcAgg.sgst, igst: itcAgg.igst, cess: itcAgg.cess }
  );

  const filings = await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id && r.period === period && r.returnType === 'GSTR-3B');
  const filing = filings[0];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">GSTR-3B — Monthly Summary Return</div>
          <div class="page-subtitle">${escapeHtml(taxpayer.legalName)} · ${periodLabel(period)}</div>
        </div>
        <div class="page-actions">
          <span class="badge ${badgeForStatus(filing ? filing.status : 'draft')}">${filing ? filing.status : 'draft'}</span>
          ${!filing || filing.status !== 'filed' ? `<button class="btn btn-primary" onclick="fileReturn('GSTR-3B')">Submit GSTR-3B (Simulated)</button>` : ''}
        </div>
      </div>

      <div class="warning-box mb-16">⚠ ITC shown below only includes purchase invoices that are <strong>matched</strong> with GSTR-2B records for this period (Rule 36(4) practice). Add GSTR-2B records and run reconciliation to refine this.</div>

      <div class="card mb-16">
        <div class="card-header"><div class="card-title">3.1 — Outward Supplies (from Sales Invoices)</div></div>
        <div class="card-body tax-breakdown">
          <div class="tax-row"><span class="tax-row-label">Taxable Value</span><span class="tax-row-value">${formatCurrency(salesAgg.taxableValue)}</span></div>
          <div class="tax-row"><span class="tax-row-label">CGST</span><span class="tax-row-value">${formatCurrency(salesAgg.cgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">SGST</span><span class="tax-row-value">${formatCurrency(salesAgg.sgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">IGST</span><span class="tax-row-value">${formatCurrency(salesAgg.igst)}</span></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header"><div class="card-title">4 — Eligible ITC (Matched with GSTR-2B)</div></div>
        <div class="card-body tax-breakdown">
          <div class="tax-row"><span class="tax-row-label">Matched Invoices</span><span class="tax-row-value">${reconResult.matched.length} of ${purchases.length}</span></div>
          <div class="tax-row"><span class="tax-row-label">CGST</span><span class="tax-row-value">${formatCurrency(itcAgg.cgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">SGST</span><span class="tax-row-value">${formatCurrency(itcAgg.sgst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">IGST</span><span class="tax-row-value">${formatCurrency(itcAgg.igst)}</span></div>
          <div class="tax-row"><span class="tax-row-label">Blocked (Sec 17(5)) — Not Claimable</span><span class="tax-row-value text-danger">${formatCurrency(blockedAgg.cgst + blockedAgg.sgst + blockedAgg.igst)}</span></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header"><div class="card-title">6 — Net Tax Payable (after ITC set-off)</div></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Head</th><th class="right">Liability</th><th class="right">ITC Utilized</th><th class="right">Cash Payable</th></tr></thead>
              <tbody>
                <tr><td>CGST</td><td class="td-num">${formatCurrency(salesAgg.cgst)}</td><td class="td-num text-success">${formatCurrency(salesAgg.cgst - netLiability.cashPayable.cgst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.cgst)}</td></tr>
                <tr><td>SGST</td><td class="td-num">${formatCurrency(salesAgg.sgst)}</td><td class="td-num text-success">${formatCurrency(salesAgg.sgst - netLiability.cashPayable.sgst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.sgst)}</td></tr>
                <tr><td>IGST</td><td class="td-num">${formatCurrency(salesAgg.igst)}</td><td class="td-num text-success">${formatCurrency(salesAgg.igst - netLiability.cashPayable.igst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.igst)}</td></tr>
                <tr style="font-weight:700;background:var(--neutral-50);"><td>TOTAL</td><td class="td-num">${formatCurrency(salesAgg.cgst+salesAgg.sgst+salesAgg.igst)}</td><td class="td-num text-success">${formatCurrency((salesAgg.cgst+salesAgg.sgst+salesAgg.igst)-(netLiability.cashPayable.cgst+netLiability.cashPayable.sgst+netLiability.cashPayable.igst))}</td><td class="td-num text-danger">${formatCurrency(netLiability.cashPayable.cgst+netLiability.cashPayable.sgst+netLiability.cashPayable.igst)}</td></tr>
              </tbody>
            </table>
          </div>
          ${netLiability.utilizationLedger.length ? `
            <div class="form-label mt-16">ITC Utilization Trail</div>
            <div class="d-flex flex-wrap gap-8 mt-8">
              ${netLiability.utilizationLedger.map(l => `<span class="badge badge-info">${l.from} → ${l.to}: ${formatCurrency(l.amount)}</span>`).join('')}
            </div>` : ''}
        </div>
      </div>
    </div>
  `;
};

async function fileReturn(returnType) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) return;

  confirmAction(`File ${returnType}`, `This will mark ${returnType} as FILED (simulated) for ${periodLabel(period)}. This action mimics real filing for practice purposes only — no data is sent to any government system. Continue?`, async () => {
    const existing = await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id && r.period === period && r.returnType === returnType);
    const payload = { taxpayerId: taxpayer.id, period, returnType, status: 'filed', filedOn: new Date().toISOString(), arn: 'PRACTICE-ARN-' + DB.genId('SIM') };
    if (existing[0]) await DB.update(DB.SHEETS.FILING_HISTORY, existing[0].id, payload);
    else await DB.create(DB.SHEETS.FILING_HISTORY, payload);
    await AUTH.logAudit('RETURN_FILED_SIMULATED', `${returnType} simulated-filed for ${period}`);
    showToast(`${returnType} marked as filed (simulated)`, 'success');
    showPage(returnType === 'GSTR-1' ? 'gstr1' : 'gstr3b');
  });
}

// ============================================================
// GSTR-2A VIEW (read-only practice ledger, user-entered)
// ============================================================
Pages.gstr2a = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const records = (taxpayer && period) ? await DB.query(DB.SHEETS.GSTR2A_DATA, r => r.taxpayerId === taxpayer.id && r.period === period) : [];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">GSTR-2A View</div>
          <div class="page-subtitle">Dynamic, invoice-level inward supply statement (practice) · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openGSTR2AForm()" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Add 2A Record</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}
      <div class="info-box mb-16">ℹ In the real GST system, GSTR-2A updates continuously as vendors upload invoices. Here, add practice records manually to simulate that feed.</div>
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Vendor</th><th>GSTIN</th><th>Invoice No.</th><th>Date</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th>Filing Status</th><th></th></tr></thead>
            <tbody>
              ${records.length === 0 ? `<tr><td colspan="10">${emptyState('👁', 'No GSTR-2A records', 'Add records to simulate vendor invoice uploads.')}</td></tr>` :
                records.map(r => `<tr>
                  <td>${escapeHtml(r.vendorName)}</td><td class="td-gstin">${escapeHtml(r.vendorGSTIN)}</td><td class="mono">${escapeHtml(r.invoiceNumber)}</td><td>${formatDate(r.invoiceDate)}</td>
                  <td class="td-num">${formatCurrency(r.taxableValue)}</td><td class="td-num">${formatCurrency(r.cgst)}</td><td class="td-num">${formatCurrency(r.sgst)}</td><td class="td-num">${formatCurrency(r.igst)}</td>
                  <td><span class="badge ${badgeForStatus(r.vendorFilingStatus)}">${escapeHtml(r.vendorFilingStatus||'filed')}</span></td>
                  <td><button class="btn-icon danger" onclick="deleteGenericRecord('${DB.SHEETS.GSTR2A_DATA}','${r.id}','gstr2a')">🗑</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

async function openGSTR2AForm() {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }

  openFormModal({
    title: 'Add GSTR-2A Record',
    submitLabel: 'Add Record',
    fields: [
      { name: 'vendorName', label: 'Vendor Name', required: true },
      { name: 'vendorGSTIN', label: 'Vendor GSTIN', required: true, validate: (v) => !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'invoiceNumber', label: 'Invoice Number', required: true, half: true },
      { name: 'invoiceDate', label: 'Invoice Date', type: 'date', required: true, half: true },
      { name: 'taxableValue', label: 'Taxable Value (₹)', type: 'number', step: '0.01', required: true, half: true,
        onInput: (id) => recalcInvoiceFields(id) },
      { name: 'gstRate', label: 'GST Rate (%)', type: 'select', required: true, half: true,
        options: ['0','5','12','18','28'], onInput: (id) => recalcInvoiceFields(id) },
      { name: 'cgst', label: 'CGST (₹) — auto', readonly: true, half: true },
      { name: 'sgst', label: 'SGST (₹) — auto', readonly: true, half: true },
      { name: 'igst', label: 'IGST (₹) — auto', readonly: true, half: true },
      { name: 'vendorFilingStatus', label: 'Vendor Filing Status', type: 'select', options: ['filed','pending'] },
    ],
    onSubmit: async (values) => {
      const calc = GSTCalc.computeTax(values.taxableValue, values.gstRate, 'intra');
      const payload = Object.assign({}, values, { taxpayerId: taxpayer.id, period, vendorGSTIN: values.vendorGSTIN.toUpperCase(), cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst });
      await DB.create(DB.SHEETS.GSTR2A_DATA, payload);
      showToast('GSTR-2A record added', 'success');
      showPage('gstr2a');
    },
  });
  setTimeout(() => {
    const rateEl = document.getElementById('dynamicModal_gstRate');
    if (rateEl) rateEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
  }, 0);
}

// ============================================================
// GSTR-2B VIEW
// ============================================================
Pages.gstr2b = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  const records = (taxpayer && period) ? await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period) : [];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">GSTR-2B View</div>
          <div class="page-subtitle">Static, auto-drafted ITC statement (practice) · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openGSTR2BForm()" ${(!taxpayer || !period) ? 'disabled' : ''}>+ Add 2B Record</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}
      <div class="info-box mb-16">ℹ GSTR-2B is what your ITC claim should be matched against (Rule 36(4)). Add records here to practice reconciliation against your Purchase Invoices.</div>
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Vendor</th><th>GSTIN</th><th>Invoice No.</th><th>Date</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th></th></tr></thead>
            <tbody>
              ${records.length === 0 ? `<tr><td colspan="9">${emptyState('✅', 'No GSTR-2B records', 'Add records here, then visit Reconciliation to match them against your purchase invoices.')}</td></tr>` :
                records.map(r => `<tr>
                  <td>${escapeHtml(r.vendorName)}</td><td class="td-gstin">${escapeHtml(r.vendorGSTIN)}</td><td class="mono">${escapeHtml(r.invoiceNumber)}</td><td>${formatDate(r.invoiceDate)}</td>
                  <td class="td-num">${formatCurrency(r.taxableValue)}</td><td class="td-num">${formatCurrency(r.cgst)}</td><td class="td-num">${formatCurrency(r.sgst)}</td><td class="td-num">${formatCurrency(r.igst)}</td>
                  <td><button class="btn-icon danger" onclick="deleteGenericRecord('${DB.SHEETS.GSTR2B_DATA}','${r.id}','gstr2b')">🗑</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

async function openGSTR2BForm() {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Set up taxpayer profile and select a period first.', 'warning'); return; }
  const vendors = await DB.query(DB.SHEETS.VENDORS, v => v.taxpayerId === taxpayer.id);

  openFormModal({
    title: 'Add GSTR-2B Record',
    submitLabel: 'Add Record',
    fields: [
      { name: 'vendorName', label: 'Vendor Name', required: true, hint: vendors.length ? 'Tip: match the name you used in Vendor Master / Purchase Invoice for accurate reconciliation' : '' },
      { name: 'vendorGSTIN', label: 'Vendor GSTIN', required: true, validate: (v) => !isValidGSTINFormat(v) ? 'Invalid GSTIN format' : null },
      { name: 'invoiceNumber', label: 'Invoice Number (must match your purchase invoice for matching)', required: true },
      { name: 'invoiceDate', label: 'Invoice Date', type: 'date', required: true, half: true },
      { name: 'taxableValue', label: 'Taxable Value (₹)', type: 'number', step: '0.01', required: true, half: true,
        onInput: (id) => recalcInvoiceFields(id) },
      { name: 'gstRate', label: 'GST Rate (%)', type: 'select', required: true, half: true,
        options: ['0','5','12','18','28'], onInput: (id) => recalcInvoiceFields(id) },
      { name: 'cgst', label: 'CGST (₹) — auto', readonly: true, half: true },
      { name: 'sgst', label: 'SGST (₹) — auto', readonly: true, half: true },
      { name: 'igst', label: 'IGST (₹) — auto', readonly: true, half: true },
    ],
    onSubmit: async (values) => {
      const calc = GSTCalc.computeTax(values.taxableValue, values.gstRate, 'intra');
      const payload = Object.assign({}, values, { taxpayerId: taxpayer.id, period, vendorGSTIN: values.vendorGSTIN.toUpperCase(), cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst });
      await DB.create(DB.SHEETS.GSTR2B_DATA, payload);
      showToast('GSTR-2B record added', 'success');
      showPage('gstr2b');
    },
  });
  setTimeout(() => {
    const rateEl = document.getElementById('dynamicModal_gstRate');
    if (rateEl) rateEl.addEventListener('change', () => recalcInvoiceFields('dynamicModal'));
  }, 0);
}

async function deleteGenericRecord(sheet, id, pageId) {
  confirmAction('Delete Record', 'This will permanently remove this record. Continue?', async () => {
    await DB.remove(sheet, id);
    showToast('Record deleted', 'success');
    showPage(pageId);
  });
}

// ============================================================
// RECONCILIATION
// ============================================================
Pages.reconciliation = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">Reconciliation</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }

  const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);
  const result = Recon.reconcile(purchases, gstr2b);
  const s = result.summary;

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Reconciliation — Purchase Register vs GSTR-2B</div>
          <div class="page-subtitle">${escapeHtml(taxpayer.legalName)} · ${periodLabel(period)}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline" onclick="showPage('gstr2b')">Manage GSTR-2B Records</button>
          <button class="btn btn-outline" onclick="showPage('purchase-invoice')">Manage Purchase Invoices</button>
        </div>
      </div>

      <div class="recon-summary-grid">
        <div class="recon-count-card"><div class="recon-count">${s.totalBooks}</div><div class="recon-label">In Books</div></div>
        <div class="recon-count-card"><div class="recon-count">${s.total2B}</div><div class="recon-label">In GSTR-2B</div></div>
        <div class="recon-count-card"><div class="recon-count text-success">${s.matchedCount}</div><div class="recon-label">Matched</div></div>
        <div class="recon-count-card"><div class="recon-count text-warning">${s.mismatchCount}</div><div class="recon-label">Mismatch</div></div>
        <div class="recon-count-card"><div class="recon-count text-danger">${s.missingIn2BCount}</div><div class="recon-label">Missing in 2B</div></div>
        <div class="recon-count-card"><div class="recon-count text-danger">${s.missingInBooksCount}</div><div class="recon-label">Missing in Books</div></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card green"><div class="stat-card-icon green">✅</div><div class="stat-card-value">${formatCurrency(s.eligibleITC)}</div><div class="stat-card-label">Eligible ITC</div></div>
        <div class="stat-card orange"><div class="stat-card-icon orange">⚠</div><div class="stat-card-value">${formatCurrency(s.disputedITC)}</div><div class="stat-card-label">Disputed ITC</div></div>
        <div class="stat-card red"><div class="stat-card-icon red">❌</div><div class="stat-card-value">${formatCurrency(s.atRiskITC)}</div><div class="stat-card-label">At-Risk ITC</div></div>
      </div>

      <div class="tab-nav">
        <button class="tab-btn active" onclick="switchTab('recon','matched',this)">✅ Matched (${result.matched.length})</button>
        <button class="tab-btn" onclick="switchTab('recon','mismatch',this)">⚠ Mismatch (${result.mismatch.length})</button>
        <button class="tab-btn" onclick="switchTab('recon','missing2b',this)">❌ Missing in 2B (${result.missingIn2B.length})</button>
        <button class="tab-btn" onclick="switchTab('recon','missingbooks',this)">❓ Missing in Books (${result.missingInBooks.length})</button>
      </div>

      <div data-tabgroup="recon" data-tabid="matched" class="tab-panel active">
        <div class="card"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">Taxable (Books)</th><th class="right">Taxable (2B)</th><th>Status</th></tr></thead>
          <tbody>${result.matched.length === 0 ? `<tr><td colspan="5">${emptyState('✅','No matched invoices yet','')}</td></tr>` :
            result.matched.map(m => `<tr><td>${escapeHtml(m.book.vendorName)}</td><td class="mono">${escapeHtml(m.book.invoiceNumber)}</td><td class="td-num">${formatCurrency(m.book.taxableValue)}</td><td class="td-num">${formatCurrency(m.twoB.taxableValue)}</td><td><span class="badge badge-success">Matched</span></td></tr>`).join('')}</tbody>
        </table></div></div>
      </div>

      <div data-tabgroup="recon" data-tabid="mismatch" class="tab-panel">
        <div class="card"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">Taxable (Books)</th><th class="right">Taxable (2B)</th><th class="right">Difference</th><th></th></tr></thead>
          <tbody>${result.mismatch.length === 0 ? `<tr><td colspan="6">${emptyState('⚠','No mismatches found','')}</td></tr>` :
            result.mismatch.map(m => `<tr><td>${escapeHtml(m.book.vendorName)}</td><td class="mono">${escapeHtml(m.book.invoiceNumber)}</td><td class="td-num">${formatCurrency(m.book.taxableValue)}</td><td class="td-num">${formatCurrency(m.twoB.taxableValue)}</td><td class="td-num text-warning fw-bold">${formatCurrency(m.diffs.taxableValue)}</td><td><button class="btn btn-sm btn-outline" onclick="showToast('Practice tip: contact vendor to correct their GSTR-1 filing.','info')">Action</button></td></tr>`).join('')}</tbody>
        </table></div></div>
      </div>

      <div data-tabgroup="recon" data-tabid="missing2b" class="tab-panel">
        <div class="card"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">Taxable (Books)</th><th class="right">ITC at Risk</th><th>Reason</th></tr></thead>
          <tbody>${result.missingIn2B.length === 0 ? `<tr><td colspan="5">${emptyState('❌','None missing','')}</td></tr>` :
            result.missingIn2B.map(m => `<tr><td>${escapeHtml(m.book.vendorName)}</td><td class="mono">${escapeHtml(m.book.invoiceNumber)}</td><td class="td-num">${formatCurrency(m.book.taxableValue)}</td><td class="td-num text-danger fw-bold">${formatCurrency((parseFloat(m.book.cgst)||0)+(parseFloat(m.book.sgst)||0)+(parseFloat(m.book.igst)||0))}</td><td style="font-size:11px;color:var(--neutral-500);">${escapeHtml(m.reason)}</td></tr>`).join('')}</tbody>
        </table></div></div>
      </div>

      <div data-tabgroup="recon" data-tabid="missingbooks" class="tab-panel">
        <div class="card"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">Taxable (2B)</th><th>Reason</th></tr></thead>
          <tbody>${result.missingInBooks.length === 0 ? `<tr><td colspan="4">${emptyState('❓','None missing','')}</td></tr>` :
            result.missingInBooks.map(m => `<tr><td>${escapeHtml(m.twoB.vendorName)}</td><td class="mono">${escapeHtml(m.twoB.invoiceNumber)}</td><td class="td-num">${formatCurrency(m.twoB.taxableValue)}</td><td style="font-size:11px;color:var(--neutral-500);">${escapeHtml(m.reason)}</td></tr>`).join('')}</tbody>
        </table></div></div>
      </div>
    </div>
  `;
};

// ============================================================
// ITC MATCHING
// ============================================================
Pages['itc-matching'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">ITC Matching</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }
  const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);
  const result = Recon.reconcile(purchases, gstr2b);
  const matchedIds = new Set(result.matched.map(m => m.book.id));
  const mismatchIds = new Set(result.mismatch.map(m => m.book.id));

  const rows = purchases.map(p => {
    const status = p.isBlockedCredit ? 'blocked' : matchedIds.has(p.id) ? 'matched' : mismatchIds.has(p.id) ? 'mismatch' : 'missing';
    const classification = Recon.classifyITCEligibility(Object.assign({}, p, { itcMatchStatus: status === 'blocked' ? p.itcMatchStatus : status }));
    return { p, status, classification };
  });

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">ITC Matching</div>
          <div class="page-subtitle">Invoice-level eligibility classification · ${periodLabel(period)}</div>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th>2B Status</th><th>Eligibility</th><th>Reason</th></tr></thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="8">${emptyState('🧮','No purchase invoices to match','Add purchase invoices to see ITC eligibility analysis.')}</td></tr>` :
                rows.map(r => `<tr>
                  <td>${escapeHtml(r.p.vendorName)}</td><td class="mono">${escapeHtml(r.p.invoiceNumber)}</td>
                  <td class="td-num">${formatCurrency(r.p.cgst)}</td><td class="td-num">${formatCurrency(r.p.sgst)}</td><td class="td-num">${formatCurrency(r.p.igst)}</td>
                  <td><span class="badge ${badgeForStatus(r.status)}">${r.status}</span></td>
                  <td><span class="badge ${badgeForStatus(r.classification.status)}">${r.classification.status}</span></td>
                  <td style="font-size:11px;color:var(--neutral-500);">${escapeHtml(r.classification.reason)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

// ============================================================
// TAX LIABILITY
// ============================================================
Pages['tax-liability'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">Tax Liability</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }
  const sales = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);
  const salesAgg = GSTCalc.aggregate(sales);
  const reconResult = Recon.reconcile(purchases, gstr2b);
  const eligiblePurchases = reconResult.matched.map(m => m.book).filter(p => !p.isBlockedCredit);
  const itcAgg = GSTCalc.aggregate(eligiblePurchases);
  const netLiability = GSTCalc.computeNetLiability(
    { cgst: salesAgg.cgst, sgst: salesAgg.sgst, igst: salesAgg.igst, cess: salesAgg.cess },
    { cgst: itcAgg.cgst, sgst: itcAgg.sgst, igst: itcAgg.igst, cess: itcAgg.cess }
  );
  const totalCash = netLiability.cashPayable.cgst + netLiability.cashPayable.sgst + netLiability.cashPayable.igst + netLiability.cashPayable.cess;

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Tax Liability Calculation</div>
          <div class="page-subtitle">Live calculation from entered invoices · ${periodLabel(period)}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card blue"><div class="stat-card-icon blue">📤</div><div class="stat-card-value">${formatCurrency(salesAgg.cgst+salesAgg.sgst+salesAgg.igst)}</div><div class="stat-card-label">Output Tax Liability</div></div>
        <div class="stat-card green"><div class="stat-card-icon green">📥</div><div class="stat-card-value">${formatCurrency(itcAgg.cgst+itcAgg.sgst+itcAgg.igst)}</div><div class="stat-card-label">ITC Available</div></div>
        <div class="stat-card orange"><div class="stat-card-icon orange">💳</div><div class="stat-card-value">${formatCurrency(totalCash)}</div><div class="stat-card-label">Net Cash Payable</div></div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">Computation Sheet</div></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Head</th><th class="right">Output Tax</th><th class="right">ITC Available</th><th class="right">Net Payable</th></tr></thead>
              <tbody>
                <tr><td>CGST</td><td class="td-num">${formatCurrency(salesAgg.cgst)}</td><td class="td-num">${formatCurrency(itcAgg.cgst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.cgst)}</td></tr>
                <tr><td>SGST</td><td class="td-num">${formatCurrency(salesAgg.sgst)}</td><td class="td-num">${formatCurrency(itcAgg.sgst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.sgst)}</td></tr>
                <tr><td>IGST</td><td class="td-num">${formatCurrency(salesAgg.igst)}</td><td class="td-num">${formatCurrency(itcAgg.igst)}</td><td class="td-num fw-bold">${formatCurrency(netLiability.cashPayable.igst)}</td></tr>
              </tbody>
            </table>
          </div>

          <div class="form-section-title">Late Payment Interest Calculator (Practice)</div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Tax Amount (₹)</label><input type="number" id="interestTaxAmt" class="form-control" value="${totalCash.toFixed(2)}"></div>
            <div class="form-group"><label class="form-label">Days Late</label><input type="number" id="interestDays" class="form-control" value="0" oninput="calcInterest()"></div>
          </div>
          <div id="interestResult" class="info-box" style="display:none;"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('interestTaxAmt').addEventListener('input', calcInterest);
};

function calcInterest() {
  const amt = parseFloat(document.getElementById('interestTaxAmt').value) || 0;
  const days = parseFloat(document.getElementById('interestDays').value) || 0;
  const result = document.getElementById('interestResult');
  if (days <= 0) { result.style.display = 'none'; return; }
  const interest = GSTCalc.computeLateInterest(amt, days);
  result.style.display = 'block';
  result.innerHTML = `Interest @ 18% p.a. for ${days} day(s) on ${formatCurrency(amt)} = <strong>${formatCurrency(interest)}</strong>`;
}

// ============================================================
// FILING SIMULATION (end-to-end walkthrough)
// ============================================================
Pages['filing-simulation'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) {
    container.innerHTML = `<div class="page-container"><div class="page-header"><div class="page-title">Filing Simulation</div></div>${!taxpayer ? requireTaxpayerNotice() : requirePeriodNotice()}</div>`;
    return;
  }
  const sales = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr2b = await DB.query(DB.SHEETS.GSTR2B_DATA, r => r.taxpayerId === taxpayer.id && r.period === period);
  const filings = await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id && r.period === period);
  const gstr1Filed = filings.some(f => f.returnType === 'GSTR-1' && f.status === 'filed');
  const gstr3bFiled = filings.some(f => f.returnType === 'GSTR-3B' && f.status === 'filed');
  const reconDone = purchases.length > 0 && gstr2b.length > 0;

  const steps = [
    { label: 'Set up Taxpayer Profile', done: !!taxpayer, page: 'taxpayer' },
    { label: 'Add Sales Invoices', done: sales.length > 0, page: 'sales-invoice' },
    { label: 'Add Purchase Invoices', done: purchases.length > 0, page: 'purchase-invoice' },
    { label: 'Add GSTR-2B Records', done: gstr2b.length > 0, page: 'gstr2b' },
    { label: 'Run Reconciliation', done: reconDone, page: 'reconciliation' },
    { label: 'Review & File GSTR-1', done: gstr1Filed, page: 'gstr1' },
    { label: 'Review & File GSTR-3B', done: gstr3bFiled, page: 'gstr3b' },
  ];

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div>
          <div class="page-title">Filing Simulation</div>
          <div class="page-subtitle">Step-by-step end-to-end return filing walkthrough · ${periodLabel(period)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          ${steps.map((s, i) => `
            <div class="step-row d-flex align-center gap-12" style="padding:14px 0;${i < steps.length-1 ? 'border-bottom:1px solid var(--neutral-200);' : ''}">
              <div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;background:${s.done ? 'var(--success-bg)' : 'var(--neutral-100)'};color:${s.done ? 'var(--success)' : 'var(--neutral-500)'};">
                ${s.done ? '✓' : i + 1}
              </div>
              <div class="flex-1">
                <div style="font-size:13px;font-weight:600;color:${s.done ? 'var(--neutral-900)' : 'var(--neutral-500)'};">${s.label}</div>
              </div>
              <button class="btn btn-sm ${s.done ? 'btn-outline' : 'btn-primary'}" onclick="showPage('${s.page}')">${s.done ? 'Review' : 'Go'}</button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
};

// ============================================================
// FILING HISTORY
// ============================================================
Pages['filing-history'] = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const filings = taxpayer ? await DB.query(DB.SHEETS.FILING_HISTORY, r => r.taxpayerId === taxpayer.id) : [];
  filings.sort((a, b) => (b.period || '').localeCompare(a.period || ''));

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div><div class="page-title">Filing History</div><div class="page-subtitle">All simulated filings across periods</div></div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : ''}
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Period</th><th>Return Type</th><th>Status</th><th>Filed On</th><th>ARN (Simulated)</th></tr></thead>
            <tbody>
              ${filings.length === 0 ? `<tr><td colspan="5">${emptyState('📁','No filings yet','Filed returns will appear here once you submit GSTR-1 / GSTR-3B from their respective pages.')}</td></tr>` :
                filings.map(f => `<tr><td>${periodLabel(f.period)}</td><td class="fw-600">${escapeHtml(f.returnType)}</td><td><span class="badge ${badgeForStatus(f.status)}">${escapeHtml(f.status)}</span></td><td>${formatDateTime(f.filedOn)}</td><td class="mono" style="font-size:11px;">${escapeHtml(f.arn||'—')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
};

// ============================================================
// PROFILE / SETTINGS
// ============================================================
Pages.profile = async function (container) {
  const session = AUTH.getSession();
  container.innerHTML = `
    <div class="page-container">
      <div class="page-header"><div><div class="page-title">My Profile</div><div class="page-subtitle">Account information</div></div></div>
      <div class="card" style="max-width:480px;">
        <div class="card-body">
          <div class="tax-breakdown">
            <div class="tax-row"><span class="tax-row-label">Name</span><span class="tax-row-value">${escapeHtml(session.firstName)} ${escapeHtml(session.lastName)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Username</span><span class="tax-row-value">${escapeHtml(session.username)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Email</span><span class="tax-row-value">${escapeHtml(session.email)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Role</span><span class="tax-row-value">${escapeHtml(session.role)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Signed in</span><span class="tax-row-value">${formatDateTime(session.loginAt)}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
};

Pages.settings = async function (container) {
  container.innerHTML = `
    <div class="page-container">
      <div class="page-header"><div><div class="page-title">Settings</div><div class="page-subtitle">Portal preferences & data management</div></div></div>
      <div class="card mb-16" style="max-width:560px;">
        <div class="card-header"><div class="card-title">Backend Connection</div></div>
        <div class="card-body">
          <div class="info-box">Currently using: <strong>${DB.backendMode()}</strong></div>
          <p class="form-hint mt-8">To connect a real Google Sheets backend, set <code>GAS_WEB_APP_URL</code> in <code>js/db.js</code> to your deployed Apps Script Web App URL. See the deployment guide in <code>docs/DEPLOYMENT.md</code>.</p>
        </div>
      </div>
      <div class="card" style="max-width:560px;border-color:var(--danger);">
        <div class="card-header"><div class="card-title text-danger">Danger Zone</div></div>
        <div class="card-body">
          <p class="form-hint mb-16">This clears all locally stored practice data (invoices, masters, filings) from this browser. This cannot be undone.</p>
          <button class="btn btn-danger" onclick="clearAllPracticeData()">Clear All Local Practice Data</button>
        </div>
      </div>
    </div>
  `;
};

function clearAllPracticeData() {
  confirmAction('Clear All Data', 'This will permanently delete ALL locally stored practice data including invoices, masters, and filing history. This cannot be undone. Continue?', async () => {
    await DB.clearAll();
    showToast('All local practice data cleared', 'success');
    setTimeout(() => location.reload(), 800);
  });
}

// ============================================================
// REPORTS & ANALYTICS
// ============================================================
Pages.reports = async function (container) {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div><div class="page-title">Reports & Analytics</div>
          <div class="page-subtitle">${taxpayer ? escapeHtml(taxpayer.legalName) : 'No taxpayer'} · ${period ? periodLabel(period) : 'No period selected'}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline" onclick="exportAllReports()">⬇ Export All</button>
        </div>
      </div>
      ${!taxpayer ? requireTaxpayerNotice() : (!period ? requirePeriodNotice() : '')}

      <div class="tab-nav">
        <button class="tab-btn active" onclick="switchTab('rpt','purchase',this)">Purchase Register</button>
        <button class="tab-btn" onclick="switchTab('rpt','sales',this)">Sales Register</button>
        <button class="tab-btn" onclick="switchTab('rpt','itc',this)">ITC Register</button>
        <button class="tab-btn" onclick="switchTab('rpt','liability',this)">GST Liability</button>
        <button class="tab-btn" onclick="switchTab('rpt','recon',this)">Reconciliation Report</button>
        <button class="tab-btn" onclick="switchTab('rpt','audit',this)">Audit Log</button>
      </div>

      <div data-tabgroup="rpt" data-tabid="purchase" class="tab-panel active" id="rpt-purchase">
        ${emptyState('⏳','Loading...','')}</div>
      <div data-tabgroup="rpt" data-tabid="sales" class="tab-panel" id="rpt-sales">
        ${emptyState('⏳','Loading...','')}</div>
      <div data-tabgroup="rpt" data-tabid="itc" class="tab-panel" id="rpt-itc">
        ${emptyState('⏳','Loading...','')}</div>
      <div data-tabgroup="rpt" data-tabid="liability" class="tab-panel" id="rpt-liability">
        ${emptyState('⏳','Loading...','')}</div>
      <div data-tabgroup="rpt" data-tabid="recon" class="tab-panel" id="rpt-recon">
        ${emptyState('⏳','Loading...','')}</div>
      <div data-tabgroup="rpt" data-tabid="audit" class="tab-panel" id="rpt-audit">
        ${emptyState('⏳','Loading...','')}</div>
    </div>
  `;

  if (!taxpayer || !period) return;
  await Reports.renderAll(taxpayer, period);
};

// ============================================================
// ADMIN PANEL
// ============================================================
Pages.admin = async function (container) {
  if (!AUTH.isAdmin()) {
    container.innerHTML = `<div class="page-container"><div class="form-error">Access denied — Administrator role required.</div></div>`;
    return;
  }

  const users = await DB.query(DB.SHEETS.USERS);
  const auditLogs = await DB.query(DB.SHEETS.AUDIT_LOGS);
  auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentLogs = auditLogs.slice(0, 50);

  const settings = await DB.query(DB.SHEETS.SETTINGS);
  const adminCodeSetting = settings.find(s => s.key === 'admin_access_code');

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <div><div class="page-title">🛡 Admin Panel</div>
          <div class="page-subtitle">System management, user control, and audit logs</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card blue"><div class="stat-card-icon blue">👥</div><div class="stat-card-value">${users.length}</div><div class="stat-card-label">Total Users</div></div>
        <div class="stat-card teal"><div class="stat-card-icon teal">👤</div><div class="stat-card-value">${users.filter(u=>u.role==='admin').length}</div><div class="stat-card-label">Admins</div></div>
        <div class="stat-card green"><div class="stat-card-icon green">✅</div><div class="stat-card-value">${users.filter(u=>u.status==='active').length}</div><div class="stat-card-label">Active Users</div></div>
        <div class="stat-card orange"><div class="stat-card-icon orange">📋</div><div class="stat-card-value">${auditLogs.length}</div><div class="stat-card-label">Audit Events</div></div>
      </div>

      <div class="tab-nav">
        <button class="tab-btn active" onclick="switchTab('admin','users',this)">User Management</button>
        <button class="tab-btn" onclick="switchTab('admin','settings',this)">GST Settings</button>
        <button class="tab-btn" onclick="switchTab('admin','periods',this)">Manage Periods</button>
        <button class="tab-btn" onclick="switchTab('admin','audit',this)">Audit Log</button>
        <button class="tab-btn" onclick="switchTab('admin','data',this)">Data Backup</button>
      </div>

      <!-- USERS TAB -->
      <div data-tabgroup="admin" data-tabid="users" class="tab-panel active">
        <div class="card">
          <div class="card-header">
            <div class="card-title">User Accounts (${users.length})</div>
            <button class="btn btn-sm btn-primary" onclick="openAdminAddUser()">+ Add User</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead>
              <tbody>
                ${users.length === 0 ? `<tr><td colspan="7">${emptyState('👥','No users registered yet','')}</td></tr>` :
                  users.map(u => `<tr>
                    <td class="fw-600">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
                    <td class="mono">${escapeHtml(u.username)}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge ${u.role==='admin'?'badge-danger':'badge-info'}">${escapeHtml(u.role)}</span></td>
                    <td><span class="badge ${u.status==='active'?'badge-success':'badge-danger'}">${escapeHtml(u.status||'active')}</span></td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>
                      ${u.status !== 'disabled'
                        ? `<button class="btn btn-sm btn-danger" onclick="adminToggleUser('${u.id}','disabled')">Disable</button>`
                        : `<button class="btn btn-sm btn-success" onclick="adminToggleUser('${u.id}','active')">Enable</button>`}
                      <button class="btn btn-sm btn-outline" onclick="adminResetUser('${u.id}','${escapeHtml(u.username)}')">Reset PW</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- GST SETTINGS TAB -->
      <div data-tabgroup="admin" data-tabid="settings" class="tab-panel">
        <div class="card" style="max-width:560px;">
          <div class="card-header"><div class="card-title">Portal Settings</div></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Portal Name</label>
              <input type="text" id="set_portalName" class="form-control" value="${escapeHtml(settings.find(s=>s.key==='portal_name')?.value || 'GST Practice Portal')}" placeholder="Portal display name">
            </div>
            <div class="form-group">
              <label class="form-label">Default Financial Year</label>
              <input type="text" id="set_fy" class="form-control" value="${escapeHtml(settings.find(s=>s.key==='default_fy')?.value || '2025-26')}" placeholder="e.g. 2025-26">
            </div>
            <div class="form-group">
              <label class="form-label">Admin Access Code (for new admin registration)</label>
              <input type="text" id="set_adminCode" class="form-control" value="${escapeHtml(adminCodeSetting?.value || AUTH.ADMIN_ACCESS_CODE)}" placeholder="Change admin signup code">
              <div class="form-hint">Changing this here is for reference only — update the code in <code>auth.js</code> as well.</div>
            </div>
            <button class="btn btn-primary" onclick="saveAdminSettings()">Save Settings</button>
            <div id="adminSettingsMsg" class="form-success" style="display:none; margin-top:10px;"></div>
          </div>
        </div>
      </div>

      <!-- PERIODS TAB -->
      <div data-tabgroup="admin" data-tabid="periods" class="tab-panel">
        <div class="card" style="max-width:480px;">
          <div class="card-header"><div class="card-title">Return Periods</div></div>
          <div class="card-body">
            <div class="info-box mb-16">Periods are managed per-user from the top header dropdown. This view shows all periods across all users.</div>
            <div id="adminPeriodList"></div>
          </div>
        </div>
      </div>

      <!-- AUDIT LOG TAB -->
      <div data-tabgroup="admin" data-tabid="audit" class="tab-panel">
        <div class="card">
          <div class="card-header"><div class="card-title">Recent Audit Events (last 50)</div></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Timestamp</th><th>Action</th><th>Description</th><th>User ID</th></tr></thead>
              <tbody>
                ${recentLogs.length === 0 ? `<tr><td colspan="4">${emptyState('📋','No audit events yet','')}</td></tr>` :
                  recentLogs.map(l => `<tr>
                    <td style="white-space:nowrap; font-size:11px;">${formatDateTime(l.timestamp)}</td>
                    <td><span class="badge badge-info" style="font-size:10px;">${escapeHtml(l.action)}</span></td>
                    <td style="font-size:12px;">${escapeHtml(l.description)}</td>
                    <td class="mono" style="font-size:10px;">${escapeHtml(l.userId||'—')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- DATA BACKUP TAB -->
      <div data-tabgroup="admin" data-tabid="data" class="tab-panel">
        <div class="card" style="max-width:520px;">
          <div class="card-header"><div class="card-title">Data Backup & Restore</div></div>
          <div class="card-body">
            <p class="form-hint mb-16">Export all locally stored practice data as a JSON file. You can re-import it later to restore a session.</p>
            <div class="d-flex gap-8 flex-wrap">
              <button class="btn btn-primary" onclick="exportBackup()">⬇ Export Backup (JSON)</button>
              <label class="btn btn-outline" style="cursor:pointer;">
                ⬆ Import Backup
                <input type="file" accept=".json" style="display:none;" onchange="importBackup(event)">
              </label>
            </div>
            <div id="backupMsg" class="form-success" style="display:none; margin-top:12px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Load periods for admin view
  const allPeriods = await DB.query(DB.SHEETS.PERIODS);
  const periodListEl = document.getElementById('adminPeriodList');
  if (periodListEl) {
    if (allPeriods.length === 0) {
      periodListEl.innerHTML = `<div style="color:var(--neutral-400);font-size:13px;">No periods created yet.</div>`;
    } else {
      periodListEl.innerHTML = allPeriods.map(p => `
        <div class="period-item">
          <span>${periodLabel(p.value)} <span class="badge badge-neutral" style="font-size:9px;">${escapeHtml(p.userId||'')}</span></span>
          <button class="btn btn-sm btn-danger" onclick="adminDeletePeriod('${p.id}')">Delete</button>
        </div>`).join('');
    }
  }
};

// ── ADMIN ACTIONS ──
async function adminToggleUser(userId, newStatus) {
  await DB.update(DB.SHEETS.USERS, userId, { status: newStatus });
  await AUTH.logAudit('ADMIN_USER_STATUS', `User ${userId} status changed to ${newStatus}`);
  showToast(`User ${newStatus}`, newStatus === 'active' ? 'success' : 'warning');
  showPage('admin');
}

async function adminResetUser(userId, username) {
  confirmAction('Reset Password', `Reset password for "${username}" to "NewPass@2025"? The user must be told to change this immediately.`, async () => {
    const newHash = AUTH.hashPassword('NewPass@2025');
    await DB.update(DB.SHEETS.USERS, userId, { passwordHash: newHash });
    await AUTH.logAudit('ADMIN_PW_RESET', `Password reset for user ${username}`);
    showToast(`Password reset for ${username}`, 'success');
  });
}

function openAdminAddUser() {
  openFormModal({
    title: 'Add User (Admin)',
    submitLabel: 'Create User',
    fields: [
      { name: 'firstName', label: 'First Name', required: true, half: true },
      { name: 'lastName', label: 'Last Name', required: true, half: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'username', label: 'Username', required: true },
      { name: 'password', label: 'Temporary Password', type: 'password', required: true },
      { name: 'role', label: 'Role', type: 'select', options: ['user','admin'], required: true },
    ],
    onSubmit: async (values) => {
      await AUTH.register({ ...values, adminCode: AUTH.ADMIN_ACCESS_CODE });
      showToast('User created', 'success');
      showPage('admin');
    },
  });
}

async function saveAdminSettings() {
  const portalName = document.getElementById('set_portalName').value.trim();
  const fy = document.getElementById('set_fy').value.trim();
  const adminCode = document.getElementById('set_adminCode').value.trim();

  const save = async (key, value) => {
    const existing = await DB.query(DB.SHEETS.SETTINGS, s => s.key === key);
    if (existing[0]) await DB.update(DB.SHEETS.SETTINGS, existing[0].id, { key, value });
    else await DB.create(DB.SHEETS.SETTINGS, { key, value });
  };
  await save('portal_name', portalName);
  await save('default_fy', fy);
  await save('admin_access_code', adminCode);
  await AUTH.logAudit('ADMIN_SETTINGS_SAVED', 'Portal settings updated');
  document.getElementById('adminSettingsMsg').style.display = 'block';
  document.getElementById('adminSettingsMsg').textContent = 'Settings saved successfully.';
  showToast('Settings saved', 'success');
}

async function adminDeletePeriod(id) {
  confirmAction('Delete Period', 'Delete this period? Transactions in that period will remain but the period selector will remove it.', async () => {
    await DB.remove(DB.SHEETS.PERIODS, id);
    showToast('Period deleted', 'success');
    showPage('admin');
  });
}

async function exportBackup() {
  const backup = {};
  for (const sheet of Object.values(DB.SHEETS)) {
    backup[sheet] = await DB.query(sheet);
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gst_practice_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exported', 'success');
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  let backup;
  try { backup = JSON.parse(text); } catch (e) { showToast('Invalid backup file', 'error'); return; }
  showLoading('Restoring backup...');
  for (const [sheet, rows] of Object.entries(backup)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const existing = await DB.read(sheet, row.id).catch(() => null);
      if (existing) await DB.update(sheet, row.id, row);
      else await DB.create(sheet, row);
    }
  }
  hideLoading();
  const msg = document.getElementById('backupMsg');
  if (msg) { msg.style.display = 'block'; msg.textContent = 'Backup restored successfully. Reload the page to see updated data.'; }
  showToast('Backup restored', 'success');
}

async function exportAllReports() {
  const taxpayer = await getActiveTaxpayer();
  const period = currentPeriod();
  if (!taxpayer || !period) { showToast('Select a taxpayer profile and period first.', 'warning'); return; }
  const data = await Reports.collectAll(taxpayer, period);
  const csvParts = [];
  for (const [name, rows] of Object.entries(data)) {
    if (!rows.length) continue;
    csvParts.push(`\n--- ${name} ---`);
    const headers = Object.keys(rows[0]).join(',');
    const rowsStr = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    csvParts.push(headers + '\n' + rowsStr);
  }
  const blob = new Blob([csvParts.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gst_reports_${period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Reports exported as CSV', 'success');
}
