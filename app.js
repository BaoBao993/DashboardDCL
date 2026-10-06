// ===== AUTHENTICATION MODULE (Email + Password, User Whitelist) =====
let currentUser = null;
let usersData = null;
let usersFileSha = null; // For GitHub API updates
let pendingUserChanges = false;

// Session and Google OAuth functions
function checkSession() {
  if (currentUser) return currentUser;
  const sessionStr = localStorage.getItem('currentUser');
  if (sessionStr) {
    try {
      currentUser = JSON.parse(sessionStr);
      if (currentUser && currentUser.email === 'tranlnb@ghn.vn') {
        currentUser.name = 'TRANLNB';
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      }
      return currentUser;
    } catch(e) {
      localStorage.removeItem('currentUser');
    }
  }
  return null;
}

function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed to decode JWT:", e);
    return null;
  }
}

function initGoogleSignIn() {
  const googleBtn = document.getElementById("googleBtn");
  if (!googleBtn) return;
  if (typeof google === 'undefined') {
    setTimeout(initGoogleSignIn, 500);
    return;
  }
  const client_id = (usersData && usersData.googleClientId) || '330492298909-gp40ri4hda2iphhfo9qk50uf1c69pc8u.apps.googleusercontent.com';
  google.accounts.id.initialize({
    client_id: client_id,
    callback: handleCredentialResponse
  });
  google.accounts.id.renderButton(
    googleBtn,
    { theme: "outline", size: "large", width: 280 }
  );
}

async function handleCredentialResponse(response) {
  try {
    const responsePayload = decodeJwt(response.credential);
    if (!responsePayload) {
      showLoginError('⚠️ Đăng nhập Google thất bại (không thể giải mã).');
      return;
    }
    const email = responsePayload.email.toLowerCase();
    const name = responsePayload.name;
    
    if (!usersData) await loadUsers();
    
    if (!usersData || !usersData.users) {
      showLoginError('⚠️ Không thể tải danh sách người dùng.');
      return;
    }
    
    let user = usersData.users.find(u => u.email.toLowerCase() === email);
    
    if (!user && email.endsWith('@ghn.vn')) {
      user = {
        email: email,
        name: name,
        role: 'user',
        createdAt: new Date().toISOString().split('T')[0]
      };
      usersData.users.push(user);
    }
    
    if (!user) {
      showLoginError(`🚫 Tài khoản Google (${email}) chưa được phê duyệt. Liên hệ Owner.`);
      return;
    }
    
    if (user.role === 'blocked') {
      showLoginError('🚫 Tài khoản đã bị khóa. Liên hệ Owner.');
      return;
    }
    
    currentUser = user;
    currentUser.name = name; // sync name from Google
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    enterDashboard();
    showToast(`✅ Đăng nhập Google thành công. Xin chào, ${escapeHtml(currentUser.name)}!`);
  } catch (err) {
    console.error('Google Auth Error:', err);
    showLoginError('⚠️ Lỗi hệ thống khi đăng nhập bằng Google.');
  }
}

// Brute-force lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 1000;
let failedAttempts = 0;
let lockoutUntil = 0;

// Telegram rate limiting
const TELEGRAM_COOLDOWN_MS = 5 * 1000;
let lastTelegramSendTime = 0;

function escapeMarkdown(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/`/g, '\\`');
}

function checkTelegramRateLimit() {
  const now = Date.now();
  if (now - lastTelegramSendTime < TELEGRAM_COOLDOWN_MS) {
    const waitSec = Math.ceil((TELEGRAM_COOLDOWN_MS - (now - lastTelegramSendTime)) / 1000);
    showToast(`⏳ Vui lòng đợi ${waitSec}s trước khi gửi tin nhắn tiếp.`);
    return false;
  }
  lastTelegramSendTime = now;
  return true;
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadUsers() {
  const str = await readFile('users.json');
  if (str) {
    try {
      usersData = JSON.parse(str);
      console.log('✅ Users loaded:', usersData.users.length, 'accounts');
    } catch(e) {
      console.error('❌ Failed to parse users.json:', e);
    }
  }
}

async function handleLogin() {
  // Lockout check
  if (Date.now() < lockoutUntil) {
    const waitSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
    showLoginError(`🔒 Tạm khóa. Thử lại sau ${waitSec} giây.`);
    return;
  }

  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const password = passInput ? passInput.value : '';

  if (!email || !password) {
    showLoginError('⚠️ Vui lòng nhập email và mật khẩu.');
    return;
  }

  // Load users if not loaded
  if (!usersData) await loadUsers();

  if (!usersData || !usersData.users || usersData.users.length === 0) {
    showLoginError('⚠️ Không thể tải danh sách người dùng.');
    return;
  }

  const user = usersData.users.find(u => u.email.toLowerCase() === email);

  if (!user) {
    failedAttempts++;
    handleFailedAttempt(passInput);
    return;
  }

  if (user.role === 'blocked') {
    showLoginError('🚫 Tài khoản đã bị khóa. Liên hệ Owner.');
    return;
  }

  const hash = await sha256(password);

  if (hash !== user.passwordHash) {
    failedAttempts++;
    handleFailedAttempt(passInput);
    return;
  }

  // Success
  failedAttempts = 0;
  currentUser = user;
  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  enterDashboard();
  showToast(`✅ Xin chào, ${escapeHtml(user.name)}!`);
}

function handleFailedAttempt(passInput) {
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    failedAttempts = 0;
    showLoginError(`🔒 Quá ${MAX_FAILED_ATTEMPTS} lần sai. Tạm khóa 60 giây.`);
    const errorEl = document.getElementById('loginError');
    const interval = setInterval(() => {
      const remain = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remain <= 0) {
        clearInterval(interval);
        if (errorEl) errorEl.style.display = 'none';
      } else if (errorEl) {
        errorEl.textContent = `🔒 Tạm khóa. Thử lại sau ${remain} giây...`;
      }
    }, 1000);
  } else {
    showLoginError(`⛔ Email hoặc mật khẩu không đúng. Còn ${MAX_FAILED_ATTEMPTS - failedAttempts} lần thử.`);
  }
  if (passInput) { passInput.value = ''; passInput.focus(); }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  showLoginScreen();
  showToast('👋 Đã đăng xuất thành công.');
  initGoogleSignIn();
}

function showLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) loginScreen.style.display = 'flex';

  const ids = ['onboarding', 'appHeader', 'appTabs', 'appMain', 'appReporting', 'appRecruitment', 'appReturnRate', 'appTransferBacklog'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.style.display = 'none';
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = 'none';
  const greeting = document.getElementById('userGreeting');
  if (greeting) greeting.style.display = 'none';
  const connectBtn = document.getElementById('connectFolderBtn');
  if (connectBtn) connectBtn.style.display = 'none';

  // Clear inputs
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput) emailInput.value = '';
  if (passInput) passInput.value = '';
  const errorEl = document.getElementById('loginError');
  if (errorEl) errorEl.style.display = 'none';
}

function enterDashboard() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) loginScreen.style.display = 'none';
  const onboarding = document.getElementById('onboarding');
  if (onboarding) onboarding.style.display = 'none';

  document.getElementById('appHeader').style.display = 'flex';
  document.getElementById('appTabs').style.display = 'flex';

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.style.display = 'flex';

  const connectBtn = document.getElementById('connectFolderBtn');
  if (connectBtn) {
    connectBtn.style.display = dirHandle ? 'none' : 'inline-flex';
  }

  // User greeting
  if (currentUser) {
    const greeting = document.getElementById('userGreeting');
    const nameEl = document.getElementById('userName');
    const badgeEl = document.getElementById('userRoleBadge');
    if (greeting) greeting.style.display = 'flex';
    if (nameEl) nameEl.textContent = currentUser.name;
    if (badgeEl) {
      badgeEl.textContent = currentUser.role === 'owner' ? '👑 Owner' : '👤 User';
      badgeEl.className = 'user-role-badge role-' + currentUser.role;
    }

    // Show admin button for owners
    if (currentUser.role === 'owner') {
      const adminBtn = document.getElementById('adminBtn');
      if (adminBtn) adminBtn.style.display = 'inline-flex';
    }
  }

  switchTab(activeTab || 'checklist');
  refreshData();
}

function showLoginError(msg) {
  const errorEl = document.getElementById('loginError');
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    errorEl.style.animation = 'none';
    errorEl.offsetHeight;
    errorEl.style.animation = 'shakeError 0.4s ease';
  }
}

// ===== ADMIN PANEL (Owner Only) =====
function openAdminPanel() {
  if (!currentUser || currentUser.role !== 'owner') return;
  document.getElementById('adminOverlay').style.display = 'flex';
  renderAdminUserTable();
}

function closeAdminPanel() {
  document.getElementById('adminOverlay').style.display = 'none';
}

