const state = {
  me: null,
  data: null,
  config: null,
  modal: null,
  tables: {},
  activeDashboard: '',
  editingCommentId: '',
  oneSignal: null,
  oneSignalPromise: null,
  recentRows: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const modal = $('#modal');
const issueViewModal = $('#issueViewModal');
const modalFields = $('#modalFields');
const statuses = ['nuevo', 'en progreso', 'realizado'];
const fieldTypes = ['texto', 'textoLargo', 'fecha', 'desplegable', 'check', 'url', 'documento'];
const fieldTypeLabels = { texto: 'Texto', textoLargo: 'Texto largo', fecha: 'Fecha', desplegable: 'Desplegable', check: 'Check', url: 'URL', documento: 'Documento' };
const dashboardLogos = {
  'san-miguel': '/images/app-icon.png?v=20260822',
  'san-rafael': '/images/app-icon.png?v=20260822',
};
const dashboardThemes = {
  'san-miguel': { brand: '#e94e24', accent: '#f58a25', glow: '#ffe2cf' },
  'san-rafael': { brand: '#cf3928', accent: '#f4772b', glow: '#ffe8d8' },
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  state.config = await api('/api/config');
  $('#googleLogin').classList.toggle('hidden', !state.config.googleEnabled);
  bindEvents();
  showLoginMessage();
  if (new URLSearchParams(window.location.search).has('resetToken')) return showPasswordResetForm();
  await loadSession();
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#forgotPasswordButton').addEventListener('click', showPasswordResetRequestForm);
  $('#cancelPasswordResetButton').addEventListener('click', showLoginForm);
  $('#passwordResetRequestForm').addEventListener('submit', requestPasswordReset);
  $('#passwordResetConfirmForm').addEventListener('submit', confirmPasswordReset);
  $('#logoutButton').addEventListener('click', logout);
  $('#addLinkButton').addEventListener('click', () => openLinkModal());
  $('#editDashboardTitleButton').addEventListener('click', openDashboardTitleModal);
  $('#addIssueButton').addEventListener('click', () => openIssueModal());
  $('#exportIssuesButton').addEventListener('click', exportIssuesCsv);
  $('#exportPendingTasksButton').addEventListener('click', exportPendingTasksCsv);
  $('#addAgreementButton').addEventListener('click', () => openAgreementModal());
  $('#exportAgreementsButton').addEventListener('click', exportAgreementsCsv);
  $('#addTableButton').addEventListener('click', () => openTableModal());
  $('#addTextBlockButton').addEventListener('click', addTextBlock);
  $('#addUserButton').addEventListener('click', () => addUserRow());
  $('#saveUsersButton').addEventListener('click', saveUsers);
  $('#saveReminderButton').addEventListener('click', saveReminder);
  $('#testReminderButton').addEventListener('click', testReminderEmail);
  $('#usersTabButton').addEventListener('click', () => showAdminTab('users'));
  $('#remindersTabButton').addEventListener('click', () => showAdminTab('reminders'));
  $('#appearanceTabButton').addEventListener('click', () => showAdminTab('appearance'));
  $('#saveAppearanceButton').addEventListener('click', saveAppearance);
  $('#dashboardSelector').addEventListener('change', switchDashboard);
  $('#closeModal').addEventListener('click', closeEditModal);
  $('#closeIssueView').addEventListener('click', () => issueViewModal.close());
  $('#closeInstallPrompt').addEventListener('click', closeInstallPrompt);
  $('#dismissInstallPrompt').addEventListener('click', closeInstallPrompt);
  $('#installAppButton').addEventListener('click', openInstallPrompt);
  $('#enablePushButton').addEventListener('click', enablePushNotifications);
  $('#closeAppInstallNotice').addEventListener('click', () => $('#appInstallNotice').classList.add('hidden'));
  $('#deleteModal').addEventListener('click', deleteCurrent);
  $('#modalForm').addEventListener('submit', saveCurrent);
  $('#pushNotifications').addEventListener('change', savePushPreference);
  document.querySelectorAll('[data-collapse-section]').forEach((button) => button.addEventListener('click', () => toggleSection(button.dataset.collapseSection)));
  document.querySelectorAll('[data-edit-section-title]').forEach((button) => button.addEventListener('click', () => openSectionTitleModal(button.dataset.editSectionTitle)));
}

async function loadSession() {
  try {
    state.me = await api('/api/me');
    state.activeDashboard = requestedDashboard() || state.me.activeDashboard;
    state.data = normalizeData(await api(`/api/data?dashboard=${encodeURIComponent(state.activeDashboard)}`));
    showApp();
  } catch (error) {
    showLogin();
  }
}

function showLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  $('#googleLogin').href = `/api/auth/google?next=${encodeURIComponent(next)}`;
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showLoginMessage() {
  const reason = new URLSearchParams(window.location.search).get('login');
  if (reason === 'denied') $('#loginError').textContent = 'Usuario no autorizado para acceder con Google.';
  if (reason === 'google-disabled') $('#loginError').textContent = 'El acceso con Google no está configurado.';
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderAccountMenu();
  applyDashboardTheme();
  getTableState('issues').status = 'nuevo';
  $('#dashboardTitle').textContent = state.data.title || activeDashboard().name;
  renderDashboardLogo();
  renderDashboardSelector();
  $('#adminPanel').classList.toggle('hidden', !activeDashboard().isAdmin);
  $('#addLinkButton').classList.toggle('hidden', !activeDashboard().isAdmin);
  $('#editDashboardTitleButton').classList.toggle('hidden', !activeDashboard().isAdmin);
  $('#tablesControls').classList.toggle('hidden', !activeDashboard().isAdmin);
  $('#textBlocksControls').classList.toggle('hidden', !activeDashboard().isAdmin);
  $('#pushNotificationSetting').classList.toggle('hidden', !state.config.oneSignalAppId);
  $('#pushNotifications').checked = pushNotificationsEnabled();
  document.querySelectorAll('.section-edit-button').forEach((button) => button.classList.toggle('hidden', !activeDashboard().isAdmin));
  document.querySelectorAll('.section-export-button').forEach((button) => button.classList.toggle('hidden', !activeDashboard().isAdmin));
  renderUserRows();
  renderReminderSettings();
  renderAppearanceSettings();
  renderSmtpTestUsers();
  render();
  initializePush();
  openLinkedTask();
  renderAppInstallNotice();
}

function applyDashboardTheme() {
  const theme = dashboardThemes[state.activeDashboard] || dashboardThemes['san-miguel'];
  const root = document.documentElement.style;
  root.setProperty('--brand', theme.brand);
  root.setProperty('--brand-2', theme.accent);
  root.setProperty('--glow', theme.glow);
}

function appIsInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

function openInstallPrompt() {
  const agent = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(agent) || (agent.includes('Macintosh') && window.navigator.maxTouchPoints > 1);
  const instructions = ios
    ? 'En iPhone o iPad, abre Compartir y elige "Añadir a pantalla de inicio".'
    : /Android/.test(agent)
      ? 'En Android, abre el menu del navegador y elige "Instalar aplicacion" o "Añadir a pantalla de inicio".'
      : 'En el ordenador, usa el icono de instalar junto a la barra de direcciones o el menu del navegador y elige "Instalar aplicacion".';
  $('#installPromptInstructions').textContent = instructions;
  const prompt = $('#installPrompt');
  try {
    if (typeof prompt.showModal === 'function' && !prompt.open) prompt.showModal();
    else {
      prompt.classList.add('fallback-modal');
      prompt.setAttribute('open', '');
    }
  } catch (error) {
    prompt.classList.add('fallback-modal');
    prompt.setAttribute('open', '');
  }
}

function renderAppInstallNotice() {
  const needsInstall = !appIsInstalled();
  const needsPush = Boolean(state.config.oneSignalAppId) && !pushNotificationsEnabled();
  const notice = $('#appInstallNotice');
  if (!needsInstall && !needsPush) return notice.classList.add('hidden');
  const actions = [];
  if (needsInstall) actions.push('instalar Consejo local');
  if (needsPush) actions.push('activar las notificaciones');
  $('#appInstallNoticeTitle').textContent = 'Completa tu acceso';
  $('#appInstallNoticeText').textContent = `Te recomendamos ${actions.join(' y ')}.`;
  $('#installAppButton').classList.toggle('hidden', !needsInstall);
  $('#enablePushButton').classList.toggle('hidden', !needsPush);
  notice.classList.remove('hidden');
}

function closeInstallPrompt() {
  const prompt = $('#installPrompt');
  prompt.classList.remove('fallback-modal');
  if (typeof prompt.close === 'function' && prompt.open) prompt.close();
  else prompt.removeAttribute('open');
}

function renderAccountMenu() {
  const name = displayUser();
  const avatar = $('#userAvatar');
  $('#userName').textContent = name;
  $('#userEmail').textContent = state.me.email;
  $('#userAvatarFallback').textContent = (name || state.me.email || '?').trim().charAt(0).toUpperCase() || '?';
  avatar.alt = `Avatar de ${name}`;
  if (state.me.photo) {
    avatar.onerror = () => {
      avatar.classList.add('hidden');
      $('#userAvatarFallback').classList.remove('hidden');
    };
    avatar.src = state.me.photo;
    avatar.classList.remove('hidden');
    $('#userAvatarFallback').classList.add('hidden');
  } else {
    avatar.onerror = null;
    avatar.removeAttribute('src');
    avatar.classList.add('hidden');
    $('#userAvatarFallback').classList.remove('hidden');
  }
  const switchAccount = $('#switchGoogleAccount');
  switchAccount.classList.toggle('hidden', state.me.provider !== 'google' || !state.config.googleEnabled);
  switchAccount.href = `/api/auth/google?prompt=select_account&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

function pushNotificationsEnabled() {
  const user = state.data.users && state.data.users[state.me.email];
  return Boolean(user && user.pushNotifications);
}

function initializePush() {
  if (!state.config.oneSignalAppId) return Promise.resolve(null);
  if (state.oneSignal) {
    syncPushSubscription();
    return Promise.resolve(state.oneSignal);
  }
  if (state.oneSignalPromise) return state.oneSignalPromise;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  state.oneSignalPromise = new Promise((resolve) => window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      await OneSignal.init({ appId: state.config.oneSignalAppId, serviceWorkerPath: '/OneSignalSDKWorker.js', serviceWorkerParam: { scope: '/' } });
      await OneSignal.login(state.me.email);
      state.oneSignal = OneSignal;
      await syncPushSubscription();
      resolve(OneSignal);
    } catch (error) {
      console.error('No se pudo inicializar OneSignal:', error);
      resolve(null);
    }
  }));
  return state.oneSignalPromise;
}

async function syncPushSubscription() {
  if (!state.oneSignal) return;
  if (pushNotificationsEnabled()) await state.oneSignal.User.PushSubscription.optIn();
  else await state.oneSignal.User.PushSubscription.optOut();
}

async function savePushPreference(event) {
  const enabled = event.target.checked;
  try {
    const oneSignal = await initializePush();
    if (oneSignal && enabled) {
      await oneSignal.Notifications.requestPermission();
      await oneSignal.User.PushSubscription.optIn();
    } else if (oneSignal) await oneSignal.User.PushSubscription.optOut();
    await api(`/api/push-preference?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'PUT', body: { enabled } });
    state.data.users[state.me.email] = { ...(state.data.users[state.me.email] || {}), email: state.me.email, name: displayUser(), pushNotifications: enabled };
    renderAppInstallNotice();
  } catch (error) {
    event.target.checked = !enabled;
    showToast(error.message);
  }
}

