const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

loadEnvFile();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'consejo.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'consejo-local-dev-secret-change-me';
const INITIAL_ADMIN_EMAIL = 'gabriel.bailly@gmail.com';
const ADMIN_EMAILS = parseList(process.env.ADMIN_EMAILS || INITIAL_ADMIN_EMAIL);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@localhost';
const APP_URL = (process.env.APP_URL || 'https://consejo.gecoas.es').replace(/\/$/, '');
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';

const DASHBOARDS = [
  { id: 'san-miguel', name: 'San Miguel' },
  { id: 'san-rafael', name: 'San Rafael' },
];
const resetAttempts = new Map();

function loadEnvFile() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2];
    process.env[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}

ensureDataFile();
startReminderScheduler();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, done) => {
      const dir = path.join(UPLOAD_DIR, req.dashboardId);
      fs.mkdirSync(dir, { recursive: true });
      done(null, dir);
    },
    filename: (req, file, done) => {
      done(null, `${Date.now()}-${id()}${path.extname(file.originalname || '')}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL,
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;
    if (!email || !getAccessibleDashboards(email).length) {
      return done(null, false, { message: 'Usuario no autorizado' });
    }
    const user = { email: email.toLowerCase(), name: profile.displayName || email, photo: profile.photos && profile.photos[0] && profile.photos[0].value || '', provider: 'google' };
    rememberUser(user);
    return done(null, user);
  }));
}

app.get('/api/config', (req, res) => {
  res.json({ googleEnabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), oneSignalAppId: ONESIGNAL_APP_ID });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').toLowerCase();
  const localUser = findLocalUser(normalizedEmail, password);
  if (!localUser) {
    return res.status(401).json({ error: 'Credenciales incorrectas o usuario no autorizado' });
  }
  req.login(localUser, (error) => {
    if (error) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
    rememberUser(req.user || localUser);
    res.json(buildMe(req.user || localUser));
  });
});

app.post('/api/password-reset/request', async (req, res) => {
  const email = text(req.body && req.body.email).toLowerCase();
  if (!allowResetRequest(req, email)) return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtalo más tarde.' });
  if (!globalSmtpConfigured()) return res.status(503).json({ error: 'La recuperación de contraseña no está disponible: configura SMTP global.' });
  const user = findEligibleUser(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const store = readData();
    store.passwordResetTokens = array(store.passwordResetTokens).filter((item) => item.email !== email && new Date(item.expiresAt) > new Date());
    store.passwordResetTokens.push({ email, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    writeData(store);
    try {
      await globalTransporter().sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Restablece tu contraseña de Consejo local',
      text: `Has solicitado restablecer tu contraseña de Consejo local. Usa este enlace durante una hora: ${APP_URL}/?resetToken=${token}`,
      });
    } catch (error) {
      store.passwordResetTokens = store.passwordResetTokens.filter((item) => item.email !== email);
      writeData(store);
      return res.status(503).json({ error: 'No se pudo enviar el correo de recuperación. Inténtalo más tarde.' });
    }
  }
  res.json({ ok: true, message: 'Si la cuenta está autorizada, recibirás un correo para restablecer la contraseña.' });
});

app.post('/api/password-reset/confirm', (req, res) => {
  const token = text(req.body && req.body.token);
  const password = String(req.body && req.body.password || '');
  const confirmation = String(req.body && req.body.confirmation || '');
  if (password.length < 12) return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
  if (password !== confirmation) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
  const store = readData();
  const tokenHash = hashResetToken(token);
  const entry = array(store.passwordResetTokens).find((item) => item.tokenHash && crypto.timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex')) && new Date(item.expiresAt) > new Date());
  if (!entry || !findEligibleUser(entry.email)) return res.status(400).json({ error: 'El enlace de recuperación no es válido o ha caducado.' });
  for (const dashboard of Object.values(store.dashboards)) {
    if (dashboard.users[entry.email]) dashboard.users[entry.email].passwordHash = hashPassword(password);
  }
  store.passwordResetTokens = array(store.passwordResetTokens).filter((item) => item !== entry);
  writeData(store);
  res.json({ ok: true });
});

app.get('/auth/google', (req, res, next) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(404).send('Google OAuth no configurado');
  const nextUrl = safeNextUrl(req.query.next);
  passport.authenticate('google', { scope: ['profile', 'email'], state: nextUrl || undefined, prompt: req.query.prompt === 'select_account' ? 'select_account' : undefined })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.redirect('/?login=google-disabled');
  next();
}, passport.authenticate('google', { failureRedirect: '/?login=denied' }), (req, res) => {
  res.redirect(safeNextUrl(req.query.state) || '/');
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  res.json(buildMe(req.user));
});

app.get('/api/data', requireAuth, requireDashboardAccess, (req, res) => {
  res.json(publicDashboard(req.dashboard));
});

app.put('/api/data', requireAuth, requireDashboardAccess, async (req, res) => {
  const store = readData();
  const previous = store.dashboards[req.dashboardId];
  const dashboard = sanitizeDashboard(req.body, previous);
  store.dashboards[req.dashboardId] = dashboard;
  writeData(store);
  await notifyDashboardChanges(previous, dashboard);
  res.json(publicDashboard(dashboard));
});

app.put('/api/push-preference', requireAuth, requireDashboardAccess, (req, res) => {
  const store = readData();
  const email = text(req.user.email).toLowerCase();
  const enabled = Boolean(req.body && req.body.enabled);
  for (const dashboard of Object.values(store.dashboards)) {
    if (!array(dashboard.allowedUsers).includes(email) && !array(dashboard.admins).includes(email) && !isSystemAdmin(email)) continue;
    const current = dashboard.users[email] || {};
    dashboard.users[email] = { ...current, email, name: current.name || text(req.user.name) || email, pushNotifications: enabled };
  }
  writeData(store);
  res.json({ enabled });
});

app.get('/api/users', requireAuth, requireDashboardAdmin, (req, res) => {
  res.json({ allowedUsers: req.dashboard.allowedUsers || [], admins: req.dashboard.admins || [], users: publicUsers(req.dashboard.users || {}) });
});

app.put('/api/users', requireAuth, requireDashboardAdmin, (req, res) => {
  const store = readData();
  const dashboard = store.dashboards[req.dashboardId];
  dashboard.users = dashboard.users || {};
  const submittedUsers = [...new Map(array(req.body && req.body.users).map((user) => ({ email: text(user.email).toLowerCase(), name: text(user.name), type: text(user.type).toLowerCase() === 'admin' ? 'admin' : 'usuario', password: text(user.password) })).filter((user) => user.email).map((user) => [user.email, user])).values()];
  const users = submittedUsers.length ? submittedUsers.map((user) => user.email) : parseList(req.body && req.body.allowedUsers || []);
  dashboard.allowedUsers = users;
  dashboard.admins = submittedUsers.filter((user) => user.type === 'admin').map((user) => user.email);
  for (const user of submittedUsers) {
    const current = dashboard.users[user.email] || {};
    dashboard.users[user.email] = { ...current, email: user.email, name: user.name || user.email, type: user.type };
    if (user.password) dashboard.users[user.email].passwordHash = hashPassword(user.password);
  }
  writeData(store);
  res.json({ allowedUsers: users, admins: dashboard.admins, users: publicUsers(dashboard.users) });
});

app.get('/api/reminders', requireAuth, requireDashboardAdmin, (req, res) => {
  res.json({ reminder: req.dashboard.reminder || defaultReminder(), smtp: publicSmtp(req.dashboard.smtp || defaultSmtp()) });
});

app.put('/api/reminders', requireAuth, requireDashboardAdmin, (req, res) => {
  const store = readData();
  const current = store.dashboards[req.dashboardId];
  current.reminder = sanitizeReminder(req.body.reminder || req.body);
  current.smtp = sanitizeSmtp(req.body.smtp || {}, current.smtp || defaultSmtp());
  writeData(store);
  res.json({ reminder: current.reminder, smtp: publicSmtp(current.smtp) });
});

app.post('/api/reminders/test', requireAuth, requireDashboardAdmin, async (req, res) => {
  const email = text(req.body && req.body.email).toLowerCase();
  const user = knownDashboardUsers(req.dashboard).find((item) => item.email === email);
  if (!email || !user) return res.status(400).json({ error: 'Selecciona un usuario válido' });
  const smtp = getSmtpConfig(req.dashboard);
  if (!smtp.host || !smtp.user || !smtp.pass) return res.status(400).json({ error: 'SMTP no configurado' });
  const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } });
  const tasks = pendingTasksByUser(req.dashboard)[email] || [];
  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject: `Prueba de tareas pendientes - ${req.dashboard.name}`,
    text: buildTasksEmailText(user.name, req.dashboard.name, tasks),
    html: buildTasksEmailHtml(user.name, req.dashboard.name, tasks),
  });
  res.json({ ok: true });
});

app.post('/api/uploads', requireAuth, requireDashboardAccess, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  res.json({
    type: 'file',
    label: text(req.body.label) || req.file.originalname,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    url: `/api/uploads/${encodeURIComponent(req.dashboardId)}/${encodeURIComponent(req.file.filename)}`,
  });
});

app.get('/api/uploads/:dashboardId/:fileName', requireAuth, (req, res) => {
  const dashboard = getDashboardForUser(req.user.email, req.params.dashboardId);
  if (!dashboard) return res.status(403).send('No autorizado');
  const fileName = path.basename(req.params.fileName);
  res.sendFile(path.join(UPLOAD_DIR, dashboard.id, fileName));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Consejo escuchando en puerto ${PORT}`));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (!getAccessibleDashboards(req.user.email).length) return res.status(403).json({ error: 'Usuario no autorizado' });
  next();
}

