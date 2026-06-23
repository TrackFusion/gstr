/* ============================================================
   auth.js — AUTHENTICATION & SESSION
   Username/password auth against the Users sheet (or local
   fallback). Role-based access: 'user' (Learner) vs 'admin'.
   No data is pre-seeded — the very first registered admin
   account must be created via the Admin Access Code.
   ============================================================ */

const AUTH = (() => {

  const SESSION_KEY = 'gst_practice_portal__session';

  // Set this to whatever you want the one-time admin signup code to be.
  // Change it before deploying for real use.
  const ADMIN_ACCESS_CODE = 'ADMIN-SETUP-2025';

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(user) {
    const session = {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      loginAt: new Date().toISOString(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    return !!getSession();
  }

  function isAdmin() {
    const s = getSession();
    return !!s && s.role === 'admin';
  }

  // Simple deterministic hash for practice-portal password storage.
  // NOTE: This is NOT cryptographically secure. For a real production
  // system, hashing/salting must happen server-side (see backend/Code.gs
  // notes). This client-side hash exists only so plaintext passwords
  // are not stored verbatim in the local fallback store / sheet.
  function hashPassword(pw) {
    let hash = 0;
    const str = 'gstpp::' + pw;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return 'h' + Math.abs(hash).toString(36) + str.length;
  }

  async function findUserByUsernameOrEmail(identifier) {
    const id = (identifier || '').trim().toLowerCase();
    const users = await DB.query(DB.SHEETS.USERS, u =>
      (u.username || '').toLowerCase() === id || (u.email || '').toLowerCase() === id
    );
    return users[0] || null;
  }

  async function register({ firstName, lastName, email, username, password, role, adminCode }) {
    if (!firstName || !lastName || !email || !username || !password) {
      throw new Error('Please fill all required fields.');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (role === 'admin' && adminCode !== ADMIN_ACCESS_CODE) {
      throw new Error('Invalid admin access code.');
    }

    const emailLower = email.trim().toLowerCase();
    const usernameLower = username.trim().toLowerCase();

    const existingByUsername = await DB.query(DB.SHEETS.USERS, u => (u.username || '').toLowerCase() === usernameLower);
    if (existingByUsername.length > 0) {
      throw new Error('This username is already taken. Choose another.');
    }
    const existingByEmail = await DB.query(DB.SHEETS.USERS, u => (u.email || '').toLowerCase() === emailLower);
    if (existingByEmail.length > 0) {
      throw new Error('An account with this email already exists.');
    }

    const user = await DB.create(DB.SHEETS.USERS, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      username: username.trim(),
      passwordHash: hashPassword(password),
      role: role === 'admin' ? 'admin' : 'user',
      status: 'active',
    });

    await logAudit('USER_REGISTERED', `New ${user.role} account created: ${user.username}`, user.id);
    return user;
  }

  async function login(identifier, password) {
    if (!identifier || !password) throw new Error('Enter your username/email and password.');
    const user = await findUserByUsernameOrEmail(identifier);
    if (!user) throw new Error('No account found with that username or email.');
    if (user.status === 'disabled') throw new Error('This account has been disabled by an administrator.');
    if (user.passwordHash !== hashPassword(password)) throw new Error('Incorrect password.');
    const session = setSession(user);
    await logAudit('USER_LOGIN', `${user.username} signed in`, user.id);
    return session;
  }

  function logout() {
    const s = getSession();
    if (s) logAudit('USER_LOGOUT', `${s.username} signed out`, s.id);
    clearSession();
  }

  async function logAudit(action, description, userId) {
    try {
      await DB.create(DB.SHEETS.AUDIT_LOGS, {
        action,
        description,
        userId: userId || (getSession() ? getSession().id : 'anonymous'),
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      // Audit logging must never block the user flow.
      console.warn('Audit log failed', e);
    }
  }

  return { getSession, isLoggedIn, isAdmin, register, login, logout, logAudit, hashPassword, ADMIN_ACCESS_CODE };
})();