function renderAdminUserTable() {
  const tbody = document.getElementById('adminUserTableBody');
  const countEl = document.getElementById('adminUserCount');
  if (!tbody || !usersData) return;

  tbody.innerHTML = '';
  countEl.textContent = usersData.users.length;

  usersData.users.forEach((user, idx) => {
    const tr = document.createElement('tr');
    const isBlocked = user.role === 'blocked';
    const isOwner = user.role === 'owner';
    const roleBadge = isOwner ? '<span class="badge-owner">👑 Owner</span>' :
                      isBlocked ? '<span class="badge-blocked">🚫 Blocked</span>' :
                      '<span class="badge-user">👤 User</span>';

    tr.innerHTML = `
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${roleBadge}</td>
      <td>${user.createdAt || 'N/A'}</td>
      <td>
        ${!isOwner ? `
          <button class="admin-btn-sm ${isBlocked ? 'btn-unblock' : 'btn-block'}" onclick="adminToggleBlock(${idx})">
            ${isBlocked ? '✅ Mở khóa' : '🚫 Khóa'}
          </button>
          <button class="admin-btn-sm btn-delete" onclick="adminDeleteUser(${idx})">❌ Xóa</button>
        ` : '<span style="color:var(--text-muted);font-size:11px;">Không thể sửa</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function adminAddUser() {
  const name = document.getElementById('adminNewName').value.trim();
  const email = document.getElementById('adminNewEmail').value.trim().toLowerCase();
  const pass = document.getElementById('adminNewPass').value;
  const role = document.getElementById('adminNewRole').value;

  if (!name || !email || !pass) {
    showToast('⚠️ Vui lòng nhập đủ tên, email và mật khẩu.');
    return;
  }

  if (usersData.users.find(u => u.email.toLowerCase() === email)) {
    showToast('⚠️ Email đã tồn tại.');
    return;
  }

  const hash = await sha256(pass);
  usersData.users.push({
    email: email,
    passwordHash: hash,
    role: role,
    name: name,
    createdAt: new Date().toISOString().split('T')[0]
  });

  pendingUserChanges = true;
  document.getElementById('adminNewName').value = '';
  document.getElementById('adminNewEmail').value = '';
  document.getElementById('adminNewPass').value = '';
  renderAdminUserTable();
  showToast(`✅ Đã thêm user: ${name}. Bấm "💾 Lưu" để áp dụng.`);
  updateSaveInfo();
}

function adminToggleBlock(idx) {
  const user = usersData.users[idx];
  if (!user || user.role === 'owner') return;
  user.role = user.role === 'blocked' ? 'user' : 'blocked';
  pendingUserChanges = true;
  renderAdminUserTable();
  showToast(`${user.role === 'blocked' ? '🚫 Đã khóa' : '✅ Đã mở khóa'}: ${user.name}`);
  updateSaveInfo();
}

function adminDeleteUser(idx) {
  const user = usersData.users[idx];
  if (!user || user.role === 'owner') return;
  if (!confirm(`Xóa user "${user.name}" (${user.email})?`)) return;
  usersData.users.splice(idx, 1);
  pendingUserChanges = true;
  renderAdminUserTable();
  showToast(`❌ Đã xóa: ${user.name}`);
  updateSaveInfo();
}

function updateSaveInfo() {
  const el = document.getElementById('adminSaveInfo');
  if (el) {
    el.textContent = pendingUserChanges ? '⚠️ Có thay đổi chưa lưu!' : '✅ Đã lưu.';
    el.style.color = pendingUserChanges ? 'var(--accent-amber)' : 'var(--accent-green)';
  }
}

async function adminSaveUsers() {
  if (!pendingUserChanges) {
    showToast('ℹ️ Không có thay đổi.');
    return;
  }

  // Prompt for GitHub token if not cached
  let ghToken = sessionStorage.getItem('gh_token');
  if (!ghToken) {
    ghToken = prompt('Nhập GitHub Personal Access Token để lưu:\n(Tạo tại: github.com > Settings > Developer settings > Personal access tokens > Tokens (classic) > Generate new token > chọn "repo" scope)');
    if (!ghToken) return;
    sessionStorage.setItem('gh_token', ghToken);
  }

  const ghConfig = usersData.github;
  const apiUrl = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${ghConfig.filePath}`;

  showToast('💾 Đang lưu...');

  try {
    // Get current file SHA
    const getRes = await fetch(apiUrl, {
      headers: { 'Authorization': `token ${ghToken}` }
    });
    let fileSha = '';
    if (getRes.ok) {
      const fileData = await getRes.json();
      fileSha = fileData.sha;
    }

    // Prepare content
    const jsonStr = JSON.stringify(usersData, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(jsonStr)));

    // Push to GitHub
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Update users.json - ${new Date().toLocaleString('vi-VN')}`,
        content: base64Content,
        sha: fileSha
      })
    });

    if (putRes.ok) {
      pendingUserChanges = false;
      showToast('✅ Đã lưu thay đổi lên GitHub thành công!');
      updateSaveInfo();
    } else {
      const err = await putRes.json();
      if (putRes.status === 401) {
        sessionStorage.removeItem('gh_token');
        showToast('⛔ Token không hợp lệ. Thử lại.');
      } else {
        showToast(`❌ Lỗi: ${err.message}`);
      }
    }
  } catch(e) {
    showToast(`❌ Lỗi kết nối: ${e.message}`);
  }
}

// ===== AUTH INITIALIZATION ON PAGE LOAD =====
document.addEventListener('DOMContentLoaded', async () => {
  // Load users first
  await loadUsers();

  // Check if session exists
  const sessionUser = checkSession();
  if (sessionUser) {
    currentUser = sessionUser;
    enterDashboard();
  } else {
    showLoginScreen();
    initGoogleSignIn();
  }

  // Enter key for login
  const passInput = document.getElementById('loginPassword');
  if (passInput) {
    passInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }
  const emailInput = document.getElementById('loginEmail');
  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const passEl = document.getElementById('loginPassword');
        if (passEl) passEl.focus();
      }
    });
  }
});

// ===== STATE =====
let dirHandle = null;
let taskSystemsContent = '';
let notebookContent = '';
let routineContent = '';
let quickType = 'idea';
let radarChart = null;


// ===== SECTION MAP =====
const SECTION_MAP = {
  priority: '## 🎯 Tiêu Điểm Tựu Thành (Top 3 Priorities)',
  routines: '## 🔄 Thói quen (Daily/Weekly Routines)',
  creating: '## ✍️ Creating (Sáng tạo, sản xuất)',
  reviewing: '## 🔍 Reviewing (Kiểm duyệt, phê duyệt)',
  connecting: '## 🔗 Connecting (Chuyển tiếp, kết nối)',
  presencing: '## 🗣️ Presencing (Hiện diện, tương tác)',
  contemplating: '## 🧘 Contemplating (Chiêm nghiệm)',
  horizon: '## 🔭 Tầm nhìn xa (Ngày mai & Tuần tới)'
};

const SECTION_ORDER = ['creating','reviewing','connecting','presencing','contemplating','horizon'];

// ===== FILE SYSTEM ACCESS =====
async function selectFolder() {
  try {
    let handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    
    // Auto-detect folder: if the selected folder is 'AI 2026', look inside for 'LDN PA'
    if (handle.name === 'AI 2026') {
      try {
        handle = await handle.getDirectoryHandle('LDN PA');
      } catch(err) {
        console.warn("Could not find LDN PA folder inside AI 2026", err);
      }
    } else if (handle.name !== 'LDN PA') {
      // Check if there is an 'LDN PA' folder inside
      try {
        const subHandle = await handle.getDirectoryHandle('LDN PA');
        if (subHandle) {
          handle = subHandle;
        }
      } catch(err) {}
    }
    
    dirHandle = handle;
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('appHeader').style.display = 'flex';
    document.getElementById('appTabs').style.display = 'flex';
    
    const connectBtn = document.getElementById('connectFolderBtn');
    if (connectBtn) connectBtn.style.display = 'none';
    
    // Restore logout button if logged in
    const session = checkSession();
    if (session) {
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.style.display = 'flex';
    }
    
    // Show the active tab correctly instead of forcing appMain grid
    switchTab(activeTab);
    
    await refreshData();
    showToast('✅ Đã kết nối thư mục thành công!');
  } catch(e) {
    if(e.name !== 'AbortError') showToast('❌ Lỗi: ' + e.message);
  }
}

async function readFile(name) {
  if (!dirHandle) {
    try {
      const res = await fetch(encodeURI(`./LDN PA/${name}?_=${Date.now()}`));
      if (res.ok) {
        return await res.text();
      }
    } catch(e) {
      console.warn("Failed to fetch file from server:", name, e);
    }
    return '';
  }
  try {
    const parts = name.split('/');
    let handle = dirHandle;
    for(let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await handle.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch(e) { return ''; }
}

async function writeFile(name, content) {
  if (!dirHandle) {
    showToast('⚠️ Đang ở Chế độ Chỉ Đọc. Chọn thư mục để có quyền chỉnh sửa.');
    return false;
  }
  try {
    const parts = name.split('/');
    let handle = dirHandle;
    for(let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await handle.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch(e) { showToast('❌ Ghi file thất bại: ' + e.message); return false; }
}

// ===== REFRESH =====
async function refreshData() {
  const now = new Date();
  let dateText = now.toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  if (!dirHandle) {
    dateText += ' | 👁️ Chế độ Chỉ Đọc (Kết nối thư mục để sửa)';
  }
  document.getElementById('dateDisplay').textContent = dateText;

  taskSystemsContent = await readFile('Task Systems.md');
  notebookContent = await readFile('Notebook.md');
  routineContent = await readFile('Routine.md');
  const insightsContent = await readFile('Operations_Insights.md');
  
  // Load operations_data.json
  const repJsonStr = await readFile('Vitality Compass/operations_data.json');
  if (repJsonStr) {
    try {
      repData = JSON.parse(repJsonStr);
    } catch(e) {
      console.error("Error parsing operations_data.json", e);
    }
  }

  // Load Telegram config
  await loadTelegramConfig();

  renderPriorities();
  renderTaskSections();
  renderRoutines();
  updateProgress();
  try {
    updateRadar();
  } catch(e) {
    console.error("Failed to update radar chart: ", e);
  }
  
  // Render reporting dashboard if data is available
  if (repData) {
    if (repData.latest_date) {
      const parts = repData.latest_date.split('-');
      if (parts.length === 3) {
        const dateEl = document.getElementById('dateDisplay');
        if (dateEl && !dateEl.textContent.includes('Vận hành:')) {
          dateEl.textContent += ` | Vận hành: ${parts[2]}/${parts[1]}/${parts[0]}`;
        }
      }
    }
    renderReportingView();
    renderRecruitmentView();
    renderWorstBcs();
    renderChecklistSidePanel();
    renderDroppedBcs();
    renderReturnRateView();
    renderTransferBacklogView();
    try {
      renderSomaticZen();
      renderPredictiveStaffing();
      renderRoutesHeatmap();
    } catch(e) {
      console.error("Failed to render new somatic/predictive views:", e);
    }
  } else if (insightsContent) {
    parseAndRenderInsights(insightsContent);
  }
  
  showToast('🔄 Dữ liệu đã cập nhật!');
}

function parseAndRenderInsights(content) {
  // Parse KPIs
  const gtcMatch = content.match(/-\s*\*\*GTC\*\*:\s*([0-9.]+\%)/i);
  const fdMatch = content.match(/-\s*\*\*FD\*\*:\s*([0-9.]+\%)/i);
  const ontimeMatch = content.match(/-\s*\*\*Ontime\*\*:\s*([0-9.]+\%)/i);
  const backlogMatch = content.match(/-\s*\*\*Backlog\*\*:\s*([0-9,]+)/i);
  const overallBacklogMatch = content.match(/-\s*\*\*Tồn đọng Lấy\/Giao\/Trả\*\*:\s*([0-9,]+)/i);
  const odrBacklogMatch = content.match(/-\s*\*\*Đơn ưu tiên giao trễ ODR\*\*:\s*([0-9,]+)/i);
  const transferBacklogMatch = content.match(/-\s*\*\*Tồn Luân Chuyển\*\*:\s*([0-9,]+)/i);

  if (gtcMatch) {
    const el = document.getElementById('kpiGTC');
    el.textContent = gtcMatch[1];
    const val = parseFloat(gtcMatch[1]);
    el.className = 'kpi-value ' + (val >= 60 ? 'good' : val >= 50 ? 'warn' : 'bad');
  }
  if (fdMatch) {
    const el = document.getElementById('kpiFD');
    el.textContent = fdMatch[1];
    const val = parseFloat(fdMatch[1]);
    el.className = 'kpi-value ' + (val <= 2.8 ? 'good' : val <= 3.5 ? 'warn' : 'bad');
  }
  if (ontimeMatch) {
    const el = document.getElementById('kpiOntime');
    el.textContent = ontimeMatch[1];
    const val = parseFloat(ontimeMatch[1]);
    el.className = 'kpi-value ' + (val >= 90 ? 'good' : val >= 85 ? 'warn' : 'bad');
  }
  if (backlogMatch) {
    const el = document.getElementById('kpiBacklog');
    el.textContent = backlogMatch[1];
    const val = parseInt(backlogMatch[1].replace(/,/g, ''));
    el.className = 'kpi-value ' + (val < 500 ? 'good' : val < 1500 ? 'warn' : 'bad');
  }
  if (overallBacklogMatch) {
    const el = document.getElementById('kpiOverallBacklog');
    if (el) el.textContent = overallBacklogMatch[1];
  }
  if (transferBacklogMatch) {
    const el = document.getElementById('kpiTransferBacklog');
    if (el) el.textContent = transferBacklogMatch[1];
  }
  if (odrBacklogMatch) {
    const el = document.getElementById('kpiODRBacklog');
    if (el) el.textContent = odrBacklogMatch[1];
  }

  // Parse AM Scorecard Table
  const lines = content.split('\n');
  let inTable = false;
  const amRows = [];
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('|') && line.toLowerCase().includes('am') && line.toLowerCase().includes('gtc') && line.toLowerCase().includes('trạng thái')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (line.startsWith('|')) {
        if (line.includes('---')) continue;
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 6) {
          const amName = parts[1];
          const gtc = parts[2];
          const fd = parts[3];
          const status = parts[4];
          const aging = parts[5];
          if (amName && amName.toLowerCase() !== 'am') {
            amRows.push({ amName, gtc, fd, status, aging });
          }
        }
      } else {
        inTable = false;
      }
    }
  }

  const amTableBody = document.getElementById('amTableBody');
  if (amTableBody && amRows.length > 0) {
    amTableBody.innerHTML = '';
    amRows.forEach(row => {
      const tr = document.createElement('tr');
      let statusClass = 'strong';
      if (row.status === 'Cải thiện') statusClass = 'improve';
      else if (row.status === 'Yếu') statusClass = 'weak';

      tr.innerHTML = `
        <td>${escapeHtml(row.amName)}</td>
        <td>
          ${escapeHtml(row.gtc)}
          <div style="font-size:10px;color:var(--text-muted)">Aging: ${escapeHtml(row.aging)} \| FD: ${escapeHtml(row.fd)}</div>
        </td>
        <td><span class="am-tag ${statusClass}">${escapeHtml(row.status)}</span></td>
      `;
      amTableBody.appendChild(tr);
    });
  }
}


// ===== PARSING =====
function extractTasksFromSection(content, sectionHeading) {
  const idx = content.indexOf(sectionHeading);
  if(idx === -1) return [];
  const afterSection = content.substring(idx + sectionHeading.length);
  const nextSection = afterSection.search(/\n## /);
  const block = nextSection === -1 ? afterSection : afterSection.substring(0, nextSection);
  const lines = block.split('\n');
  const tasks = [];
  for(const line of lines) {
    const trimmed = line.trim();
    if(trimmed.startsWith('- [ ] ')) {
      tasks.push({ text: trimmed.substring(6), done: false, raw: trimmed });
    } else if(trimmed.startsWith('- [x] ')) {
      tasks.push({ text: trimmed.substring(6), done: true, raw: trimmed });
    }
  }
  return tasks;
}

// ===== RENDER =====
function renderPriorities() {
  const container = document.getElementById('priorityList');
  if (!container) return;
  const tasks = extractTasksFromSection(taskSystemsContent, SECTION_MAP.priority);
  container.innerHTML = '';
  tasks.forEach((t, i) => {
    container.appendChild(createTaskEl(t, 'priority', i));
  });
  const done = tasks.filter(t => t.done).length;
  const badge = document.getElementById('priorityBadge');
  if (badge) badge.textContent = done + '/' + tasks.length;
}

function renderTaskSections() {
  const container = document.getElementById('taskSections');
  if (!container) return;
  container.innerHTML = '';
  let totalTasks = 0;
  for(const key of SECTION_ORDER) {
    const tasks = extractTasksFromSection(taskSystemsContent, SECTION_MAP[key]);
    if(tasks.length === 0) continue;
    totalTasks += tasks.length;
    const section = document.createElement('div');
    section.className = 'task-section';
    const icon = SECTION_MAP[key].split(' ')[1];
    const label = SECTION_MAP[key].replace(/^## /, '');
    section.innerHTML = '<div class="section-title">' + label + '</div>';
    tasks.forEach((t, i) => {
      section.appendChild(createTaskEl(t, key, i));
    });
    container.appendChild(section);
  }
  const badge = document.getElementById('taskBadge');
  if (badge) badge.textContent = totalTasks;
}

function createTaskEl(task, sectionKey, index) {
  const div = document.createElement('div');
  div.className = 'task-item';
  div.innerHTML =
    '<div class="task-checkbox ' + (task.done ? 'checked' : '') + '"></div>' +
    '<span class="task-text ' + (task.done ? 'done' : '') + '">' + escapeHtml(task.text) + '</span>';
  div.querySelector('.task-checkbox').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTask(task, sectionKey);
  });
  return div;
}

function renderRoutines() {
  const container = document.getElementById('routineList');
  if (!container) return;
  const tasks = extractTasksFromSection(taskSystemsContent, SECTION_MAP.routines);
  container.innerHTML = '';
  if(tasks.length === 0) {
    // Fallback: read from Routine.md daily section
    const dailyTasks = extractTasksFromSection(routineContent, '## 🌅 Hàng ngày (Daily)');
    dailyTasks.forEach(t => {
      container.appendChild(createRoutineEl(t));
    });
    return;
  }
  tasks.forEach(t => {
    container.appendChild(createRoutineEl(t));
  });
}

function createRoutineEl(task) {
  const div = document.createElement('div');
  div.className = 'routine-item';
  div.innerHTML =
    '<button class="toggle-btn ' + (task.done ? 'active' : '') + '"></button>' +
    '<span class="routine-text ' + (task.done ? 'active' : '') + '">' + escapeHtml(task.text) + '</span>';
  div.querySelector('.toggle-btn').addEventListener('click', () => toggleRoutine(task));
  return div;
}

// ===== TOGGLE TASK =====
async function toggleTask(task, sectionKey) {
  const oldStr = task.done ? '- [x] ' + task.text : '- [ ] ' + task.text;
  const newStr = task.done ? '- [ ] ' + task.text : '- [x] ' + task.text;
  taskSystemsContent = taskSystemsContent.replace(oldStr, newStr);
  await writeFile('Task Systems.md', taskSystemsContent);
  renderPriorities();
  renderTaskSections();
  renderRoutines();
  updateProgress();
  updateRadar();
}

async function toggleRoutine(task) {
  // Try in Task Systems first, then Routine.md
  const oldStr = task.done ? '- [x] ' + task.text : '- [ ] ' + task.text;
  const newStr = task.done ? '- [ ] ' + task.text : '- [x] ' + task.text;
  if(taskSystemsContent.includes(oldStr)) {
    taskSystemsContent = taskSystemsContent.replace(oldStr, newStr);
    await writeFile('Task Systems.md', taskSystemsContent);
  } else if(routineContent.includes(oldStr)) {
    routineContent = routineContent.replace(oldStr, newStr);
    await writeFile('Routine.md', routineContent);
  }
  renderRoutines();
  updateProgress();
}

// ===== ADD TASK =====
async function addTask(type) {
  const inputId = type === 'priority' ? 'priorityInput' : 'taskInput';
  const input = document.getElementById(inputId);
  const text = input.value.trim();
  if(!text) return;

  let heading;
  if(type === 'priority') {
    heading = SECTION_MAP.priority;
  } else {
    const sel = document.getElementById('taskSectionSelect').value;
    heading = SECTION_MAP[sel];
  }

  const newLine = '- [ ] ' + text;
  const idx = taskSystemsContent.indexOf(heading);
  if(idx === -1) return;
  const insertPos = idx + heading.length;
  taskSystemsContent = taskSystemsContent.substring(0, insertPos) + '\n' + newLine + taskSystemsContent.substring(insertPos);

  await writeFile('Task Systems.md', taskSystemsContent);
  input.value = '';
  renderPriorities();
  renderTaskSections();
  updateProgress();
  updateRadar();
  showToast('✅ Đã thêm: ' + text);
}

// ===== QUICK ADD NOTEBOOK =====
function setQuickType(type, el) {
  quickType = type;
  document.querySelectorAll('.quick-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const placeholders = { idea:'Nhập ý tưởng...', urgent:'Việc gấp hôm nay...', tomorrow:'Việc gấp ngày mai...', project:'Việc không gấp...' };
  document.getElementById('quickInput').placeholder = placeholders[type] || '';
}

async function quickAdd() {
  const input = document.getElementById('quickInput');
  const text = input.value.trim();
  if(!text) return;

  const newLine = '- [ ] ' + text;
  const headingMap = {
    idea: '## 💡 Ý tưởng đột xuất (Ideas)',
    urgent: '### 🚨 Gấp trong hôm nay',
    tomorrow: '### 🌅 Gấp trong ngày mai',
    project: '### 🛋️ Không gấp (Thuộc dự án)'
  };
  const heading = headingMap[quickType];
  const idx = notebookContent.indexOf(heading);
  if(idx === -1) { showToast('❌ Không tìm thấy mục trong Notebook.md'); return; }
  const insertPos = idx + heading.length;
  notebookContent = notebookContent.substring(0, insertPos) + '\n' + newLine + notebookContent.substring(insertPos);

  await writeFile('Notebook.md', notebookContent);
  input.value = '';
  showToast('📝 Đã ghi vào Notebook!');
}

// ===== PROGRESS =====
function updateProgress() {
  const textEl = document.getElementById('progressText');
  const fillEl = document.getElementById('progressFill');
  if (!textEl && !fillEl) return;
  let total = 0, done = 0;
  for(const key of ['priority', ...SECTION_ORDER, 'routines']) {
    const tasks = extractTasksFromSection(taskSystemsContent, SECTION_MAP[key]);
    total += tasks.length;
    done += tasks.filter(t => t.done).length;
  }
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  if (textEl) textEl.textContent = pct + '%';
  if (fillEl) fillEl.style.width = pct + '%';
}

// ===== RADAR CHART =====
function updateRadar() {
  const counts = {};
  for(const key of SECTION_ORDER) {
    const tasks = extractTasksFromSection(taskSystemsContent, SECTION_MAP[key]);
    counts[key] = tasks.filter(t => t.done).length;
  }

  const labels = ['Sáng tạo','Kiểm duyệt','Kết nối','Hiện diện','Chiêm nghiệm','Tầm nhìn'];
  const data = SECTION_ORDER.map(k => counts[k] || 0);

  if(radarChart) radarChart.destroy();
  const canvas = document.getElementById('radarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Hoàn thành',
        data: data,
        backgroundColor: 'rgba(45,212,191,0.15)',
        borderColor: '#2dd4bf',
        borderWidth: 2,
        pointBackgroundColor: '#2dd4bf',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          beginAtZero: true,
          ticks: { display: false, stepSize: 1 },
          grid: { color: 'rgba(42,58,82,0.5)' },
          pointLabels: { color: '#8899b0', font: { size: 11 } },
          angleLines: { color: 'rgba(42,58,82,0.5)' }
        }
      }
    }
  });
}

// ===== HELPERS =====
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Enter key support
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;
  if(document.activeElement.id === 'priorityInput') addTask('priority');
  if(document.activeElement.id === 'taskInput') addTask('section');
  if(document.activeElement.id === 'quickInput') quickAdd();
});

// ===== REPORTING VIEW STATE & DYNAMIC LOGIC =====
let repData = null;
let activeTab = 'checklist';
let activeDim = 'province';
let activeTrendMetric = 'gtc';
let trendChartObj = null;
let tableSearchQuery = '';
let telegramConfig = null;

// ===== RETURN RATE (%FD) STATE =====
let activeFdMetric = 'total';
let activeFdTrendMetric = 'weekly';
let activeFdViewMode = 'weekly';
let activeFdDimension = 'bc';
let fdTableSearchQuery = '';
let fdTrendChartObj = null;

// ===== RECRUITMENT VIEW STATE =====
let activeHrDim = 'province';
let hrTableSearchQuery = '';
let hrChartObj = null;

// ===== DROPPED TRANSFER SORT STATE =====
let activeDroppedSort = 'tts';

async function loadTelegramConfig() {
  const confStr = await readFile('telegram_config.json');
  if (confStr) {
    try {
      telegramConfig = JSON.parse(confStr);
      console.log('✅ Telegram config loaded:', telegramConfig.CHAT_ID ? 'OK' : 'Missing CHAT_ID');
    } catch(e) {
      console.error('❌ Failed to parse telegram_config.json:', e);
    }
  }
}

function switchTab(tabName) {
  activeTab = tabName;
  const checklistMain = document.getElementById('appMain');
  const reportingMain = document.getElementById('appReporting');
  const recruitmentMain = document.getElementById('appRecruitment');
  const returnRateMain = document.getElementById('appReturnRate');
  const transferBacklogMain = document.getElementById('appTransferBacklog');
  
  const tabCheck = document.getElementById('tabChecklist');
  const tabRep = document.getElementById('tabReporting');
  const tabRec = document.getElementById('tabRecruitment');
  const tabRet = document.getElementById('tabReturnRate');
  const tabTb = document.getElementById('tabTransferBacklog');

  checklistMain.style.display = 'none';
  reportingMain.style.display = 'none';
  recruitmentMain.style.display = 'none';
  if (returnRateMain) returnRateMain.style.display = 'none';
  if (transferBacklogMain) transferBacklogMain.style.display = 'none';
  
  tabCheck.classList.remove('active');
  tabRep.classList.remove('active');
  tabRec.classList.remove('active');
  if (tabRet) tabRet.classList.remove('active');
  if (tabTb) tabTb.classList.remove('active');

  if (tabName === 'checklist') {
    checklistMain.style.display = 'grid';
    tabCheck.classList.add('active');
  } else if (tabName === 'reporting') {
    reportingMain.style.display = 'flex';
    reportingMain.style.flexDirection = 'column';
    tabRep.classList.add('active');
    if (repData) {
      setTimeout(renderTrendChart, 50);
    }
  } else if (tabName === 'recruitment') {
    recruitmentMain.style.display = 'flex';
    recruitmentMain.style.flexDirection = 'column';
    tabRec.classList.add('active');
    if (repData) {
      setTimeout(renderRecruitmentView, 50);
    }
  } else if (tabName === 'return_rate') {
    if (returnRateMain) {
      returnRateMain.style.display = 'flex';
      returnRateMain.style.flexDirection = 'column';
    }
    if (tabRet) tabRet.classList.add('active');
    if (repData) {
      setTimeout(renderReturnRateView, 50);
    }
  } else if (tabName === 'transfer_backlog') {
    if (transferBacklogMain) {
      transferBacklogMain.style.display = 'flex';
      transferBacklogMain.style.flexDirection = 'column';
    }
    if (tabTb) tabTb.classList.add('active');
    if (repData) {
      setTimeout(renderTransferBacklogView, 50);
    }
  }
}

function renderWorstBcs() {
  if (!repData || !repData.bcs) return;

  const container = document.getElementById('worstBcTableBody');
  if (!container) return;

  container.innerHTML = '';

  // Determine thresholds dynamically to find active anomalies
  // 1. Low GTC: gtc < 0.60
  // 2. High Backlog: backlog >= 30
  // 3. Return rate spike: fd_change >= 0.01 (+1% or more)
  const candidates = [...repData.bcs]
    .filter(bc => bc.volume > 0)
    .map(bc => {
      let severity = 0;
      let matchesCriteria = false;
      const reasons = [];

      // Check GTC: target is 67%, flag if below 55% heavily or below 60% generally
      if (bc.gtc < 0.60) {
        severity += (0.60 - bc.gtc) * 100 * 2; // e.g. GTC 13.76% -> +92.5 points
        matchesCriteria = true;
        reasons.push(`<span style="color: var(--accent-rose); background: rgba(244,63,94,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">🔴 GTC thấp: ${(bc.gtc*100).toFixed(1)}%</span>`);
      }

      // Check Backlog: flag if backlog is 30 or more units
      if (bc.backlog >= 30) {
        severity += (bc.backlog / 10) * 1.5; // e.g. 646 backlog -> +96.9 points; 30 backlog -> +4.5 points
        matchesCriteria = true;
        reasons.push(`<span style="color: var(--accent-amber); background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">📦 Tồn cao: ${bc.backlog} đơn</span>`);
      }

      // Check Return rate spike: fd_change >= 0.01 (increased by 1% or more compared to yesterday)
      if (bc.fd_change >= 0.01) {
        severity += (bc.fd_change * 100) * 10; // e.g. +2% spike -> +20 points
        severity += 30; // base penalty for having a spike >= 1%
        matchesCriteria = true;
        reasons.push(`<span style="color: var(--accent-purple); background: rgba(167,139,250,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">⚠️ Trả tăng vọt: +${(bc.fd_change*100).toFixed(1)}%</span>`);
      }

      // Check staffing shortage: shortage_actual / target_headcount >= 20%
      if (bc.hr && bc.hr.target_headcount > 0) {
        const shortagePct = bc.hr.shortage_actual / bc.hr.target_headcount;
        if (shortagePct >= 0.20) {
          severity += shortagePct * 100 * 1.5;
          matchesCriteria = true;
          reasons.push(`<span style="color: #f43f5e; background: rgba(244,63,94,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">🚨 Thiếu NV: -${bc.hr.shortage_actual}</span>`);
        }
      }

      // Check Resign wave: resign_week >= 3
      if (bc.hr && bc.hr.resign_week >= 3) {
        severity += bc.hr.resign_week * 10;
        matchesCriteria = true;
        reasons.push(`<span style="color: #f43f5e; background: rgba(244,63,94,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">⚠️ Nghỉ việc: -${bc.hr.resign_week}</span>`);
      }

      // Check Newbie overload: ob_week / target_headcount >= 20%
      if (bc.hr && bc.hr.target_headcount > 0) {
        const obPct = bc.hr.ob_week / bc.hr.target_headcount;
        if (obPct >= 0.20) {
          severity += obPct * 100 * 0.5;
          matchesCriteria = true;
          reasons.push(`<span style="color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">🌱 Shipper mới: +${bc.hr.ob_week}</span>`);
        }
      }

      // Check Dropped transfer
      if (bc.cause && bc.cause.includes("Rớt luân chuyển")) {
        severity += 20;
        matchesCriteria = true;
        reasons.push(`<span style="color: #a78bfa; background: rgba(167,139,250,0.1); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block; margin-right: 4px; margin-top: 4px;">🔄 Rớt luân chuyển</span>`);
      }

      // Fallback: If it doesn't match any criteria but we need to fill the list, sort by GTC
      if (!matchesCriteria) {
        severity = (0.67 - bc.gtc) * 5; // very small severity baseline
      }

      return { bc, severity, reasons };
    });

  // Sort candidates by computed severity descending
  candidates.sort((a, b) => b.severity - a.severity);

  const worstBcs = candidates.slice(0, 10);

  worstBcs.forEach(item => {
    const bc = item.bc;
    const tr = document.createElement('tr');
    
    // GTC Change formatting
    const changeVal = bc.gtc_change;
    const arrow = changeVal >= 0 ? '↗' : '↘';
    const sign = changeVal >= 0 ? '+' : '';
    const changeColor = changeVal >= 0 ? 'var(--accent-green)' : 'var(--accent-rose)';
    const changeText = `${arrow} ${sign}${(changeVal * 100).toFixed(2)}%`;

    const amDisplay = bc.am && bc.am !== 'N/A' && bc.am !== 'nan' ? bc.am : 'Chưa phân AM';
    const teleDisplay = bc.am_tele ? `<div style="font-size: 9px; color: var(--text-muted); margin-top: 1px;">${escapeHtml(bc.am_tele)}</div>` : '';
    
    // Backlog badge class
    const blBadgeCls = bc.backlog > 0 ? 'has-backlog' : 'no-backlog';
    
    // Join badges beautifully
    const badgesHtml = item.reasons.length > 0 ? `<div style="margin-top: 4px;">${item.reasons.join('')}</div>` : '';
    
    tr.innerHTML = `
      <td style="padding: 12px 6px; vertical-align: top;">
        <div style="font-weight: 600; color: #fff; font-size: 13px; line-height: 1.4;">${escapeHtml(bc.name)}</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Tỉnh: ${escapeHtml(bc.province)} | Sản lượng: ${bc.volume.toLocaleString()}</div>
        ${badgesHtml}
        <div style="font-size: 11px; color: var(--accent-rose); background: rgba(244,63,94,0.06); border-left: 2px solid var(--accent-rose); padding: 5px 8px; margin-top: 6px; line-height: 1.4; border-radius: 0 4px 4px 0;">
          <strong>Nguyên nhân:</strong> ${escapeHtml(bc.cause)}
        </div>
      </td>
      <td style="padding: 12px 6px; vertical-align: top; font-size: 12px;">
        <div style="color: var(--text-primary); font-weight: 500;">👤 ${escapeHtml(amDisplay)}</div>
        ${teleDisplay}
      </td>
      <td style="padding: 12px 6px; vertical-align: top; text-align: center;">
        <div style="font-size: 13px; font-weight: 700; color: var(--accent-rose);">${(bc.gtc * 100).toFixed(2)}%</div>
        <div style="font-size: 10px; color: ${changeColor}; margin-top: 2px; font-weight: 500;">${changeText}</div>
      </td>
      <td style="padding: 12px 6px; vertical-align: top; text-align: center;">
        <span class="bc-backlog-badge ${blBadgeCls}" style="padding: 2px 6px; font-size: 10px; border-radius: 4px; display: inline-block;">${bc.backlog} đơn</span>
      </td>
      <td style="padding: 12px 6px; vertical-align: top; text-align: center;">
        <button class="bc-btn bc-btn-primary" style="padding: 4px 8px; font-size: 11px; height: auto; width: auto; display: inline-block;" onclick="sendTop10Alert('${escapeHtml(bc.name)}', '${escapeHtml(bc.am)}', '${escapeHtml(bc.am_tele)}', '${(bc.gtc*100).toFixed(2)}%', '${escapeHtml(changeText)}', '${bc.backlog}', '${escapeHtml(bc.cause)}')">Nhắc AM</button>
      </td>
    `;
    container.appendChild(tr);
  });
}

async function sendTop10Alert(bcName, amName, amTele, gtcVal, changeText, backlog, cause) {
  if (!telegramConfig || !telegramConfig.BOT_TOKEN || !telegramConfig.CHAT_ID) {
    showToast("⚠️ Vui lòng cấu hình BOT_TOKEN & CHAT_ID trong file telegram_config.json");
    return;
  }
  if (!checkTelegramRateLimit()) return;

  const token = telegramConfig.BOT_TOKEN;
  const chatId = telegramConfig.CHAT_ID;
  const threadId = telegramConfig.THREADS && telegramConfig.THREADS.top10;

  // Look up full post office details to fetch dynamic HR metrics
  const bc = repData && repData.bcs ? repData.bcs.find(b => b.name === bcName) : null;
  let hrInfo = "";
  let recInfo = "";

  if (bc && bc.hr) {
    hrInfo = `*Nhân sự:* Thiếu ${bc.hr.shortage_actual}/${bc.hr.target_headcount} NVPTTT | Biến động tuần: +${bc.hr.ob_week} OB / -${bc.hr.resign_week} nghỉ\n`;
    if (bc.hr.tuyen_thieu) {
      hrInfo += `*Tuyến thiếu:* ${bc.hr.tuyen_thieu}\n`;
    }
    if (bc.hr.hrbp && bc.hr.hrbp !== 'N/A') {
      hrInfo += `*HRBP Phụ Trách:* ${bc.hr.hrbp}\n`;
    }
    hrInfo += `\n`;
    
    if (bc.recommendation) {
      recInfo = `*Khuyến nghị hành động:* ${bc.recommendation}\n\n`;
    }
  }

  // Determine telegram warning label header
  let labelHeader = `🚨 *[TOP 10 BƯU CỤC CẦN CHÚ Ý]* 🚨`;
  if (bc && bc.hr && bc.hr.target_headcount > 0 && bc.hr.shortage_actual / bc.hr.target_headcount >= 0.20) {
    labelHeader = `🚨 *[CẢNH BÁO NHÂN SỰ & VẬN HÀNH TOP 10]* 🚨`;
  }

  const text = `${labelHeader}\n\n` +
               `*Bưu cục:* ${escapeMarkdown(bcName)}\n` +
               `*AM Phụ Trách:* ${escapeMarkdown(amName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n\n` +
               `*Tỷ lệ GTC hiện tại:* ${escapeMarkdown(gtcVal)} (Biến động N-1: ${escapeMarkdown(changeText)})\n` +
               `*Đơn Tồn > 5 ngày:* ${escapeMarkdown(backlog)} đơn\n\n` +
               hrInfo +
               `*Nguyên nhân:* ${escapeMarkdown(cause)}\n\n` +
               recInfo +
               `👉 Đề nghị AM cắm chốt xử lý và HRBP phối hợp tuyển dụng/điều phối gấp!`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  showToast(`💬 Đang gửi cảnh báo Top 10 tới Telegram...`);

  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (threadId) payload.message_thread_id = threadId;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("✅ Đã gửi cảnh báo Telegram thành công!");
    } else {
      const err = await res.json();
      showToast(`❌ Gửi Telegram thất bại: ${err.description}`);
    }
  } catch (e) {
    showToast(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
}

function renderChecklistSidePanel() {
  if (!repData) return;

  // 1. Update KPIs
  const kpis = repData.kpis;
  if (kpis) {
    if (kpis.gtc) {
      const el = document.getElementById('kpiGTC');
      if (el) {
        const val = kpis.gtc.value * 100;
        el.textContent = val.toFixed(1) + '%';
        el.className = 'kpi-value ' + (val >= 67 ? 'good' : val >= 55 ? 'warn' : 'bad');
      }
    }
    if (kpis.fd) {
      const el = document.getElementById('kpiFD');
      if (el) {
        const val = kpis.fd.value * 100;
        el.textContent = val.toFixed(1) + '%';
        el.className = 'kpi-value ' + (val <= 2.8 ? 'good' : val <= 3.5 ? 'warn' : 'bad');
      }
    }
    const ontimeEl = document.getElementById('kpiOntime');
    if (ontimeEl) {
      ontimeEl.textContent = '91.5%';
      ontimeEl.className = 'kpi-value good';
    }
    if (kpis.backlog) {
      const el = document.getElementById('kpiBacklog');
      if (el) {
        el.textContent = kpis.backlog.value.toLocaleString();
        const val = kpis.backlog.value;
        el.className = 'kpi-value ' + (val < 500 ? 'good' : val < 1500 ? 'warn' : 'bad');
      }
    }
    if (repData.overall_backlog) {
      const el = document.getElementById('kpiOverallBacklog');
      if (el) el.textContent = repData.overall_backlog.total.toLocaleString();
    }
    if (repData.transfer_backlog && repData.transfer_backlog.kpis) {
      const el = document.getElementById('kpiTransferBacklog');
      if (el) el.textContent = repData.transfer_backlog.kpis.total.toLocaleString();
    }
    if (repData.odr_backlog) {
      const el = document.getElementById('kpiODRBacklog');
      if (el) {
        const totalVal = repData.odr_backlog.total.toLocaleString();
        const pctVal = (repData.odr_backlog.percentage * 100).toFixed(1) + '%';
        el.textContent = `${totalVal} (${pctVal})`;
      }
    }
  }

  // Update badges to "Thực tế" instead of "Demo"
  const kpiBadge = document.getElementById('kpiBadgeChecklist');
  if (kpiBadge) {
    kpiBadge.textContent = 'Thực tế';
    kpiBadge.style.background = 'rgba(34,197,94,0.15)';
    kpiBadge.style.color = 'var(--accent-green)';
  }
  const amBadge = document.getElementById('amBadgeChecklist');
  if (amBadge) {
    amBadge.textContent = 'Thực tế';
    amBadge.style.background = 'rgba(34,197,94,0.15)';
    amBadge.style.color = 'var(--accent-green)';
  }

  // 2. Update AM table
  const amTableBody = document.getElementById('amTableBody');
  if (amTableBody && repData.ams) {
    amTableBody.innerHTML = '';
    repData.ams.forEach(am => {
      const tr = document.createElement('tr');
      let statusClass = 'strong';
      if (am.status === 'Cải thiện') statusClass = 'improve';
      else if (am.status === 'Yếu') statusClass = 'weak';

      tr.innerHTML = `
        <td>${escapeHtml(am.name)}</td>
        <td>
          ${(am.gtc * 100).toFixed(1)}%
          <div style="font-size:10px;color:var(--text-muted)">Tồn: ${am.backlog} | FD: ${(am.fd * 100).toFixed(1)}%</div>
        </td>
        <td><span class="am-tag ${statusClass}">${escapeHtml(am.status)}</span></td>
      `;
      amTableBody.appendChild(tr);
    });
  }
}

function renderDroppedBcs() {
  if (!repData || !repData.dropped_bcs) return;

  const container = document.getElementById('droppedBcTableBody');
  if (!container) return;

  container.innerHTML = '';

  // Sort the dropped list based on activeDroppedSort descending (TTS is default)
  const droppedList = [...repData.dropped_bcs];
  droppedList.sort((a, b) => {
    const valA = a[activeDroppedSort] || 0;
    const valB = b[activeDroppedSort] || 0;
    if (valB !== valA) {
      return valB - valA;
    }
    // Secondary sort by total descending
    if (activeDroppedSort !== 'total') {
      return (b.total || 0) - (a.total || 0);
    }
    return 0;
  });
  
  // Update badge count
  const badge = document.getElementById('droppedBcBadge');
  if (badge) {
    badge.textContent = droppedList.length + ' BC';
  }

  // 1. Calculate max total/value across all items to calibrate heatmap
  let maxVal = 1;
  droppedList.forEach(item => {
    if (item.khac > maxVal) maxVal = item.khac;
    if (item.shopee > maxVal) maxVal = item.shopee;
    if (item.tts > maxVal) maxVal = item.tts;
    if (item.total > maxVal) maxVal = item.total;
  });

  // Helper function for Excel-like heatmap colors
  function getExcelHeatmapColor(val, maxVal) {
    if (!val || val <= 0) return '';
    const ratio = val / maxVal;
    // Interpolate between a very light pink #fdebeb (253, 235, 235) and a solid red #ea3b2f (234, 59, 47)
    const r = Math.round(253 - ratio * (253 - 234));
    const g = Math.round(235 - ratio * (235 - 59));
    const b = Math.round(235 - ratio * (235 - 47));
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Initialize total accumulators for the grand total row
  let totalKhac = 0;
  let totalShopee = 0;
  let totalTts = 0;
  let totalGrand = 0;

  // 2. Render each data row
  droppedList.forEach(item => {
    totalKhac += item.khac || 0;
    totalShopee += item.shopee || 0;
    totalTts += item.tts || 0;
    totalGrand += item.total || 0;

    const tr = document.createElement('tr');
    
    // Find AM Tele username
    const amTele = findAmTele(item.am);
    const teleDisplay = amTele ? `<div style="font-size: 8px; color: #5a6a80; margin-top: 1px;">${escapeHtml(amTele)}</div>` : '';
    
    // Determine cell styling (heatmap backgrounds and black text)
    const khacBg = item.khac > 0 ? `background-color: ${getExcelHeatmapColor(item.khac, maxVal)};` : '';
    const shopeeBg = item.shopee > 0 ? `background-color: ${getExcelHeatmapColor(item.shopee, maxVal)};` : '';
    const ttsBg = item.tts > 0 ? `background-color: ${getExcelHeatmapColor(item.tts, maxVal)};` : '';
    const totalBg = item.total > 0 ? `background-color: ${getExcelHeatmapColor(item.total, maxVal)};` : '';

    tr.innerHTML = `
      <td class="am-cell" style="vertical-align: middle;">
        <div style="font-weight: 500;">${escapeHtml(item.am)}</div>
        ${teleDisplay}
      </td>
      <td class="bc-cell" style="vertical-align: middle;">
        <strong style="color: #111827;">${escapeHtml(item.bc_name)}</strong>
      </td>
      <td class="num-cell" style="${khacBg}">
        ${item.khac > 0 ? item.khac : ''}
      </td>
      <td class="num-cell" style="${shopeeBg}">
        ${item.shopee > 0 ? item.shopee : ''}
      </td>
      <td class="num-cell" style="${ttsBg}">
        ${item.tts > 0 ? item.tts : ''}
      </td>
      <td class="num-cell" style="${totalBg} font-weight: bold;">
        ${item.total > 0 ? item.total : ''}
      </td>
      <td style="text-align: center; background-color: #ffffff;">
        <button class="btn-nhac-am" onclick="sendDroppedAlert('${escapeHtml(item.bc_name)}', '${escapeHtml(item.am)}', '${escapeHtml(amTele)}', ${item.khac}, ${item.shopee}, ${item.tts}, ${item.total})">Nhắc AM</button>
      </td>
    `;
    container.appendChild(tr);
  });

  // 3. Append the Grand Total row
  const trTotal = document.createElement('tr');
  trTotal.className = 'grand-total-row';
  trTotal.innerHTML = `
    <td class="am-cell" style="background-color: #f2f2f2;"></td>
    <td class="bc-cell" style="font-weight: bold; color: #000000; background-color: #f2f2f2;">Grand Total</td>
    <td class="num-cell" style="font-weight: bold; color: #000000; background-color: #f2f2f2;">${totalKhac}</td>
    <td class="num-cell" style="font-weight: bold; color: #000000; background-color: #f2f2f2;">${totalShopee}</td>
    <td class="num-cell" style="font-weight: bold; color: #000000; background-color: #f2f2f2;">${totalTts}</td>
    <td class="num-cell" style="font-weight: bold; color: #000000; background-color: #f2f2f2;">${totalGrand}</td>
    <td style="background-color: #f2f2f2;"></td>
  `;
  container.appendChild(trTotal);
}

function changeDroppedSort(value) {
  activeDroppedSort = value;
  const selectEl = document.getElementById('droppedBcSortSelect');
  if (selectEl) selectEl.value = value;
  renderDroppedBcs();
}


function findAmTele(amName) {
  if (!amName || !repData || !repData.bcs) return '';
  const cleanAmName = amName.toLowerCase().trim();
  const match = repData.bcs.find(bc => bc.am && bc.am.toLowerCase().trim() === cleanAmName);
  return match ? match.am_tele : '';
}

async function sendDroppedAlert(bcName, amName, amTele, khac, shopee, tts, total) {
  if (!telegramConfig || !telegramConfig.BOT_TOKEN || !telegramConfig.CHAT_ID) {
    showToast("⚠️ Vui lòng cấu hình BOT_TOKEN & CHAT_ID trong file telegram_config.json");
    return;
  }
  if (!checkTelegramRateLimit()) return;
  
  const token = telegramConfig.BOT_TOKEN;
  const chatId = telegramConfig.CHAT_ID;
  const threadId = telegramConfig.THREADS && telegramConfig.THREADS.backlog_lc;
  
  const text = `🚨 *[CẢNH BÁO RỚT LUÂN CHUYỂN]* 🚨\n\n` +
               `*Bưu cục:* ${escapeMarkdown(bcName)}\n` +
               `*AM Phụ Trách:* ${escapeMarkdown(amName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n\n` +
               `*Tổng đơn LẤY rớt luân chuyển:* *${escapeMarkdown(total)}* đơn\n` +
               `  • Shopee: ${escapeMarkdown(shopee)} đơn\n` +
               `  • TiktokShop: ${escapeMarkdown(tts)} đơn\n` +
               `  • Khác: ${escapeMarkdown(khac)} đơn\n\n` +
               `👉 Đề nghị AM kiểm tra lý do và xử lý bàn giao luân chuyển gấp trong ca!`;
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  showToast(`💬 Đang gửi tin nhắn nhắc nhở tới Telegram...`);
  
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (threadId) payload.message_thread_id = threadId;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast("✅ Đã gửi cảnh báo Telegram thành công!");
    } else {
      const err = await res.json();
      showToast(`❌ Gửi Telegram thất bại: ${err.description}`);
    }
  } catch (e) {
    showToast(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
}

function renderReportingView() {
  if (!repData) return;
  renderKPIs();
  try {
    renderTrendChart();
  } catch(e) {
    console.error("Failed to render trend chart: ", e);
  }
  try {
    renderExitHoursChart();
  } catch(e) {
    console.error("Failed to render exit hours chart: ", e);
  }
  renderInsights();
  renderDimensionTable();
}

function formatChange(val, isPercentage = true, isInverse = false) {
  if (val === 0) return `<span class="change-tag flat">→ 0%</span>`;
  const sign = val > 0 ? '+' : '';
  const arrow = val > 0 ? '↗' : '↘';
  const valFormatted = isPercentage ? (val * 100).toFixed(2) + '%' : Math.abs(val).toLocaleString();
  const cls = (val > 0) ? (isInverse ? 'down' : 'up') : (isInverse ? 'up' : 'down');
  return `<span class="change-tag ${cls}">${arrow} ${sign}${valFormatted}</span>`;
}

function renderKPIs() {
  const kpis = repData.kpis;
  if (!kpis) return;

  // Volume
  document.getElementById('repVol').textContent = kpis.volume.value.toLocaleString();
  document.getElementById('repVolChanges').innerHTML = `
    <span class="change-tag ${kpis.volume.vs_yesterday >= 0 ? 'up' : 'down'}" id="repVolYest">${kpis.volume.vs_yesterday >= 0 ? '↗' : '↘'} ${kpis.volume.vs_yesterday >= 0 ? '+' : ''}${(kpis.volume.vs_yesterday * 100).toFixed(2)}% vs Hôm qua</span>
    <span class="change-tag ${kpis.volume.vs_lastweek >= 0 ? 'up' : 'down'}" id="repVolWeek">${kpis.volume.vs_lastweek >= 0 ? '↗' : '↘'} ${kpis.volume.vs_lastweek >= 0 ? '+' : ''}${(kpis.volume.vs_lastweek * 100).toFixed(2)}% vs Tuần trước</span>
    <span class="change-tag ${kpis.volume.vs_lastmonth >= 0 ? 'up' : 'down'}" id="repVolMonth">${kpis.volume.vs_lastmonth >= 0 ? '↗' : '↘'} ${kpis.volume.vs_lastmonth >= 0 ? '+' : ''}${(kpis.volume.vs_lastmonth * 100).toFixed(2)}% vs Tháng trước</span>
  `;

  // GTC
  document.getElementById('repGtc').textContent = (kpis.gtc.value * 100).toFixed(2) + '%';
  document.getElementById('repGtc').className = 'kpi-value ' + (kpis.gtc.value >= 0.67 ? 'good' : kpis.gtc.value >= 0.55 ? 'warn' : 'bad');
  document.getElementById('repGtcChanges').innerHTML = `
    <span class="change-tag ${kpis.gtc.vs_yesterday >= 0 ? 'up' : 'down'}" id="repGtcYest">${kpis.gtc.vs_yesterday >= 0 ? '↗' : '↘'} ${kpis.gtc.vs_yesterday >= 0 ? '+' : ''}${(kpis.gtc.vs_yesterday * 100).toFixed(2)}% vs Hôm qua</span>
    <span class="change-tag ${kpis.gtc.vs_lastweek >= 0 ? 'up' : 'down'}" id="repGtcWeek">${kpis.gtc.vs_lastweek >= 0 ? '↗' : '↘'} ${kpis.gtc.vs_lastweek >= 0 ? '+' : ''}${(kpis.gtc.vs_lastweek * 100).toFixed(2)}% vs Tuần trước</span>
    <span class="change-tag ${kpis.gtc.vs_lastmonth >= 0 ? 'up' : 'down'}" id="repGtcMonth">${kpis.gtc.vs_lastmonth >= 0 ? '↗' : '↘'} ${kpis.gtc.vs_lastmonth >= 0 ? '+' : ''}${(kpis.gtc.vs_lastmonth * 100).toFixed(2)}% vs Tháng trước</span>
  `;

  // FD
  document.getElementById('repFd').textContent = (kpis.fd.value * 100).toFixed(2) + '%';
  document.getElementById('repFd').className = 'kpi-value ' + (kpis.fd.value <= 0.028 ? 'good' : kpis.fd.value <= 0.035 ? 'warn' : 'bad');
  document.getElementById('repFdChanges').innerHTML = `
    <span class="change-tag ${kpis.fd.vs_yesterday <= 0 ? 'up' : 'down'}" id="repFdYest">${kpis.fd.vs_yesterday <= 0 ? '↘' : '↗'} ${(kpis.fd.vs_yesterday * 100).toFixed(2)}% vs Hôm qua</span>
    <span class="change-tag ${kpis.fd.vs_lastweek <= 0 ? 'up' : 'down'}" id="repFdWeek">${kpis.fd.vs_lastweek <= 0 ? '↘' : '↗'} ${(kpis.fd.vs_lastweek * 100).toFixed(2)}% vs Tuần trước</span>
    <span class="change-tag ${kpis.fd.vs_lastmonth <= 0 ? 'up' : 'down'}" id="repFdMonth">${kpis.fd.vs_lastmonth <= 0 ? '↘' : '↗'} ${(kpis.fd.vs_lastmonth * 100).toFixed(2)}% vs Tháng trước</span>
  `;

  // Backlog
  document.getElementById('repBl').textContent = kpis.backlog.value.toLocaleString();
  document.getElementById('repBl').className = 'kpi-value ' + (kpis.backlog.value < 500 ? 'good' : kpis.backlog.value < 1500 ? 'warn' : 'bad');
  document.getElementById('repBlChanges').innerHTML = `
    <span class="change-tag ${kpis.backlog.vs_yesterday <= 0 ? 'up' : 'down'}" id="repBlYest">${kpis.backlog.vs_yesterday <= 0 ? '↘' : '↗'} ${(kpis.backlog.vs_yesterday * 100).toFixed(2)}% vs Hôm qua</span>
    <span class="change-tag ${kpis.backlog.vs_lastweek <= 0 ? 'up' : 'down'}" id="repBlWeek">${kpis.backlog.vs_lastweek <= 0 ? '↘' : '↗'} ${(kpis.backlog.vs_lastweek * 100).toFixed(2)}% vs Tuần trước</span>
    <span class="change-tag ${kpis.backlog.vs_lastmonth <= 0 ? 'up' : 'down'}" id="repBlMonth">${kpis.backlog.vs_lastmonth <= 0 ? '↘' : '↗'} ${(kpis.backlog.vs_lastmonth * 100).toFixed(2)}% vs Tháng trước</span>
  `;
}

function renderTrendChart() {
  const trends = repData.daily_trends;
  if (!trends || trends.length === 0) return;

  const labels = trends.map(t => t.date.split('-').slice(1).reverse().join('/')); // DD/MM
  
  let datasets = [];
  if (activeTrendMetric === 'gtc') {
    datasets = [
      {
        label: 'Tỷ lệ GTC (%)',
        data: trends.map(t => (t.gtc * 100).toFixed(1)),
        borderColor: '#2dd4bf',
        backgroundColor: 'rgba(45,212,191,0.1)',
        yAxisID: 'y',
        tension: 0.3,
        fill: true
      },
      {
        label: 'Tỷ lệ FD (%)',
        data: trends.map(t => (t.fd * 100).toFixed(1)),
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244,63,94,0.1)',
        yAxisID: 'y1',
        tension: 0.3,
        fill: false
      }
    ];
  } else if (activeTrendMetric === 'volume') {
    datasets = [
      {
        label: 'Sản lượng (Volume)',
        data: trends.map(t => t.volume),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        tension: 0.3,
        fill: true
      }
    ];
  } else {
    datasets = [
      {
        label: 'Đơn tồn backlog (>5 ngày)',
        data: trends.map(t => t.backlog),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.15)',
        tension: 0.3,
        fill: true
      }
    ];
  }

  if (trendChartObj) trendChartObj.destroy();
  const ctx = document.getElementById('trendChart').getContext('2d');
  
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#8899b0', font: { size: 11 } }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(42,58,82,0.1)' },
        ticks: { color: '#8899b0', font: { size: 10 } }
      },
      y: {
        grid: { color: 'rgba(42,58,82,0.1)' },
        ticks: { color: '#8899b0', font: { size: 10 } }
      }
    }
  };

  if (activeTrendMetric === 'gtc') {
    options.scales.y1 = {
      position: 'right',
      grid: { drawOnChartArea: false },
      ticks: { color: '#f43f5e', font: { size: 10 } }
    };
  }

  trendChartObj = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: options
  });
}

function toggleTrendChart(metric) {
  activeTrendMetric = metric;
  document.getElementById('btnTrendGtc').classList.remove('active');
  document.getElementById('btnTrendVol').classList.remove('active');
  document.getElementById('btnTrendBl').classList.remove('active');

  if (metric === 'gtc') document.getElementById('btnTrendGtc').classList.add('active');
  else if (metric === 'volume') document.getElementById('btnTrendVol').classList.add('active');
  else document.getElementById('btnTrendBl').classList.add('active');

  renderTrendChart();
}

function renderInsights() {
  const analysis = repData.analysis;
  if (!analysis) return;

  const renderList = (id, items) => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.appendChild(li);
    });
  };

  renderList('insightHighlights', analysis.highlights);
  renderList('insightLowlights', analysis.lowlights);
  renderList('insightCauses', analysis.causes);
  renderList('insightRecommendations', analysis.recommendations);
}

function switchDimension(dim) {
  activeDim = dim;
  document.getElementById('btnDimProvince').classList.remove('active');
  document.getElementById('btnDimAm').classList.remove('active');
  document.getElementById('btnDimBc').classList.remove('active');

  if (dim === 'province') document.getElementById('btnDimProvince').classList.add('active');
  else if (dim === 'am') document.getElementById('btnDimAm').classList.add('active');
  else document.getElementById('btnDimBc').classList.add('active');

  renderDimensionTable();
}

function handleSearch() {
  tableSearchQuery = document.getElementById('tableSearch').value.toLowerCase().trim();
  renderDimensionTable();
}

function renderDimensionTable() {
  const table = document.getElementById('repTable');
  const head = document.getElementById('repTableHead');
  const body = document.getElementById('repTableBody');
  
  // Handle layout: table for province/am, card grid for bc
  let gridEl = document.getElementById('bcGrid');
  if (!gridEl) {
    gridEl = document.createElement('div');
    gridEl.className = 'bc-grid';
    gridEl.id = 'bcGrid';
    table.parentNode.appendChild(gridEl);
  }

  if (activeDim === 'bc') {
    table.style.display = 'none';
    gridEl.style.display = 'grid';
    renderBcGrid(gridEl);
    return;
  }

  table.style.display = 'table';
  gridEl.style.display = 'none';
  body.innerHTML = '';

  if (activeDim === 'province') {
    head.innerHTML = `
      <th>Tỉnh</th>
      <th>Sản lượng</th>
      <th>Tỷ lệ GTC</th>
      <th>Biến động GTC (N-1)</th>
      <th>Tỷ lệ FD</th>
      <th>Biến động FD (N-1)</th>
      <th>Đơn tồn aging >5 ngày</th>
      <th>Biến động tồn</th>
    `;

    const filtered = repData.provinces.filter(p => p.name.toLowerCase().includes(tableSearchQuery));
    filtered.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${p.volume.toLocaleString()}</td>
        <td>${(p.gtc * 100).toFixed(2)}%</td>
        <td>${formatChange(p.gtc_change)}</td>
        <td>${(p.fd * 100).toFixed(2)}%</td>
        <td>${formatChange(p.fd_change, true, true)}</td>
        <td>${p.backlog.toLocaleString()}</td>
        <td>${formatChange(p.backlog_change, false, true)}</td>
      `;
      body.appendChild(tr);
    });
  } else if (activeDim === 'am') {
    head.innerHTML = `
      <th>Area Manager (AM)</th>
      <th>Sản lượng</th>
      <th>Tỷ lệ GTC</th>
      <th>Biến động (N-1)</th>
      <th>Tỷ lệ FD</th>
      <th>Biến động FD</th>
      <th>Backlog >5 ngày</th>
      <th>Đánh giá</th>
    `;

    const filtered = repData.ams.filter(am => am.name.toLowerCase().includes(tableSearchQuery));
    filtered.forEach(am => {
      const tr = document.createElement('tr');
      let statusClass = 'strong';
      if (am.status === 'Cải thiện') statusClass = 'improve';
      else if (am.status === 'Yếu') statusClass = 'weak';

      tr.innerHTML = `
        <td><strong>${escapeHtml(am.name)}</strong></td>
        <td>${am.volume.toLocaleString()}</td>
        <td>${(am.gtc * 100).toFixed(2)}%</td>
        <td>${formatChange(am.gtc_change)}</td>
        <td>${(am.fd * 100).toFixed(2)}%</td>
        <td>${formatChange(am.fd_change, true, true)}</td>
        <td>
          ${am.backlog.toLocaleString()}
          <div style="font-size:10px;color:var(--text-muted)">
            5-8 ngày: ${am.backlog_detail['5_8']} | 8-15 ngày: ${am.backlog_detail['8_15']} | >15 ngày: ${am.backlog_detail['above_15']}
          </div>
        </td>
        <td><span class="am-tag ${statusClass}">${escapeHtml(am.status)}</span></td>
      `;
      body.appendChild(tr);
    });
  }
}

function renderBcGrid(gridEl) {
  gridEl.innerHTML = '';
  // Show all BCs or filter by search query
  const filtered = repData.bcs.filter(bc => 
    bc.name.toLowerCase().includes(tableSearchQuery) || 
    bc.am.toLowerCase().includes(tableSearchQuery)
  );

  if (filtered.length === 0) {
    gridEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Không tìm thấy bưu cục nào trùng khớp.</div>';
    return;
  }

  filtered.forEach(bc => {
    const card = document.createElement('div');
    card.className = 'bc-card';
    
    // GTC Change formatting
    const changeVal = bc.gtc_change;
    const arrow = changeVal >= 0 ? '↗' : '↘';
    const sign = changeVal >= 0 ? '+' : '';
    const changeCls = changeVal >= 0 ? 'up' : 'down';
    const changeText = `${arrow} ${sign}${(changeVal * 100).toFixed(2)}%`;
    
    // Backlog badge
    const blBadgeCls = bc.backlog > 0 ? 'has-backlog' : 'no-backlog';
    
    // Check if AM is assigned
    const amDisplay = bc.am && bc.am !== 'N/A' && bc.am !== 'nan' ? `${bc.am_id ? bc.am_id + ' - ' : ''}${bc.am}` : 'Chưa phân AM';

    card.innerHTML = `
      <div>
        <div class="bc-card-title">${escapeHtml(bc.name)}</div>
        <div class="bc-card-am">👤 AM: ${escapeHtml(amDisplay)}</div>
      </div>
      <div class="bc-card-stats-row">
        <div class="bc-stat-box">
          <div class="bc-stat-label">Tỷ lệ GTC hiện tại</div>
          <div class="bc-stat-val ${bc.gtc >= 0.67 ? 'up' : 'down'}">${(bc.gtc * 100).toFixed(2)}%</div>
        </div>
        <div class="bc-stat-box">
          <div class="bc-stat-label">Biến động (N-1)</div>
          <div class="bc-stat-val ${changeCls}">${changeText}</div>
        </div>
      </div>
      <div class="bc-backlog-row">
        <span>📦 Đơn Tồn > 5 ngày:</span>
        <span class="bc-backlog-badge ${blBadgeCls}">${bc.backlog} đơn</span>
      </div>
      <div class="bc-cause-box">
        <strong>Nguyên nhân:</strong> ${escapeHtml(bc.cause)}
      </div>
      <div class="bc-card-buttons">
        <button class="bc-btn" onclick="viewBcHistory('${escapeHtml(bc.name)}')">📉 Xem Lịch Sử</button>
        <button class="bc-btn bc-btn-primary" onclick="sendTelegramAlert('${escapeHtml(bc.name)}', '${escapeHtml(bc.am)}', '${escapeHtml(bc.am_tele)}', '${(bc.gtc*100).toFixed(2)}%', '${escapeHtml(changeText)}', '${bc.backlog}', '${escapeHtml(bc.cause)}', '${escapeHtml(bc.recommendation || '')}')">💬 Nhắc AM</button>
      </div>
    `;
    gridEl.appendChild(card);
  });
}

function viewBcHistory(bcName) {
  showToast(`📉 Đang mở lịch sử của ${bcName}...`);
}

async function sendTelegramAlert(bcName, amName, amTele, gtcVal, changeText, backlog, cause, recommendation) {
  if (!telegramConfig || !telegramConfig.BOT_TOKEN || !telegramConfig.CHAT_ID) {
    showToast("⚠️ Vui lòng cấu hình BOT_TOKEN & CHAT_ID trong file telegram_config.json");
    return;
  }
  if (!checkTelegramRateLimit()) return;
  
  const token = telegramConfig.BOT_TOKEN;
  const chatId = telegramConfig.CHAT_ID;
  const threadId = telegramConfig.THREADS && telegramConfig.THREADS.van_hanh;
  
  const recText = recommendation ? recommendation : "👉 Đề nghị AM vào kiểm tra và xử lý luồng hàng gấp!";
  
  const text = `🚨 *[CẢNH BÁO VẬN HÀNH]* 🚨\n\n` +
               `*Bưu cục:* ${escapeMarkdown(bcName)}\n` +
               `*AM Phụ Trách:* ${escapeMarkdown(amName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n\n` +
               `*Tỷ lệ GTC hiện tại:* ${escapeMarkdown(gtcVal)} (Biến động N-1: ${escapeMarkdown(changeText)})\n` +
               `*Đơn Tồn > 5 ngày:* ${escapeMarkdown(backlog)} đơn\n\n` +
               `*Nguyên nhân:* ${escapeMarkdown(cause)}\n\n` +
               `💡 *Đề xuất:* ${escapeMarkdown(recText)}`;
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  showToast(`💬 Đang gửi tin nhắn nhắc nhở tới Telegram...`);
  
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (threadId) payload.message_thread_id = threadId;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast("✅ Đã gửi cảnh báo Telegram thành công!");
    } else {
      const err = await res.json();
      showToast(`❌ Gửi Telegram thất bại: ${err.description}`);
    }
  } catch (e) {
    showToast(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
}

async function sendHrTelegramAlert(bcName, amName, amTele, hrbpName, shortageVal, targetHeadcount, tuyenVal, nghiVal, missingRoutes, actionPlan) {
  if (!telegramConfig || !telegramConfig.BOT_TOKEN || !telegramConfig.CHAT_ID) {
    showToast("⚠️ Vui lòng cấu hình BOT_TOKEN & CHAT_ID trong file telegram_config.json");
    return;
  }
  if (!checkTelegramRateLimit()) return;
  
  const token = telegramConfig.BOT_TOKEN;
  const chatId = telegramConfig.CHAT_ID;
  const threadId = telegramConfig.THREADS && telegramConfig.THREADS.nhan_su; // thread ID 8
  
  const text = `🚨 *[CẢNH BÁO NHÂN SỰ & TUYỂN DỤNG]* 🚨\n\n` +
               `*Bưu cục:* ${escapeMarkdown(bcName)}\n` +
               `*AM Phụ Trách:* ${escapeMarkdown(amName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n` +
               `*HRBP Phụ Trách:* ${escapeMarkdown(hrbpName || 'N/A')}\n\n` +
               `*Tình trạng nhân sự:* Thiếu ${escapeMarkdown(shortageVal)} NV (Định biên: ${escapeMarkdown(targetHeadcount)})\n` +
               `*Biến động tuần (Tuyển/Nghỉ):* +${escapeMarkdown(tuyenVal)} / -${escapeMarkdown(nghiVal)}\n` +
               `*Tuyến giao hàng thiếu:* ${escapeMarkdown(missingRoutes) || 'Không có (Đủ tuyến)'}\n\n` +
               `*Phương án xử lý:* ${escapeMarkdown(actionPlan)}\n\n` +
               `👉 Đề nghị AM cắm chốt kho hỗ trợ, HRBP tập trung tuyển dụng bổ sung nhân sự gấp!`;
               
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  showToast(`💬 Đang gửi tin nhắn nhắc nhở tuyển dụng tới Telegram...`);
  
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (threadId) payload.message_thread_id = threadId;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast("✅ Đã gửi cảnh báo Telegram thành công!");
    } else {
      const err = await res.json();
      showToast(`❌ Gửi Telegram thất bại: ${err.description}`);
    }
  } catch (e) {
    showToast(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
}

// ===== RECRUITMENT DASHBOARD RENDERING =====
function renderRecruitmentView() {
  if (!repData || !repData.kpis || !repData.kpis.hr) return;
  renderHrKPIs();
  try {
    renderHrChart();
  } catch(e) {
    console.error("Failed to render HR chart: ", e);
  }
  renderHrTop5();
  renderHrDimensionTable();
}

function renderHrKPIs() {
  const hr = repData.kpis.hr;
  document.getElementById('hrActual').textContent = hr.total_shortage_actual;
  document.getElementById('hrBs').textContent = hr.total_shortage_bs;
  document.getElementById('hrOb').textContent = hr.total_ob_week;
  document.getElementById('hrResign').textContent = hr.total_resign_week;
}

function renderHrChart() {
  const provinces = repData.provinces;
  if (!provinces || provinces.length === 0) return;

  const labels = provinces.map(p => p.name);
  const shortageActualData = provinces.map(p => p.hr.shortage_actual);
  const shortageBsData = provinces.map(p => p.hr.shortage_bs);
  const obData = provinces.map(p => p.hr.ob);

  if (hrChartObj) hrChartObj.destroy();
  const ctx = document.getElementById('hrProvinceChart').getContext('2d');
  
  hrChartObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Thiếu thực tế (NVPTTT)',
          data: shortageActualData,
          backgroundColor: 'rgba(244, 63, 94, 0.75)',
          borderColor: '#f43f5e',
          borderWidth: 1
        },
        {
          label: 'Thiếu tuyển thêm (BS)',
          data: shortageBsData,
          backgroundColor: 'rgba(245, 158, 11, 0.75)',
          borderColor: '#f59e0b',
          borderWidth: 1
        },
        {
          label: 'Nhận việc mới (OB)',
          data: obData,
          backgroundColor: 'rgba(34, 197, 94, 0.75)',
          borderColor: '#22c55e',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8899b0', font: { size: 11 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(42,58,82,0.1)' },
          ticks: { color: '#8899b0', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(42,58,82,0.1)' },
          ticks: { color: '#8899b0', font: { size: 10 }, stepSize: 5 }
        }
      }
    }
  });
}