function requireDashboardAccess(req, res, next) {
  const dashboardId = text(req.query.dashboard || req.body.dashboard || req.body.id);
  const dashboard = getDashboardForUser(req.user.email, dashboardId);
  if (!dashboard) return res.status(403).json({ error: 'Reunión no autorizada' });
  req.dashboardId = dashboard.id;
  req.dashboard = dashboard;
  next();
}

function requireDashboardAdmin(req, res, next) {
  requireDashboardAccess(req, res, () => {
    if (!isDashboardAdmin(req.user.email, req.dashboardId)) return res.status(403).json({ error: 'Solo administrador' });
    next();
  });
}

function buildMe(user) {
  const dashboards = getAccessibleDashboards(user.email).map((dashboard) => ({
    id: dashboard.id,
    name: dashboard.title || dashboard.name,
    isAdmin: isDashboardAdmin(user.email, dashboard.id),
  }));
  return { ...user, dashboards, activeDashboard: dashboards[0] && dashboards[0].id, isAdmin: dashboards.some((dashboard) => dashboard.isAdmin) };
}

function getDashboardForUser(email, requestedId) {
  const dashboards = getAccessibleDashboards(email);
  if (!requestedId) return dashboards[0] || null;
  return dashboards.find((dashboard) => dashboard.id === requestedId) || null;
}