async function enablePushNotifications() {
  const input = $('#pushNotifications');
  input.checked = true;
  await savePushPreference({ target: input });
}

function showAdminTab(tab) {
  $('#usersTab').classList.toggle('hidden', tab !== 'users');
  $('#remindersTab').classList.toggle('hidden', tab !== 'reminders');
  $('#appearanceTab').classList.toggle('hidden', tab !== 'appearance');
}

function renderDashboardLogo() {
  const logo = $('#dashboardLogo');
  const src = dashboardLogos[state.activeDashboard];
  logo.classList.add('hidden');
  logo.removeAttribute('src');
  if (!src) return;
  logo.onload = () => logo.classList.remove('hidden');
  logo.onerror = () => logo.classList.add('hidden');
  logo.src = src;
}

function renderDashboardSelector() {
  const dashboards = state.me.dashboards || [];
  const box = $('#dashboardSelectorBox');
  const selector = $('#dashboardSelector');
  box.classList.toggle('hidden', dashboards.length <= 1);
  selector.innerHTML = dashboards.map((dashboard) => `<option value="${escapeAttr(dashboard.id)}" ${dashboard.id === state.activeDashboard ? 'selected' : ''}>${escapeHtml(dashboard.name)}</option>`).join('');
}

async function switchDashboard(event) {
  state.activeDashboard = event.target.value;
  state.tables = {};
  state.data = normalizeData(await api(`/api/data?dashboard=${encodeURIComponent(state.activeDashboard)}`));
  clearTaskLink();
  showApp();
}

async function login(event) {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { email: $('#loginEmail').value, password: $('#loginPassword').value } });
    await loadSession();
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

function showLoginForm() {
  $('#loginForm').classList.remove('hidden');
  $('#forgotPasswordButton').classList.remove('hidden');
  $('#passwordResetRequestForm').classList.add('hidden');
  $('#passwordResetConfirmForm').classList.add('hidden');
  $('#googleLogin').classList.toggle('hidden', !state.config.googleEnabled);
  $('#loginError').textContent = '';
}

function showPasswordResetRequestForm() {
  $('#loginForm').classList.add('hidden');
  $('#forgotPasswordButton').classList.add('hidden');
  $('#googleLogin').classList.add('hidden');
  $('#passwordResetConfirmForm').classList.add('hidden');
  $('#passwordResetRequestForm').classList.remove('hidden');
  $('#loginError').textContent = '';
  $('#passwordResetEmail').focus();
}

function showPasswordResetForm() {
  showLogin();
  $('#loginForm').classList.add('hidden');
  $('#forgotPasswordButton').classList.add('hidden');
  $('#googleLogin').classList.add('hidden');
  $('#passwordResetRequestForm').classList.add('hidden');
  $('#passwordResetConfirmForm').classList.remove('hidden');
  $('#newPassword').focus();
}