function renderHrTop5() {
  const container = document.getElementById('hrTop5List');
  container.innerHTML = '';
  
  const top5 = repData.recruitment.top_5;
  if (!top5 || top5.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Không có dữ liệu bưu cục thiếu nhiều.</div>';
    return;
  }

  top5.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'hr-top5-item';
    
    // Parse target date and yesterday's date for GTC comparison warning
    // We will extract matching BC object from repData.bcs to get GTC change and details
    let bcMatch = null;
    let cleanName = clean_bc_name(item.bc_name);
    for (let bc of repData.bcs) {
      let b_clean = clean_bc_name(bc.name);
      if (b_clean === cleanName || b_clean.includes(cleanName) || cleanName.includes(b_clean)) {
        bcMatch = bc;
        break;
      }
    }

    let warningText = '';
    let changeVal = 0;
    let changeText = 'N/A';
    let amTele = '';
    
    if (bcMatch) {
      changeVal = bcMatch.gtc_change;
      changeText = formatChangeText(changeVal);
      amTele = bcMatch.am_tele;
      
      const arrow = changeVal >= 0 ? '↗' : '↘';
      const sign = changeVal >= 0 ? '+' : '';
      
      warningText = `Hiệu suất GTC ngày giao gần nhất đạt ${(bcMatch.gtc*100).toFixed(2)}% (biến động N-1: ${arrow} ${sign}${(changeVal*100).toFixed(2)}%).`;
    }

    // Determine the shortage and missing routes
    const shortageAccurate = item.shortage_accurate !== undefined ? item.shortage_accurate : (item.dinhiben_nvpttt - item.tuyen_7d);
    const missingRoutes = item.missing_routes || "";

    // Badge styling (green if shortage is 0, red if shortage is > 0)
    let badgeStyle = '';
    let badgeText = '';
    if (shortageAccurate <= 0) {
      badgeStyle = 'background: rgba(34,197,94,0.15); color: var(--accent-green);';
      badgeText = 'Đủ nhân sự';
    } else {
      badgeStyle = 'background: rgba(244,63,94,0.15); color: var(--accent-rose);';
      badgeText = `Thiếu ${shortageAccurate} NV`;
    }

    // Routes info
    const routesHtml = missingRoutes
      ? `<div class="hr-plan-box" style="border-left-color: var(--accent-amber); background: rgba(245,158,11,0.08); margin-top: 6px; font-size: 11px;">
          <strong style="color: var(--accent-amber);">Tuyến thiếu:</strong> ${escapeHtml(missingRoutes)}
         </div>`
      : `<div class="hr-plan-box" style="border-left-color: var(--accent-green); background: rgba(34,197,94,0.08); margin-top: 6px; font-size: 11px;">
          <strong style="color: var(--accent-green);">Tuyến thiếu:</strong> Không có (Đủ tuyến)
         </div>`;

    el.innerHTML = `
      <div class="hr-top5-header">
        <div>
          <div class="hr-top5-bcname">${i+1}. ${escapeHtml(item.bc_name)}</div>
          <div class="hr-top5-am">👤 AM: ${escapeHtml(item.am)}</div>
        </div>
        <span class="hr-top5-badge" style="${badgeStyle}">${badgeText}</span>
      </div>
      <div class="hr-top5-stats">
        <div class="hr-top5-stat">
          Định biên
          <strong>${item.dinhiben_nvpttt}</strong>
        </div>
        <div class="hr-top5-stat" style="color:var(--accent-rose)">
          Tồn giao >= 72h
          <strong>${item.backlog_72h} đơn</strong>
        </div>
        <div class="hr-top5-stat" style="color:var(--accent-teal)">
          Tuyển mới/Nghỉ
          <strong>+${item.tuyen_7d} / -${item.nghi_7d}</strong>
        </div>
      </div>
      ${routesHtml}
      <div class="bc-cause-box" style="margin-top: 6px;">
        <strong>Chi tiết vận hành:</strong> ${escapeHtml(warningText)} ${escapeHtml(item.details)}
      </div>
      <div class="hr-plan-box">
        <strong>Phương án xử lý:</strong> ${escapeHtml(item.action_plan || 'Phân bổ gán tuyến trước 8h sáng, chạy FB Ads tìm shipper thay thế. AM cắm chốt tại BC để hướng dẫn shipper mới.')}
      </div>
      <div style="display:flex; justify-content: flex-end; margin-top: 8px;">
        <button class="bc-btn bc-btn-primary" style="flex:none; padding: 6px 14px; font-size:11px;" onclick="sendHrTelegramAlert('${escapeHtml(item.bc_name)}', '${escapeHtml(item.am)}', '${escapeHtml(amTele)}', '${escapeHtml(bcMatch && bcMatch.hr ? bcMatch.hr.hrbp : 'N/A')}', ${shortageAccurate}, ${item.dinhiben_nvpttt}, ${item.tuyen_7d}, ${item.nghi_7d}, '${escapeHtml(missingRoutes)}', '${escapeHtml(item.action_plan || 'Phân bổ gán tuyến trước 8h sáng, chạy FB Ads tìm shipper thay thế. AM cắm chốt tại BC để hướng dẫn shipper mới.')}')">💬 Nhắc AM & HRBP</button>
      </div>
    `;
    container.appendChild(el);
  });
}

