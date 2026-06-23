/* ============================================================
   app.js — APPLICATION BOOTSTRAP & GLOBAL HANDLERS
   Initializes the portal on load, handles auth screen events,
   period management, and sidebar GSTIN refresh.
   ============================================================ */

// ── BOOT ──
document.addEventListener('DOMContentLoaded', async () => {
  if (AUTH.isLoggedIn()) {
    await bootApp();
  } else {
    showAuthScreen();
  }

  // Admin code field visibility on register form
  const regRole = document.getElementById('regRole');
  if (regRole) {
    regRole.addEventListener('change', () => {
      const codeGroup = document.getElementById('adminCodeGroup');
      if (codeGroup) codeGroup.style.display = regRole.value === 'admin' ? 'block' : 'none';
    });
  }

  // Populate year selector in period modal
  const yearSel = document.getElementById('newPeriodYear');
  if (yearSel) {
    const now = new Date().getFullYear();
    for (let y = now + 1; y >= now - 3; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === now) opt.selected = true;
      yearSel.appendChild(opt);
    }
  }
});

async function bootApp() {
  const session = AUTH.getSession();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  // Set header user info
  document.getElementById('headerUserName').textContent = session.firstName + ' ' + session.lastName;
  document.getElementById('headerUserRole').textContent = session.role;
  document.getElementById('headerAvatar').textContent = (session.firstName[0] || 'U').toUpperCase();

  // Show admin nav section only for admins
  if (AUTH.isAdmin()) {
    const adminSection = document.getElementById('adminSection');
    if (adminSection) adminSection.style.display = 'block';
  }

  // Load periods for this user
  await loadPeriodsIntoSelector();

  // Refresh sidebar GSTIN
  await refreshSidebarGSTIN();

  // Show dashboard
  await showPage('dashboard');
}

function showAuthScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

// ── AUTH HANDLERS ──
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(t => { if (t.textContent.toLowerCase().includes(tab === 'login' ? 'sign' : 'reg')) t.classList.add('active'); });
  document.getElementById('loginForm').style.display   = tab === 'login'    ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.style.display = 'none';

  try {
    showLoading('Signing in...');
    await AUTH.login(username, password);
    const rememberMe = document.getElementById('rememberMe').checked;
    if (!rememberMe) {
      // Session will still persist in localStorage until explicit logout —
      // "remember me" here is purely informational in this practice portal.
    }
    hideLoading();
    await bootApp();
  } catch (e) {
    hideLoading();
    errEl.style.display = 'block';
    errEl.textContent   = e.message || 'Login failed.';
  }
}

async function handleRegister() {
  const firstName       = document.getElementById('regFirstName').value.trim();
  const lastName        = document.getElementById('regLastName').value.trim();
  const email           = document.getElementById('regEmail').value.trim();
  const username        = document.getElementById('regUsername').value.trim();
  const password        = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const role            = document.getElementById('regRole').value;
  const adminCode       = document.getElementById('regAdminCode').value.trim();
  const errEl           = document.getElementById('registerError');
  const okEl            = document.getElementById('registerSuccess');
  errEl.style.display   = 'none';
  okEl.style.display    = 'none';

  if (password !== confirmPassword) {
    errEl.style.display = 'block';
    errEl.textContent   = 'Passwords do not match.';
    return;
  }

  try {
    showLoading('Creating account...');
    await AUTH.register({ firstName, lastName, email, username, password, role, adminCode });
    hideLoading();
    okEl.style.display  = 'block';
    okEl.textContent    = 'Account created! You can now sign in.';
    setTimeout(() => switchAuthTab('login'), 1500);
  } catch (e) {
    hideLoading();
    errEl.style.display = 'block';
    errEl.textContent   = e.message || 'Registration failed.';
  }
}

function handleLogout() {
  confirmAction('Sign Out', 'Are you sure you want to sign out?', () => {
    AUTH.logout();
    showAuthScreen();
    showToast('Signed out successfully', 'success');
    // Clear page container
    const pc = document.getElementById('pageContainer');
    if (pc) pc.innerHTML = '';
  });
}

function showForgotPassword() {
  showToast('Password recovery: contact your portal administrator to reset your password.', 'info', 6000);
}