async function requestPasswordReset(event) {
  event.preventDefault();
  try {
    const result = await api('/api/password-reset/request', { method: 'POST', body: { email: $('#passwordResetEmail').value } });
    $('#loginError').textContent = result.message;
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

async function confirmPasswordReset(event) {
  event.preventDefault();
  try {
    await api('/api/password-reset/confirm', { method: 'POST', body: { token: new URLSearchParams(window.location.search).get('resetToken'), password: $('#newPassword').value, confirmation: $('#confirmPassword').value } });
    window.history.replaceState({}, '', window.location.pathname);
    showLoginForm();
    $('#loginError').textContent = 'Contraseña actualizada. Ya puedes entrar.';
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

async function logout() {
  if (state.oneSignal) {
    try {
      await state.oneSignal.logout();
    } catch (error) {
      console.error('No se pudo cerrar la sesión de OneSignal:', error);
    }
  }
  await api('/api/logout', { method: 'POST' });
  state.me = null;
  state.data = null;
  state.oneSignal = null;
  state.oneSignalPromise = null;
  showLogin();
}

function render() {
  renderLinks();
  renderIssues();
  renderPendingTasks();
  renderAgreements();
  renderTextBlocks();
  renderCustomTables();
  ensurePublicFilters();
  renderSectionOrder();
  renderSectionTitles();
  renderCollapsedSections();
  renderHiddenSections();
}

function renderSectionTitles() {
  const titles = { links: 'Enlaces de uso frecuente', issues: 'Asuntos para la próxima reunión', pendingTasks: 'Tareas pendientes', agreements: 'Acuerdos' };
  Object.entries(titles).forEach(([id, fallback]) => {
    $(`#${id}Title`).textContent = state.data.sectionTitles[id] || fallback;
  });
}

function renderCollapsedSections() {
  const collapsed = new Set(state.data.collapsedSections || []);
  document.querySelectorAll('[data-section-id]').forEach((section) => {
    const isCollapsed = collapsed.has(section.dataset.sectionId);
    section.classList.toggle('collapsed-panel', isCollapsed);
    const button = section.querySelector(`[data-collapse-section="${section.dataset.sectionId}"]`);
    if (button) {
      button.textContent = isCollapsed ? '▶️' : '🔽';
      button.setAttribute('aria-label', `${isCollapsed ? 'Mostrar' : 'Ocultar'} sección`);
    }
  });
}

function renderHiddenSections() {
  const hidden = new Set(state.data.hiddenSections || []);
  ['links', 'agreements'].forEach((sectionId) => {
    const section = document.querySelector(`[data-section-id="${sectionId}"]`);
    if (section) section.classList.toggle('hidden', hidden.has(sectionId));
  });
}

async function toggleSection(sectionId) {
  const collapsed = new Set(state.data.collapsedSections || []);
  if (collapsed.has(sectionId)) collapsed.delete(sectionId);
  else collapsed.add(sectionId);
  state.data.collapsedSections = [...collapsed];
  await persist();
}

function ensurePublicFilters() {
  ensureFilterBefore($('#issuesBody').closest('.table-wrap'), 'issues');
  const pendingWrap = $('#pendingTasksBody').closest('.table-wrap');
  if (!$('#pendingTasksPanel').classList.contains('hidden')) ensureFilterBefore(pendingWrap, 'pendingTasks');
}

function renderLinks() {
  const list = $('#linksList');
  list.innerHTML = '';
  list.className = 'links-list';
  if (!state.data.frequentLinks.length) {
    list.innerHTML = '<p class="empty">Todavía no hay enlaces frecuentes.</p>';
    return;
  }
  state.data.frequentLinks.forEach((link) => {
    const row = document.createElement('div');
    row.className = 'link-row';
    row.dataset.linkId = link.id;
    if (activeDashboard().isAdmin) row.draggable = true;
    row.innerHTML = `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener" draggable="false">${escapeHtml(link.title || link.url)}</a>`;
    if (activeDashboard().isAdmin) row.append(button('Editar', () => openLinkModal(link), 'secondary small-button'));
    list.append(row);
  });
  if (activeDashboard().isAdmin) enableLinkDragging(list);
}

function renderIssues() {
  const columns = [
    { key: 'date', label: 'Fecha' },
    { key: 'title', label: 'Título' },
    { key: 'addedBy', label: 'Quién lo ha añadido' },
    { key: 'taskCount', label: 'Nº tareas' },
    { key: 'readBy', label: 'Leído' },
    { key: 'status', label: 'Estado' },
  ];
  const rows = filteredRows('issues', state.data.issues, columns, (issue, key) => {
    if (key === 'taskCount') return (issue.tasks || []).length;
    if (key === 'readBy') return (issue.readBy || []).map((reader) => reader.name || reader.email).join(', ');
    return issue[key];
  });
  const body = $('#issuesBody');
  body.innerHTML = '';
  ensureFilterBefore(body.closest('.table-wrap'), 'issues');
  renderSortableHeader(body.closest('table'), 'issues', columns);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No hay asuntos que coincidan.</td></tr>';
    return;
  }
  rows.forEach((issue) => {
    const row = document.createElement('tr');
    row.className = `clickable-row${isRecentRow('issues', issue.id) ? ' recent-row' : ''}`;
    row.dataset.tableRowId = issue.id;
    row.innerHTML = `<td>${escapeHtml(formatDate(issue.date))}</td><td>${tableText(issue.title)}</td><td>${userChip(issue.addedBy)}</td><td>${escapeHtml(String((issue.tasks || []).length))}</td><td>${issueReadCell(issue)}</td><td>${statusChip(issue.status)}</td>`;
    row.querySelectorAll('td').forEach((cell) => cell.addEventListener('click', () => openIssueView(issue)));
    row.querySelector('[data-mark-issue-read]').addEventListener('click', (event) => toggleIssueRead(event, issue.id));
    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.innerHTML = tableRowDragHandle();
    actions.append(button('Editar', (event) => {
      event.stopPropagation();
      openIssueModal(issue);
    }));
    row.append(actionCell(actions));
    body.append(row);
  });
  enableTableRowDragging(body, state.data.issues, 'issues');
}

function exportIssuesCsv() {
  const rows = state.data.issues || [];
  downloadCsv('asuntos.csv', ['Fecha', 'Título', 'Quién lo ha añadido', 'Nº tareas', 'Leído', 'Estado'], rows.map((issue) => [
    formatDate(issue.date),
    issue.title,
    userForValue(issue.addedBy).name,
    (issue.tasks || []).length,
    (issue.readBy || []).map((reader) => reader.name || reader.email).join(', '),
    issue.status,
  ]));
}

function issueReadCell(issue) {
  const readBy = issue.readBy || [];
  const hasRead = readBy.some((reader) => reader.email === String(state.me.email).toLowerCase());
  const avatars = readBy.map((reader) => `<span class="read-avatar" title="${escapeAttr(reader.name || reader.email)}" aria-label="Leído por ${escapeAttr(reader.name || reader.email)}">${userAvatar(reader)}</span>`).join('');
  const label = hasRead ? 'Marcar no leído' : 'Marcar leído';
  return `<div class="read-by"><button type="button" class="read-toggle" data-mark-issue-read title="${label}" aria-label="${label}">${hasRead ? '&#8634;' : '&#10003;'}</button><div class="read-avatars">${avatars}</div></div>`;
}

async function toggleIssueRead(event, issueId) {
  event.stopPropagation();
  const issue = state.data.issues.find((item) => item.id === issueId);
  if (!issue) return;
  const email = String(state.me.email || '').toLowerCase();
  if (!email) return;
  const previous = issue.readBy || [];
  const hasRead = previous.some((reader) => reader.email === email);
  issue.readBy = hasRead ? previous.filter((reader) => reader.email !== email) : [...previous, { email, name: state.me.name || email, photo: state.me.photo || '' }];
  try {
    await persist();
  } catch (error) {
    issue.readBy = previous;
    showToast(error.message);
  }
}

function openIssueView(issue) {
  setIssueViewHeaderAction();
  $('#issueViewTitle').textContent = issue.title || 'Sin título';
  $('#issueViewContent').innerHTML = `
    <dl class="issue-meta">
      <div><dt>Fecha</dt><dd>${escapeHtml(formatDate(issue.date) || 'Sin fecha')}</dd></div>
      <div><dt>Añadido por</dt><dd>${userChip(issue.addedBy)}</dd></div>
        <div><dt>Estado</dt><dd>${statusChip(issue.status)}</dd></div>
    </dl>
    <section class="issue-section">
      <h3>Descripción</h3>
      <div class="rich-text-content">${renderRichText(issue.description) || 'Sin descripción.'}</div>
    </section>
    <section class="issue-section">
      <h3>Documentos adjuntos</h3>
      ${renderIssueAttachments(issue.attachments || [])}
    </section>
    <section class="issue-section">
      <h3>Tareas</h3>
      ${renderIssueTasks(issue.tasks || [])}
    </section>
    <section class="issue-section comments-section">
      <h3>Comentarios</h3>
      ${renderIssueComments(issue.comments || [])}
      <form id="issueCommentForm" class="comment-form">
        <textarea name="comment" rows="3" placeholder="Escribe un comentario" required></textarea>
        <button type="submit">Añadir comentario</button>
      </form>
    </section>
  `;
  $('#issueCommentForm').addEventListener('submit', (event) => addIssueComment(event, issue.id));
  $('#issueViewContent').querySelectorAll('[data-edit-comment]').forEach((button) => button.addEventListener('click', () => editIssueComment(issue.id, button.dataset.editComment)));
  $('#issueViewContent').querySelectorAll('[data-delete-comment]').forEach((button) => button.addEventListener('click', () => deleteIssueComment(issue.id, button.dataset.deleteComment)));
  $('#issueViewContent').querySelectorAll('[data-save-comment]').forEach((form) => form.addEventListener('submit', (event) => saveIssueComment(event, issue.id, form.dataset.saveComment)));
  $('#issueViewContent').querySelectorAll('[data-cancel-comment]').forEach((button) => button.addEventListener('click', () => {
    state.editingCommentId = '';
    openIssueView(issue);
  }));
  if (!issueViewModal.open) issueViewModal.showModal();
}

function renderIssueAttachments(attachments) {
  if (!attachments.length) return '<p class="muted-text">No hay documentos adjuntos.</p>';
  return `<div class="attachment-list">${attachments.map((attachment) => {
    const label = attachment.label || attachment.originalName || attachment.url || 'Documento';
    const isFile = attachment.type === 'file' || attachment.fileName;
    return `<a class="attachment-link" href="${escapeAttr(attachment.url)}" target="_blank" rel="noopener"${isFile ? ' download' : ''}>${escapeHtml(label)}<span>${isFile ? 'Descargar' : 'Visitar'}</span></a>`;
  }).join('')}</div>`;
}

function renderIssueTasks(tasks) {
  if (!tasks.length) return '<p class="muted-text">No hay tareas añadidas.</p>';
  return `<div class="task-view-list">${tasks.map((task) => `
    <article class="task-view-card">
      <div><strong>${escapeHtml(task.task || 'Tarea sin título')}</strong></div>
      <dl>
        <div><dt>Responsables</dt><dd>${escapeHtml(formatAssignees(task.assignees))}</dd></div>
        <div><dt>Fecha límite</dt><dd>${escapeHtml(formatDate(task.dueDate) || 'Sin fecha')}</dd></div>
        <div><dt>Estado</dt><dd>${statusChip(task.status)}</dd></div>
      </dl>
    </article>
  `).join('')}</div>`;
}

function renderIssueComments(comments) {
  if (!comments.length) return '<p class="muted-text">Todavía no hay comentarios.</p>';
  return `<div class="comment-list">${comments.map((comment) => {
    const own = String(comment.author).toLowerCase() === String(state.me.email).toLowerCase();
    const editing = state.editingCommentId === comment.id;
    return `<article class="comment-message"><div class="comment-meta">${userChip(comment.author)}<time datetime="${escapeAttr(comment.createdAt)}">${escapeHtml(formatDateTime(comment.createdAt))}</time></div>${editing ? `<form class="comment-edit-form" data-save-comment="${escapeAttr(comment.id)}"><textarea name="comment" rows="3" required>${escapeHtml(comment.text)}</textarea><div class="link-actions"><button type="button" class="secondary" data-cancel-comment>Cancelar</button><button type="submit">Guardar</button></div></form>` : `<p>${escapeHtml(comment.text)}</p>`}${own && !editing ? `<div class="comment-actions"><button type="button" class="secondary small-button" data-edit-comment="${escapeAttr(comment.id)}">Editar</button><button type="button" class="danger small-button" data-delete-comment="${escapeAttr(comment.id)}">Eliminar</button></div>` : ''}</article>`;
  }).join('')}</div>`;
}

async function addIssueComment(event, issueId) {
  event.preventDefault();
  const form = event.currentTarget;
  const text = form.elements.comment.value.trim();
  if (!text) return;
  const issue = state.data.issues.find((item) => item.id === issueId);
  if (!issue) return;
  issue.comments = issue.comments || [];
  issue.comments.push({ id: uid(), author: state.me.email, createdAt: new Date().toISOString(), text });
  try {
    await persist();
    state.editingCommentId = '';
    openIssueView(state.data.issues.find((item) => item.id === issueId));
  } catch (error) {
    showToast(error.message);
  }
}

function editIssueComment(issueId, commentId) {
  state.editingCommentId = commentId;
  openIssueView(state.data.issues.find((item) => item.id === issueId));
}

async function saveIssueComment(event, issueId, commentId) {
  event.preventDefault();
  const text = event.currentTarget.elements.comment.value.trim();
  if (!text) return;
  const issue = state.data.issues.find((item) => item.id === issueId);
  const comment = issue && issue.comments.find((item) => item.id === commentId && String(item.author).toLowerCase() === String(state.me.email).toLowerCase());
  if (!comment) return;
  comment.text = text;
  try {
    await persist();
    state.editingCommentId = '';
    openIssueView(state.data.issues.find((item) => item.id === issueId));
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteIssueComment(issueId, commentId) {
  const issue = state.data.issues.find((item) => item.id === issueId);
  const comment = issue && issue.comments.find((item) => item.id === commentId && String(item.author).toLowerCase() === String(state.me.email).toLowerCase());
  if (!comment || !window.confirm('¿Eliminar este comentario?')) return;
  remove(issue.comments, commentId);
  try {
    await persist();
    state.editingCommentId = '';
    openIssueView(state.data.issues.find((item) => item.id === issueId));
  } catch (error) {
    showToast(error.message);
  }
}

function renderPendingTasks() {
  const tasks = pendingTasks();
  $('#pendingTasksPanel').classList.toggle('hidden', !tasks.length);
  if (!tasks.length) return;
  const columns = [
    { key: 'issueTitle', label: 'Asunto' },
    { key: 'task', label: 'Tarea' },
    { key: 'assigneesText', label: 'Quién/es la deben realizar' },
    { key: 'dueDateText', label: 'Fecha límite' },
    { key: 'status', label: 'Estado' },
  ];
  const rows = filteredRows('pendingTasks', tasks, columns);
  const body = $('#pendingTasksBody');
  body.innerHTML = '';
  ensureFilterBefore(body.closest('.table-wrap'), 'pendingTasks');
  renderSortableHeader(body.closest('table'), 'pendingTasks', columns);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No hay tareas pendientes que coincidan.</td></tr>';
    return;
  }
  rows.forEach((task) => {
    const row = document.createElement('tr');
    row.className = 'clickable-row';
    row.innerHTML = `<td>${issueChip(task.issueTitle)}</td><td>${tableText(task.task)}</td><td>${tableText(task.assigneesText)}</td><td>${escapeHtml(task.dueDateText)}</td><td>${statusChip(task.status)}</td>`;
    row.querySelectorAll('td').forEach((cell) => cell.addEventListener('click', () => openTaskView(task)));
    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.append(button('Editar', (event) => {
      event.stopPropagation();
      openTaskModal(task);
    }));
    actions.append(button('Eliminar', (event) => {
      event.stopPropagation();
      deleteTask(task);
    }, 'danger'));
    row.append(actionCell(actions));
    body.append(row);
  });
}

function exportPendingTasksCsv() {
  downloadCsv('tareas-pendientes.csv', ['Tarea', 'Asunto', 'Quién/es la deben realizar', 'Fecha límite', 'Estado'], pendingTasks().map((task) => [task.task, task.issueTitle, task.assigneesText, task.dueDateText, task.status]));
}

function pendingTasks() {
  return (state.data.issues || []).flatMap((issue) => (issue.tasks || []).filter((task) => task.status !== 'realizado').map((task) => ({
    ...task,
    task: task.task || 'Tarea sin título',
    assigneesText: formatAssignees(task.assignees),
    dueDate: task.dueDate || '',
    dueDateText: formatDate(task.dueDate),
    status: task.status || 'nuevo',
    issueTitle: issue.title,
    issueId: issue.id,
    taskId: task.id,
  })));
}

function openTaskView(task) {
  const edit = button('Editar', () => {
    issueViewModal.close();
    openTaskModal(task);
  });
  setIssueViewHeaderAction(edit);
  $('#issueViewTitle').textContent = task.task || 'Tarea sin título';
  $('#issueViewContent').innerHTML = `
    <dl class="issue-meta task-meta">
      <div><dt>Asunto</dt><dd>${issueChip(task.issueTitle, task.issueId)}</dd></div>
      <div><dt>Responsables</dt><dd>${escapeHtml(task.assigneesText || 'Sin asignar')}</dd></div>
      <div><dt>Fecha límite</dt><dd>${escapeHtml(task.dueDateText || 'Sin fecha')}</dd></div>
      <div><dt>Estado</dt><dd>${statusChip(task.status)}</dd></div>
    </dl>
    <div class="actions"><button type="button" id="deleteTaskFromView" class="danger">Eliminar</button></div>
  `;
  $('#deleteTaskFromView').addEventListener('click', () => {
    issueViewModal.close();
    deleteTask(task);
  });
  issueViewModal.showModal();
}

function setIssueViewHeaderAction(action = null) {
  const actions = $('#issueViewHeaderActions');
  actions.querySelector('[data-task-view-edit]')?.remove();
  if (!action) return;
  action.dataset.taskViewEdit = 'true';
  actions.insertBefore(action, $('#closeIssueView'));
}

function openLinkedTask() {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('task');
  const issueId = params.get('issue');
  if (!issueId || params.get('dashboard') !== state.activeDashboard) return;
  if (!taskId) {
    const issue = (state.data.issues || []).find((item) => item.id === issueId);
    if (!issue) return;
    clearTaskLink();
    openIssueView(issue);
    return;
  }
  const task = linkedTask(params);
  if (!task) return;
  clearTaskLink();
  openTaskView(task);
}

function linkedTask(params) {
  const issueId = params.get('issue');
  const taskId = params.get('task');
  const issue = (state.data.issues || []).find((item) => !issueId || item.id === issueId);
  if (!issue) return null;
  const task = (issue.tasks || []).find((item) => item.id === taskId);
  if (!task) return null;
  return {
    ...task,
    task: task.task || 'Tarea sin título',
    assigneesText: formatAssignees(task.assignees),
    dueDate: task.dueDate || '',
    dueDateText: formatDate(task.dueDate),
    status: task.status || 'nuevo',
    issueTitle: issue.title,
    issueId: issue.id,
    taskId: task.id,
  };
}

function clearTaskLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('task') && !params.has('issue') && !params.has('dashboard')) return;
  params.delete('task');
  params.delete('issue');
  params.delete('dashboard');
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  window.history.replaceState({}, '', nextUrl);
}

function renderAgreements() {
  const columns = [
    { key: 'date', label: 'Fecha del acuerdo' },
    { key: 'title', label: 'Título' },
    { key: 'description', label: 'Descripción' },
    { key: 'attachments', label: 'Adjuntos' },
  ];
  const rows = filteredRows('agreements', state.data.agreements, columns, (agreement, key) => key === 'attachments' ? (agreement.attachments || []).map((attachment) => attachment.label || attachment.url).join(' ') : agreement[key]);
  const body = $('#agreementsBody');
  body.innerHTML = '';
  ensureFilterBefore(body.closest('.table-wrap'), 'agreements');
  renderSortableHeader(body.closest('table'), 'agreements', columns);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No hay acuerdos que coincidan.</td></tr>';
    return;
  }
  rows.forEach((agreement) => {
    const row = document.createElement('tr');
    row.className = isRecentRow('agreements', agreement.id) ? 'recent-row' : '';
    row.dataset.tableRowId = agreement.id;
    const attachments = agreement.attachments && agreement.attachments.length ? renderIssueAttachments(agreement.attachments) : '';
    row.innerHTML = `<td>${escapeHtml(formatDate(agreement.date))}</td><td>${tableText(agreement.title)}</td><td>${tableText(plainText(agreement.description))}</td><td>${attachments}</td>`;
    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.innerHTML = tableRowDragHandle();
    actions.append(button('Editar', () => openAgreementModal(agreement)));
    row.append(actionCell(actions));
    body.append(row);
  });
  enableTableRowDragging(body, state.data.agreements, 'agreements');
}

function exportAgreementsCsv() {
  downloadCsv('acuerdos.csv', ['Fecha del acuerdo', 'Título', 'Descripción', 'Adjuntos'], (state.data.agreements || []).map((agreement) => [formatDate(agreement.date), agreement.title, plainText(agreement.description), (agreement.attachments || []).map((attachment) => attachment.url).join(', ')]));
}

function renderTextBlocks() {
  const list = $('#sectionsList');
  list.querySelectorAll(':scope > [data-text-block-panel]').forEach((panel) => panel.remove());
  (state.data.textBlocks || []).forEach((block) => {
    const panel = document.createElement('article');
    panel.className = 'panel text-block-panel';
    panel.dataset.sectionId = textBlockSectionId(block.id);
    panel.dataset.textBlockPanel = 'true';
    const header = document.createElement('div');
    header.className = 'section-title';
    header.innerHTML = `<div class="section-heading">${collapseButton(textBlockSectionId(block.id))}<h2>${escapeHtml(block.title || 'Texto')}</h2></div>`;
    header.querySelector('[data-collapse-section]').addEventListener('click', () => toggleSection(textBlockSectionId(block.id)));
    if (activeDashboard().isAdmin) header.querySelector('.section-heading').append(button('✏️', () => openTextBlockTitleModal(block), 'icon-button'));
    if (activeDashboard().isAdmin) header.append(button('Eliminar', async () => {
      if (!window.confirm('¿Eliminar este bloque de texto?')) return;
      remove(state.data.textBlocks, block.id);
      state.data.layoutOrder = state.data.layoutOrder.filter((id) => id !== textBlockSectionId(block.id));
      await persist();
    }, 'danger'));
    panel.append(header);
    if (activeDashboard().isAdmin) {
      const editor = richTextField(`textBlock:${block.id}`, '', block.content, true);
      editor.querySelector('[data-rich-text]').addEventListener('blur', async () => {
        const content = editor.querySelector('[data-rich-text]').innerHTML.trim();
        if (content === block.content) return;
        block.content = content;
        await persist();
      });
      panel.append(editor);
    } else panel.append(html(`<div class="rich-text-content">${renderRichText(block.content)}</div>`));
    list.append(panel);
  });
}

async function addTextBlock() {
  if (!activeDashboard().isAdmin) return;
  const block = { id: uid(), title: 'Texto', content: '<p>Escribe aquí.</p>' };
  state.data.textBlocks.push(block);
  state.data.layoutOrder = [textBlockSectionId(block.id), ...completeLayoutOrder().filter((id) => id !== textBlockSectionId(block.id))];
  await persist();
}

function renderCustomTables() {
  const list = $('#sectionsList');
  list.querySelectorAll(':scope > [data-custom-table-panel]').forEach((panel) => panel.remove());
  state.data.customTables.forEach((table) => {
    const panel = document.createElement('article');
    panel.className = 'panel';
    panel.dataset.sectionId = customSectionId(table.id);
    panel.dataset.customTablePanel = 'true';
    const header = document.createElement('div');
    header.className = 'section-title';
    header.innerHTML = `<div class="section-heading">${collapseButton(customSectionId(table.id))}<h2>${escapeHtml(table.title)}</h2></div>`;
    header.querySelector('[data-collapse-section]').addEventListener('click', () => toggleSection(customSectionId(table.id)));
    if (activeDashboard().isAdmin) header.querySelector('.section-heading').append(exportIconButton(() => exportCustomTableCsv(table)));
    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.append(button('Añadir fila', () => openCustomRowModal(table)));
    if (activeDashboard().isAdmin) actions.append(button('Editar tabla', () => openTableModal(table)));
    header.append(actions);
    panel.append(header);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const columns = table.fields.map((field) => ({ key: field.id, label: field.label, type: field.type }));
    const rows = filteredRows(table.id, table.rows, columns, (row, key) => formatCustomValue(table.fields.find((field) => field.id === key), row.values[key]));
    const htmlRows = rows.length ? rows.map((row) => `<tr class="clickable-row${isRecentRow(table.id, row.id) ? ' recent-row' : ''}" data-view-row="${escapeAttr(row.id)}" data-table-row-id="${escapeAttr(row.id)}">${table.fields.map((field) => `<td>${customTableCell(field, row.values[field.id])}</td>`).join('')}<td>${tableRowDragHandle()}<button data-row="${escapeAttr(row.id)}">Editar</button></td></tr>`).join('') : `<tr><td colspan="${table.fields.length + 1}" class="empty">Sin filas que coincidan.</td></tr>`;
    wrap.innerHTML = `<table><thead><tr>${columns.map((column) => headerButton(table.id, column)).join('')}<th></th></tr></thead><tbody>${htmlRows}</tbody></table>`;
    wrap.prepend(filterBar(table.id));
    wrap.querySelectorAll('tr[data-view-row] td:not(:last-child)').forEach((cell) => cell.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      openCustomRowView(table, table.rows.find((row) => row.id === cell.parentElement.dataset.viewRow));
    }));
    wrap.querySelectorAll('button[data-row]').forEach((edit) => edit.addEventListener('click', () => openCustomRowModal(table, table.rows.find((row) => row.id === edit.dataset.row))));
    enableTableRowDragging(wrap.querySelector('tbody'), table.rows, table.id);
    panel.append(wrap);
    list.append(panel);
  });
}