function getAccessibleDashboards(email) {
  const normalizedEmail = String(email || '').toLowerCase();
  const store = readData();
  if (isSystemAdmin(normalizedEmail)) return Object.values(store.dashboards);
  return Object.values(store.dashboards).filter((dashboard) => {
    return array(dashboard.allowedUsers).includes(normalizedEmail) || array(dashboard.admins).includes(normalizedEmail);
  });
}

function isDashboardAdmin(email, dashboardId) {
  const normalizedEmail = String(email || '').toLowerCase();
  if (isSystemAdmin(normalizedEmail)) return true;
  const dashboard = readData().dashboards[dashboardId];
  return Boolean(dashboard && array(dashboard.admins).includes(normalizedEmail));
}

function isSystemAdmin(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase());
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) writeData(initialStore());
}

function readData() {
  ensureDataFileWithoutRecursion();
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const normalized = normalizeStore(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) writeData(normalized);
  return normalized;
}

function ensureDataFileWithoutRecursion() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initialStore(), null, 2));
}

function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function initialStore() {
  return { version: 2, passwordResetTokens: [], dashboards: Object.fromEntries(DASHBOARDS.map((dashboard) => [dashboard.id, defaultDashboard(dashboard)])) };
}

function defaultDashboard(definition) {
  return {
    id: definition.id,
    name: definition.name,
    title: definition.name,
    domains: [],
    admins: [INITIAL_ADMIN_EMAIL],
    allowedUsers: [INITIAL_ADMIN_EMAIL],
    users: { [INITIAL_ADMIN_EMAIL]: { email: INITIAL_ADMIN_EMAIL, name: 'Gabriel Bailly', type: 'admin', pushNotifications: false } },
    reminder: defaultReminder(),
    smtp: defaultSmtp(),
    frequentLinks: [
      { id: id(), title: 'Drive compartido', url: 'https://drive.google.com' },
      { id: id(), title: 'Calendario', url: 'https://calendar.google.com' },
    ],
    issues: [],
    agreements: [],
    textBlocks: [],
    customTables: [],
    layoutOrder: [],
  };
}