function formatChangeText(val) {
  if (val === null || val === undefined || isNaN(val)) return '--';
  if (val === 0) return '→ 0%';
  const sign = val > 0 ? '+' : '';
  const arrow = val > 0 ? '↗' : '↘';
  return `${arrow} ${sign}${(val * 100).toFixed(2)}%`;
}

function switchHrDimension(dim) {
  activeHrDim = dim;
  document.getElementById('btnHrDimProvince').classList.remove('active');
  document.getElementById('btnHrDimAm').classList.remove('active');
  const bcBtn = document.getElementById('btnHrDimBc');
  if (bcBtn) bcBtn.classList.remove('active');

  if (dim === 'province') {
    document.getElementById('btnHrDimProvince').classList.add('active');
  } else if (dim === 'am') {
    document.getElementById('btnHrDimAm').classList.add('active');
  } else if (dim === 'bc' && bcBtn) {
    bcBtn.classList.add('active');
  }

  renderHrDimensionTable();
}

function handleHrSearch() {
  hrTableSearchQuery = document.getElementById('hrTableSearch').value.toLowerCase().trim();
  renderHrDimensionTable();
}

function renderHrDimensionTable() {
  const head = document.getElementById('hrRepTableHead');
  const body = document.getElementById('hrRepTableBody');
  body.innerHTML = '';

  if (activeHrDim === 'province') {
    head.innerHTML = `
      <th>Tỉnh</th>
      <th>HRBP phụ trách</th>
      <th>HRBP Intern</th>
      <th>Định biên NVPTTT</th>
      <th>Thiếu sau trừ OB</th>
      <th>Thiếu bổ sung (BS)</th>
      <th>Tuyển mới tuần qua (OB)</th>
      <th>Nghỉ việc tuần qua</th>
    `;

    const filtered = repData.provinces.filter(p => p.name.toLowerCase().includes(hrTableSearchQuery));
    filtered.forEach(p => {
      // Find HRBP and Intern dynamically from data
      const hrbp = (p.hr && p.hr.hrbp) ? p.hr.hrbp : 'N/A';
      const intern = (p.hr && p.hr.intern) ? p.hr.intern : 'N/A';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(hrbp)}</td>
        <td>${escapeHtml(intern)}</td>
        <td>${p.hr.target_headcount}</td>
        <td style="color:${p.hr.shortage_actual > 0 ? 'var(--accent-rose)' : 'inherit'}; font-weight:${p.hr.shortage_actual > 0 ? '600' : 'normal'}">${p.hr.shortage_actual}</td>
        <td style="color:${p.hr.shortage_bs > 0 ? 'var(--accent-amber)' : 'inherit'}">${p.hr.shortage_bs}</td>
        <td style="color:var(--accent-green)">+${p.hr.ob}</td>
        <td style="color:var(--accent-rose)">-${p.hr.resign}</td>
      `;
      body.appendChild(tr);
    });
  } else if (activeHrDim === 'am') {
    head.innerHTML = `
      <th>AM Phụ Trách</th>
      <th>Tỉnh</th>
      <th>Định biên NVPTTT</th>
      <th>Thiếu sau trừ OB</th>
      <th>Thiếu bổ sung (BS)</th>
      <th>Tuyển mới (OB)</th>
      <th>Nghỉ việc</th>
    `;

    const filtered = repData.ams.filter(am => am.name.toLowerCase().includes(hrTableSearchQuery));
    filtered.forEach(am => {
      // Find Province for this AM
      let prov = 'N/A';
      let amMatch = repData.bcs.find(b => b.am === am.name);
      if (amMatch) prov = amMatch.province;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(am.name)}</strong></td>
        <td>${escapeHtml(prov)}</td>
        <td>${am.hr.target_headcount}</td>
        <td style="color:${am.hr.shortage_actual > 0 ? 'var(--accent-rose)' : 'inherit'}; font-weight:${am.hr.shortage_actual > 0 ? '600' : 'normal'}">${am.hr.shortage_actual}</td>
        <td style="color:${am.hr.shortage_bs > 0 ? 'var(--accent-amber)' : 'inherit'}">${am.hr.shortage_bs}</td>
        <td style="color:var(--accent-green)">+${am.hr.ob}</td>
        <td style="color:var(--accent-rose)">-${am.hr.resign}</td>
      `;
      body.appendChild(tr);
    });
  } else if (activeHrDim === 'bc') {
    head.innerHTML = `
      <th>Bưu cục</th>
      <th>Tỉnh</th>
      <th>AM Phụ Trách</th>
      <th>Định biên NVPTTT</th>
      <th>Thiếu sau trừ OB</th>
      <th>Thiếu bổ sung (BS)</th>
      <th>Tuyển mới (OB)</th>
      <th>Nghỉ việc</th>
      <th>Tuyến thiếu</th>
      <th>HRBP phụ trách</th>
    `;

    const filtered = repData.bcs.filter(bc => 
      bc.name.toLowerCase().includes(hrTableSearchQuery) || 
      (bc.am && bc.am.toLowerCase().includes(hrTableSearchQuery)) || 
      (bc.province && bc.province.toLowerCase().includes(hrTableSearchQuery))
    );

    // Sort by shortage_actual descending
    filtered.sort((a, b) => {
      const shortageA = a.hr ? a.hr.shortage_actual : 0;
      const shortageB = b.hr ? b.hr.shortage_actual : 0;
      if (shortageB !== shortageA) return shortageB - shortageA;
      return a.name.localeCompare(b.name);
    });

    filtered.forEach(bc => {
      const hr = bc.hr || { target_headcount: 0, shortage_actual: 0, shortage_bs: 0, ob_week: 0, resign_week: 0, tuyen_thieu: "", hrbp: "N/A" };
      const tr = document.createElement('tr');
      
      const shortageAct = hr.shortage_actual || 0;
      const shortageBs = hr.shortage_bs || 0;
      const ob = hr.ob_week || 0;
      const resign = hr.resign_week || 0;
      const routes = hr.tuyen_thieu || '';

      tr.innerHTML = `
        <td><strong>${escapeHtml(bc.name)}</strong></td>
        <td>${escapeHtml(bc.province || 'N/A')}</td>
        <td>👤 ${escapeHtml(bc.am || 'N/A')}</td>
        <td>${hr.target_headcount}</td>
        <td style="color:${shortageAct > 0 ? 'var(--accent-rose)' : 'inherit'}; font-weight:${shortageAct > 0 ? '600' : 'normal'}">${shortageAct}</td>
        <td style="color:${shortageBs > 0 ? 'var(--accent-amber)' : 'inherit'}">${shortageBs}</td>
        <td style="color:var(--accent-green)">+${ob}</td>
        <td style="color:var(--accent-rose)">-${resign}</td>
        <td style="font-size: 11px; max-width: 240px; white-space: normal; line-height: 1.4; color: ${routes ? 'var(--accent-amber)' : 'var(--text-secondary)'};">
          ${routes ? escapeHtml(routes) : '-'}
        </td>
        <td>${escapeHtml(hr.hrbp || 'N/A')}</td>
      `;
      body.appendChild(tr);
    });
  }
}