function exportCustomTableCsv(table) {
  downloadCsv(`${safeFileName(table.title || 'tabla')}.csv`, table.fields.map((field) => field.label), table.rows.map((row) => table.fields.map((field) => formatCustomValue(field, row.values[field.id]))));
}

function exportIconButton(onClick) {
  const icon = button('↓', onClick, 'icon-button section-export-button');
  icon.setAttribute('aria-label', 'Exportar tabla a CSV');
  return icon;
}

function downloadCsv(fileName, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function safeFileName(value) {
  return String(value || 'tabla').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'tabla';
}

function renderSectionOrder() {
  const list = $('#sectionsList');
  const sections = new Map([...list.querySelectorAll(':scope > [data-section-id]')].map((section) => [section.dataset.sectionId, section]));
  const order = completeLayoutOrder();
  order.forEach((id) => {
    const section = sections.get(id);
    if (section) list.append(section);
    if (id === 'agreements') list.append($('#tablesControls'));
  });
  list.querySelectorAll(':scope > [data-section-id]').forEach((section) => setupSectionDrag(section));
}

function completeLayoutOrder() {
  const defaults = ['links', 'issues', 'pendingTasks', 'agreements', ...(state.data.textBlocks || []).map((block) => textBlockSectionId(block.id)), ...(state.data.customTables || []).map((table) => customSectionId(table.id))];
  const stored = state.data.layoutOrder || [];
  const ordered = stored.filter((id) => defaults.includes(id));
  if (!ordered.includes('links')) ordered.unshift('links');
  return [...ordered, ...defaults.filter((id) => !ordered.includes(id))];
}

function setupSectionDrag(section) {
  const canDrag = activeDashboard().isAdmin;
  section.classList.toggle('draggable-section', canDrag);
  section.draggable = false;
  const heading = section.querySelector('.section-heading');
  if (!canDrag) {
    heading?.querySelector('[data-drag-handle]')?.remove();
    return;
  }
  if (heading && !heading.querySelector('[data-drag-handle]')) heading.prepend(html('<span class="drag-handle" data-drag-handle title="Arrastrar sección">::</span>'));
  if (section.dataset.dragReady) return;
  section.dataset.dragReady = 'true';
  section.querySelector('[data-drag-handle]').addEventListener('pointerdown', (event) => startSectionDrag(event, section));
}

function startSectionDrag(event, section) {
  if (!activeDashboard().isAdmin) return;
  event.preventDefault();
  section.classList.add('dragging');
  const list = $('#sectionsList');
  let moved = false;
  const move = (moveEvent) => {
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-section-id]');
    if (!target || target === section || target.parentElement !== list) return;
    const after = moveEvent.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    list.insertBefore(section, after ? target.nextSibling : target);
    moved = true;
  };
  const finish = async () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    section.classList.remove('dragging');
    if (!moved) return;
    state.data.layoutOrder = currentLayoutOrder();
    await persist();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish, { once: true });
  document.addEventListener('pointercancel', finish, { once: true });
}

function currentLayoutOrder() {
  return [...$('#sectionsList').querySelectorAll('[data-section-id]')].map((section) => section.dataset.sectionId);
}

function customSectionId(id) {
  return `custom:${id}`;
}

function textBlockSectionId(id) {
  return `text:${id}`;
}

function collapseButton(sectionId) {
  return `<button type="button" class="collapse-button" data-collapse-section="${escapeAttr(sectionId)}" aria-label="Ocultar sección">🔽</button>`;
}

function enableLinkDragging(list) {
  if (list.dataset.dragReady) return;
  list.dataset.dragReady = 'true';
  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-link-id]');
    if (!row) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.linkId);
    row.classList.add('dragging');
  });
  list.addEventListener('dragend', (event) => event.target.closest('[data-link-id]')?.classList.remove('dragging'));
  list.addEventListener('dragover', (event) => event.preventDefault());
  list.addEventListener('drop', async (event) => {
    if (!activeDashboard().isAdmin) return;
    event.preventDefault();
    const fromId = event.dataTransfer.getData('text/plain');
    const toRow = event.target.closest('[data-link-id]');
    if (!fromId || !toRow || fromId === toRow.dataset.linkId) return;
    reorderByIds(state.data.frequentLinks, fromId, toRow.dataset.linkId);
    await persist();
  });
}

function reorderByIds(list, fromId, toId) {
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
}

function tableRowDragHandle() {
  return activeDashboard().isAdmin ? '<span class="table-row-drag-handle" data-table-row-drag-handle title="Arrastrar registro">::</span>' : '';
}

function enableTableRowDragging(body, rows, tableId) {
  if (!activeDashboard().isAdmin || !body) return;
  body.querySelectorAll('[data-table-row-drag-handle]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => startTableRowDrag(event, body, rows, tableId, handle.closest('[data-table-row-id]')));
  });
}

function startTableRowDrag(event, body, rows, tableId, row) {
  if (!row) return;
  event.preventDefault();
  getTableState(tableId).sortKey = '';
  row.classList.add('dragging');
  let moved = false;
  const move = (moveEvent) => {
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-table-row-id]');
    if (!target || target === row || target.parentElement !== body) return;
    const after = moveEvent.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    body.insertBefore(row, after ? target.nextSibling : target);
    reorderTableRows(rows, row.dataset.tableRowId, target.dataset.tableRowId, after);
    moved = true;
  };
  const finish = async () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    row.classList.remove('dragging');
    if (!moved) return;
    await persist();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish, { once: true });
  document.addEventListener('pointercancel', finish, { once: true });
}

