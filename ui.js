/* ============================================================
   ui.js — REUSABLE UI HELPERS
   Toasts, modals, formatting utilities, sidebar/menu toggles,
   generic tab switching, confirm dialogs.
   ============================================================ */

// ── TOASTS ──
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ── LOADING OVERLAY ──
function showLoading(text = 'Loading...') {
  const overlay = document.getElementById('loadingOverlay');
  const txt = document.getElementById('loadingText');
  if (txt) txt.textContent = text;
  if (overlay) overlay.style.display = 'flex';
}
function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ── MODALS ──
function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function closeModalOutside(event, id) {
  if (event.target.id === id) closeModal(id);
}

function confirmAction(title, message, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const btn = document.getElementById('confirmBtn');
  const newBtn = btn.cloneNode(true); // strip old listeners
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => {
    closeModal('confirmModal');
    onConfirm();
  });
  showModal('confirmModal');
}

// ── DYNAMIC MODAL BUILDER (for CRUD forms) ──
function openFormModal({ id = 'dynamicModal', title, fields, initialValues = {}, onSubmit, submitLabel = 'Save', maxWidth = '640px' }) {
  let modal = document.getElementById(id);
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = id;
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  const fieldsHtml = fields.map(f => renderFormField(f, initialValues[f.name])).join('');

  modal.innerHTML = `
    <div class="modal" style="max-width:${maxWidth};">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" onclick="document.getElementById('${id}').remove()">×</button>
      </div>
      <div class="modal-body">
        <form id="${id}_form">${fieldsHtml}</form>
        <div id="${id}_error" class="form-error" style="display:none;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" type="button" onclick="document.getElementById('${id}').remove()">Cancel</button>
        <button class="btn btn-primary" type="button" id="${id}_submit">${escapeHtml(submitLabel)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Wire up dependent calc listeners if any field declares onInput
  fields.forEach(f => {
    if (f.onInput) {
      const el = document.getElementById(`${id}_${f.name}`);
      if (el) el.addEventListener('input', () => f.onInput(id, fields));
    }
  });

  document.getElementById(`${id}_submit`).addEventListener('click', async () => {
    const values = {};
    let valid = true;
    let firstError = '';
    fields.forEach(f => {
      const el = document.getElementById(`${id}_${f.name}`);
      if (!el) return;
      let val = f.type === 'checkbox' ? el.checked : el.value;
      if (f.type === 'number') val = val === '' ? '' : parseFloat(val);
      values[f.name] = val;
      if (f.required && (val === '' || val === undefined || val === null)) {
        valid = false;
        if (!firstError) firstError = `${f.label} is required.`;
        el.classList.add('error');
      } else {
        el.classList.remove('error');
      }
      if (f.validate && val !== '' && val !== undefined) {
        const err = f.validate(val, values);
        if (err) {
          valid = false;
          if (!firstError) firstError = err;
          el.classList.add('error');
        }
      }
    });
    const errBox = document.getElementById(`${id}_error`);
    if (!valid) {
      errBox.style.display = 'block';
      errBox.textContent = firstError;
      return;
    }
    errBox.style.display = 'none';
    try {
      await onSubmit(values);
      document.getElementById(id).remove();
    } catch (e) {
      errBox.style.display = 'block';
      errBox.textContent = e.message || 'Something went wrong.';
    }
  });
}

function renderFormField(f, value) {
  const id = `dynamicModal_${f.name}`;
  const val = value !== undefined && value !== null ? value : (f.default !== undefined ? f.default : '');
  const requiredMark = f.required ? '<span class="required">*</span>' : '';
  const wrapStart = f.half ? '<div class="form-row">' : '';
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const ov = typeof o === 'object' ? o.value : o;
      const ol = typeof o === 'object' ? o.label : o;
      return `<option value="${escapeHtml(ov)}" ${String(val) === String(ov) ? 'selected' : ''}>${escapeHtml(ol)}</option>`;
    }).join('');
    return `<div class="form-group"><label class="form-label">${escapeHtml(f.label)}${requiredMark}</label>
      <select id="${id}" class="form-control form-select" ${f.disabled ? 'disabled' : ''}>${f.placeholder ? `<option value="">${escapeHtml(f.placeholder)}</option>` : ''}${opts}</select>
      ${f.hint ? `<div class="form-hint">${escapeHtml(f.hint)}</div>` : ''}</div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="form-group"><label class="form-label">${escapeHtml(f.label)}${requiredMark}</label>
      <textarea id="${id}" class="form-control" rows="${f.rows || 3}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(val)}</textarea></div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
      <input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${escapeHtml(f.label)}</label></div>`;
  }
  return `<div class="form-group"><label class="form-label">${escapeHtml(f.label)}${requiredMark}</label>
    <input type="${f.type || 'text'}" id="${id}" class="form-control" value="${escapeHtml(val)}"
      placeholder="${escapeHtml(f.placeholder || '')}" ${f.readonly ? 'readonly' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>
    ${f.hint ? `<div class="form-hint">${escapeHtml(f.hint)}</div>` : ''}</div>`;
}

// ── SIDEBAR / MENU ──
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const mc = document.getElementById('mainContent');
  if (window.innerWidth <= 900) {
    sb.classList.toggle('open');
  } else {
    sb.classList.toggle('collapsed');
    mc.classList.toggle('expanded');
  }
}

function toggleUserMenu() {
  const dd = document.getElementById('userDropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.user-menu');
  const dd = document.getElementById('userDropdown');
  if (dd && menu && !menu.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// ── TABS ──
function switchTab(groupId, tabId, btn) {
  document.querySelectorAll(`[data-tabgroup="${groupId}"]`).forEach(p => p.classList.remove('active'));
  const panel = document.querySelector(`[data-tabgroup="${groupId}"][data-tabid="${tabId}"]`);
  if (panel) panel.classList.add('active');
  if (btn) {
    btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}

// ── FORMATTING HELPERS ──
function formatCurrency(amount) {
  const n = parseFloat(amount);
  if (isNaN(n)) return '₹0.00';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(n) {
  const v = parseFloat(n);
  return isNaN(v) ? '0' : v.toLocaleString('en-IN');
}

function formatDate(isoOrDateStr) {
  if (!isoOrDateStr) return '—';
  const d = new Date(isoOrDateStr);
  if (isNaN(d.getTime())) return isoOrDateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function emptyState(icon, text, sub) {
  return `<div class="table-empty">
    <div class="table-empty-icon">${icon}</div>
    <div class="table-empty-text">${escapeHtml(text)}</div>
    ${sub ? `<div class="table-empty-sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

function badgeForStatus(status) {
  const map = {
    active: 'badge-success', filed: 'badge-success', matched: 'badge-success', paid: 'badge-success', eligible: 'badge-success', approved: 'badge-success',
    pending: 'badge-warning', draft: 'badge-warning', mismatch: 'badge-warning', partial: 'badge-warning',
    overdue: 'badge-danger', missing: 'badge-danger', blocked: 'badge-danger', cancelled: 'badge-danger', rejected: 'badge-danger', disabled: 'badge-danger',
    expired: 'badge-neutral', inactive: 'badge-neutral',
  };
  return map[(status || '').toLowerCase()] || 'badge-neutral';
}

// GSTIN structural validation (format only — this is a practice portal, no live GSTN lookup)
function isValidGSTINFormat(gstin) {
  if (!gstin) return false;
  const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  return pattern.test(gstin.toUpperCase());
}

function gstinStateName(gstin) {
  const codes = {
    '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand',
    '06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim',
    '12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya',
    '18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
    '24':'Gujarat','25':'Daman & Diu','26':'Dadra & Nagar Haveli','27':'Maharashtra','28':'Andhra Pradesh (Old)',
    '29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry',
    '35':'Andaman & Nicobar','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh',
  };
  if (!gstin || gstin.length < 2) return '';
  return codes[gstin.substring(0, 2)] || 'Unknown';
}