// ── SIDEBAR GSTIN REFRESH ──
async function refreshSidebarGSTIN() {
  const taxpayer = await getActiveTaxpayer();
  const gstinDiv = document.getElementById('sidebarGSTIN');
  if (!gstinDiv) return;

  if (!taxpayer) {
    gstinDiv.innerHTML = `
      <div class="gstin-prompt" onclick="showPage('taxpayer')">
        <span class="gstin-icon">🏢</span>
        <div>
          <div class="gstin-title">Setup Taxpayer Profile</div>
          <div class="gstin-sub">Click to configure GSTIN</div>
        </div>
      </div>`;
  } else {
    gstinDiv.innerHTML = `
      <div class="gstin-prompt" onclick="showPage('taxpayer')" title="Click to edit profile">
        <span class="gstin-icon">🏢</span>
        <div>
          <div class="gstin-number">${escapeHtml(taxpayer.gstin)}</div>
          <div class="gstin-name">${escapeHtml(taxpayer.legalName)}</div>
          <div class="gstin-sub">${escapeHtml(taxpayer.state || taxpayer.regType || '')}</div>
        </div>
      </div>`;
  }
}

// ── PERIOD MANAGEMENT ──
async function loadPeriodsIntoSelector() {
  const session = AUTH.getSession();
  if (!session) return;

  const periods  = await DB.query(DB.SHEETS.PERIODS, p => p.userId === session.id);
  periods.sort((a, b) => (b.value || '').localeCompare(a.value || ''));

  const sel = document.getElementById('globalPeriod');
  if (!sel) return;

  // Preserve current selection
  const current = sel.value;
  sel.innerHTML  = '<option value="">— Select Period —</option>';
  periods.forEach(p => {
    const opt     = document.createElement('option');
    opt.value     = p.value;
    opt.textContent = periodLabel(p.value);
    if (p.value === current) opt.selected = true;
    sel.appendChild(opt);
  });

  // Auto-select first period if none chosen
  if (!sel.value && periods.length > 0) {
    sel.value = periods[0].value;
  }

  // Refresh period list in manage modal
  refreshPeriodList(periods);
}

function refreshPeriodList(periods) {
  const listEl = document.getElementById('periodList');
  if (!listEl) return;
  if (!periods || periods.length === 0) {
    listEl.innerHTML = `<div style="color:var(--neutral-400); font-size:12px; padding:8px 0;">No periods added yet.</div>`;
    return;
  }
  listEl.innerHTML = periods.map(p => `
    <div class="period-item ${p.value === currentPeriod() ? 'active' : ''}">
      <span>${periodLabel(p.value)}</span>
      <button class="btn btn-sm btn-danger" onclick="deletePeriod('${p.id}')">Delete</button>
    </div>`).join('');
}

async function addPeriod() {
  const month  = document.getElementById('newPeriodMonth').value;
  const year   = document.getElementById('newPeriodYear').value;
  if (!month || !year) { showToast('Select month and year', 'warning'); return; }

  const value   = `${year}-${month}`;
  const session = AUTH.getSession();

  // Duplicate check
  const existing = await DB.query(DB.SHEETS.PERIODS, p => p.userId === session.id && p.value === value);
  if (existing.length > 0) { showToast('This period already exists', 'warning'); return; }

  await DB.create(DB.SHEETS.PERIODS, { userId: session.id, value });
  showToast(`Period ${periodLabel(value)} added`, 'success');
  await loadPeriodsIntoSelector();

  // Auto-select newly added period
  const sel = document.getElementById('globalPeriod');
  if (sel) { sel.value = value; onPeriodChange(); }
}

async function deletePeriod(id) {
  confirmAction('Delete Period', 'Remove this return period? Existing transaction records in that period will remain unchanged.', async () => {
    await DB.remove(DB.SHEETS.PERIODS, id);
    showToast('Period removed', 'success');
    await loadPeriodsIntoSelector();
    const sel = document.getElementById('globalPeriod');
    if (sel) sel.value = '';
    onPeriodChange();
  });
}

async function onPeriodChange() {
  // Re-render current page with new period context
  const active = document.querySelector('.nav-item.active');
  const pageId = active ? active.dataset.page : 'dashboard';
  if (pageId) await showPage(pageId);
}

// Keyboard shortcut: Escape closes any open modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      if (m.id !== 'confirmModal') m.remove();
      else m.style.display = 'none';
    });
  }
});