// ===== RETURN RATE (%FD) DASHBOARD RENDERING =====
function renderReturnRateView() {
  if (!repData || !repData.fd_report) return;
  renderFdKPIs();
  try {
    renderFdChart();
  } catch(e) {
    console.error("Failed to render FD trend chart:", e);
  }
  renderFdTop5();
  renderFdTable();
}

function formatDailyHeader(lbl) {
  if (!lbl) return '';
  const parts = lbl.split('/');
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  const parts2 = lbl.split('-');
  if (parts2.length >= 3) {
    return `${parts2[2]}/${parts2[1]}`;
  }
  return lbl;
}

function renderFdKPIs() {
  const fdReport = repData.fd_report;
  if (!fdReport) return;
  const metricData = fdReport[activeFdMetric];
  if (!metricData || !metricData.kpis) return;
  
  const isGtb = activeFdMetric === 'gtb';
  
  // Extract week and date label dynamically
  const latestWeekLabel = fdReport.headers.weekly[6] ? fdReport.headers.weekly[6].replace('2026/', 'W') : 'W22';
  const latestDailyLabel = fdReport.headers.daily[9] ? formatDailyHeader(fdReport.headers.daily[9]) : '25/05';
  
  // Update Card Titles and Descriptions dynamically
  const labelWeekly = isGtb ? `Tỷ lệ GTB-TT Tuần ${latestWeekLabel}` : `Tỷ lệ Trả Tuần ${latestWeekLabel}`;
  const labelDaily = isGtb ? `Tỷ lệ GTB-TT Ngày ${latestDailyLabel}` : `Tỷ lệ Trả Ngày ${latestDailyLabel}`;
  const labelRedCount = isGtb ? 'Bưu cục GTB-TT Thấp (<15%)' : 'Bưu cục Vượt Ngưỡng Đỏ (>8%)';
  const labelTarget = isGtb ? 'Mục Tiêu Khuyến Khích' : 'Mục Tiêu Định Hướng';
  
  const fdWeeklyTitle = document.getElementById('fdWeeklyTitle');
  if (fdWeeklyTitle) fdWeeklyTitle.textContent = labelWeekly + ' (Tổng Vùng)';
  
  const fdDailyTitle = document.getElementById('fdDailyTitle');
  if (fdDailyTitle) fdDailyTitle.textContent = labelDaily + ' (Tổng Vùng)';
  
  const fdRedCountTitle = document.getElementById('fdRedCountTitle');
  if (fdRedCountTitle) fdRedCountTitle.textContent = labelRedCount;
  
  const fdTargetTitle = document.getElementById('fdTargetTitle');
  if (fdTargetTitle) fdTargetTitle.textContent = labelTarget;

  const fdRedCountDesc = document.getElementById('fdRedCountDesc');
  if (fdRedCountDesc) {
    fdRedCountDesc.innerHTML = isGtb 
      ? `<span class="change-tag warn">Cần thúc đẩy nhân rộng GTB-TT</span>`
      : `<span class="change-tag warn">Cần hành động giảm hoàn khẩn cấp</span>`;
  }
  
  const fdTargetDesc = document.getElementById('fdTargetDesc');
  if (fdTargetDesc) {
    fdTargetDesc.innerHTML = isGtb
      ? `<span class="change-tag up">Tối ưu chi phí shipper</span>`
      : `<span class="change-tag up">Ngưỡng an toàn vận hành</span>`;
  }

  const fdTargetVal = document.getElementById('fdTargetVal');
  if (fdTargetVal) {
    fdTargetVal.textContent = isGtb ? '> 25.0%' : '< 5.0%';
    fdTargetVal.style.color = 'var(--accent-green)';
  }

  // Weekly total
  const wt = metricData.kpis.weekly_total;
  const weeklyValEl = document.getElementById('fdWeeklyVal');
  const weeklyChangesEl = document.getElementById('fdWeeklyChanges');
  
  if (wt && wt.w22 !== null && wt.w22 !== undefined) {
    weeklyValEl.textContent = (wt.w22 * 100).toFixed(2) + '%';
    const change_wtd = wt.change_wtd;
    const hasChange = change_wtd !== null && change_wtd !== undefined && !isNaN(change_wtd);
    const sign = hasChange && change_wtd >= 0 ? '+' : '';
    const arrow = hasChange ? (change_wtd >= 0 ? '↗' : '↘') : '';
    
    let cls = '';
    if (hasChange) {
      if (isGtb) {
        cls = change_wtd >= 0 ? 'up' : 'down';
      } else {
        cls = change_wtd <= 0 ? 'up' : 'down';
      }
    }
    
    weeklyChangesEl.innerHTML = hasChange
      ? `<span class="change-tag ${cls}">${arrow} ${sign}${(change_wtd * 100).toFixed(2)}% vs Tuần trước</span>`
      : `<span class="change-tag">-- vs Tuần trước</span>`;
  } else {
    weeklyValEl.textContent = '--';
    weeklyChangesEl.innerHTML = `<span class="change-tag">-- vs Tuần trước</span>`;
  }
  
  // Daily total
  const dt = metricData.kpis.daily_total;
  const dailyValEl = document.getElementById('fdDailyVal');
  const dailyChangesEl = document.getElementById('fdDailyChanges');
  
  if (dt && dt.d25 !== null && dt.d25 !== undefined) {
    dailyValEl.textContent = (dt.d25 * 100).toFixed(2) + '%';
    const change_d1 = dt.change_d1;
    const change_d7 = dt.change_d7;
    
    const hasChange1 = change_d1 !== null && change_d1 !== undefined && !isNaN(change_d1);
    const sign1 = hasChange1 && change_d1 >= 0 ? '+' : '';
    const arrow1 = hasChange1 ? (change_d1 >= 0 ? '↗' : '↘') : '';
    
    const hasChange7 = change_d7 !== null && change_d7 !== undefined && !isNaN(change_d7);
    const sign7 = hasChange7 && change_d7 >= 0 ? '+' : '';
    const arrow7 = hasChange7 ? (change_d7 >= 0 ? '↗' : '↘') : '';
    
    let cls1 = '';
    let cls7 = '';
    if (isGtb) {
      if (hasChange1) cls1 = change_d1 >= 0 ? 'up' : 'down';
      if (hasChange7) cls7 = change_d7 >= 0 ? 'up' : 'down';
    } else {
      if (hasChange1) cls1 = change_d1 <= 0 ? 'up' : 'down';
      if (hasChange7) cls7 = change_d7 <= 0 ? 'up' : 'down';
    }
    
    const tag1Html = hasChange1 
      ? `<span class="change-tag ${cls1}" style="margin-right:8px">${arrow1} ${sign1}${(change_d1 * 100).toFixed(2)}% vs Hôm qua</span>`
      : `<span class="change-tag" style="margin-right:8px">-- vs Hôm qua</span>`;
      
    const tag7Html = hasChange7
      ? `<span class="change-tag ${cls7}">${arrow7} ${sign7}${(change_d7 * 100).toFixed(2)}% vs Tuần trước</span>`
      : `<span class="change-tag">-- vs Tuần trước</span>`;
      
    dailyChangesEl.innerHTML = tag1Html + tag7Html;
  } else {
    dailyValEl.textContent = '--';
    dailyChangesEl.innerHTML = `
      <span class="change-tag" style="margin-right:8px">-- vs Hôm qua</span>
      <span class="change-tag">-- vs Tuần trước</span>
    `;
  }
  
  // Red Count
  let redCount = 0;
  if (metricData.weekly) {
    if (isGtb) {
      redCount = metricData.weekly.filter(bc => bc.bc_name !== 'TỔNG Vùng ĐCL' && bc.w22 !== null && bc.w22 < 0.15).length;
    } else {
      redCount = metricData.weekly.filter(bc => bc.bc_name !== 'TỔNG Vùng ĐCL' && bc.w22 !== null && bc.w22 > 0.08).length;
    }
  }
  document.getElementById('fdRedCount').textContent = redCount;
}