function reorderTableRows(rows, fromId, toId, after) {
  const fromIndex = rows.findIndex((item) => item.id === fromId);
  if (fromIndex < 0 || !rows.some((item) => item.id === toId)) return;
  const [item] = rows.splice(fromIndex, 1);
  const nextIndex = rows.findIndex((entry) => entry.id === toId) + (after ? 1 : 0);
  rows.splice(nextIndex, 0, item);
}

function renderSortableHeader(table, tableId, columns, hasActions = true) {
  table.querySelector('thead tr').innerHTML = `${columns.map((column) => headerButton(tableId, column)).join('')}${hasActions ? '<th></th>' : ''}`;
}

function headerButton(tableId, column) {
  const tableState = getTableState(tableId);
  const mark = tableState.sortKey === column.key ? (tableState.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th><button class="sort-button" data-sort-table="${escapeAttr(tableId)}" data-sort-key="${escapeAttr(column.key)}">${escapeHtml(column.label)}${mark}</button></th>`;
}

document.addEventListener('click', (event) => {
  const sort = event.target.closest('[data-sort-table]');
  if (!sort) return;
  const tableState = getTableState(sort.dataset.sortTable);
  tableState.sortDir = tableState.sortKey === sort.dataset.sortKey && tableState.sortDir === 'asc' ? 'desc' : 'asc';
  tableState.sortKey = sort.dataset.sortKey;
  render();
});

document.addEventListener('click', (event) => {
  const issueLink = event.target.closest('[data-open-issue]');
  if (!issueLink || !state.data) return;
  const issue = state.data.issues.find((item) => item.id === issueLink.dataset.openIssue);
  if (!issue) return;
  event.preventDefault();
  event.stopPropagation();
  openIssueView(issue);
});

document.addEventListener('click', (event) => {
  const status = event.target.closest('[data-status-filter]');
  if (status) {
    const tableState = getTableState(status.dataset.filterTable);
    tableState.status = tableState.status === status.dataset.statusFilter ? '' : status.dataset.statusFilter;
    render();
    return;
  }
  const mine = event.target.closest('[data-mine-filter]');
  if (mine) {
    const tableState = getTableState(mine.dataset.filterTable);
    tableState.mine = !tableState.mine;
    render();
  }
});

function ensureFilterBefore(wrap, tableId) {
  const panel = wrap.parentElement;
  const existing = panel.querySelector(`[data-filter-for="${tableId}"]`);
  if (existing) {
    refreshFilterControls(existing, tableId);
    return;
  }
  panel.insertBefore(filterBar(tableId), wrap);
}

function filterBar(tableId) {
  const bar = document.createElement('div');
  bar.className = 'table-filter-bar';
  bar.dataset.filterFor = tableId;
  bar.append(filterInput(tableId));
  bar.append(button('Limpiar', () => {
    getTableState(tableId).filter = '';
    render();
  }, 'secondary small-button'));
  refreshFilterControls(bar, tableId);
  return bar;
}

function refreshFilterControls(bar, tableId) {
  bar.querySelector('.quick-filters')?.remove();
  bar.querySelector('.mine-filter')?.remove();
  if (['issues', 'pendingTasks'].includes(tableId)) bar.append(statusFilterChips(tableId));
  if (tableId === 'pendingTasks') bar.append(mineFilterChip(tableId));
}

function filterInput(tableId) {
  const input = document.createElement('input');
  input.className = 'table-filter';
  input.dataset.filterFor = tableId;
  input.placeholder = 'Filtrar tabla...';
  input.value = getTableState(tableId).filter;
  input.addEventListener('input', () => {
    getTableState(tableId).filter = input.value;
    const cursor = input.selectionStart;
    render();
    window.requestAnimationFrame(() => {
      const next = [...document.querySelectorAll('input[data-filter-for]')].find((field) => field.dataset.filterFor === tableId);
      if (!next) return;
      next.focus();
      next.setSelectionRange(cursor, cursor);
    });
  });
  return input;
}

function statusFilterChips(tableId) {
  const tableState = getTableState(tableId);
  const list = document.createElement('div');
  list.className = 'chip-list quick-filters';
  statuses.forEach((status) => {
    list.append(html(`<button type="button" class="status status-filter status-${statusClass(status)} ${tableState.status === status ? 'selected' : ''}" data-filter-table="${escapeAttr(tableId)}" data-status-filter="${escapeAttr(status)}">${escapeHtml(status)}</button>`));
  });
  return list;
}

function mineFilterChip(tableId) {
  const tableState = getTableState(tableId);
  return html(`<button type="button" class="chip mine-filter ${tableState.mine ? 'selected' : ''}" data-filter-table="${escapeAttr(tableId)}" data-mine-filter="1">Mis tareas</button>`);
}

function filteredRows(tableId, rows, columns, customValue = (row, key) => row[key]) {
  const tableState = getTableState(tableId);
  const query = tableState.filter.toLowerCase().trim();
  const visible = rows.filter((row) => {
    const matchesText = !query || columns.some((column) => String(customValue(row, column.key) || '').toLowerCase().includes(query));
    const matchesStatus = !tableState.status || row.status === tableState.status;
    const currentEmail = String(state.me.email || '').toLowerCase();
    const matchesMine = !tableState.mine || (row.assignees || []).some((assignee) => assigneeMatchesUser(assignee, currentEmail));
    return matchesText && matchesStatus && matchesMine;
  });
  if (!tableState.sortKey) return visible;
  return [...visible].sort((a, b) => compareValues(customValue(a, tableState.sortKey), customValue(b, tableState.sortKey), tableState.sortDir));
}

function assigneeMatchesUser(assignee, email) {
  const value = String(assignee || '').toLowerCase();
  if (value === email) return true;
  const user = state.data.users && state.data.users[email];
  return Boolean(user && value === String(user.name || '').toLowerCase());
}

function compareValues(a, b, direction) {
  const result = String(a || '').localeCompare(String(b || ''), 'es', { numeric: true, sensitivity: 'base' });
  return direction === 'desc' ? -result : result;
}

function getTableState(tableId) {
  if (!state.tables[tableId]) state.tables[tableId] = { filter: '', sortKey: '', sortDir: 'asc', status: '', mine: false };
  return state.tables[tableId];
}

function openLinkModal(link = null) {
  openModal({ type: 'link', id: link && link.id, title: link ? 'Editar enlace' : 'Añadir enlace', fields: [inputField('title', 'Título', link && link.title), inputField('url', 'URL', link && link.url, 'url')], deletable: Boolean(link) });
}

function openIssueModal(issue = null) {
  openModal({
    type: 'issue',
    id: issue && issue.id,
    comments: issue ? issue.comments || [] : [],
    readBy: issue ? issue.readBy || [] : [],
    title: issue ? 'Editar asunto' : 'Añadir asunto',
    fields: [
      inputField('date', 'Fecha', issue ? issue.date : today(), 'date'),
      inputField('title', 'Título', issue && issue.title),
      inputField('addedBy', 'Quién lo ha añadido', issue ? issue.addedBy : displayUser()),
      statusChipField('status', 'Estado', issue && issue.status),
      richTextField('description', 'Descripción', issue && issue.description),
      attachmentsField(issue && issue.attachments),
      tasksField(issue && issue.tasks),
    ],
    deletable: Boolean(issue),
  });
}

function openTaskModal(task) {
  openModal({
    type: 'task',
    issueId: task.issueId,
    taskId: task.taskId,
    title: 'Editar tarea',
    fields: [
      taskIssueField(task.issueTitle, task.issueId),
      inputField('task', 'Tarea', task.task),
      taskAssigneesField(task.assignees || []),
      inputField('dueDate', 'Fecha límite', task.dueDate, 'date'),
      compactStatusField(task.status),
    ],
    deletable: true,
  });
}

function openAgreementModal(agreement = null) {
  openModal({ type: 'agreement', id: agreement && agreement.id, title: agreement ? 'Editar acuerdo' : 'Añadir acuerdo', fields: [inputField('date', 'Fecha del acuerdo', agreement ? agreement.date : today(), 'date'), inputField('title', 'Título', agreement && agreement.title), richTextField('description', 'Descripción', agreement && agreement.description), attachmentsField(agreement && agreement.attachments)], deletable: Boolean(agreement) });
}

function openSectionTitleModal(sectionId) {
  const defaults = { links: 'Enlaces de uso frecuente', issues: 'Asuntos para la próxima reunión', pendingTasks: 'Tareas pendientes', agreements: 'Acuerdos' };
  openModal({ type: 'sectionTitle', sectionId, title: 'Editar título de sección', fields: [inputField('title', 'Título', state.data.sectionTitles[sectionId] || defaults[sectionId])], deletable: false });
}

function openDashboardTitleModal() {
  openModal({ type: 'dashboardTitle', title: 'Editar título de la reunión', fields: [inputField('title', 'Título', state.data.title || activeDashboard().name)], deletable: false });
}

function openTextBlockTitleModal(block) {
  openModal({ type: 'textBlockTitle', blockId: block.id, title: 'Editar título del bloque', fields: [inputField('title', 'Título', block.title || 'Texto')], deletable: false });
}

function openTableModal(table = null) {
  openModal({ type: 'table', id: table && table.id, title: table ? 'Editar tabla' : 'Crear tabla', fields: [inputField('title', 'Título de la tabla', table && table.title), tableFieldsEditor(table ? table.fields : [], !table)], deletable: Boolean(table) });
}

function openCustomRowModal(table, row = null) {
  openModal({ type: 'customRow', tableId: table.id, id: row && row.id, title: row ? `Editar fila: ${table.title}` : `Añadir fila: ${table.title}`, fields: table.fields.map((field) => customFieldInput(field, row && row.values[field.id])), deletable: Boolean(row) });
}

function openCustomRowView(table, row) {
  if (!row) return;
  const summaryFields = table.fields.filter((field) => !['textoLargo', 'url', 'documento'].includes(field.type));
  const detailFields = table.fields.filter((field) => ['textoLargo', 'url', 'documento'].includes(field.type));
  openModal({ type: 'customRowView', title: table.title, fields: [...(summaryFields.length ? [customRowSummary(summaryFields, row)] : []), ...detailFields.map((field) => customFieldReadOnly(field, row.values[field.id]))], readOnly: true });
}

function openModal(config) {
  state.modal = config;
  modal.classList.toggle('wide-modal', ['issue', 'customRowView'].includes(config.type));
  modal.classList.remove('fallback-modal');
  $('#modalTitle').textContent = config.title;
  $('#modalError').textContent = '';
  $('#deleteModal').classList.toggle('hidden', !config.deletable);
  $('#modalForm').querySelectorAll('.save-modal-button').forEach((button) => button.classList.toggle('hidden', Boolean(config.readOnly)));
  modalFields.innerHTML = '';
  config.fields.forEach((field) => modalFields.append(field));
  try {
    if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    else {
      modal.classList.add('fallback-modal');
      modal.setAttribute('open', '');
    }
  } catch (error) {
    modal.classList.add('fallback-modal');
    modal.setAttribute('open', '');
  }
}

function closeEditModal() {
  modal.classList.remove('fallback-modal');
  if (typeof modal.close === 'function' && modal.open) modal.close();
  else modal.removeAttribute('open');
}

async function saveCurrent(event) {
  event.preventDefault();
  let values;
  try {
    values = await readModalValues();
  } catch (error) {
    $('#modalError').textContent = error.message;
    return;
  }
  if (!values) return;
  const id = state.modal.id || uid();
  const isNew = !state.modal.id;
  const newRowTable = state.modal.type === 'issue' ? 'issues' : state.modal.type === 'agreement' ? 'agreements' : state.modal.type === 'customRow' ? state.modal.tableId : '';
  if (state.modal.type === 'link') upsert(state.data.frequentLinks, { id, title: values.title, url: values.url });
  if (state.modal.type === 'issue') upsert(state.data.issues, { id, date: values.date, title: values.title, addedBy: values.addedBy, status: values.status, description: values.description, attachments: values.attachments, tasks: values.tasks, comments: state.modal.comments || [], readBy: state.modal.readBy || [] });
  if (state.modal.type === 'task') updateTask(state.modal.issueId, state.modal.taskId, { task: values.task, assignees: values.assignees, dueDate: values.dueDate, status: values.status });
  if (state.modal.type === 'agreement') upsert(state.data.agreements, { id, date: values.date, title: values.title, description: values.description, attachments: values.attachments });
  if (state.modal.type === 'sectionTitle') state.data.sectionTitles[state.modal.sectionId] = values.title;
  if (state.modal.type === 'dashboardTitle') {
    state.data.title = values.title;
    const dashboard = state.me.dashboards.find((item) => item.id === state.activeDashboard);
    if (dashboard) dashboard.name = values.title;
  }
  if (state.modal.type === 'textBlockTitle') state.data.textBlocks.find((block) => block.id === state.modal.blockId).title = values.title;
  if (state.modal.type === 'table') upsert(state.data.customTables, { id, title: values.title, fields: values.fields, rows: existingRowsForTable(id, values.fields) });
  if (state.modal.type === 'customRow') {
    const table = state.data.customTables.find((item) => item.id === state.modal.tableId);
    upsert(table.rows, { id, values: Object.fromEntries(table.fields.map((field) => [field.id, values[`field:${field.id}`] || (field.type === 'check' ? false : '')])) });
  }
  await persist();
  if (isNew && newRowTable) {
    if (newRowTable === 'issues') getTableState('issues').status = 'nuevo';
    markRecentRow(newRowTable, id);
  }
  closeEditModal();
}

function markRecentRow(tableId, rowId) {
  const key = `${tableId}:${rowId}`;
  state.recentRows.add(key);
  render();
  window.setTimeout(() => {
    state.recentRows.delete(key);
    render();
  }, 4500);
}

function isRecentRow(tableId, rowId) {
  return state.recentRows.has(`${tableId}:${rowId}`);
}

async function deleteCurrent() {
  if (!state.modal || !window.confirm('Eliminar este elemento?')) return;
  if (state.modal.type === 'link') remove(state.data.frequentLinks, state.modal.id);
  if (state.modal.type === 'issue') remove(state.data.issues, state.modal.id);
  if (state.modal.type === 'task') {
    await deleteTask({ issueId: state.modal.issueId, taskId: state.modal.taskId }, false, false);
    closeEditModal();
    return;
  }
  if (state.modal.type === 'agreement') remove(state.data.agreements, state.modal.id);
  if (state.modal.type === 'table') remove(state.data.customTables, state.modal.id);
  if (state.modal.type === 'customRow') remove(state.data.customTables.find((item) => item.id === state.modal.tableId).rows, state.modal.id);
  persist();
  closeEditModal();
}

async function readModalValues() {
  const values = {};
  modalFields.querySelectorAll('[name]').forEach((field) => { values[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim(); });
  modalFields.querySelectorAll('[data-rich-text]').forEach((field) => { values[field.dataset.richText] = field.innerHTML.trim(); });
  values.attachments = [];
  for (const row of modalFields.querySelectorAll('.attachment-row')) {
    if (row.closest('[data-custom-documents]')) continue;
    const attachment = await readAttachmentRow(row);
    if (attachment) values.attachments.push(attachment);
  }
  if (state.modal.type === 'issue') values.tasks = readTasks();
  if (state.modal.type === 'task') values.assignees = readSelectedAssignees(modalFields);
  if (state.modal.type === 'customRow') {
    for (const field of modalFields.querySelectorAll('[data-custom-documents]')) {
      const documents = [];
      for (const row of field.querySelectorAll('.attachment-row')) {
        const document = await readAttachmentRow(row);
        if (document) documents.push(document);
      }
      values[`field:${field.dataset.customDocuments}`] = documents;
    }
  }
  if (state.modal.type === 'table') {
    values.fields = readTableFields();
    if (!values.fields.length) {
      $('#modalError').textContent = 'Indica al menos un campo.';
      return null;
    }
  }
  return values;
}

async function persist() {
  state.data = normalizeData(await api(`/api/data?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'PUT', body: state.data }));
  render();
}