function normalizeStore(input) {
  const base = initialStore();
  if (!input || !input.dashboards) return base;
  // La versión 2 sustituye deliberadamente las reuniones anteriores.
  for (const definition of DASHBOARDS) {
    base.dashboards[definition.id] = sanitizeDashboard(input.dashboards[definition.id] || {}, base.dashboards[definition.id]);
  }
  base.version = 2;
  base.passwordResetTokens = array(input.passwordResetTokens).filter((item) => text(item.email) && /^[a-f0-9]{64}$/i.test(text(item.tokenHash)) && new Date(item.expiresAt) > new Date()).map((item) => ({ email: text(item.email).toLowerCase(), tokenHash: text(item.tokenHash), expiresAt: new Date(item.expiresAt).toISOString() }));
  return base;
}

function sanitizeDashboard(input, fallback) {
  const users = sanitizeUsers(input.users || {}, fallback.users || {});
  const admins = [...new Set([...parseList(input.admins || fallback.admins || []), ...Object.values(users).filter((user) => user.type === 'admin').map((user) => user.email)])];
  return {
    id: fallback.id,
    name: fallback.name,
    title: text(input.title) || fallback.title || fallback.name,
    domains: [],
    admins,
    allowedUsers: parseList(input.allowedUsers || fallback.allowedUsers || []),
    users,
    reminder: sanitizeReminder(input.reminder || fallback.reminder || defaultReminder()),
    smtp: sanitizeSmtp(input.smtp || {}, fallback.smtp || defaultSmtp()),
    frequentLinks: array(input.frequentLinks).map((item) => ({
      id: text(item.id) || id(),
      title: text(item.title),
      url: text(item.url),
    })),
    issues: array(input.issues).map((item) => ({
      id: text(item.id) || id(),
      date: text(item.date),
      title: text(item.title),
      addedBy: text(item.addedBy),
      status: ['nuevo', 'en progreso', 'realizado'].includes(item.status) ? item.status : 'nuevo',
      readBy: normalizeReaders(item.readBy),
      description: richText(item.description),
      attachments: array(item.attachments).map((attachment) => ({
        id: text(attachment.id) || id(),
        type: ['url', 'file'].includes(attachment.type) ? attachment.type : 'url',
        label: text(attachment.label),
        url: text(attachment.url),
        originalName: text(attachment.originalName),
        fileName: text(attachment.fileName),
      })),
      tasks: array(item.tasks).map((task) => ({
        id: text(task.id) || id(),
        task: text(task.task),
        assignees: parseList(task.assignees || []),
        dueDate: text(task.dueDate),
        status: ['nuevo', 'en progreso', 'realizado'].includes(task.status) ? task.status : 'nuevo',
      })),
      comments: array(item.comments).map((comment) => ({
        id: text(comment.id) || id(),
        author: text(comment.author).toLowerCase(),
        createdAt: text(comment.createdAt),
        text: text(comment.text),
      })).filter((comment) => comment.author && comment.text),
    })),
    agreements: array(input.agreements).map((item) => ({
      id: text(item.id) || id(),
      date: text(item.date),
      title: text(item.title),
      description: richText(item.description),
    })),
    textBlocks: array(input.textBlocks).map((block) => ({
      id: text(block.id) || id(),
      title: text(block.title) || 'Texto',
      content: richText(block.content),
    })),
    customTables: array(input.customTables).map((table) => ({
      id: text(table.id) || id(),
      title: text(table.title),
      fields: normalizeFields(table.fields),
      rows: array(table.rows).map((row) => ({
        id: text(row.id) || id(),
        values: Object.fromEntries(Object.entries(row.values || {}).map(([key, value]) => [text(key), normalizeValue(value)])),
      })),
    })),
    layoutOrder: parseOptions(input.layoutOrder || fallback.layoutOrder || []),
    collapsedSections: parseOptions(input.collapsedSections || fallback.collapsedSections || []),
    sectionTitles: sanitizeSectionTitles(input.sectionTitles || fallback.sectionTitles || {}),
  };
}