function renderFdChart() {
  const fdReport = repData.fd_report;
  if (!fdReport) return;
  const metricData = fdReport[activeFdMetric];
  if (!metricData || !metricData.kpis) return;
  
  const weeklyTotal = metricData.kpis.weekly_total;
  const dailyTotal = metricData.kpis.daily_total;
  const isGtb = activeFdMetric === 'gtb';
  
  let labels = [];
  let data = [];
  let title = '';
  
  if (activeFdTrendMetric === 'weekly') {
    labels = fdReport.headers.weekly.slice(2, 7); // '2026/18' to '2026/22'
    if (weeklyTotal) {
      data = [
        weeklyTotal.w18 !== null && weeklyTotal.w18 !== undefined ? (weeklyTotal.w18 * 100).toFixed(2) : null,
        weeklyTotal.w19 !== null && weeklyTotal.w19 !== undefined ? (weeklyTotal.w19 * 100).toFixed(2) : null,
        weeklyTotal.w20 !== null && weeklyTotal.w20 !== undefined ? (weeklyTotal.w20 * 100).toFixed(2) : null,
        weeklyTotal.w21 !== null && weeklyTotal.w21 !== undefined ? (weeklyTotal.w21 * 100).toFixed(2) : null,
        weeklyTotal.w22 !== null && weeklyTotal.w22 !== undefined ? (weeklyTotal.w22 * 100).toFixed(2) : null
      ];
    }
    title = isGtb ? 'Tỷ lệ GTB-TT theo Tuần (%)' : 'Tỷ lệ Trả theo Tuần (%)';
  } else {
    labels = fdReport.headers.daily.slice(2, 10); // '18/05/2026' to '25/05/2026'
    if (dailyTotal) {
      data = [
        dailyTotal.d18 !== null && dailyTotal.d18 !== undefined ? (dailyTotal.d18 * 100).toFixed(2) : null,
        dailyTotal.d19 !== null && dailyTotal.d19 !== undefined ? (dailyTotal.d19 * 100).toFixed(2) : null,
        dailyTotal.d20 !== null && dailyTotal.d20 !== undefined ? (dailyTotal.d20 * 100).toFixed(2) : null,
        dailyTotal.d21 !== null && dailyTotal.d21 !== undefined ? (dailyTotal.d21 * 100).toFixed(2) : null,
        dailyTotal.d22 !== null && dailyTotal.d22 !== undefined ? (dailyTotal.d22 * 100).toFixed(2) : null,
        dailyTotal.d23 !== null && dailyTotal.d23 !== undefined ? (dailyTotal.d23 * 100).toFixed(2) : null,
        dailyTotal.d24 !== null && dailyTotal.d24 !== undefined ? (dailyTotal.d24 * 100).toFixed(2) : null,
        dailyTotal.d25 !== null && dailyTotal.d25 !== undefined ? (dailyTotal.d25 * 100).toFixed(2) : null
      ];
    }
    title = isGtb ? 'Tỷ lệ GTB-TT theo Ngày (%)' : 'Tỷ lệ Trả theo Ngày (%)';
  }
  
  if (fdTrendChartObj) fdTrendChartObj.destroy();
  const canvas = document.getElementById('fdTrendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const themeColor = isGtb ? '#2dd4bf' : '#f43f5e';
  const bgColor = isGtb ? 'rgba(45, 212, 191, 0.1)' : 'rgba(244, 63, 94, 0.1)';
  
  fdTrendChartObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: title,
          data: data,
          borderColor: themeColor,
          backgroundColor: bgColor,
          tension: 0.3,
          fill: true,
          borderWidth: 2,
          pointBackgroundColor: themeColor,
          pointRadius: 4,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8899b0', font: { size: 11 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(42,58,82,0.1)' },
          ticks: { color: '#8899b0', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(42,58,82,0.1)' },
          ticks: { color: '#8899b0', font: { size: 10 } }
        }
      }
    }
  });
}

function toggleFdTrendChart(metric) {
  activeFdTrendMetric = metric;
  document.getElementById('btnFdTrendWeekly').classList.remove('active');
  document.getElementById('btnFdTrendDaily').classList.remove('active');
  
  if (metric === 'weekly') document.getElementById('btnFdTrendWeekly').classList.add('active');
  else document.getElementById('btnFdTrendDaily').classList.add('active');
  
  renderFdChart();
}

function renderFdTop5() {
  const container = document.getElementById('fdTop5List');
  if (!container || !repData || !repData.fd_report) return;
  container.innerHTML = '';
  
  const metricData = repData.fd_report[activeFdMetric];
  if (!metricData || !metricData.weekly) return;

  const isGtb = activeFdMetric === 'gtb';
  
  const filtered = metricData.weekly.filter(bc => 
    bc.bc_name && 
    bc.bc_name !== 'TỔNG Vùng ĐCL' && 
    bc.bc_name !== 'Grand Total' &&
    bc.w22 !== null
  );
  
  const sorted = [...filtered].sort((a, b) => {
    return isGtb ? a.w22 - b.w22 : b.w22 - a.w22;
  });
  
  const top5 = sorted.slice(0, 5);
  
  const titleEl = document.getElementById('fdTop5Title');
  if (titleEl) {
    titleEl.textContent = isGtb ? '🔥 Top 5 Bưu Cục Tỷ Lệ GTB-TT Thấp Nhất' : '🔥 Top 5 Bưu Cục Tỷ Lệ Trả Cao Nhất';
  }
  
  if (top5.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Không có dữ liệu bưu cục.</div>';
    return;
  }
  
  const fd_causes = {
    'Phó Cơ Điều': 'Thiếu shipper giao chặng cuối, hàng hoàn do lưu kho quá hạn.',
    'Đường Huyện 35': 'Tuyến giao hàng Vĩnh Kim xa, shipper mới giao không kịp phải chuyển hoàn.',
    'QL57 KP3': 'Khách hàng không liên lạc được nhiều, tỷ lệ hẹn lại giao thấp.',
    'Quốc Lộ 53': 'Hàng gom giao trễ ca tối, shipper giao trễ bị khách từ chối nhận.',
    'Tỉnh Lộ 868': 'Shipper chưa rành tuyến, tự ý báo hoàn không liên hệ khách.'
  };
  
  const fd_plans = {
    'Phó Cơ Điều': 'Điều phối khẩn cấp 2 shipper cứng từ Vĩnh Long sang hỗ trợ, kiểm tra các đơn báo lưu kho/chuyển trả.',
    'Đường Huyện 35': 'Chia nhỏ tuyến giao Vĩnh Kim, HRBP tuyển gấp shipper phụ trách tuyến này.',
    'QL57 KP3': 'Yêu cầu AM kiểm tra lịch sử cuộc gọi của shipper, lọc danh sách đơn hoàn tự động.',
    'Quốc Lộ 53': 'Điều chỉnh luồng hàng ca chiều về sớm trước 14h, hạn chế đi giao ca tối muộn.',
    'Tỉnh Lộ 868': 'Tổ chức kèm cặp shipper mới nhận việc, rà soát quy trình báo hoàn trên App.'
  };

  const gtb_causes = {
    'Phó Cơ Điều': 'Shipper chưa quen với quy trình thu cước thất bại, lo ngại tranh chấp với người nhận.',
    'Đường Huyện 35': 'Tuyến xa, shipper ngại thu cước chuyển hoàn vì tốn thời gian giải thích.',
    'QL57 KP3': 'AM chưa phổ biến đầy đủ chính sách tính lương giao thành công cho shipper khi thực hiện GTB-TT.',
    'Quốc Lộ 53': 'Tỷ lệ đơn thanh toán trước cao, hoặc shipper chưa chủ động đề xuất thu cước khi giao thất bại.',
    'Tỉnh Lộ 868': 'Shipper mới nhiều chưa được hướng dẫn thao tác thu cước thất bại trên app.'
  };

  const gtb_plans = {
    'Phó Cơ Điều': 'AM họp khẩn đào tạo lại quy trình GTB-TT, hướng dẫn shipper cách giải thích cước phí hoàn với khách.',
    'Đường Huyện 35': 'Áp dụng chỉ tiêu tối thiểu 20% GTB-TT cho các tuyến huyện xa, theo dõi sát tiến độ hàng ngày.',
    'QL57 KP3': 'Dán bảng hướng dẫn tính lương shipper của đơn GTB-TT tại bảng tin bưu cục, AM trực tiếp giải đáp thắc mắc.',
    'Quốc Lộ 53': 'Truyền thông gương shipper điển hình thu cước tốt, AM kiểm tra danh sách đơn hoàn không thu được phí.',
    'Tỉnh Lộ 868': 'Tổ chức kèm cặp thực tế trên tuyến cho shipper mới về nghiệp vụ thu cước giao thất bại.'
  };
  
  top5.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'hr-top5-item';
    
    let bcMatch = null;
    let cleanName = clean_bc_name(item.bc_name);
    for (let bc of repData.bcs) {
      let b_clean = clean_bc_name(bc.name);
      if (b_clean === cleanName || b_clean.includes(cleanName) || cleanName.includes(b_clean)) {
        bcMatch = bc;
        break;
      }
    }
    
    const amTele = bcMatch ? bcMatch.am_tele : '';
    const vol = bcMatch ? bcMatch.volume : 0;
    
    let cause = isGtb 
      ? 'Shipper chưa nắm rõ nghiệp vụ thu phí khi giao thất bại, tỷ lệ áp dụng thấp.' 
      : 'Khách báo hủy đơn hoặc không liên lạc được nhiều lần.';
    let plan = isGtb 
      ? 'AM tổ chức truyền thông cách tính lương đơn GTB-TT và hướng dẫn shipper tăng cường thu cước hoàn.' 
      : 'AM cắm chốt kiểm tra trực tiếp danh sách đơn hoàn, gọi điện xác minh khách hàng.';
    
    const causes_dict = isGtb ? gtb_causes : fd_causes;
    const plans_dict = isGtb ? gtb_plans : fd_plans;

    for (let k in causes_dict) {
      if (item.bc_name.includes(k)) {
        cause = causes_dict[k];
        plan = plans_dict[k];
        break;
      }
    }
    
    const changeVal = item.change_wtd;
    const hasChange = changeVal !== null && changeVal !== undefined && !isNaN(changeVal);
    const arrow = hasChange ? (changeVal >= 0 ? '▲' : '▼') : '';
    const sign = hasChange ? (changeVal >= 0 ? '+' : '') : '';
    
    let changeCls = '';
    if (hasChange) {
      if (isGtb) {
        changeCls = changeVal >= 0 ? 'text-success' : 'text-danger';
      } else {
        changeCls = changeVal <= 0 ? 'text-success' : 'text-danger';
      }
    }
    
    const changeText = hasChange ? `${arrow} ${sign}${(changeVal * 100).toFixed(2)}%` : '--';
    
    const labelMetric = isGtb ? '%GTB-TT' : '%FD';
    const badgeColor = isGtb 
      ? (item.w22 >= 0.25 ? 'rgba(34,197,94,0.15); color: var(--accent-green);' : (item.w22 >= 0.15 ? 'rgba(245,158,11,0.15); color: var(--accent-amber);' : 'rgba(244,63,94,0.15); color: var(--accent-rose);'))
      : (item.w22 > 0.08 ? 'rgba(244,63,94,0.15); color: var(--accent-rose);' : (item.w22 >= 0.05 ? 'rgba(245,158,11,0.15); color: var(--accent-amber);' : 'rgba(34,197,94,0.15); color: var(--accent-green);'));

    el.innerHTML = `
      <div class="hr-top5-header">
        <div>
          <div class="hr-top5-bcname">${i+1}. ${escapeHtml(item.bc_name)}</div>
          <div class="hr-top5-am">👤 AM: ${escapeHtml(item.am)}</div>
        </div>
        <span class="hr-top5-badge" style="background: ${badgeColor}">${labelMetric}: ${(item.w22 * 100).toFixed(2)}%</span>
      </div>
      <div class="hr-top5-stats" style="grid-template-columns: repeat(2, 1fr)">
        <div class="hr-top5-stat">
          Biến động tuần (Wow)
          <strong class="${changeCls}">${changeText}</strong>
        </div>
        <div class="hr-top5-stat">
          Sản lượng giao
          <strong>${vol ? vol.toLocaleString() : 'N/A'} đơn</strong>
        </div>
      </div>
      <div class="bc-cause-box" style="margin-top: 6px;">
        <strong>Nguyên nhân:</strong> ${escapeHtml(cause)}
      </div>
      <div class="hr-plan-box" style="border-left-color: var(--accent-amber); background: rgba(245,158,11,0.08);">
        <strong>Phương án xử lý:</strong> ${escapeHtml(plan)}
      </div>
      <div style="display:flex; justify-content: flex-end; margin-top: 8px;">
        <button class="bc-btn bc-btn-primary" style="flex:none; padding: 6px 14px; font-size:11px;" onclick="sendTelegramFdAlert('${escapeHtml(item.bc_name)}', '${escapeHtml(item.am)}', '${escapeHtml(amTele)}', '${(item.w22*100).toFixed(2)}%', '${escapeHtml(formatChangeText(changeVal))}', '${escapeHtml(cause)}')">💬 Nhắc AM</button>
      </div>
    `;
    container.appendChild(el);
  });
}

function getProvinceOfBc(bcName) {
  if (!repData || !repData.bcs) return 'N/A';
  const cleanName = clean_bc_name(bcName);
  const match = repData.bcs.find(b => clean_bc_name(b.name) === cleanName);
  if (match) return match.province;
  
  const matchSub = repData.bcs.find(b => clean_bc_name(b.name).includes(cleanName) || cleanName.includes(clean_bc_name(b.name)));
  return matchSub ? matchSub.province : 'N/A';
}

function getAggregatedFdData(list, keyType, isWeekly) {
  const groups = {};
  
  list.forEach(row => {
    if (row.bc_name === 'TỔNG Vùng ĐCL' || row.bc_name === 'Grand Total') return;
    
    let keyVal = 'N/A';
    if (keyType === 'am') {
      keyVal = row.am || 'N/A';
    } else if (keyType === 'province') {
      keyVal = getProvinceOfBc(row.bc_name);
    }
    
    if (keyVal === 'N/A' || keyVal === 'nan' || !keyVal) return;
    
    if (!groups[keyVal]) {
      groups[keyVal] = { name: keyVal, values: {}, count: {} };
    }
    
    if (isWeekly) {
      ['w18', 'w19', 'w20', 'w21', 'w22'].forEach(col => {
        if (row[col] !== null && row[col] !== undefined && !isNaN(row[col])) {
          if (!groups[keyVal].values[col]) {
            groups[keyVal].values[col] = 0;
            groups[keyVal].count[col] = 0;
          }
          groups[keyVal].values[col] += row[col];
          groups[keyVal].count[col] += 1;
        }
      });
    } else {
      const numCols = repData.fd_report.headers.daily.length - 4;
      for (let i = 18; i < 18 + numCols; i++) {
        const col = `d${i}`;
        if (row[col] !== null && row[col] !== undefined && !isNaN(row[col])) {
          if (!groups[keyVal].values[col]) {
            groups[keyVal].values[col] = 0;
            groups[keyVal].count[col] = 0;
          }
          groups[keyVal].values[col] += row[col];
          groups[keyVal].count[col] += 1;
        }
      }
    }
  });
  
  const avg = (sum, count) => count === 0 ? null : sum / count;
  
  return Object.values(groups).map(g => {
    const res = {
      bc_name: g.name,
      am: keyType === 'am' ? g.name : '',
      province: keyType === 'province' ? g.name : ''
    };
    
    if (isWeekly) {
      ['w18', 'w19', 'w20', 'w21', 'w22'].forEach(col => {
        res[col] = g.count[col] ? avg(g.values[col], g.count[col]) : null;
      });
      res.change_wtd = (res.w22 !== null && res.w21 !== null) ? (res.w22 - res.w21) : null;
    } else {
      const numCols = repData.fd_report.headers.daily.length - 4;
      for (let i = 18; i < 18 + numCols; i++) {
        const col = `d${i}`;
        res[col] = g.count[col] ? avg(g.values[col], g.count[col]) : null;
      }
      const d25_key = `d${18 + numCols - 1}`;
      const d24_key = `d${18 + numCols - 2}`;
      const d18_key = `d18`;
      res.change_d1 = (res[d25_key] !== null && res[d24_key] !== null) ? (res[d25_key] - res[d24_key]) : null;
      res.change_d7 = (res[d25_key] !== null && res[d18_key] !== null) ? (res[d25_key] - res[d18_key]) : null;
    }
    return res;
  });
}