async function saveUsers() {
  const result = await api(`/api/users?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'PUT', body: { users: readUserRows() } });
  state.data.allowedUsers = result.allowedUsers;
  state.data.admins = result.admins || [];
  state.data.users = result.users || {};
  renderUserRows();
  renderSmtpTestUsers();
  render();
  showToast('Usuarios guardados correctamente');
}

function renderUserRows() {
  const list = $('#allowedUsersList');
  list.innerHTML = '';
  const editableEmails = new Set([...(state.data.allowedUsers || []), ...(state.data.admins || [])]);
  const users = dashboardUsers().filter((user) => editableEmails.has(user.email));
  if (!users.length) addUserRow();
  users.forEach((user) => addUserRow(user));
}

function addUserRow(user = {}) {
  const list = $('#allowedUsersList');
  const row = html(`<div class="user-row">
    <label>Correo<input data-user-email type="email" placeholder="usuario@dominio.com" value="${escapeAttr(user.email || '')}"></label>
    <label>Nombre<input data-user-name placeholder="Nombre visible" value="${escapeAttr(user.name || '')}"></label>
    <label>Tipo<select data-user-type><option value="usuario" ${(user.type || 'usuario') !== 'admin' ? 'selected' : ''}>Usuario</option><option value="admin" ${user.type === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
    <label>Contraseña<input data-user-password type="password" placeholder="${user.passwordConfigured ? 'Configurada. Dejar en blanco para mantenerla' : 'Solo para administradores'}"></label>
  </div>`);
  row.append(button('Quitar', () => row.remove(), 'secondary small-button'));
  list.append(row);
}

function readUserRows() {
  return [...$('#allowedUsersList').querySelectorAll('.user-row')].map((row) => ({
    email: row.querySelector('[data-user-email]').value.trim().toLowerCase(),
    name: row.querySelector('[data-user-name]').value.trim(),
    type: row.querySelector('[data-user-type]').value,
    password: row.querySelector('[data-user-password]').value.trim(),
  })).filter((user) => user.email);
}

function renderReminderSettings() {
  const reminder = state.data.reminder || { enabled: false, days: [], time: '08:00' };
  const smtp = state.data.smtp || {};
  $('#reminderEnabled').checked = Boolean(reminder.enabled);
  $('#reminderTime').value = reminder.time || '08:00';
  $('#smtpHost').value = smtp.host || '';
  $('#smtpPort').value = smtp.port || 587;
  $('#smtpUser').value = smtp.user || '';
  $('#smtpFrom').value = smtp.from || '';
  $('#smtpPass').placeholder = smtp.configured ? 'Configurada. Dejar en blanco para mantenerla' : 'Contraseña de aplicación de Gmail';
  document.querySelectorAll('[name="reminderDay"]').forEach((input) => { input.checked = (reminder.days || []).includes(input.value); });
}

function renderAppearanceSettings() {
  const hidden = new Set(state.data.hiddenSections || []);
  $('#showLinksSection').checked = !hidden.has('links');
  $('#showAgreementsSection').checked = !hidden.has('agreements');
}

async function saveAppearance() {
  state.data.hiddenSections = [
    ...(!$('#showLinksSection').checked ? ['links'] : []),
    ...(!$('#showAgreementsSection').checked ? ['agreements'] : []),
  ];
  await persist();
  renderAppearanceSettings();
  showToast('Vista guardada correctamente');
}

async function saveReminder(options = {}) {
  const reminder = {
    enabled: $('#reminderEnabled').checked,
    days: [...document.querySelectorAll('[name="reminderDay"]:checked')].map((input) => input.value),
    time: $('#reminderTime').value || '08:00',
  };
  const smtp = { host: $('#smtpHost').value, port: $('#smtpPort').value, user: $('#smtpUser').value, pass: $('#smtpPass').value, from: $('#smtpFrom').value };
  const result = await api(`/api/reminders?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'PUT', body: { reminder, smtp } });
  state.data.reminder = result.reminder;
  state.data.smtp = result.smtp;
  $('#smtpPass').value = '';
  renderReminderSettings();
  if (!options.silent) showToast('Configuración guardada correctamente');
}

