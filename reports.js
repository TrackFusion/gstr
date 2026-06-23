/* ============================================================
   reports.js — REPORT RENDERERS
   All data pulled live from DB for the selected period.
   No hardcoded figures — everything computed from user entries.
   ============================================================ */

const Reports = {

  async collectAll(taxpayer, period) {
    const sales     = await DB.query(DB.SHEETS.SALES_INVOICES,    r => r.taxpayerId === taxpayer.id && r.period === period);
    const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
    const gstr2b    = await DB.query(DB.SHEETS.GSTR2B_DATA,       r => r.taxpayerId === taxpayer.id && r.period === period);
    const recon     = Recon.reconcile(purchases, gstr2b);
    const salesAgg  = GSTCalc.aggregate(sales);
    const eligibleP = recon.matched.map(m => m.book).filter(p => !p.isBlockedCredit);
    const itcAgg    = GSTCalc.aggregate(eligibleP);
    const net       = GSTCalc.computeNetLiability(
      { cgst: salesAgg.cgst, sgst: salesAgg.sgst, igst: salesAgg.igst, cess: salesAgg.cess },
      { cgst: itcAgg.cgst,   sgst: itcAgg.sgst,   igst: itcAgg.igst,   cess: itcAgg.cess }
    );
    return { 'Purchase Register': purchases, 'Sales Register': sales, 'GSTR-2B Records': gstr2b,
      'Reconciliation - Matched': recon.matched.map(m => m.book),
      'Reconciliation - Mismatch': recon.mismatch.map(m => ({ ...m.book, diff_taxable: m.diffs.taxableValue })),
      'Reconciliation - Missing in 2B': recon.missingIn2B.map(m => m.book),
    };
  },

  async renderAll(taxpayer, period) {
    const sales     = await DB.query(DB.SHEETS.SALES_INVOICES,    r => r.taxpayerId === taxpayer.id && r.period === period);
    const purchases = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
    const gstr2b    = await DB.query(DB.SHEETS.GSTR2B_DATA,       r => r.taxpayerId === taxpayer.id && r.period === period);
    const auditLogs = await DB.query(DB.SHEETS.AUDIT_LOGS, l => l.userId === AUTH.getSession().id);
    auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const salesAgg   = GSTCalc.aggregate(sales);
    const purchAgg   = GSTCalc.aggregate(purchases);
    const recon      = Recon.reconcile(purchases, gstr2b);
    const eligibleP  = recon.matched.map(m => m.book).filter(p => !p.isBlockedCredit);
    const blockedP   = purchases.filter(p => p.isBlockedCredit);
    const itcAgg     = GSTCalc.aggregate(eligibleP);
    const blockedAgg = GSTCalc.aggregate(blockedP);
    const net        = GSTCalc.computeNetLiability(
      { cgst: salesAgg.cgst, sgst: salesAgg.sgst, igst: salesAgg.igst, cess: salesAgg.cess },
      { cgst: itcAgg.cgst,   sgst: itcAgg.sgst,   igst: itcAgg.igst,   cess: itcAgg.cess }
    );

    // ── Purchase Register ──
    const purchEl = document.getElementById('rpt-purchase');
    if (purchEl) purchEl.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">Purchase Register — ${periodLabel(period)}</div>
          <button class="btn btn-sm btn-outline" onclick="Reports.exportSheet('purchase-register','${period}')">⬇ CSV</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Vendor</th><th>GSTIN</th><th>Invoice No.</th><th>Category</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th class="right">Total</th><th>RCM</th><th>ITC Eligible</th></tr></thead>
            <tbody>
              ${purchases.length === 0 ? `<tr><td colspan="12">${emptyState('📦','No purchase invoices','')}</td></tr>` :
                purchases.map(p => {
                  const total = (parseFloat(p.taxableValue)||0)+(parseFloat(p.cgst)||0)+(parseFloat(p.sgst)||0)+(parseFloat(p.igst)||0);
                  const eligible = recon.matched.some(m => m.book.id === p.id) && !p.isBlockedCredit;
                  return `<tr>
                    <td>${formatDate(p.invoiceDate)}</td>
                    <td class="fw-600">${escapeHtml(p.vendorName)}</td>
                    <td class="td-gstin">${p.vendorGSTIN ? escapeHtml(p.vendorGSTIN) : '—'}</td>
                    <td class="mono">${escapeHtml(p.invoiceNumber)}</td>
                    <td style="font-size:11px;">${escapeHtml(p.category||'—')}</td>
                    <td class="td-num">${formatCurrency(p.taxableValue)}</td>
                    <td class="td-num">${parseFloat(p.cgst)>0?formatCurrency(p.cgst):'—'}</td>
                    <td class="td-num">${parseFloat(p.sgst)>0?formatCurrency(p.sgst):'—'}</td>
                    <td class="td-num">${parseFloat(p.igst)>0?formatCurrency(p.igst):'—'}</td>
                    <td class="td-num fw-bold">${formatCurrency(total)}</td>
                    <td>${p.isRCM?'<span class="badge badge-warning">RCM</span>':'—'}</td>
                    <td><span class="badge ${p.isBlockedCredit ? 'badge-danger' : eligible ? 'badge-success' : 'badge-warning'}">${p.isBlockedCredit ? 'Blocked' : eligible ? 'Eligible' : 'Pending'}</span></td>
                  </tr>`;
                }).join('')}
            </tbody>
            ${purchases.length > 0 ? `<tfoot><tr style="font-weight:700; background:var(--neutral-50);">
              <td colspan="5" class="right">TOTAL</td>
              <td class="td-num">${formatCurrency(purchAgg.taxableValue)}</td>
              <td class="td-num">${formatCurrency(purchAgg.cgst)}</td>
              <td class="td-num">${formatCurrency(purchAgg.sgst)}</td>
              <td class="td-num">${formatCurrency(purchAgg.igst)}</td>
              <td class="td-num">${formatCurrency(purchAgg.taxableValue+purchAgg.cgst+purchAgg.sgst+purchAgg.igst)}</td>
              <td colspan="2"></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
      </div>`;

    // ── Sales Register ──
    const salesEl = document.getElementById('rpt-sales');
    if (salesEl) salesEl.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">Sales Register — ${periodLabel(period)}</div>
          <button class="btn btn-sm btn-outline" onclick="Reports.exportSheet('sales-register','${period}')">⬇ CSV</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Buyer</th><th>GSTIN</th><th>Invoice No.</th><th>HSN</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th class="right">Total</th><th>Type</th></tr></thead>
            <tbody>
              ${sales.length === 0 ? `<tr><td colspan="11">${emptyState('🧾','No sales invoices','')}</td></tr>` :
                sales.map(s => {
                  const total = (parseFloat(s.taxableValue)||0)+(parseFloat(s.cgst)||0)+(parseFloat(s.sgst)||0)+(parseFloat(s.igst)||0);
                  return `<tr>
                    <td>${formatDate(s.invoiceDate)}</td>
                    <td class="fw-600">${escapeHtml(s.buyerName)}</td>
                    <td class="td-gstin">${s.buyerGSTIN ? escapeHtml(s.buyerGSTIN) : '<span class="badge badge-neutral">B2C</span>'}</td>
                    <td class="mono">${escapeHtml(s.invoiceNumber)}</td>
                    <td class="mono">${escapeHtml(s.hsnCode||'—')}</td>
                    <td class="td-num">${formatCurrency(s.taxableValue)}</td>
                    <td class="td-num">${parseFloat(s.cgst)>0?formatCurrency(s.cgst):'—'}</td>
                    <td class="td-num">${parseFloat(s.sgst)>0?formatCurrency(s.sgst):'—'}</td>
                    <td class="td-num">${parseFloat(s.igst)>0?formatCurrency(s.igst):'—'}</td>
                    <td class="td-num fw-bold">${formatCurrency(total)}</td>
                    <td><span class="badge ${s.supplyType==='inter'?'badge-info':'badge-neutral'}">${s.supplyType==='inter'?'Inter':'Intra'}</span></td>
                  </tr>`;
                }).join('')}
            </tbody>
            ${sales.length > 0 ? `<tfoot><tr style="font-weight:700; background:var(--neutral-50);">
              <td colspan="5" class="right">TOTAL</td>
              <td class="td-num">${formatCurrency(salesAgg.taxableValue)}</td>
              <td class="td-num">${formatCurrency(salesAgg.cgst)}</td>
              <td class="td-num">${formatCurrency(salesAgg.sgst)}</td>
              <td class="td-num">${formatCurrency(salesAgg.igst)}</td>
              <td class="td-num">${formatCurrency(salesAgg.taxableValue+salesAgg.cgst+salesAgg.sgst+salesAgg.igst)}</td>
              <td></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
      </div>`;

    // ── ITC Register ──
    const itcEl = document.getElementById('rpt-itc');
    if (itcEl) itcEl.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">ITC Register — ${periodLabel(period)}</div>
        </div>
        <div class="card-body">
          <div class="tax-breakdown mb-16">
            <div class="tax-row"><span class="tax-row-label">Gross ITC in Books (all purchases)</span><span class="tax-row-value">${formatCurrency(purchAgg.cgst+purchAgg.sgst+purchAgg.igst)}</span></div>
            <div class="tax-row"><span class="tax-row-label">ITC Matched with GSTR-2B</span><span class="tax-row-value text-success">${formatCurrency(itcAgg.cgst+itcAgg.sgst+itcAgg.igst)}</span></div>
            <div class="tax-row"><span class="tax-row-label">ITC Blocked (Section 17(5))</span><span class="tax-row-value text-danger">${formatCurrency(blockedAgg.cgst+blockedAgg.sgst+blockedAgg.igst)}</span></div>
            <div class="tax-row"><span class="tax-row-label">ITC at Risk (Missing in 2B)</span><span class="tax-row-value text-danger">${formatCurrency(recon.summary.atRiskITC)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Net Eligible ITC (CGST)</span><span class="tax-row-value">${formatCurrency(itcAgg.cgst)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Net Eligible ITC (SGST)</span><span class="tax-row-value">${formatCurrency(itcAgg.sgst)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Net Eligible ITC (IGST)</span><span class="tax-row-value">${formatCurrency(itcAgg.igst)}</span></div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Vendor</th><th>Invoice No.</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th>2B Status</th><th>Eligible?</th></tr></thead>
            <tbody>
              ${purchases.length === 0 ? `<tr><td colspan="7">${emptyState('🧮','No purchase invoices','')}</td></tr>` :
                purchases.map(p => {
                  const matched = recon.matched.some(m => m.book.id === p.id);
                  const mismatch = recon.mismatch.some(m => m.book.id === p.id);
                  const twoB = matched ? 'matched' : mismatch ? 'mismatch' : 'missing';
                  const eligible = matched && !p.isBlockedCredit;
                  return `<tr>
                    <td>${escapeHtml(p.vendorName)}</td>
                    <td class="mono">${escapeHtml(p.invoiceNumber)}</td>
                    <td class="td-num">${formatCurrency(p.cgst)}</td>
                    <td class="td-num">${formatCurrency(p.sgst)}</td>
                    <td class="td-num">${formatCurrency(p.igst)}</td>
                    <td><span class="badge ${badgeForStatus(twoB)}">${twoB}</span></td>
                    <td><span class="badge ${p.isBlockedCredit ? 'badge-danger' : eligible ? 'badge-success' : 'badge-warning'}">${p.isBlockedCredit ? 'Blocked' : eligible ? 'Yes' : 'No'}</span></td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // ── GST Liability ──
    const liabEl = document.getElementById('rpt-liability');
    if (liabEl) liabEl.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">GST Liability Statement — ${periodLabel(period)}</div></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Head</th><th class="right">Output Tax</th><th class="right">ITC (Eligible)</th><th class="right">Net Cash Payable</th></tr></thead>
              <tbody>
                <tr><td>CGST</td><td class="td-num">${formatCurrency(salesAgg.cgst)}</td><td class="td-num text-success">${formatCurrency(itcAgg.cgst)}</td><td class="td-num fw-bold text-danger">${formatCurrency(net.cashPayable.cgst)}</td></tr>
                <tr><td>SGST</td><td class="td-num">${formatCurrency(salesAgg.sgst)}</td><td class="td-num text-success">${formatCurrency(itcAgg.sgst)}</td><td class="td-num fw-bold text-danger">${formatCurrency(net.cashPayable.sgst)}</td></tr>
                <tr><td>IGST</td><td class="td-num">${formatCurrency(salesAgg.igst)}</td><td class="td-num text-success">${formatCurrency(itcAgg.igst)}</td><td class="td-num fw-bold text-danger">${formatCurrency(net.cashPayable.igst)}</td></tr>
                <tr><td>CESS</td><td class="td-num">${formatCurrency(salesAgg.cess)}</td><td class="td-num text-success">${formatCurrency(itcAgg.cess)}</td><td class="td-num fw-bold text-danger">${formatCurrency(net.cashPayable.cess)}</td></tr>
                <tr style="font-weight:700; background:var(--neutral-50);">
                  <td>TOTAL</td>
                  <td class="td-num">${formatCurrency(salesAgg.cgst+salesAgg.sgst+salesAgg.igst+salesAgg.cess)}</td>
                  <td class="td-num text-success">${formatCurrency(itcAgg.cgst+itcAgg.sgst+itcAgg.igst+itcAgg.cess)}</td>
                  <td class="td-num text-danger">${formatCurrency(net.cashPayable.cgst+net.cashPayable.sgst+net.cashPayable.igst+net.cashPayable.cess)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    // ── Reconciliation Report ──
    const reconEl = document.getElementById('rpt-recon');
    if (reconEl) reconEl.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">Reconciliation Report — ${periodLabel(period)}</div></div>
        <div class="card-body">
          <div class="recon-summary-grid">
            <div class="recon-count-card"><div class="recon-count">${recon.summary.totalBooks}</div><div class="recon-label">Total in Books</div></div>
            <div class="recon-count-card"><div class="recon-count">${recon.summary.total2B}</div><div class="recon-label">Total in 2B</div></div>
            <div class="recon-count-card"><div class="recon-count text-success">${recon.summary.matchedCount}</div><div class="recon-label">Matched</div></div>
            <div class="recon-count-card"><div class="recon-count text-warning">${recon.summary.mismatchCount}</div><div class="recon-label">Mismatch</div></div>
            <div class="recon-count-card"><div class="recon-count text-danger">${recon.summary.missingIn2BCount}</div><div class="recon-label">Missing in 2B</div></div>
            <div class="recon-count-card"><div class="recon-count text-danger">${recon.summary.missingInBooksCount}</div><div class="recon-label">Missing in Books</div></div>
          </div>
          <div class="tax-breakdown mt-16">
            <div class="tax-row"><span class="tax-row-label">Eligible ITC (Matched)</span><span class="tax-row-value text-success">${formatCurrency(recon.summary.eligibleITC)}</span></div>
            <div class="tax-row"><span class="tax-row-label">Disputed ITC (Mismatch)</span><span class="tax-row-value text-warning">${formatCurrency(recon.summary.disputedITC)}</span></div>
            <div class="tax-row"><span class="tax-row-label">At-Risk ITC (Missing in 2B)</span><span class="tax-row-value text-danger">${formatCurrency(recon.summary.atRiskITC)}</span></div>
          </div>
        </div>
      </div>`;

    // ── Audit Log ──
    const auditEl = document.getElementById('rpt-audit');
    if (auditEl) auditEl.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">My Activity Log</div></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Timestamp</th><th>Action</th><th>Description</th></tr></thead>
            <tbody>
              ${auditLogs.length === 0 ? `<tr><td colspan="3">${emptyState('📋','No activity logged yet','')}</td></tr>` :
                auditLogs.slice(0,100).map(l => `<tr>
                  <td style="white-space:nowrap; font-size:11px;">${formatDateTime(l.timestamp)}</td>
                  <td><span class="badge badge-info" style="font-size:10px;">${escapeHtml(l.action)}</span></td>
                  <td style="font-size:12px;">${escapeHtml(l.description)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  async exportSheet(type, period) {
    const taxpayer = await getActiveTaxpayer();
    if (!taxpayer) return;
    let rows = [], headers = [], filename = type;
    if (type === 'purchase-register') {
      rows = await DB.query(DB.SHEETS.PURCHASE_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
      headers = ['invoiceDate','vendorName','vendorGSTIN','invoiceNumber','category','taxableValue','cgst','sgst','igst','isRCM','isBlockedCredit'];
    } else if (type === 'sales-register') {
      rows = await DB.query(DB.SHEETS.SALES_INVOICES, r => r.taxpayerId === taxpayer.id && r.period === period);
      headers = ['invoiceDate','buyerName','buyerGSTIN','invoiceNumber','hsnCode','description','taxableValue','cgst','sgst','igst','supplyType'];
    }
    if (!rows.length) { showToast('No data to export', 'warning'); return; }
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported', 'success');
  }
};