function renderFdTable() {
  const head = document.getElementById('fdRepTableHead');
  const body = document.getElementById('fdRepTableBody');
  if (!head || !body || !repData || !repData.fd_report) return;
  body.innerHTML = '';
  
  const fdReport = repData.fd_report;
  const metricData = fdReport[activeFdMetric];
  if (!metricData) return;
  
  let filteredWeekly = [];
  let filteredDaily = [];
  
  if (activeFdDimension === 'am' || activeFdDimension === 'province') {
    filteredWeekly = getAggregatedFdData(metricData.weekly, activeFdDimension, true);
    filteredDaily = getAggregatedFdData(metricData.daily, activeFdDimension, false);
    
    filteredWeekly = filteredWeekly.filter(row => row.bc_name.toLowerCase().includes(fdTableSearchQuery));
    filteredDaily = filteredDaily.filter(row => row.bc_name.toLowerCase().includes(fdTableSearchQuery));
  } else {
    filteredWeekly = metricData.weekly.filter(bc => 
      bc.bc_name.toLowerCase().includes(fdTableSearchQuery) || 
      (bc.am && bc.am.toLowerCase().includes(fdTableSearchQuery))
    );
    filteredDaily = metricData.daily.filter(bc => 
      bc.bc_name.toLowerCase().includes(fdTableSearchQuery) || 
      (bc.am && bc.am.toLowerCase().includes(fdTableSearchQuery))
    );
  }
  
  function getFdCellClass(val) {
    if (val === null || val === undefined || val === '') return '';
    const isGtb = activeFdMetric === 'gtb';
    if (isGtb) {
      if (val >= 0.25) return 'fd-cell-green';
      if (val >= 0.15) return 'fd-cell-amber';
      return 'fd-cell-red';
    } else {
      if (val > 0.08) return 'fd-cell-red';
      if (val >= 0.05) return 'fd-cell-amber';
      return 'fd-cell-green';
    }
  }

  function formatValue(val) {
    if (val === null || val === undefined || val === '') return '--';
    return (val * 100).toFixed(2) + '%';
  }
  
  const isGtb = activeFdMetric === 'gtb';
  
  function renderChangeTagHtml(val) {
    if (val === null || val === undefined || isNaN(val)) {
      return `<span class="change-tag">--</span>`;
    }
    const arrow = val >= 0 ? '▲' : '▼';
    const sign = val >= 0 ? '+' : '';
    let changeCls = '';
    if (isGtb) {
      changeCls = val >= 0 ? 'up' : 'down';
    } else {
      changeCls = val <= 0 ? 'up' : 'down';
    }
    return `<span class="change-tag ${changeCls}">${arrow} ${sign}${(val * 100).toFixed(2)}%</span>`;
  }
  
  const firstHeader = activeFdDimension === 'bc' ? 'Bưu cục' : activeFdDimension === 'am' ? 'Area Manager (AM)' : 'Tỉnh';
  const secondHeader = activeFdDimension === 'bc' ? 'AM Phụ Trách' : '';
  
  if (activeFdViewMode === 'weekly') {
    const w18_lbl = fdReport.headers.weekly[2] || '2026/18';
    const w19_lbl = fdReport.headers.weekly[3] || '2026/19';
    const w20_lbl = fdReport.headers.weekly[4] || '2026/20';
    const w21_lbl = fdReport.headers.weekly[5] || '2026/21';
    const w22_lbl = fdReport.headers.weekly[6] || '2026/22';

    head.innerHTML = `
      <th>${firstHeader}</th>
      ${secondHeader ? `<th>${secondHeader}</th>` : ''}
      <th style="text-align: center">${w18_lbl}</th>
      <th style="text-align: center">${w19_lbl}</th>
      <th style="text-align: center">${w20_lbl}</th>
      <th style="text-align: center">${w21_lbl}</th>
      <th style="text-align: center; font-weight: bold">${w22_lbl}</th>
      <th style="text-align: center">Biến động (Wow)</th>
      <th style="text-align: center">Thao tác</th>
    `;
    
    filteredWeekly.sort((a, b) => {
      const valA = a.w22;
      const valB = b.w22;
      
      const hasA = valA !== null && valA !== undefined;
      const hasB = valB !== null && valB !== undefined;
      
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      
      return isGtb ? valA - valB : valB - valA;
    });
    
    filteredWeekly.forEach(row => {
      if (row.bc_name === 'TỔNG Vùng ĐCL' || row.bc_name === 'Grand Total') return;
      const tr = document.createElement('tr');
      tr.className = 'fd-row-active';
      
      const changeVal = row.change_wtd;
      
      let amTele = '';
      if (activeFdDimension === 'am') {
        const match = repData.bcs.find(b => b.am && b.am.toLowerCase().trim() === row.bc_name.toLowerCase().trim());
        amTele = match ? match.am_tele : '';
      } else if (activeFdDimension === 'bc') {
        let bcMatch = repData.bcs.find(b => clean_bc_name(b.name) === clean_bc_name(row.bc_name));
        amTele = bcMatch ? bcMatch.am_tele : '';
      }
      
      const btnLabel = activeFdDimension === 'province' ? 'Nhắc các AM' : 'Nhắc AM';
      const amNameForAlert = activeFdDimension === 'bc' ? row.am : activeFdDimension === 'am' ? row.bc_name : 'AM thuộc ' + row.bc_name;
      
      tr.innerHTML = `
        <td><strong>${escapeHtml(row.bc_name)}</strong></td>
        ${secondHeader ? `<td>👤 ${escapeHtml(row.am)}</td>` : ''}
        <td style="text-align: center" class="${getFdCellClass(row.w18)}">${formatValue(row.w18)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.w19)}">${formatValue(row.w19)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.w20)}">${formatValue(row.w20)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.w21)}">${formatValue(row.w21)}</td>
        <td style="text-align: center; font-weight: bold" class="${getFdCellClass(row.w22)}">${formatValue(row.w22)}</td>
        <td style="text-align: center">
          ${renderChangeTagHtml(changeVal)}
        </td>
        <td style="text-align: center">
          <button class="btn-nhac-am" onclick="sendTelegramFdAlert('${escapeHtml(row.bc_name)}', '${escapeHtml(amNameForAlert)}', '${escapeHtml(amTele)}', '${formatValue(row.w22)}', '${formatChangeText(changeVal)}', 'Kiểm tra tỷ lệ vận hành và đẩy mạnh GTB-TT')">${btnLabel}</button>
        </td>
      `;
      body.appendChild(tr);
    });
  } else {
    const d18_lbl = formatDailyHeader(fdReport.headers.daily[2]) || '18/05';
    const d19_lbl = formatDailyHeader(fdReport.headers.daily[3]) || '19/05';
    const d20_lbl = formatDailyHeader(fdReport.headers.daily[4]) || '20/05';
    const d21_lbl = formatDailyHeader(fdReport.headers.daily[5]) || '21/05';
    const d22_lbl = formatDailyHeader(fdReport.headers.daily[6]) || '22/05';
    const d23_lbl = formatDailyHeader(fdReport.headers.daily[7]) || '23/05';
    const d24_lbl = formatDailyHeader(fdReport.headers.daily[8]) || '24/05';
    const d25_lbl = formatDailyHeader(fdReport.headers.daily[9]) || '25/05';

    head.innerHTML = `
      <th>${firstHeader}</th>
      ${secondHeader ? `<th>${secondHeader}</th>` : ''}
      <th style="text-align: center">${d18_lbl}</th>
      <th style="text-align: center">${d19_lbl}</th>
      <th style="text-align: center">${d20_lbl}</th>
      <th style="text-align: center">${d21_lbl}</th>
      <th style="text-align: center">${d22_lbl}</th>
      <th style="text-align: center">${d23_lbl}</th>
      <th style="text-align: center">${d24_lbl}</th>
      <th style="text-align: center; font-weight: bold">${d25_lbl}</th>
      <th style="text-align: center">Biến động (DoD)</th>
      <th style="text-align: center">Thao tác</th>
    `;
    
    filteredDaily.sort((a, b) => {
      const valA = a.d25;
      const valB = b.d25;
      
      const hasA = valA !== null && valA !== undefined;
      const hasB = valB !== null && valB !== undefined;
      
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      
      return isGtb ? valA - valB : valB - valA;
    });
    
    filteredDaily.forEach(row => {
      if (row.bc_name === 'TỔNG Vùng ĐCL' || row.bc_name === 'Grand Total') return;
      const tr = document.createElement('tr');
      tr.className = 'fd-row-active';
      
      const changeVal = row.change_d1;
      const hasChange = changeVal !== null && changeVal !== undefined && !isNaN(changeVal);
      const arrow = hasChange ? (changeVal >= 0 ? '▲' : '▼') : '';
      const sign = hasChange ? (changeVal >= 0 ? '+' : '') : '';
      let changeCls = '';
      if (hasChange) {
        if (isGtb) {
          changeCls = changeVal >= 0 ? 'up' : 'down';
        } else {
          changeCls = changeVal <= 0 ? 'up' : 'down';
        }
      }
      
      let amTele = '';
      if (activeFdDimension === 'am') {
        const match = repData.bcs.find(b => b.am && b.am.toLowerCase().trim() === row.bc_name.toLowerCase().trim());
        amTele = match ? match.am_tele : '';
      } else if (activeFdDimension === 'bc') {
        let bcMatch = repData.bcs.find(b => clean_bc_name(b.name) === clean_bc_name(row.bc_name));
        amTele = bcMatch ? bcMatch.am_tele : '';
      }
      
      const btnLabel = activeFdDimension === 'province' ? 'Nhắc các AM' : 'Nhắc AM';
      const amNameForAlert = activeFdDimension === 'bc' ? row.am : activeFdDimension === 'am' ? row.bc_name : 'AM thuộc ' + row.bc_name;
      
      tr.innerHTML = `
        <td><strong>${escapeHtml(row.bc_name)}</strong></td>
        ${secondHeader ? `<td>👤 ${escapeHtml(row.am)}</td>` : ''}
        <td style="text-align: center" class="${getFdCellClass(row.d18)}">${formatValue(row.d18)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d19)}">${formatValue(row.d19)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d20)}">${formatValue(row.d20)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d21)}">${formatValue(row.d21)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d22)}">${formatValue(row.d22)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d23)}">${formatValue(row.d23)}</td>
        <td style="text-align: center" class="${getFdCellClass(row.d24)}">${formatValue(row.d24)}</td>
        <td style="text-align: center; font-weight: bold" class="${getFdCellClass(row.d25)}">${formatValue(row.d25)}</td>
        <td style="text-align: center">
          <span class="change-tag ${changeCls}">${arrow} ${sign}${(changeVal * 100).toFixed(2)}%</span>
        </td>
        <td style="text-align: center">
          <button class="btn-nhac-am" onclick="sendTelegramFdAlert('${escapeHtml(row.bc_name)}', '${escapeHtml(amNameForAlert)}', '${escapeHtml(amTele)}', '${formatValue(row.d25)}', '${formatChangeText(changeVal)}', 'Kiểm tra tỷ lệ trả trong ngày và đôn đốc thực hiện GTB-TT')">${btnLabel}</button>
        </td>
      `;
      body.appendChild(tr);
    });
  }
}

function switchFdViewMode(mode) {
  activeFdViewMode = mode;
  document.getElementById('btnFdViewWeekly').classList.remove('active');
  document.getElementById('btnFdViewDaily').classList.remove('active');
  
  if (mode === 'weekly') document.getElementById('btnFdViewWeekly').classList.add('active');
  else document.getElementById('btnFdViewDaily').classList.add('active');
  
  renderFdTable();
}

function switchFdDimension(dim) {
  activeFdDimension = dim;
  document.getElementById('btnFdDimBc').classList.remove('active');
  document.getElementById('btnFdDimAm').classList.remove('active');
  document.getElementById('btnFdDimProvince').classList.remove('active');
  
  if (dim === 'bc') document.getElementById('btnFdDimBc').classList.add('active');
  else if (dim === 'am') document.getElementById('btnFdDimAm').classList.add('active');
  else if (dim === 'province') document.getElementById('btnFdDimProvince').classList.add('active');
  
  renderFdTable();
}