function defaultReminder() {
  return { enabled: false, days: [], time: '08:00', lastSentDate: '' };
}

function sanitizeSectionTitles(titles) {
  return Object.fromEntries(['links', 'issues', 'pendingTasks', 'agreements'].map((id) => [id, text(titles[id])]).filter(([, title]) => title));
}

function defaultSmtp() {
  return { host: '', port: 587, user: '', pass: '', from: '' };
}

function sanitizeSmtp(input, fallback = defaultSmtp()) {
  const pass = text(input.pass) || text(input.password) || fallback.pass || '';
  return {
    host: text(input.host) || fallback.host || '',
    port: Number(input.port || fallback.port || 587),
    user: text(input.user) || fallback.user || '',
    pass,
    from: text(input.from) || fallback.from || text(input.user) || fallback.user || '',
  };
}

function publicSmtp(smtp) {
  return { host: text(smtp.host), port: Number(smtp.port || 587), user: text(smtp.user), from: text(smtp.from), configured: Boolean(smtp.host && smtp.user && smtp.pass) };
}

function sanitizeReminder(input) {
  const validDays = ['1', '2', '3', '4', '5', '6', '0'];
  const time = /^\d{2}:\d{2}$/.test(text(input.time)) ? text(input.time) : '08:00';
  return {
    enabled: Boolean(input.enabled),
    days: array(input.days).map((day) => text(day)).filter((day) => validDays.includes(day)),
    time,
    lastSentDate: text(input.lastSentDate),
  };
}

function sanitizeUsers(users, fallback = {}) {
  return Object.fromEntries(Object.entries({ ...(fallback || {}), ...(users || {}) }).map(([email, user]) => {
    const normalizedEmail = text(email).toLowerCase();
    const current = fallback[normalizedEmail] || {};
    const passwordHash = text(user.passwordHash) || current.passwordHash || '';
    const type = text(user.type).toLowerCase() === 'admin' ? 'admin' : 'usuario';
    const photo = text(user.photo) || current.photo || '';
    const pushNotifications = user.pushNotifications === true || current.pushNotifications === true;
    return [normalizedEmail, { email: normalizedEmail, name: text(user.name) || current.name || normalizedEmail, type, pushNotifications, ...(photo ? { photo } : {}), ...(passwordHash ? { passwordHash } : {}) }];
  }).filter(([email]) => email));
}

function rememberUser(user) {
  const email = text(user.email).toLowerCase();
  if (!email) return;
  const store = readData();
  for (const dashboard of Object.values(store.dashboards)) {
    if (array(dashboard.allowedUsers).includes(email) || array(dashboard.admins).includes(email) || isSystemAdmin(email)) {
      dashboard.users[email] = { ...(dashboard.users[email] || {}), email, name: dashboard.users[email] && dashboard.users[email].name || text(user.name) || email, pushNotifications: Boolean(dashboard.users[email] && dashboard.users[email].pushNotifications), ...(text(user.photo) ? { photo: text(user.photo) } : {}) };
    }
  }
  writeData(store);
}

function startReminderScheduler() {
  if (process.env.NODE_ENV === 'test') return;
  setInterval(sendDueReminders, 60 * 1000).unref();
}

async function sendDueReminders() {
  const now = new Date();
  const day = String(now.getDay());
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = now.toISOString().slice(0, 10);
  const store = readData();
  let changed = false;
  for (const dashboard of Object.values(store.dashboards)) {
    const reminder = dashboard.reminder || defaultReminder();
    if (!reminder.enabled || reminder.time !== time || !reminder.days.includes(day) || reminder.lastSentDate === today) continue;
    const sent = await sendDashboardReminders(dashboard);
    if (!sent) continue;
    reminder.lastSentDate = today;
    dashboard.reminder = reminder;
    changed = true;
  }
  if (changed) writeData(store);
}

async function sendDashboardReminders(dashboard) {
  const smtp = getSmtpConfig(dashboard);
  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.log('SMTP no configurado. No se envían recordatorios de tareas.');
    return false;
  }
  const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } });
  const pendingByUser = pendingTasksByUser(dashboard);
  for (const [email, tasks] of Object.entries(pendingByUser)) {
    if (!tasks.length) continue;
    const user = dashboard.users[email] || { name: email };
    await transporter.sendMail({
      from: smtp.from,
      to: email,
      subject: `Tareas pendientes - ${dashboard.name}`,
      text: buildTasksEmailText(user.name, dashboard.name, tasks),
      html: buildTasksEmailHtml(user.name, dashboard.name, tasks),
    });
  }
  return true;
}