async function testReminderEmail() {
  const selected = $('#smtpTestUsers .chip.selected');
  $('#smtpTestResult').textContent = '';
  if (!selected) {
    $('#smtpTestResult').textContent = 'Selecciona un usuario para la prueba.';
    return;
  }
  try {
    await saveReminder({ silent: true });
    await api(`/api/reminders/test?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'POST', body: { email: selected.dataset.email } });
    $('#smtpTestResult').textContent = 'Envío realizado correctamente.';
    showToast('Envío realizado correctamente');
  } catch (error) {
    $('#smtpTestResult').textContent = error.message;
  }
}

function renderSmtpTestUsers() {
  const container = $('#smtpTestUsers');
  container.innerHTML = '';
  dashboardUsers().forEach((user) => {
    const chip = html(`<button type="button" class="chip user-select-chip" data-email="${escapeAttr(user.email)}">${userAvatar(user)}<span>${escapeHtml(user.name)}</span></button>`);
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach((item) => item.classList.remove('selected'));
      chip.classList.add('selected');
    });
    container.append(chip);
  });
}

function tableFieldsEditor(fields = [], allowCsvImport = false) {
  const box = document.createElement('div');
  box.className = 'stack';
  box.innerHTML = '<label>Campos de la tabla</label><div class="stack" data-table-fields></div>';
  const list = box.querySelector('[data-table-fields]');
  (fields.length ? fields : [{ id: uid(), label: '', type: 'texto', options: [] }]).forEach((field) => list.append(tableFieldRow(field)));
  box.append(button('Añadir campo', () => list.append(tableFieldRow({ id: uid(), label: '', type: 'texto', options: [] })), 'secondary'));
  if (allowCsvImport) box.append(csvImportButton());
  return box;
}

function csvImportButton() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const table = csvTable(await file.text(), file.name);
      upsert(state.data.customTables, table);
      await persist();
      closeEditModal();
      showToast('Tabla importada correctamente');
    } catch (error) {
      $('#modalError').textContent = error.message;
    } finally {
      input.value = '';
    }
  });
  const trigger = button('Importar CSV y crear tabla', () => input.click(), 'secondary');
  const actions = document.createElement('div');
  actions.className = 'link-actions';
  actions.append(trigger, input);
  return actions;
}

function csvTable(text, fileName) {
  const rows = parseCsv(text);
  if (!rows.length || !rows[0].some((value) => value.trim())) throw new Error('El CSV debe incluir una primera fila con los nombres de las columnas.');
  const fields = rows.shift().map((label, index) => ({ id: uid(), label: label.trim() || `Columna ${index + 1}`, type: 'texto', options: [] }));
  const dataRows = rows.filter((row) => row.some((value) => value.trim())).map((row) => ({
    id: uid(),
    values: Object.fromEntries(fields.map((field, index) => [field.id, (row[index] || '').trim()])),
  }));
  return { id: uid(), title: fileName.replace(/\.[^.]+$/, '') || 'Tabla importada', fields, rows: dataRows };
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].reduce((selected, candidate) => csvDelimiterCount(firstLine, candidate) > csvDelimiterCount(firstLine, selected) ? candidate : selected, ',');
  const rows = [[]];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      rows.at(-1).push(value);
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      rows.at(-1).push(value);
      rows.push([]);
      value = '';
    } else value += char;
  }
  rows.at(-1).push(value);
  return rows.filter((row) => row.length > 1 || row[0].trim());
}

function csvDelimiterCount(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

function tableFieldRow(field) {
  const row = html(`<div class="field-row" data-field-id="${escapeAttr(field.id || field.label || uid())}"><input data-field-label placeholder="Nombre del campo" value="${escapeAttr(field.label || '')}"><select data-field-type>${fieldTypes.map((type) => `<option value="${type}" ${type === field.type ? 'selected' : ''}>${fieldTypeLabels[type]}</option>`).join('')}</select><input data-field-options placeholder="Opciones desplegable, separadas por coma" value="${escapeAttr((field.options || []).join(', '))}"></div>`);
  row.append(button('Quitar', () => row.remove(), 'secondary small-button'));
  const select = row.querySelector('[data-field-type]');
  const options = row.querySelector('[data-field-options]');
  const sync = () => options.classList.toggle('hidden', select.value !== 'desplegable');
  select.addEventListener('change', sync);
  sync();
  return row;
}

function readTableFields() {
  return [...modalFields.querySelectorAll('.field-row')].map((row) => {
    const label = row.querySelector('[data-field-label]').value.trim();
    const type = row.querySelector('[data-field-type]').value;
    return label ? { id: row.dataset.fieldId || label, label, type, options: commaList(row.querySelector('[data-field-options]').value) } : null;
  }).filter(Boolean);
}

function customFieldInput(field, value = '') {
  if (field.type === 'fecha') return inputField(`field:${field.id}`, field.label, dateInputValue(value), 'date');
  if (field.type === 'desplegable') return html(`<label>${escapeHtml(field.label)}<select name="field:${escapeAttr(field.id)}"><option value=""></option>${(field.options || []).map((option) => `<option value="${escapeAttr(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`);
  if (field.type === 'check') return html(`<label class="check-label"><input name="field:${escapeAttr(field.id)}" type="checkbox" ${value === true || value === 'true' ? 'checked' : ''}> ${escapeHtml(field.label)}</label>`);
  if (field.type === 'url') return inputField(`field:${field.id}`, field.label, value, 'url');
  if (field.type === 'textoLargo') return richTextField(`field:${field.id}`, field.label, value);
  if (field.type === 'documento') return customDocumentsField(field, value);
  return inputField(`field:${field.id}`, field.label, value);
}

function customFieldReadOnly(field, value) {
  let content = '';
  if (field.type === 'url' && value) content = `<a href="${escapeAttr(value)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`;
  else if (field.type === 'documento') {
    const documents = Array.isArray(value) ? value : [];
    content = documents.length ? documents.map((document) => `<a href="${escapeAttr(document.url)}" target="_blank" rel="noopener">${escapeHtml(document.label || document.originalName || 'Documento')}</a>`).join('') : 'Sin documentos';
  } else content = field.type === 'textoLargo' ? renderRichText(value) || 'Sin valor' : escapeHtml(formatCustomValue(field, value) || 'Sin valor');
  return html(`<section class="read-only-field"><h3>${escapeHtml(field.label)}</h3><div>${content}</div></section>`);
}

function customRowSummary(fields, row) {
  return html(`<dl class="issue-meta custom-row-meta">${fields.map((field) => {
    const value = field.type === 'check' ? (row.values[field.id] === true || row.values[field.id] === 'true' ? '<span class="table-value-icon" title="Marcado">&#10003;</span>' : '') : escapeHtml(formatCustomValue(field, row.values[field.id]) || 'Sin valor');
    return `<div><dt>${escapeHtml(field.label)}</dt><dd>${value}</dd></div>`;
  }).join('')}</dl>`);
}

function customDocumentsField(field, value) {
  const box = document.createElement('div');
  box.className = 'stack';
  box.dataset.customDocuments = field.id;
  box.innerHTML = `<label>${escapeHtml(field.label)}</label><div class="stack" data-documents></div>`;
  const list = box.querySelector('[data-documents]');
  (Array.isArray(value) ? value : []).forEach((document) => list.append(attachmentRow(document)));
  box.append(button('Añadir documento', () => list.append(attachmentRow({ type: 'file' })), 'secondary'));
  return box;
}

function inputField(name, label, value = '', type = 'text') {
  return html(`<label>${escapeHtml(label)}<input name="${escapeAttr(name)}" type="${type}" value="${escapeAttr(value || '')}"></label>`);
}

function textareaField(name, label, value = '') {
  return html(`<label>${escapeHtml(label)}<textarea name="${escapeAttr(name)}" rows="4">${escapeHtml(value || '')}</textarea></label>`);
}

function richTextField(name, label, value = '', compact = false) {
  const field = document.createElement('div');
  field.className = `rich-text-field${compact ? ' compact-rich-text-field' : ''}`;
  if (label) field.append(html(`<label>${escapeHtml(label)}</label>`));
  const toolbar = html('<div class="rich-text-toolbar" role="toolbar" aria-label="Formato de texto"><button type="button" data-format="bold" title="Negrita"><strong>B</strong></button><button type="button" data-format="italic" title="Cursiva"><em>I</em></button><button type="button" data-format="underline" title="Subrayado"><u>U</u></button><button type="button" data-format="insertUnorderedList" title="Lista">Lista</button><button type="button" data-format="insertOrderedList" title="Lista numerada">1. Lista</button></div>');
  const editor = document.createElement('div');
  editor.className = 'rich-text-editor';
  editor.contentEditable = 'true';
  editor.dataset.richText = name;
  editor.innerHTML = value || '';
  toolbar.querySelectorAll('[data-format]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => document.execCommand(button.dataset.format, false));
  });
  field.append(toolbar, editor);
  return field;
}

function renderRichText(value) {
  return String(value || '');
}

function plainText(value) {
  const node = document.createElement('div');
  node.innerHTML = String(value || '');
  return node.textContent || '';
}

function selectField(name, label, value = 'nuevo') {
  return html(`<label>${escapeHtml(label)}<select name="${escapeAttr(name)}">${statuses.map((status) => `<option value="${status}" ${status === value ? 'selected' : ''}>${status}</option>`).join('')}</select></label>`);
}

function statusChipField(name, label, value = 'nuevo') {
  const selected = statuses.includes(value) ? value : 'nuevo';
  const field = html(`<div class="status-chip-field">
    <span>${escapeHtml(label)}</span>
    <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(selected)}">
    ${statusChoices(selected)}
  </div>`);
  bindStatusChoices(field, `input[name="${name}"]`);
  return field;
}

function taskIssueField(issueTitle = '', issueId = '') {
  return html(`<div class="readonly-field"><span>Asunto</span>${issueChip(issueTitle, issueId)}</div>`);
}

function attachmentsField(attachments = []) {
  const box = document.createElement('div');
  box.className = 'stack';
  box.innerHTML = '<label>Documentos o enlaces adjuntos</label><div class="stack" data-attachments></div>';
  const list = box.querySelector('[data-attachments]');
  (attachments || []).forEach((attachment) => list.append(attachmentRow(attachment)));
  const actions = document.createElement('div');
  actions.className = 'link-actions';
  actions.append(button('Añadir URL', () => list.append(attachmentRow({ type: 'url' })), 'secondary'));
  actions.append(button('Subir archivo', () => list.append(attachmentRow({ type: 'file' })), 'secondary'));
  box.append(actions);
  return box;
}

function tasksField(tasks = []) {
  const box = document.createElement('div');
  box.className = 'stack';
  box.innerHTML = '<label>Tareas</label><div class="task-row-header"><span>Tarea</span><span>Responsables</span><span>Fecha límite</span><span>Estado</span><span></span></div><div class="stack" data-tasks></div>';
  const list = box.querySelector('[data-tasks]');
  (tasks || []).forEach((task) => list.append(taskRow(task)));
  box.append(button('Añadir tarea', () => list.append(taskRow()), 'secondary task-add-button'));
  return box;
}

function taskRow(task = {}) {
  const row = html(`<div class="task-row" data-id="${escapeAttr(task.id || '')}">
    <input data-task-title placeholder="Tarea" value="${escapeAttr(task.task || '')}">
    ${compactAssigneePicker(task.assignees || [])}
    <input data-task-due-date type="date" value="${escapeAttr(task.dueDate || '')}">
    ${compactStatusPicker(task.status || 'nuevo')}
  </div>`);
  bindCompactTaskPickers(row);
  row.append(button('Quitar', () => row.remove(), 'secondary small-button'));
  return row;
}

function compactAssigneePicker(selected = []) {
  return `<details class="compact-picker" data-task-assignees><summary><span data-picker-label>${escapeHtml(assigneeSummary(selected))}</span><span class="picker-arrow" aria-hidden="true"></span></summary><div class="picker-options">${dashboardUsers().map((user) => `<label><input type="checkbox" value="${escapeAttr(user.email)}" ${selected.includes(user.email) ? 'checked' : ''}> ${escapeHtml(user.name)}</label>`).join('')}</div></details>`;
}

function compactStatusPicker(selected = 'nuevo', includeName = false) {
  const current = statuses.includes(selected) ? selected : 'nuevo';
  return `<details class="compact-picker task-status-picker"><summary><span data-picker-label>${escapeHtml(current)}</span><span class="picker-arrow" aria-hidden="true"></span></summary><input type="hidden" ${includeName ? 'name="status"' : ''} data-task-status value="${escapeAttr(current)}"><div class="picker-options">${statuses.map((status) => `<button type="button" data-task-status-choice="${escapeAttr(status)}">${escapeHtml(status)}</button>`).join('')}</div></details>`;
}

function bindCompactTaskPickers(row) {
  bindCompactAssigneePicker(row);
  bindCompactStatusPicker(row);
}

function bindCompactAssigneePicker(root) {
  const assignees = root.querySelector('[data-task-assignees]');
  if (!assignees || assignees.tagName === 'SELECT') return;
  const assigneeLabel = assignees.querySelector('[data-picker-label]');
  assignees.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
    assigneeLabel.textContent = assigneeSummary([...assignees.querySelectorAll('input:checked')].map((item) => item.value));
  }));
}

function bindCompactStatusPicker(root) {
  const statusPicker = root.querySelector('.task-status-picker');
  if (!statusPicker) return;
  const statusLabel = statusPicker.querySelector('[data-picker-label]');
  const statusField = statusPicker.querySelector('[data-task-status]');
  statusPicker.querySelectorAll('[data-task-status-choice]').forEach((choice) => choice.addEventListener('click', () => {
    statusField.value = choice.dataset.taskStatusChoice;
    statusLabel.textContent = choice.dataset.taskStatusChoice;
    statusPicker.open = false;
  }));
}

function assigneeSummary(selected) {
  if (!selected.length) return 'Responsables';
  const users = state.data.users || {};
  return selected.map((email) => users[email] && users[email].name || email).join(', ');
}

function statusChoices(selected = 'nuevo') {
  const current = statuses.includes(selected) ? selected : 'nuevo';
  return `<div class="chip-list status-choice-list">${statuses.map((status) => `<button type="button" class="status status-choice status-${statusClass(status)} ${status === current ? 'selected' : ''}" data-status-choice="${escapeAttr(status)}">${escapeHtml(status)}</button>`).join('')}</div>`;
}

function bindStatusChoices(root, valueSelector) {
  const valueField = root.querySelector(valueSelector);
  root.querySelectorAll('[data-status-choice]').forEach((chip) => chip.addEventListener('click', () => {
    valueField.value = chip.dataset.statusChoice;
    root.querySelectorAll('[data-status-choice]').forEach((item) => item.classList.toggle('selected', item === chip));
  }));
}

