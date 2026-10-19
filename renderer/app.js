// AGY Router Desktop — Application Logic
// Security: Uses textContent and createElement instead of innerHTML for user data.
// All API communication uses HTTPS.
(function () {
  'use strict';

  // ── State ──
  let currentCurrency = 'USD';
  let currencyRate = 15850;
  let cachedMetrics = null;
  let cachedRoutes = [];
  let cachedTransactions = [];
  let cachedSessions = [];
  let eventSource = null;
  let pollInterval = null;
  let authToken = null;
  let serverBaseUrl = 'https://agy.shipr.my.id';

  // ── DOM References ──
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const navActionsAuth = document.getElementById('nav-actions-auth');
  const loginForm = document.getElementById('login-form');
  const loginAlert = document.getElementById('login-alert');
  const btnLoginSubmit = document.getElementById('btn-login-submit');
  const btnLogout = document.getElementById('btn-logout');
  const btnSync = document.getElementById('btn-sync');
  const syncIcon = document.getElementById('sync-icon');
  const clockDisplay = document.getElementById('clock-display');

  const btnCurrUsd = document.getElementById('btn-curr-usd');
  const btnCurrIdr = document.getElementById('btn-curr-idr');

  const streamStatusPill = document.getElementById('stream-status-pill');
  const streamStatusText = document.getElementById('stream-status-text');
  const heroModelName = document.getElementById('hero-model-name');
  const sessionsCountBadge = document.getElementById('sessions-count-badge');
  const topologyMetaText = document.getElementById('topology-meta-text');

  const valTotalRequests = document.getElementById('val-total-requests');
  const subTotalSessions = document.getElementById('sub-total-sessions');
  const valInputTokens = document.getElementById('val-input-tokens');
  const valOutputTokens = document.getElementById('val-output-tokens');
  const valCachedTokens = document.getElementById('val-cached-tokens');
  const badgeCacheHit = document.getElementById('badge-cache-hit');
  const valEstimatedCost = document.getElementById('val-estimated-cost');
  const badgeCurrencyIndicator = document.getElementById('badge-currency-indicator');
  const subCostFormula = document.getElementById('sub-cost-formula');

  const routeMatrixContainer = document.getElementById('route-matrix-container');
  const transactionTbody = document.getElementById('transaction-tbody');
  const filterSession = document.getElementById('filter-session');
  const filterModel = document.getElementById('filter-model');
  const searchTask = document.getElementById('search-task');

  // ── Custom Titlebar Controls ──
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');

  if (window.electronAPI) {
    btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
    btnClose.addEventListener('click', () => window.electronAPI.close());
  }

  // ── Live Clock ──
  function updateClock() {
    const now = new Date();
    clockDisplay.textContent = now.toTimeString().split(' ')[0] + ' UTC';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── Number Formatters ──
  function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num || 0);
  }

  function formatCompact(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function formatCost(usdValue) {
    if (!usdValue || usdValue === 0) {
      return currentCurrency === 'IDR' ? 'Rp 0' : '$0.0000';
    }
    if (currentCurrency === 'IDR') {
      const idr = Math.round(usdValue * currencyRate);
      return 'Rp ' + new Intl.NumberFormat('id-ID').format(idr);
    }
    return '$' + Number(usdValue).toFixed(4);
  }

  // ── Helpers: Safe text escaping for static structure builds ──
  function safeText(text) {
    if (text === null || text === undefined) return '';
    return String(text);
  }

  // ── Auth helpers ──
  function authHeaders(extra) {
    var h = {};
    if (authToken) h['Authorization'] = 'Bearer ' + authToken;
    if (extra) {
      for (var k in extra) { h[k] = extra[k]; }
    }
    return h;
  }

  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = authHeaders(opts.headers);
    return fetch(url, opts);
  }

  // ── Auth: Check Session on Boot ──
  async function checkAuthSession() {
    try {
      const res = await authFetch(serverBaseUrl + '/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          if (data.token) authToken = data.token;
          showDashboard();
          setupRealTimeStream();
          return;
        }
      }
    } catch (_) {
      // Fail safe: show login
    }
    showLogin();
  }

  function showLogin() {
    loginView.style.display = 'flex';
    dashboardView.style.display = 'none';
    navActionsAuth.style.display = 'none';
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function showDashboard() {
    loginView.style.display = 'none';
    dashboardView.style.display = 'block';
    navActionsAuth.style.display = 'flex';
  }

  // ── Login Form Submission ──
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    loginAlert.style.display = 'none';
    btnLoginSubmit.disabled = true;
    btnLoginSubmit.textContent = 'VERIFYING CREDENTIALS...';

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const urlInput = document.getElementById('server-url').value.trim();

    // Validate server URL — only HTTPS allowed
    // TODO(security): In production, the server URL should be pinned/hardcoded.
    if (urlInput && urlInput.startsWith('https://')) {
      serverBaseUrl = urlInput.replace(/\/+$/, '');
    } else if (urlInput && !urlInput.startsWith('https://')) {
      loginAlert.textContent = 'Server URL must use HTTPS protocol for security.';
      loginAlert.style.display = 'block';
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'AUTHENTICATE & ENTER →';
      return;
    }

    try {
      const res = await fetch(serverBaseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const json = await res.json();
      if (res.ok && json.ok) {
        authToken = json.token || null;
        loginForm.reset();
        // Restore server URL in the input
        document.getElementById('server-url').value = serverBaseUrl;
        showDashboard();
        setupRealTimeStream();
      } else {
        loginAlert.textContent = safeText(json.detail || json.title || 'Invalid username or password.');
        loginAlert.style.display = 'block';
      }
    } catch (err) {
      loginAlert.textContent = 'Server connection error. Check URL and try again.';
      loginAlert.style.display = 'block';
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'AUTHENTICATE & ENTER →';
    }
  });

  // ── Logout Action ──
  btnLogout.addEventListener('click', async function () {
    try {
      await authFetch(serverBaseUrl + '/api/auth/logout', {
        method: 'POST',
      });
    } catch (_) {
      // Fail safe: still logout locally
    }
    // Clear client-side state
    authToken = null;
    cachedMetrics = null;
    cachedRoutes = [];
    cachedTransactions = [];
    cachedSessions = [];
    showLogin();
  });

  // ── Setup Server-Sent Events (SSE) with Auto-Poll Fallback ──
  function setupRealTimeStream() {
    if (eventSource) eventSource.close();

    let sseUrl = serverBaseUrl + '/api/stream';
    if (authToken) sseUrl += '?token=' + encodeURIComponent(authToken);
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = function () {
      streamStatusText.textContent = 'SSE LIVE STREAM (3s)';
      streamStatusPill.style.backgroundColor = '#111111';
    };

    eventSource.onmessage = function (event) {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.data) {
          applyTelemetryPayload(payload.data);
        }
      } catch (e) {
        // Fail safe: ignore parse errors
      }
    };

    eventSource.onerror = function () {
      streamStatusText.textContent = 'AUTO-POLL BACKUP (3s)';
      streamStatusPill.style.backgroundColor = '#444444';
      if (!pollInterval) {
        pollInterval = setInterval(loadAllTelemetryRest, 3000);
      }
    };

    // Immediate initial REST load as safety
    loadAllTelemetryRest();
  }

  async function loadAllTelemetryRest() {
    try {
      const [metricsRes, routesRes, txRes, sessRes] = await Promise.all([
        authFetch(serverBaseUrl + '/api/metrics'),
        authFetch(serverBaseUrl + '/api/routes'),
        authFetch(serverBaseUrl + '/api/transactions?limit=60'),
        authFetch(serverBaseUrl + '/api/sessions'),
      ]);

      if (metricsRes.status === 401 || routesRes.status === 401) {
        showLogin();
        return;
      }

      if (metricsRes.ok && routesRes.ok && txRes.ok) {
        const m = await metricsRes.json();
        const r = await routesRes.json();
        const t = await txRes.json();
        let s = [];
        if (sessRes.ok) {
          const sData = await sessRes.json();
          s = sData.data || [];
        }
        applyTelemetryPayload({
          metrics: m.data,
          routes: r.data,
          transactions: t.data,
          sessions: s,
        });
      }
    } catch (_) {
      // Fail safe: silently retry on next poll
    }
  }

  function applyTelemetryPayload(data) {
    if (data.metrics) {
      cachedMetrics = data.metrics;
      currencyRate = cachedMetrics.rateUsdIdr || 15850;
      renderMetrics(cachedMetrics);
    }
    if (data.sessions) {
      cachedSessions = data.sessions;
      renderSessionsState(cachedSessions);
    }
    if (data.routes) {
      cachedRoutes = data.routes;
      renderRouteMatrix(cachedRoutes);
      populateModelDropdown(cachedRoutes);
    }
    if (data.transactions) {
      cachedTransactions = data.transactions;
      renderTransactions(cachedTransactions);
    }
  }

  // ── Manual Sync Button ──
  btnSync.addEventListener('click', async () => {
    syncIcon.classList.add('spin-icon');
    btnSync.disabled = true;

    try {
      await authFetch(serverBaseUrl + '/api/refresh', {
        method: 'POST',
      });
      await loadAllTelemetryRest();
    } catch (_) {
      // Fail safe
    }

    setTimeout(() => {
      syncIcon.classList.remove('spin-icon');
      btnSync.disabled = false;
    }, 350);
  });

  // ── Currency Toggles ──
  btnCurrUsd.addEventListener('click', () => {
    currentCurrency = 'USD';
    btnCurrUsd.classList.add('active');
    btnCurrIdr.classList.remove('active');
    if (cachedMetrics) renderMetrics(cachedMetrics);
    if (cachedRoutes.length) renderRouteMatrix(cachedRoutes);
    if (cachedTransactions.length) renderTransactions(cachedTransactions);
  });

  btnCurrIdr.addEventListener('click', () => {
    currentCurrency = 'IDR';
    btnCurrIdr.classList.add('active');
    btnCurrUsd.classList.remove('active');
    if (cachedMetrics) renderMetrics(cachedMetrics);
    if (cachedRoutes.length) renderRouteMatrix(cachedRoutes);
    if (cachedTransactions.length) renderTransactions(cachedTransactions);
  });

  // ── Render: Bento Metrics ──
  function renderMetrics(m) {
    valTotalRequests.textContent = formatNumber(m.totalRequests);
    const tgCount = (m.telemetrySource && m.telemetrySource.telegramActivityCount) || 0;
    subTotalSessions.textContent = 'Tmux CLI Sessions + ' + tgCount + ' Telegram Actions';

    valInputTokens.textContent = formatCompact(m.inputTokens);
    valOutputTokens.textContent = formatCompact(m.outputTokens);
    valCachedTokens.textContent = formatCompact(m.cachedTokens);
    badgeCacheHit.textContent = (m.cacheHitRate || '0%') + ' HIT';

    badgeCurrencyIndicator.textContent = currentCurrency;
    valEstimatedCost.textContent = formatCost(m.costUsd);

    if (m.currentCLIModel) {
      heroModelName.textContent = m.currentCLIModel;
    }
    if (m.costUsd === 0) {
      subCostFormula.textContent = 'Google AI Pro Tier · Free API / Zero-Cost Quota';
    } else {
      subCostFormula.textContent = '1 USD = Rp ' + formatNumber(currencyRate) + ' · Tariff Calculated';
    }
  }

  function renderSessionsState(sessions) {
    if (!sessions || sessions.length === 0) return;
    const activeCount = sessions.filter(function (s) { return s.isRunning; }).length;
    sessionsCountBadge.textContent = activeCount + '/' + sessions.length + ' TMUX SESSIONS ACTIVE';
  }

  // ── Render: Populate Model Dropdown Dynamically ──
  function populateModelDropdown(routes) {
    const existingVal = filterModel.value;
    const modelNames = new Set(['ALL']);
    routes.forEach(function (r) { modelNames.add(r.name); });

    // Clear existing options securely
    while (filterModel.firstChild) {
      filterModel.removeChild(filterModel.firstChild);
    }

    // Add default option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'ALL';
    defaultOpt.textContent = 'ALL MODELS';
    filterModel.appendChild(defaultOpt);

    modelNames.forEach(function (name) {
      if (name === 'ALL') return;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === existingVal) opt.selected = true;
      filterModel.appendChild(opt);
    });
  }

  // ── Render: Dynamic Topology Matrix (secure DOM building) ──
  function renderRouteMatrix(routes) {
    // Clear container securely
    while (routeMatrixContainer.firstChild) {
      routeMatrixContainer.removeChild(routeMatrixContainer.firstChild);
    }
    topologyMetaText.textContent = routes.length + ' MODEL ENDPOINTS TRACKED';

    routes.forEach(function (route) {
      const card = document.createElement('div');
      const isActive = route.status === 'ACTIVE';
      card.className = 'route-card' + (isActive ? ' route-card-active' : '');

      let badgeClass = 'badge-active';
      if (route.status === 'STANDBY') badgeClass = 'badge-standby';
      if (route.status === 'IDLE') badgeClass = 'badge-idle';

      const costDisplay = (route.costPer1kUsd === 0)
        ? 'FREE ($0.00)'
        : (currentCurrency === 'IDR'
          ? 'Rp ' + formatNumber(route.costPer1kIdr) + ' / 1K'
          : '$' + route.costPer1kUsd.toFixed(4) + ' / 1K');

      // Build card top section
      const cardTop = document.createElement('div');
      cardTop.className = 'route-card-top';

      const infoDiv = document.createElement('div');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'route-name';
      nameDiv.textContent = safeText(route.name);
      const sessionTag = document.createElement('div');
      sessionTag.className = 'route-session-tag';
      sessionTag.textContent = 'SCOPE: ' + safeText(route.sessionDisplayName || route.sessionScope);
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(sessionTag);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge ' + badgeClass;
      statusBadge.textContent = safeText(route.status);

      cardTop.appendChild(infoDiv);
      cardTop.appendChild(statusBadge);

      // Build type description
      const typeDesc = document.createElement('div');
      typeDesc.className = 'route-type-desc';
      typeDesc.textContent = safeText(route.type);

      // Build metrics bar
      const metricsBar = document.createElement('div');
      metricsBar.className = 'route-metrics-bar';

      const latencyGauge = document.createElement('span');
      latencyGauge.className = 'latency-gauge';
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      if (!isActive) dot.style.backgroundColor = '#888';
      latencyGauge.appendChild(dot);
      const latencyText = document.createTextNode(' ' + safeText(route.avgLatencyMs) + ' ms');
      latencyGauge.appendChild(latencyText);

      const weightSpan = document.createElement('span');
      weightSpan.textContent = safeText(route.weight || 'Route');

      const costStrong = document.createElement('strong');
      costStrong.textContent = costDisplay;

      metricsBar.appendChild(latencyGauge);
      metricsBar.appendChild(weightSpan);
      metricsBar.appendChild(costStrong);

      card.appendChild(cardTop);
      card.appendChild(typeDesc);
      card.appendChild(metricsBar);

      routeMatrixContainer.appendChild(card);
    });
  }

  // ── Render: Transaction Ledger (secure DOM building) ──
  function renderTransactions(transactions) {
    const query = searchTask.value.toLowerCase().trim();
    const selectedModel = filterModel.value;
    const selectedSession = filterSession.value;

    var filtered = transactions.filter(function (t) {
      if (selectedSession !== 'ALL') {
        if (t.session !== selectedSession && (!t.sessionLabel || !t.sessionLabel.toLowerCase().includes(selectedSession.toLowerCase()))) {
          return false;
        }
      }
      if (selectedModel !== 'ALL') {
        if (!t.model.toLowerCase().includes(selectedModel.toLowerCase())) {
          return false;
        }
      }
      if (query) {
        var inTask = t.taskPreview && t.taskPreview.toLowerCase().includes(query);
        var inId = t.id && t.id.toLowerCase().includes(query);
        var inModel = t.model && t.model.toLowerCase().includes(query);
        var inSess = t.sessionLabel && t.sessionLabel.toLowerCase().includes(query);
        if (!inTask && !inId && !inModel && !inSess) return false;
      }
      return true;
    });

    // Clear tbody securely
    while (transactionTbody.firstChild) {
      transactionTbody.removeChild(transactionTbody.firstChild);
    }

    if (filtered.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.setAttribute('colspan', '11');
      emptyCell.style.textContent = '';
      emptyCell.style.textAlign = 'center';
      emptyCell.style.padding = '24px';
      emptyCell.style.color = 'var(--text-muted)';
      emptyCell.textContent = 'No matching transactions found for current filter criteria.';
      emptyRow.appendChild(emptyCell);
      transactionTbody.appendChild(emptyRow);
      return;
    }

    filtered.forEach(function (t) {
      var tr = document.createElement('tr');

      // TX ID
      var td0 = document.createElement('td');
      td0.className = 'tx-hash';
      var code = document.createElement('code');
      code.textContent = safeText(t.id);
      td0.appendChild(code);

      // Timestamp
      var td1 = document.createElement('td');
      td1.textContent = safeText(t.formattedTime || (t.timestamp ? t.timestamp.substring(11, 19) : ''));

      // Origin Session
      var td2 = document.createElement('td');
      var sessBadge = document.createElement('span');
      sessBadge.className = 'badge badge-outline tx-session-badge';
      sessBadge.textContent = safeText(t.sessionLabel || t.session);
      td2.appendChild(sessBadge);

      // Model / Route
      var td3 = document.createElement('td');
      var modelBadge = document.createElement('span');
      modelBadge.className = 'badge badge-inverted';
      modelBadge.textContent = safeText(t.model);
      td3.appendChild(modelBadge);

      // IN Tokens
      var td4 = document.createElement('td');
      td4.textContent = formatNumber(t.inputTokens);

      // OUT Tokens
      var td5 = document.createElement('td');
      td5.textContent = formatNumber(t.outputTokens);

      // Cached
      var td6 = document.createElement('td');
      td6.textContent = formatNumber(t.cachedTokens);

      // Latency
      var td7 = document.createElement('td');
      var latStrong = document.createElement('strong');
      latStrong.textContent = safeText(t.latencyMs) + ' ms';
      td7.appendChild(latStrong);

      // Est. Cost
      var td8 = document.createElement('td');
      var costSt = document.createElement('strong');
      costSt.textContent = formatCost(t.costUsd);
      td8.appendChild(costSt);

      // Status
      var td9 = document.createElement('td');
      var statusB = document.createElement('span');
      statusB.className = 'badge badge-outline';
      statusB.textContent = '200 OK';
      td9.appendChild(statusB);

      // Task / Context
      var td10 = document.createElement('td');
      td10.className = 'tx-task';
      td10.title = safeText(t.taskPreview);
      td10.textContent = safeText(t.taskPreview);

      tr.appendChild(td0);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(td5);
      tr.appendChild(td6);
      tr.appendChild(td7);
      tr.appendChild(td8);
      tr.appendChild(td9);
      tr.appendChild(td10);

      transactionTbody.appendChild(tr);
    });
  }

  // ── Filter & Search Event Listeners ──
  filterSession.addEventListener('change', function () { renderTransactions(cachedTransactions); });
  filterModel.addEventListener('change', function () { renderTransactions(cachedTransactions); });
  searchTask.addEventListener('input', function () { renderTransactions(cachedTransactions); });

  // ── Boot Application ──
  checkAuthSession();

})();