function switchFdMetric(metric) {
  activeFdMetric = metric;
  
  const btnIds = {
    total: 'btnFdMetricTotal',
    sme: 'btnFdMetricSme',
    tts: 'btnFdMetricTts',
    gtb: 'btnFdMetricGtb'
  };
  
  for (const m in btnIds) {
    const btn = document.getElementById(btnIds[m]);
    if (btn) {
      if (m === metric) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }
  
  const descEl = document.getElementById('fdMetricDesc');
  if (descEl) {
    const descriptions = {
      total: 'Hiển thị tỷ lệ chuyển trả tổng của Bưu cục (tất cả các nguồn đơn).',
      sme: 'Hiển thị tỷ lệ chuyển trả của các đơn hàng thuộc nhóm SME COD.',
      tts: 'Hiển thị tỷ lệ chuyển trả của các đơn hàng từ sàn TikTok Shop (TTS).',
      gtb: 'Hiển thị tỷ lệ Giao thất bại thu tiền - Shipper vẫn được tính công và tăng GTC.'
    };
    descEl.textContent = descriptions[metric] || '';
  }
  
  const chartTitleEl = document.getElementById('fdChartTitle');
  if (chartTitleEl) {
    const chartTitles = {
      total: '📉 Biểu đồ Xu hướng Tỷ lệ Trả Tổng (%)',
      sme: '📉 Biểu đồ Xu hướng Tỷ lệ Trả SME COD (%)',
      tts: '📉 Biểu đồ Xu hướng Tỷ lệ Trả TikTok Shop (%)',
      gtb: '📈 Biểu đồ Xu hướng Tỷ lệ Giao Thất Bại Thu Tiền (%)'
    };
    chartTitleEl.textContent = chartTitles[metric];
  }

  const tableTitleEl = document.getElementById('fdTableTitle');
  if (tableTitleEl) {
    const tableTitles = {
      total: '📋 Bảng Chi Tiết Tỷ Lệ Trả Tổng (%)',
      sme: '📋 Bảng Chi Tiết Tỷ Lệ Trả SME COD (%)',
      tts: '📋 Bảng Chi Tiết Tỷ Lệ Trả TikTok Shop (%)',
      gtb: '📋 Bảng Chi Tiết Tỷ Lệ Giao Thất Bại Thu Tiền (%)'
    };
    tableTitleEl.textContent = tableTitles[metric];
  }
  
  renderReturnRateView();
}

function handleFdSearch() {
  fdTableSearchQuery = document.getElementById('fdTableSearch').value.toLowerCase().trim();
  renderFdTable();
}

async function sendTelegramFdAlert(bcName, amName, amTele, currentVal, changeText, cause) {
  if (!telegramConfig || !telegramConfig.BOT_TOKEN || !telegramConfig.CHAT_ID) {
    showToast("⚠️ Vui lòng cấu hình BOT_TOKEN & CHAT_ID trong file telegram_config.json");
    return;
  }
  if (!checkTelegramRateLimit()) return;
  
  const fdReport = repData.fd_report;
  
  function getBcMetricVal(metricKey, isDailyMode) {
    const data = fdReport[metricKey];
    if (!data) return 'N/A';
    
    const list = isDailyMode ? data.daily : data.weekly;
    
    if (activeFdDimension === 'am' || activeFdDimension === 'province') {
      const aggList = getAggregatedFdData(list, activeFdDimension, !isDailyMode);
      const cleanTarget = bcName.toLowerCase().trim();
      const match = aggList.find(row => row.bc_name.toLowerCase().trim() === cleanTarget);
      if (!match) return 'N/A';
      const val = isDailyMode ? match.d25 : match.w22;
      if (val === null || val === undefined) return 'N/A';
      return (val * 100).toFixed(2) + '%';
    } else {
      const cleanTarget = clean_bc_name(bcName);
      const match = list.find(row => clean_bc_name(row.bc_name) === cleanTarget);
      if (!match) return 'N/A';
      const val = isDailyMode ? match.d25 : match.w22;
      if (val === null || val === undefined) return 'N/A';
      return (val * 100).toFixed(2) + '%';
    }
  }

  const isDaily = activeFdViewMode === 'daily';
  const valTotal = getBcMetricVal('total', isDaily);
  const valSme = getBcMetricVal('sme', isDaily);
  const valTts = getBcMetricVal('tts', isDaily);
  const valGtb = getBcMetricVal('gtb', isDaily);
  
  const modeText = isDaily ? 'Báo cáo ngày 25/05' : 'Báo cáo tuần W22';
  
  const token = telegramConfig.BOT_TOKEN;
  const chatId = telegramConfig.CHAT_ID;
  
  let labelHeader = `🚨 *[CẢNH BÁO CHỈ SỐ VẬN HÀNH & TỶ LỆ TRẢ]* 🚨`;
  let detailLabel = `*Bưu cục:* ${escapeMarkdown(bcName)}\n*AM Phụ Trách:* ${escapeMarkdown(amName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n*Thời điểm:* ${escapeMarkdown(modeText)}\n\n`;
  
  if (activeFdDimension === 'am') {
    labelHeader = `🚨 *[CẢNH BÁO CHỈ SỐ VẬN HÀNH & TỶ LỆ TRẢ - AM]* 🚨`;
    detailLabel = `*Area Manager:* ${escapeMarkdown(bcName)} (${escapeMarkdown(amTele || '@chua_co_tele')})\n*Thời điểm:* ${escapeMarkdown(modeText)}\n\n`;
  } else if (activeFdDimension === 'province') {
    labelHeader = `🚨 *[CẢNH BÁO CHỈ SỐ VẬN HÀNH & TỶ LỆ TRẢ - TỈNH]* 🚨`;
    detailLabel = `*Tỉnh:* ${escapeMarkdown(bcName)}\n*Thời điểm:* ${escapeMarkdown(modeText)}\n\n`;
  }
  
  const text = `${labelHeader}\n\n` +
               detailLabel +
               `*Chi tiết bộ chỉ số:* \n` +
               `• *%FD Tổng:* ${escapeMarkdown(valTotal)}\n` +
               `• *%FD SME COD:* ${escapeMarkdown(valSme)}\n` +
               `• *%FD TikTok Shop:* ${escapeMarkdown(valTts)}\n` +
               `• *%GTB-TT (Thất bại thu tiền):* *${escapeMarkdown(valGtb)}*\n\n` +
               `*Lưu ý từ hệ thống:* Chỉ số GTB-TT cao giúp tăng tỷ lệ GTC và hạ tỷ lệ %FD thực tế, cần được AM đôn đốc nhân rộng ngay!\n\n` +
               `*Nguyên nhân/Nội dung nhắc nhở:* ${escapeMarkdown(cause)}\n\n` +
               `👉 *Hành động yêu cầu:* Đề nghị AM nhanh chóng rà soát các đơn giao không thành công, thúc đẩy shipper thực hiện thu cước hoàn (GTB-TT) đúng quy trình, kiểm soát ca giao tối và xử lý dứt điểm các đơn tồn đọng!`;
  
  const threadId = telegramConfig.THREADS && telegramConfig.THREADS.fd;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  showToast(`💬 Đang gửi cảnh báo qua Telegram...`);
  
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (threadId) payload.message_thread_id = threadId;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast("✅ Đã gửi cảnh báo Telegram thành công!");
    } else {
      const err = await res.json();
      showToast(`❌ Gửi Telegram thất bại: ${err.description}`);
    }
  } catch (e) {
    showToast(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
}

function clean_bc_name(name) {
  if (!name) return "";
  return name.toLowerCase().replace("bưu cục", "").replace("bc", "").replace(/[\s\-]+/g, " ").trim();
}

// ===== TRANSFER BACKLOG STATE =====
let activeTbDim = 'province';
let tbSearchQuery = '';
let tbCurrentPage = 1;
const tbPageSize = 25;

// ===== TRANSFER BACKLOG DASHBOARD RENDERING =====
function renderTransferBacklogView() {
  if (!repData || !repData.transfer_backlog) return;
  const tb = repData.transfer_backlog;
  
  // Render KPIs
  const kpis = tb.kpis;
  document.getElementById('tbKpiTotal').textContent = kpis.total.toLocaleString();
  document.getElementById('tbKpiGiao').textContent = kpis.giao.toLocaleString();
  document.getElementById('tbKpiTra').textContent = kpis.tra.toLocaleString();
  document.getElementById('tbKpiAsOf').textContent = kpis.as_of || '--';
  
  // Render KPI Changes
  const diffTotal = kpis.total - kpis.prev_total;
  const diffGiao = kpis.giao - kpis.prev_giao;
  const diffTra = kpis.tra - kpis.prev_tra;
  
  const formatDiff = (diff) => {
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '±';
    const sign = diff > 0 ? '+' : '';
    const cls = diff > 0 ? 'down' : diff < 0 ? 'up' : ''; // For backlog, increase is bad (down), decrease is good (up)
    return `<span class="change-tag ${cls}">${arrow} ${sign}${diff} vs Lần trước</span>`;
  };
  
  document.getElementById('tbKpiTotalChanges').innerHTML = formatDiff(diffTotal);
  document.getElementById('tbKpiGiaoChanges').innerHTML = formatDiff(diffGiao);
  document.getElementById('tbKpiTraChanges').innerHTML = formatDiff(diffTra);
  document.getElementById('tbKpiPrevAsOf').textContent = `Lần trước: ${kpis.prev_as_of || '--'}`;
  
  // Render Top 20 Table
  renderTbTop20(tb.top_20);
  
  // Render Dimension Table
  renderTbDimension(tb);
  
  // Render Detail Table
  renderTbDetails(tb.orders);
}

function renderTbTop20(top20) {
  const tbody = document.getElementById('tbTop20TableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!top20 || top20.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted)">Không có dữ liệu bưu cục tồn cao</td></tr>';
    return;
  }
  
  top20.forEach(item => {
    const tr = document.createElement('tr');
    
    // Check trend values to color
    let chgVal = 0;
    try {
      const cleanChg = item.change_total.replace('+', '').replace('▲', '').replace('▼', '').trim();
      chgVal = parseInt(cleanChg) || 0;
      if (item.change_total.includes('-') || item.change_total.includes('▼')) chgVal = -chgVal;
    } catch(e) {}
    
    const trendCls = chgVal > 0 ? 'color:var(--accent-rose)' : chgVal < 0 ? 'color:var(--accent-green)' : 'color:var(--text-muted)';
    
    tr.innerHTML = `
      <td>${item.stt}</td>
      <td style="font-weight:600; color:#fff">${escapeHtml(item.bc_name)}</td>
      <td>👤 ${escapeHtml(item.am)}</td>
      <td style="text-align:center">${item.giao}</td>
      <td style="text-align:center">${item.tra}</td>
      <td style="text-align:center; font-weight:700">${item.total}</td>
      <td style="text-align:center; font-weight:600; ${trendCls}">${item.change_total}</td>
    `;
    tbody.appendChild(tr);
  });
}

function switchTbDimension(dim) {
  activeTbDim = dim;
  document.getElementById('btnTbDimProvince').classList.remove('active');
  document.getElementById('btnTbDimAm').classList.remove('active');
  document.getElementById('btnTbDimBc').classList.remove('active');
  
  if (dim === 'province') document.getElementById('btnTbDimProvince').classList.add('active');
  else if (dim === 'am') document.getElementById('btnTbDimAm').classList.add('active');
  else if (dim === 'bc') document.getElementById('btnTbDimBc').classList.add('active');
  
  if (repData && repData.transfer_backlog) {
    renderTbDimension(repData.transfer_backlog);
  }
}

function renderTbDimension(tb) {
  const thead = document.getElementById('tbDimTableHead');
  const tbody = document.getElementById('tbDimTableBody');
  if (!thead || !tbody) return;
  
  tbody.innerHTML = '';
  let items = [];
  
  if (activeTbDim === 'province') {
    thead.innerHTML = `
      <th>Tỉnh</th>
      <th style="text-align:center">LC Giao</th>
      <th style="text-align:center">LC Trả</th>
      <th style="text-align:center">Tổng Tồn</th>
    `;
    items = tb.provinces || [];
  } else if (activeTbDim === 'am') {
    thead.innerHTML = `
      <th>Area Manager (AM)</th>
      <th style="text-align:center">LC Giao</th>
      <th style="text-align:center">LC Trả</th>
      <th style="text-align:center">Tổng Tồn</th>
    `;
    items = tb.ams || [];
  } else if (activeTbDim === 'bc') {
    thead.innerHTML = `
      <th>Bưu Cục</th>
      <th>AM</th>
      <th style="text-align:center">LC Giao</th>
      <th style="text-align:center">LC Trả</th>
      <th style="text-align:center">Tổng Tồn</th>
    `;
    items = tb.bcs || [];
  }
  
  if (items.length === 0) {
    const colSpan = activeTbDim === 'bc' ? 5 : 4;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; color:var(--text-muted)">Không có dữ liệu</td></tr>`;
    return;
  }
  
  items.forEach(item => {
    const tr = document.createElement('tr');
    if (activeTbDim === 'bc') {
      tr.innerHTML = `
        <td style="font-weight:600; color:#fff">${escapeHtml(item.name)}</td>
        <td>👤 ${escapeHtml(item.am)}</td>
        <td style="text-align:center">${item.giao}</td>
        <td style="text-align:center">${item.tra}</td>
        <td style="text-align:center; font-weight:700; color:var(--accent-amber)">${item.total}</td>
      `;
    } else {
      tr.innerHTML = `
        <td style="font-weight:600; color:#fff">${escapeHtml(item.name)}</td>
        <td style="text-align:center">${item.giao}</td>
        <td style="text-align:center">${item.tra}</td>
        <td style="text-align:center; font-weight:700; color:var(--accent-amber)">${item.total}</td>
      `;
    }
    tbody.appendChild(tr);
  });
}

function handleTbSearch() {
  tbSearchQuery = document.getElementById('tbTableSearch').value.toLowerCase().trim();
  tbCurrentPage = 1;
  if (repData && repData.transfer_backlog) {
    renderTbDetails(repData.transfer_backlog.orders);
  }
}

function changeTbPage(delta) {
  tbCurrentPage += delta;
  if (tbCurrentPage < 1) tbCurrentPage = 1;
  if (repData && repData.transfer_backlog) {
    renderTbDetails(repData.transfer_backlog.orders);
  }
}

function renderTbDetails(orders) {
  const tbody = document.getElementById('tbDetailTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted)">Không có dữ liệu đơn hàng</td></tr>';
    document.getElementById('tbDetailCount').textContent = 'Hiển thị: 0 đơn';
    document.getElementById('tbPaginationInfo').textContent = 'Trang 1 / 1';
    return;
  }
  
  // Filter orders based on search query
  let filtered = orders;
  if (tbSearchQuery) {
    filtered = orders.filter(o => 
      o.order_id.toLowerCase().includes(tbSearchQuery) ||
      o.bc_name.toLowerCase().includes(tbSearchQuery) ||
      o.am.toLowerCase().includes(tbSearchQuery) ||
      o.province.toLowerCase().includes(tbSearchQuery) ||
      o.customer.toLowerCase().includes(tbSearchQuery) ||
      o.status.toLowerCase().includes(tbSearchQuery) ||
      o.type.toLowerCase().includes(tbSearchQuery)
    );
  }
  
  // Total details count display
  document.getElementById('tbDetailCount').textContent = `Hiển thị: ${filtered.length.toLocaleString()} đơn`;
  
  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / tbPageSize));
  if (tbCurrentPage > totalPages) tbCurrentPage = totalPages;
  
  document.getElementById('tbPaginationInfo').textContent = `Trang ${tbCurrentPage} / ${totalPages}`;
  document.getElementById('btnTbPrevPage').disabled = tbCurrentPage === 1;
  document.getElementById('btnTbNextPage').disabled = tbCurrentPage === totalPages;
  
  const startIdx = (tbCurrentPage - 1) * tbPageSize;
  const pageItems = filtered.slice(startIdx, startIdx + tbPageSize);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted)">Không tìm thấy đơn hàng phù hợp</td></tr>';
    return;
  }
  
  pageItems.forEach(o => {
    const tr = document.createElement('tr');
    
    const typeCls = o.type === 'Luân chuyển giao' ? 'color:var(--accent-blue)' : 'color:var(--accent-purple)';
    const statusCls = o.status === 'Chưa đóng kiện' ? 'background:rgba(244,63,94,0.15); color:var(--accent-rose)' : 'background:rgba(45,212,191,0.15); color:var(--accent-teal)';
    const typeLabel = o.type === 'Luân chuyển giao' ? '🚚 LC Giao' : '🔄 LC Trả';
    
    tr.innerHTML = `
      <td style="font-family:monospace; font-weight:600; color:#fff">${o.order_id}</td>
      <td style="font-weight:600; ${typeCls}">${typeLabel}</td>
      <td>${escapeHtml(o.customer)}</td>
      <td><span style="font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; ${statusCls}">${escapeHtml(o.status)}</span></td>
      <td style="font-weight:600; text-align:center">${o.age_hours}</td>
      <td>${escapeHtml(o.bc_name)}</td>
      <td>${escapeHtml(o.province)}</td>
      <td>👤 ${escapeHtml(o.am)}</td>
      <td style="font-size:11px; color:var(--text-secondary); font-weight:500">${escapeHtml(o.aging_band)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Auto-load server data on startup if available (Read-Only mode)
async function initAutoLoad() {
  try {
    const testLoad = await readFile('Task Systems.md');
    if (testLoad) {
      const session = checkSession();
      if (session) {
        document.getElementById('onboarding').style.display = 'none';
        document.getElementById('appHeader').style.display = 'flex';
        document.getElementById('appTabs').style.display = 'flex';
        
        switchTab('checklist');
        await refreshData();
        showToast('👁️ Chế độ xem Chỉ Đọc (Dữ liệu từ GitHub)');
      }
    }
  } catch(e) {
    console.error("Autoload failed:", e);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initAutoLoad);
} else {
  initAutoLoad();
}

/* === SOMATIC & PREDICTIVE UPGRADES FUNCTIONS === */
function renderSomaticZen() {
  if (!repData) return;
  const zenScore = repData.zen_score !== undefined ? repData.zen_score : 65;
  const scoreVal = document.getElementById('zenScoreValue');
  const emojiEl = document.getElementById('zenEmoji');
  const titleEl = document.getElementById('zenTitle');
  const subtitleEl = document.getElementById('zenSubtitle');
  const cardEl = document.querySelector('.somatic-zen-card');

  if (scoreVal) scoreVal.textContent = zenScore + '%';

  if (zenScore >= 80) {
    if (emojiEl) emojiEl.textContent = '🧘';
    if (titleEl) titleEl.textContent = 'VÙNG ĐCL BÌNH YÊN';
    if (subtitleEl) subtitleEl.textContent = 'Các chỉ số vận hành đang rất khỏe. Bạn có thể thư giãn và duy trì nhịp độ.';
    if (scoreVal) scoreVal.style.color = 'var(--accent-green)';
    if (cardEl) {
      cardEl.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(13, 13, 13, 0.95) 100%)';
      cardEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
    }
  } else if (zenScore >= 50) {
    if (emojiEl) emojiEl.textContent = '🌱';
    if (titleEl) titleEl.textContent = 'VÙNG ĐCL QUÂN BÌNH';
    if (subtitleEl) subtitleEl.textContent = 'Vận hành tương đối ổn định. Chú ý theo dõi sát sao các tuyến hụt nhân sự.';
    if (scoreVal) scoreVal.style.color = 'var(--accent-teal)';
    if (cardEl) {
      cardEl.style.background = 'linear-gradient(135deg, rgba(45, 212, 191, 0.05) 0%, rgba(13, 13, 13, 0.95) 100%)';
      cardEl.style.borderColor = 'rgba(45, 212, 191, 0.2)';
    }
  } else {
    if (emojiEl) emojiEl.textContent = '🚨';
    if (titleEl) titleEl.textContent = 'VÙNG ĐCL BÃO ĐỘNG';
    if (subtitleEl) subtitleEl.textContent = 'Nhiều điểm nóng quá tải và thiếu hụt nhân sự. Khuyến nghị thực hiện trị liệu thở trước khi chỉ đạo.';
    if (scoreVal) scoreVal.style.color = 'var(--accent-rose)';
    if (cardEl) {
      cardEl.style.background = 'linear-gradient(135deg, rgba(244, 63, 94, 0.05) 0%, rgba(13, 13, 13, 0.95) 100%)';
      cardEl.style.borderColor = 'rgba(244, 63, 94, 0.2)';
    }
  }
}

let breathingTimerInterval = null;
let breathingCycleTimeout = null;
let isBreathingActive = false;

function openBreathingModal() {
  const modal = document.getElementById('breathingModal');
  if (modal) modal.style.display = 'flex';
  resetBreathing();
}

function closeBreathingModal() {
  const modal = document.getElementById('breathingModal');
  if (modal) modal.style.display = 'none';
  resetBreathing();
}

function resetBreathing() {
  isBreathingActive = false;
  clearInterval(breathingTimerInterval);
  clearTimeout(breathingCycleTimeout);
  
  const textEl = document.getElementById('breathingText');
  const timerEl = document.getElementById('breathingTimer');
  const circleEl = document.getElementById('breathingCircle');
  const btnEl = document.getElementById('btnStartBreathing');
  
  if (textEl) textEl.textContent = 'Hãy ngồi thẳng lưng, thả lỏng vai và sẵn sàng...';
  if (timerEl) timerEl.textContent = '0s';
  if (btnEl) btnEl.textContent = '▶ Bắt đầu chu kỳ';
  if (circleEl) {
    circleEl.style.animation = 'none';
    circleEl.style.transform = 'scale(1)';
  }
}

function toggleBreathingCycle() {
  if (isBreathingActive) {
    resetBreathing();
  } else {
    isBreathingActive = true;
    const btnEl = document.getElementById('btnStartBreathing');
    if (btnEl) btnEl.textContent = '⏹ Dừng chu kỳ';
    runBreathingStep('inhale');
  }
}

function runBreathingStep(phase) {
  if (!isBreathingActive) return;
  
  const textEl = document.getElementById('breathingText');
  const timerEl = document.getElementById('breathingTimer');
  const circleEl = document.getElementById('breathingCircle');
  
  let duration = 0;
  
  if (phase === 'inhale') {
    duration = 4;
    if (textEl) textEl.textContent = '💨 Hít vào từ từ qua mũi...';
    if (circleEl) {
      circleEl.style.animation = 'inhale 4s forwards linear';
    }
  } else if (phase === 'hold') {
    duration = 7;
    if (textEl) textEl.textContent = '🧘 Giữ hơi thở lại...';
    if (circleEl) {
      circleEl.style.animation = 'none';
      circleEl.style.transform = 'scale(2.8)';
    }
  } else if (phase === 'exhale') {
    duration = 8;
    if (textEl) textEl.textContent = '🌬️ Thở ra từ từ bằng miệng...';
    if (circleEl) {
      circleEl.style.animation = 'exhale 8s forwards linear';
    }
  }
  
  let elapsed = 0;
  if (timerEl) timerEl.textContent = elapsed + 's / ' + duration + 's';
  
  clearInterval(breathingTimerInterval);
  breathingTimerInterval = setInterval(() => {
    elapsed++;
    if (elapsed <= duration) {
      if (timerEl) timerEl.textContent = elapsed + 's / ' + duration + 's';
    }
  }, 1000);
  
  clearTimeout(breathingCycleTimeout);
  breathingCycleTimeout = setTimeout(() => {
    clearInterval(breathingTimerInterval);
    if (phase === 'inhale') {
      runBreathingStep('hold');
    } else if (phase === 'hold') {
      runBreathingStep('exhale');
    } else {
      runBreathingStep('inhale');
    }
  }, duration * 1000);
}

function renderPredictiveStaffing() {
  if (!repData || !repData.forecasting) return;
  const f = repData.forecasting;
  const volEl = document.getElementById('projectedVolumeVal');
  const trendEl = document.getElementById('projectedTrendVal');
  const shortageEl = document.getElementById('projectedShortageVal');
  const recEl = document.getElementById('forecastingRecommendation');
  
  if (volEl) volEl.textContent = f.projected_volume.toLocaleString() + ' đơn';
  if (trendEl) {
    trendEl.textContent = f.vol_trend === 'Tăng' ? '↗ Tăng' : '↘ Giảm';
    trendEl.style.color = f.vol_trend === 'Tăng' ? 'var(--accent-green)' : 'var(--accent-rose)';
  }
  if (shortageEl) shortageEl.textContent = f.projected_shortage + ' NV';
  if (recEl) recEl.textContent = f.recommendation;
}

function renderRoutesHeatmap() {
  const gridEl = document.getElementById('routesHeatmapGrid');
  if (!gridEl || !repData || !repData.bcs) return;
  gridEl.innerHTML = '';
  
  const allRoutes = [];
  repData.bcs.forEach(bc => {
    if (bc.hr && bc.hr.tuyen_thieu) {
      const routes = bc.hr.tuyen_thieu.split(/[,;\n]+/).map(r => r.trim()).filter(r => r.length > 0);
      routes.forEach(r => {
        allRoutes.push({
          bcName: bc.name,
          routeName: r,
          province: bc.province
        });
      });
    }
  });
  
  if (allRoutes.length === 0) {
    gridEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Không có tuyến thiếu hụt nhân sự được ghi nhận.</div>';
    return;
  }
  
  const uniqueRoutes = [];
  const seen = new Set();
  allRoutes.forEach(r => {
    const key = `${r.bcName}-${r.routeName}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRoutes.push(r);
    }
  });

  uniqueRoutes.slice(0, 15).forEach(item => {
    const card = document.createElement('div');
    const isSpecial = /đò|phà|cù lao|sông|biển/i.test(item.routeName);
    card.className = isSpecial ? 'heatmap-route-card heatmap-route-special' : 'heatmap-route-card heatmap-route-normal';
    
    const icon = isSpecial ? '⛴️' : '📍';
    card.innerHTML = `${icon} <strong>[${item.bcName}]</strong> ${item.routeName}`;
    gridEl.appendChild(card);
  });
}

let exitHoursChartObj = null;

function renderExitHoursChart() {
  const provinces = repData.provinces;
  if (!provinces || provinces.length === 0) return;
  
  const labels = provinces.map(p => p.name);
  const exitHoursData = provinces.map(p => {
    if (p.exit_profile && p.exit_profile.exit_hour) {
      const parts = p.exit_profile.exit_hour.split(':');
      return parseFloat(parts[0]) + parseFloat(parts[1]) / 60;
    }
    return 8.75;
  });
  
  if (exitHoursChartObj) exitHoursChartObj.destroy();
  const ctx = document.getElementById('exitHoursChart').getContext('2d');
  
  exitHoursChartObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Giờ rời kho bình quân shipper',
        data: exitHoursData,
        backgroundColor: 'rgba(45, 212, 191, 0.75)',
        borderColor: '#2dd4bf',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 8.0,
          max: 10.5,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: function(value) {
              const hour = Math.floor(value);
              const min = Math.round((value - hour) * 60);
              return hour.toString().padStart(2, '0') + ':' + min.toString().padStart(2, '0');
            }
          }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed.y;
              const hour = Math.floor(val);
              const min = Math.round((val - hour) * 60);
              return 'Giờ ra kho: ' + hour.toString().padStart(2, '0') + ':' + min.toString().padStart(2, '0');
            }
          }
        }
      }
    }
  });

  const textEl = document.getElementById('inboundBottleneckAnalysis');
  if (textEl) {
    let html = '';
    provinces.forEach(p => {
      const ep = p.exit_profile || { exit_hour: '08:45', late_inbound_rate: 0.1, sorting_delay_min: 30 };
      const latePct = (ep.late_inbound_rate * 100).toFixed(0);
      const isLate = parseFloat(ep.exit_hour.replace(':', '.')) >= 9.0;
      const statusIcon = isLate ? '🔴' : '🟢';
      
      html += `<div style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px dashed var(--border);">
        <div style="font-weight:600; color:#fff; display:flex; align-items:center; gap:6px;">
          ${statusIcon} ${p.name}: Giờ ra kho ${ep.exit_hour}
        </div>
        <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">
          • Xe tải về trễ (late inbound): <strong>${latePct}%</strong> số chuyến.<br>
          • Thời gian chia chọn (sorting delay): <strong>${ep.sorting_delay_min} phút</strong>.<br>
          • Đánh giá: ${isLate ? '<span style="color:var(--accent-rose)">Nghẽn nghiêm trọng, cần cắm chốt tối ưu phân chuyến.</span>' : '<span style="color:var(--accent-green)">Tốt, dòng hàng ổn định.</span>'}
        </div>
      </div>`;
    });
    textEl.innerHTML = html;
  }
}