function taskAssigneesField(selected = []) {
  const box = document.createElement('div');
  box.className = 'stack';
  box.innerHTML = `<label>Responsables</label><div class="chip-list task-assignee-chips" data-task-assignees>${dashboardUsers().map((user) => `<button type="button" class="chip user-select-chip ${selected.includes(user.email) ? 'selected' : ''}" data-assignee-choice="${escapeAttr(user.email)}">${userAvatar(user)}<span>${escapeHtml(user.name)}</span></button>`).join('')}</div>`;
  box.querySelectorAll('[data-assignee-choice]').forEach((chip) => chip.addEventListener('click', () => chip.classList.toggle('selected')));
  return box;
}

function compactStatusField(selected = 'nuevo') {
  const box = document.createElement('div');
  box.className = 'stack';
  const current = statuses.includes(selected) ? selected : 'nuevo';
  box.innerHTML = `<label>Estado</label><input type="hidden" name="status" data-task-status value="${escapeAttr(current)}">${statusChoices(current)}`;
  bindStatusChoices(box, '[data-task-status]');
  return box;
}

function readTasks() {
  return [...modalFields.querySelectorAll('.task-row')].map((row) => {
    const task = row.querySelector('[data-task-title]').value.trim();
    const assignees = readSelectedAssignees(row);
    const dueDate = row.querySelector('[data-task-due-date]').value;
    const status = row.querySelector('[data-task-status]').value;
    return task || assignees.length || dueDate ? { id: row.dataset.id || uid(), task, assignees, dueDate, status } : null;
  }).filter(Boolean);
}

function readSelectedAssignees(root) {
  const select = root.querySelector('[data-task-assignees]');
  if (!select) return [];
  if (select.tagName === 'SELECT') return [...select.selectedOptions].map((option) => option.value);
  const inputs = [...select.querySelectorAll('input:checked')];
  return inputs.length ? inputs.map((input) => input.value) : [...select.querySelectorAll('[data-assignee-choice].selected')].map((chip) => chip.dataset.assigneeChoice);
}

function updateTask(issueId, taskId, nextTask) {
  const issue = state.data.issues.find((item) => item.id === issueId);
  if (!issue) return;
  const index = (issue.tasks || []).findIndex((task) => task.id === taskId);
  if (index >= 0) issue.tasks[index] = { ...issue.tasks[index], ...nextTask, id: taskId };
}

async function deleteTask(task, closeModal = true, askConfirm = true) {
  if (askConfirm && !window.confirm('¿Eliminar esta tarea?')) return;
  const issue = state.data.issues.find((item) => item.id === task.issueId);
  if (!issue) return;
  remove(issue.tasks || [], task.taskId);
  await persist();
  if (closeModal) closeEditModal();
}

function attachmentRow(attachment = {}) {
  const type = attachment.type || (attachment.fileName ? 'file' : 'url');
  const row = html(`<div class="attachment-row" data-id="${escapeAttr(attachment.id || '')}" data-type="${escapeAttr(type)}" data-file-name="${escapeAttr(attachment.fileName || '')}" data-original-name="${escapeAttr(attachment.originalName || '')}" data-url="${escapeAttr(attachment.url || '')}"><input data-attachment-label placeholder="Nombre del documento" value="${escapeAttr(attachment.label || attachment.originalName || '')}"></div>`);
  if (type === 'file') {
    row.append(html(`<div class="file-field"><input data-attachment-file type="file"><small>${escapeHtml(attachment.originalName || 'Selecciona un archivo del ordenador')}</small></div>`));
  } else {
    row.append(html(`<input data-attachment-url placeholder="URL del documento o enlace" value="${escapeAttr(attachment.url || '')}">`));
  }
  row.append(button('Quitar', () => row.remove(), 'secondary'));
  return row;
}

async function readAttachmentRow(row) {
  const type = row.dataset.type || 'url';
  const label = row.querySelector('[data-attachment-label]').value.trim();
  if (type === 'file') {
    const file = row.querySelector('[data-attachment-file]').files[0];
    if (file) return uploadAttachment(file, label);
    if (row.dataset.fileName) {
      return { id: row.dataset.id || uid(), type: 'file', label, url: row.dataset.url, fileName: row.dataset.fileName, originalName: row.dataset.originalName };
    }
    return null;
  }
  const url = row.querySelector('[data-attachment-url]').value.trim();
  return label || url ? { id: row.dataset.id || uid(), type: 'url', label, url } : null;
}

async function uploadAttachment(file, label) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('label', label || file.name);
  const response = await fetch(`/api/uploads?dashboard=${encodeURIComponent(state.activeDashboard)}`, { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No se pudo subir el archivo');
  return { id: uid(), ...payload };
}

function existingRowsForTable(tableId, fields) {
  const table = state.data.customTables.find((item) => item.id === tableId);
  if (!table) return [];
  return table.rows.map((row) => ({ id: row.id, values: Object.fromEntries(fields.map((field) => [field.id, row.values[field.id] || row.values[field.label] || (field.type === 'check' ? false : '')])) }));
}

function normalizeData(data) {
  data.allowedUsers = data.allowedUsers || [];
  data.admins = data.admins || [];
  data.users = data.users || {};
  data.layoutOrder = data.layoutOrder || [];
  data.collapsedSections = data.collapsedSections || [];
  data.hiddenSections = data.hiddenSections || [];
  data.sectionTitles = data.sectionTitles || {};
  data.issues = (data.issues || []).map((issue) => ({ ...issue, tasks: issue.tasks || [], comments: issue.comments || [], readBy: normalizeReaders(issue.readBy) }));
  data.textBlocks = (data.textBlocks || []).map((block) => ({ ...block, title: block.title || 'Texto', content: block.content || '' }));
  data.customTables = (data.customTables || []).map((table) => ({
    ...table,
    fields: (table.fields || []).map((field) => typeof field === 'string' ? { id: field, label: field, type: 'texto', options: [] } : { id: field.id || field.label, label: field.label || field.id, type: field.type || 'texto', options: field.options || [] }),
    rows: table.rows || [],
  }));
  return data;
}

function dashboardUsers() {
  const users = new Map();
  const knownUsers = state.data.users || {};
  const admins = new Set(state.data.admins || []);
  Object.values(knownUsers).forEach((user) => users.set(user.email, { email: user.email, name: user.name || user.email, photo: user.photo || '', type: user.type === 'admin' || admins.has(user.email) ? 'admin' : 'usuario', passwordConfigured: Boolean(user.passwordConfigured) }));
  [state.me.email, ...(state.data.admins || []), ...(state.data.allowedUsers || [])].forEach((email) => {
    if (email && !users.has(email)) users.set(email, { email, name: email, photo: email === state.me.email ? state.me.photo || '' : '', type: admins.has(email) ? 'admin' : 'usuario' });
  });
  (state.data.issues || []).forEach((issue) => (issue.tasks || []).forEach((task) => (task.assignees || []).forEach((email) => {
    if (email && !users.has(email)) users.set(email, { email, name: email });
  })));
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function formatAssignees(assignees = []) {
  if (!assignees.length) return 'Sin asignar';
  const users = state.data.users || {};
  return assignees.map((email) => users[email] && users[email].name || email).join(', ');
}

function userChip(value) {
  const user = value && typeof value === 'object' ? { ...value, name: value.name || value.email || 'Sin indicar' } : userForValue(value);
  return `<span class="user-chip">${userAvatar(user)}<span>${escapeHtml(user.name)}</span></span>`;
}

function normalizeReaders(readBy) {
  return (Array.isArray(readBy) ? readBy : []).map((reader) => {
    const value = typeof reader === 'object' && reader ? reader : { email: reader };
    const email = String(value.email || '').trim().toLowerCase();
    return email ? { email, name: String(value.name || email).trim(), photo: String(value.photo || '').trim() } : null;
  }).filter(Boolean);
}

function userAvatar(user) {
  const initial = escapeHtml((user.name || user.email || '?').trim().charAt(0).toUpperCase() || '?');
  return user.photo ? `<img class="user-avatar" src="${escapeAttr(user.photo)}" alt="">` : `<span class="user-avatar user-avatar-fallback" aria-hidden="true">${initial}</span>`;
}

function userForValue(value) {
  const key = String(value || '').toLowerCase();
  const users = [state.me, ...Object.values(state.data.users || {})].filter(Boolean);
  return users.find((user) => String(user.email || '').toLowerCase() === key || String(user.name || '').toLowerCase() === key) || { name: value || 'Sin indicar', email: '' };
}

function issueChip(value, issueId = '') {
  const content = escapeHtml(value || 'Sin asunto');
  return issueId ? `<button type="button" class="issue-chip issue-link" data-open-issue="${escapeAttr(issueId)}">${content}</button>` : `<span class="issue-chip">${content}</span>`;
}

function statusChip(value) {
  const status = statuses.includes(value) ? value : 'nuevo';
  return `<span class="status status-${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function statusClass(value) {
  return String(value || 'nuevo').replaceAll(' ', '-');
}

function formatUserLabel(value) {
  const key = String(value || '').toLowerCase();
  const user = state.data.users && state.data.users[key];
  return user && user.name || value || '';
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = dateInputValue(value).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year.slice(-2)}`;
}

function dateInputValue(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const european = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (european) return `${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}`;
  return text;
}

function formatCustomValue(field, value) {
  if (field && field.type === 'check') return value === true || value === 'true' ? 'Si' : 'No';
  if (field && field.type === 'fecha') return formatDate(value);
  if (field && field.type === 'textoLargo') return plainText(value);
  if (field && field.type === 'documento') return (Array.isArray(value) ? value : []).map((document) => document.label || document.originalName || 'Documento').join(', ');
  return value || '';
}

function customTableCell(field, value) {
  const text = formatCustomValue(field, value);
  if (field.type === 'check') return value === true || value === 'true' ? '<span class="table-value-icon" title="Marcado">&#10003;</span>' : '';
  if (field.type === 'url' && value) return `<a class="table-value-icon" href="${escapeAttr(value)}" target="_blank" rel="noopener" title="Abrir enlace">&#128279;</a>`;
  if (field.type === 'documento') {
    const documents = Array.isArray(value) ? value : [];
    return documents.length ? `<span class="table-value-icon" title="${escapeAttr(`${documents.length} documento(s): ${text}`)}">&#128206;</span>` : '';
  }
  if (field.type === 'textoLargo' && text) return `<span class="table-value-icon" title="${escapeAttr(text)}">&#128172;</span>`;
  return tableText(text);
}

function tableText(value) {
  const text = String(value || '');
  return `<span class="table-cell-text" title="${escapeAttr(text)}">${escapeHtml(text)}</span>`;
}

function actionCell(element) {
  const cell = document.createElement('td');
  cell.append(element);
  return cell;
}

function upsert(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function remove(list, id) {
  const index = list.findIndex((entry) => entry.id === id);
  if (index >= 0) list.splice(index, 1);
}

function button(label, onClick, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.add('hidden'), 2600);
}

function lines(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function commaList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error de conexión');
  return payload;
}

function displayUser() {
  return state.me && (state.me.name || state.me.email) || '';
}

function requestedDashboard() {
  const dashboardId = new URLSearchParams(window.location.search).get('dashboard');
  return (state.me.dashboards || []).some((dashboard) => dashboard.id === dashboardId) ? dashboardId : '';
}

function activeDashboard() {
  return (state.me.dashboards || []).find((dashboard) => dashboard.id === state.activeDashboard) || { name: 'Consejo local', isAdmin: false };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#039;');
}