function getSmtpConfig(dashboard) {
  const smtp = dashboard.smtp || {};
  return {
    host: smtp.host || SMTP_HOST,
    port: Number(smtp.port || SMTP_PORT || 587),
    user: smtp.user || SMTP_USER,
    pass: smtp.pass || SMTP_PASS,
    from: smtp.from || SMTP_FROM,
  };
}

function globalSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function globalTransporter() {
  return nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function findEligibleUser(email) {
  if (!email) return null;
  const store = readData();
  for (const dashboard of Object.values(store.dashboards)) {
    if (array(dashboard.allowedUsers).includes(email) || array(dashboard.admins).includes(email)) {
      return dashboard.users[email] || { email, name: email };
    }
  }
  return null;
}

function allowResetRequest(req, email) {
  const now = Date.now();
  const keys = [`ip:${req.ip || req.socket.remoteAddress || ''}`, `email:${email}`];
  for (const key of keys) {
    const attempts = array(resetAttempts.get(key)).filter((time) => now - time < 15 * 60 * 1000);
    if (attempts.length >= 5) return false;
    attempts.push(now);
    resetAttempts.set(key, attempts);
  }
  return true;
}

function publicDashboard(dashboard) {
  return { ...dashboard, users: publicUsers(dashboard.users || {}), smtp: publicSmtp(dashboard.smtp || defaultSmtp()) };
}

function publicUsers(users) {
  return Object.fromEntries(Object.entries(users || {}).map(([email, user]) => [email, { email: user.email || email, name: user.name || email, photo: user.photo || '', type: user.type || 'usuario', pushNotifications: Boolean(user.pushNotifications), passwordConfigured: Boolean(user.passwordHash) }]));
}

async function notifyDashboardChanges(previous, dashboard) {
  const previousTasks = new Map(array(previous.issues).flatMap((issue) => array(issue.tasks).map((task) => [`${issue.id}:${task.id}`, task])));
  for (const issue of array(dashboard.issues)) {
    for (const task of array(issue.tasks)) {
      const before = previousTasks.get(`${issue.id}:${task.id}`);
      const recipients = array(task.assignees).filter((email) => !array(before && before.assignees).includes(email));
      if (recipients.length) await sendPush(dashboard, recipients, 'Nueva tarea asignada', task.task || 'Tarea sin título', taskUrl(dashboard.id, issue.id, task.id));
    }
  }
  const previousComments = new Set(array(previous.issues).flatMap((issue) => array(issue.comments).map((comment) => `${issue.id}:${comment.id}`)));
  for (const issue of array(dashboard.issues)) {
    for (const comment of array(issue.comments)) {
      if (previousComments.has(`${issue.id}:${comment.id}`)) continue;
      const recipients = knownDashboardUsers(dashboard).map((user) => user.email);
      await sendPush(dashboard, recipients, `Nuevo comentario en ${issue.title || 'un asunto'}`, comment.text, issueUrl(dashboard.id, issue.id));
    }
  }
}

async function sendPush(dashboard, recipients, title, body, url) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) return;
  const enabledRecipients = [...new Set(recipients.map((email) => text(email).toLowerCase()).filter((email) => dashboard.users[email] && dashboard.users[email].pushNotifications === true))];
  if (!enabledRecipients.length) return;
  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${ONESIGNAL_REST_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, target_channel: 'push', include_aliases: { external_id: enabledRecipients }, headings: { en: title, es: title }, contents: { en: body, es: body }, url }),
    });
    if (!response.ok) console.error('No se pudo enviar la notificación push:', await response.text());
  } catch (error) {
    console.error('Error al enviar la notificación push:', error.message);
  }
}

function findLocalUser(email, password) {
  if (!email || !password) return null;
  const store = readData();
  for (const dashboard of Object.values(store.dashboards)) {
    const user = dashboard.users[email];
    if (user && user.passwordHash && verifyPassword(password, user.passwordHash) && getAccessibleDashboards(email).length) {
      return { email, name: user.name || email, provider: 'local' };
    }
  }
  return null;
}

function knownDashboardUsers(dashboard) {
  const users = new Map();
  Object.values(dashboard.users || {}).forEach((user) => users.set(user.email, { email: user.email, name: user.name || user.email }));
  [...array(dashboard.admins), ...array(dashboard.allowedUsers)].forEach((email) => {
    if (email && !users.has(email)) users.set(email, { email, name: email });
  });
  for (const issue of array(dashboard.issues)) {
    for (const task of array(issue.tasks)) {
      for (const email of array(task.assignees)) {
        if (email && !users.has(email)) users.set(email, { email, name: email });
      }
    }
  }
  return [...users.values()];
}

function pendingTasksByUser(dashboard) {
  const result = {};
  for (const issue of array(dashboard.issues)) {
    for (const task of array(issue.tasks)) {
      if (task.status === 'realizado') continue;
      for (const email of array(task.assignees)) {
        if (!result[email]) result[email] = [];
        result[email].push({ ...task, assigneesText: formatAssignees(dashboard, task.assignees), issueTitle: issue.title, issueId: issue.id, issueUrl: issueUrl(dashboard.id, issue.id), taskUrl: taskUrl(dashboard.id, issue.id, task.id) });
      }
    }
  }
  return result;
}

function buildTasksEmailText(name, dashboardName, tasks) {
  return [
    `Hola ${name},`,
    '',
    `Estas son tus tareas pendientes en ${dashboardName}:`,
    '',
    ...tasks.map((task) => `- ${task.task || 'Tarea sin título'} | Asunto: ${task.issueTitle || 'Sin asunto'} | Responsables: ${task.assigneesText || 'Sin asignar'} | Fecha límite: ${formatDate(task.dueDate) || 'Sin fecha'} | Estado: ${task.status} | Enlace tarea: ${task.taskUrl} | Enlace asunto: ${task.issueUrl}`),
    '',
    'Instrucciones: pulsa el título de una tarea para abrirla en la web, o el asunto para abrir su detalle. Si no tienes la sesión iniciada, entra con Google y se abrirá el contenido después del acceso.',
    '',
    'Este correo se ha enviado automáticamente desde Consejo local.',
  ].join('\n');
}

function buildTasksEmailHtml(name, dashboardName, tasks) {
  const rows = tasks.length ? tasks.map((task) => `
    <tr>
      <td style="border-bottom:1px solid #ded6c8;padding:12px;vertical-align:top;"><a href="${escapeAttr(task.taskUrl)}" style="color:#153f4f;font-weight:800;text-decoration:underline;">${escapeHtml(task.task || 'Tarea sin título')}</a></td>
      <td style="border-bottom:1px solid #ded6c8;padding:12px;vertical-align:top;"><a href="${escapeAttr(task.issueUrl)}" style="color:#153f4f;font-weight:800;text-decoration:underline;">${escapeHtml(task.issueTitle || 'Sin asunto')}</a></td>
      <td style="border-bottom:1px solid #ded6c8;padding:12px;vertical-align:top;">${escapeHtml(task.assigneesText || 'Sin asignar')}</td>
      <td style="border-bottom:1px solid #ded6c8;padding:12px;vertical-align:top;">${escapeHtml(formatDate(task.dueDate) || 'Sin fecha')}</td>
      <td style="border-bottom:1px solid #ded6c8;padding:12px;vertical-align:top;"><span style="display:inline-block;border-radius:999px;background:${statusBackground(task.status)};color:${statusColor(task.status)};font-weight:700;padding:4px 10px;">${escapeHtml(task.status || 'nuevo')}</span></td>
    </tr>
  `).join('') : '<tr><td colspan="5" style="padding:18px;text-align:center;color:#667780;">No tienes tareas pendientes.</td></tr>';
  return `
    <div style="margin:0;padding:24px;background:#f4f1ea;color:#1e2a31;font-family:Inter,Arial,sans-serif;">
      <div style="max-width:820px;margin:0 auto;background:#fffdf8;border:1px solid #ded6c8;border-radius:18px;padding:24px;">
        <p style="margin:0 0 8px;color:#c47c36;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Consejo local</p>
        <h1 style="margin:0 0 8px;font-size:26px;">Tareas pendientes</h1>
        <p style="margin:0 0 20px;color:#667780;">Hola ${escapeHtml(name)}, estas son tus tareas pendientes en ${escapeHtml(dashboardName)}.</p>
        <table style="border-collapse:collapse;width:100%;background:white;">
          <thead>
            <tr>
              <th style="border-bottom:1px solid #ded6c8;color:#667780;font-size:12px;padding:12px;text-align:left;text-transform:uppercase;">Tarea</th>
              <th style="border-bottom:1px solid #ded6c8;color:#667780;font-size:12px;padding:12px;text-align:left;text-transform:uppercase;">Asunto</th>
              <th style="border-bottom:1px solid #ded6c8;color:#667780;font-size:12px;padding:12px;text-align:left;text-transform:uppercase;">Responsables</th>
              <th style="border-bottom:1px solid #ded6c8;color:#667780;font-size:12px;padding:12px;text-align:left;text-transform:uppercase;">Fecha límite</th>
              <th style="border-bottom:1px solid #ded6c8;color:#667780;font-size:12px;padding:12px;text-align:left;text-transform:uppercase;">Estado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:18px;padding:14px 16px;background:#f7f3eb;border:1px solid #ded6c8;border-radius:14px;color:#667780;line-height:1.45;">
          <strong style="color:#153f4f;">Instrucciones:</strong> pulsa sobre el título de cualquier tarea para abrirla directamente en la web, o sobre el asunto para abrir su detalle. Si no tienes la sesión iniciada, entra con Google y se abrirá el contenido después del acceso.
        </div>
      </div>
    </div>
  `;
}

function formatAssignees(dashboard, assignees = []) {
  if (!assignees.length) return 'Sin asignar';
  return assignees.map((email) => dashboard.users[email] && dashboard.users[email].name || email).join(', ');
}

function taskUrl(dashboardId, issueId, taskId) {
  const params = new URLSearchParams({ dashboard: dashboardId, issue: issueId, task: taskId });
  return `${APP_URL}/?${params.toString()}`;
}

function issueUrl(dashboardId, issueId) {
  const params = new URLSearchParams({ dashboard: dashboardId, issue: issueId });
  return `${APP_URL}/?${params.toString()}`;
}

function safeNextUrl(value) {
  const nextUrl = text(value);
  return nextUrl.startsWith('/?') ? nextUrl : '';
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year.slice(-2)}`;
}

function statusBackground(status) {
  if (status === 'realizado') return '#e5f5e9';
  if (status === 'en progreso') return '#fff1d8';
  return '#eaf1ff';
}

function statusColor(status) {
  if (status === 'realizado') return '#2b6b3d';
  if (status === 'en progreso') return '#8a5200';
  return '#244c8f';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#039;');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || '').split(':');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256');
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || '').trim();
}

function richText(value) {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'div', 'ul', 'ol', 'li', 'br']);
  return text(value).replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, name) => {
    const normalized = name.toLowerCase();
    if (!allowed.has(normalized)) return '';
    return tag.startsWith('</') ? `</${normalized}>` : `<${normalized}>`;
  });
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => text(item).toLowerCase()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function normalizeReaders(value) {
  const readers = array(value).map((reader) => {
    const item = reader && typeof reader === 'object' ? reader : { email: reader };
    const email = text(item.email).toLowerCase();
    return email ? { email, name: text(item.name) || email, photo: text(item.photo) } : null;
  }).filter(Boolean);
  return [...new Map(readers.map((reader) => [reader.email, reader])).values()];
}

function parseOptions(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeFields(fields) {
  return array(fields).map((field) => {
    if (typeof field === 'string') {
      const label = text(field);
      return label ? { id: label, label, type: 'texto', options: [] } : null;
    }
    const label = text(field.label || field.name || field.id);
    const type = ['texto', 'textoLargo', 'fecha', 'desplegable', 'check', 'url', 'documento'].includes(field.type) ? field.type : 'texto';
    return label ? { id: text(field.id) || label, label, type, options: parseOptions(field.options || []) } : null;
  }).filter(Boolean);
}

function normalizeValue(value) {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((document) => ({ id: text(document.id) || id(), type: 'file', label: text(document.label), url: text(document.url), originalName: text(document.originalName), fileName: text(document.fileName) })).filter((document) => document.url);
  return text(value);
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = app;
