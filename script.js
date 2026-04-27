(function() {
  // ============ DOM ELEMENTS ============
  const sidebar = document.getElementById('sidebar');
  const sidebarBody = document.getElementById('sidebarBody');
  const editorContent = document.getElementById('editorContent');
  const noFileMsg = document.getElementById('noFileMsg');
  const fileInfo = document.getElementById('fileInfo');
  const saveIndicator = document.getElementById('saveIndicator');
  const settingsModal = document.getElementById('settingsModal');
  const btnBold = document.getElementById('btnBold');
  const btnItalic = document.getElementById('btnItalic');
  const fontFamilySelect = document.getElementById('fontFamilySelect');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  const toastContainer = document.getElementById('toastContainer');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  // ============ KONFIGURASI PUBLIK ============
  // 🌐 GANTI dengan username GitHub dan nama repo publik kamu
  const PUBLIC_USERNAME = 'USERNAME_KAMU';       // <-- GANTI
  const PUBLIC_REPO = 'scripthub-data';           // <-- GANTI
  const PUBLIC_RAW_URL = `https://raw.githubusercontent.com/${PUBLIC_USERNAME}/${PUBLIC_REPO}/main/data.json`;

  // ============ STATE ============
  const STORAGE_KEY = 'scripthub_data';
  const GITHUB_CONFIG_KEY = 'scripthub_github_config';
  const DATA_FILE_PATH = 'data.json';

  let appData = {
    folders: [],
    files: [],
  };

  let currentFileId = null;
  let isDirty = false;
  let saveTimeout = null;
  let isSyncing = false;
  let isPublicMode = true;   // <-- Awalnya publik, sampai user set token

  // ============ INIT ============
  async function init() {
    loadFromLocalStorage();
    if (!appData.folders.length && !appData.files.length) {
      await loadFromPublicGitHub();   // coba ambil data publik
    }
    if (!appData.folders.length) {
      createDefaultFolder();          // fallback
    }

    renderSidebar();
    setupEditorEvents();
    setupToolbarEvents();
    setupModalEvents();
    setupKeyboardShortcuts();
    setupMobileMenu();

    // Cek apakah user sudah set token -> jadi mode privat
    const config = getGitHubConfig();
    if (config.configured) {
      isPublicMode = false;
      await autoSyncFromGitHub();     // sinkronkan data privat
    }

    updateSaveIndicator();
    console.log('📜 ScriptHub siap! Mode:', isPublicMode ? 'Publik (baca saja)' : 'Pribadi (bisa edit)');
  }

  function createDefaultFolder() {
    appData.folders.push({
      id: generateId(),
      name: 'Umum',
      createdAt: new Date().toISOString()
    });
    saveToLocalStorage();
  }

  function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ============ LOCAL STORAGE ============
  function saveToLocalStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); }
    catch (e) { showToast('⚠️ Gagal menyimpan ke localStorage', 'error'); }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.folders && parsed.files) appData = parsed;
      }
    } catch (e) {}
  }

  // ============ AMBIL DATA PUBLIK DARI GITHUB ============
  async function loadFromPublicGitHub() {
    try {
      const resp = await fetch(PUBLIC_RAW_URL);
      if (!resp.ok) throw new Error('Tidak bisa mengambil data publik');
      const remoteData = await resp.json();
      if (remoteData.folders && remoteData.files) {
        appData = remoteData;
        saveToLocalStorage();
        showToast('📖 Data publik dimuat', 'success');
      }
    } catch (e) {
      console.warn('Gagal load data publik, pakai data lokal');
    }
  }

  // ============ RENDER SIDEBAR ============
  function renderSidebar() {
    sidebarBody.innerHTML = '';
    if (!appData.folders.length && !appData.files.length) {
      sidebarBody.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>Belum ada folder.<br>Klik 📁 untuk membuat folder pertama.</p></div>`;
      return;
    }

    appData.folders.forEach((folder, index) => {
      const folderFiles = appData.files.filter(f => f.folderId === folder.id);
      const isOpen = folder._isOpen !== false;
      const group = document.createElement('div');
      group.className = 'folder-group';
      group.dataset.folderId = folder.id;
      group.innerHTML = `
        <div class="folder-header ${isOpen ? 'open' : ''}" data-folder-id="${folder.id}">
          <span class="folder-arrow">▶</span>
          <span class="folder-icon">📁</span>
          <span class="folder-name" data-rename-folder="${folder.id}">${escapeHtml(folder.name)}</span>
          <span class="folder-count">${folderFiles.length}</span>
          <span class="folder-actions">
            <button class="folder-move-arrow" data-action="move-up" data-folder-id="${folder.id}" ${index === 0 ? 'disabled' : ''}>⬆️</button>
            <button class="folder-move-arrow" data-action="move-down" data-folder-id="${folder.id}" ${index === appData.folders.length-1 ? 'disabled' : ''}>⬇️</button>
            <button class="btn-icon" data-action="add-file" data-folder-id="${folder.id}">＋</button>
            <button class="btn-icon" data-action="delete-folder" data-folder-id="${folder.id}">🗑</button>
          </span>
        </div>
        <div class="file-list ${isOpen ? 'expanded' : ''}" data-folder-id="${folder.id}">
          ${folderFiles.map(f => `
            <div class="file-item ${f.id === currentFileId ? 'active' : ''}" data-file-id="${f.id}">
              <span class="file-dot"></span>
              <span class="file-name" data-rename-file="${f.id}">${escapeHtml(f.name)}</span>
              <span class="file-date">${formatDateShort(f.updatedAt)}</span>
              <button class="file-delete" data-action="delete-file" data-file-id="${f.id}">✕</button>
            </div>
          `).join('')}
          ${folderFiles.length === 0 ? '<div class="empty-state" style="padding:12px;font-size:0.7rem;">Kosong</div>' : ''}
        </div>`;
      sidebarBody.appendChild(group);
    });

    attachSidebarEvents();
  }

  function attachSidebarEvents() {
    // Toggle folder
    sidebarBody.querySelectorAll('.folder-header').forEach(header => {
      header.addEventListener('click', function(e) {
        if (e.target.closest('[data-action], .folder-move-arrow, [data-rename-folder]')) return;
        const folder = appData.folders.find(f => f.id === this.dataset.folderId);
        if (folder) {
          folder._isOpen = !(folder._isOpen !== false);
          saveToLocalStorage();
          renderSidebar();
        }
      });
    });

    // Rename folder (double-click) – hanya jika bukan public
    sidebarBody.querySelectorAll('[data-rename-folder]').forEach(span => {
      span.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        startRenameFolder(this.dataset.renameFolder);
      });
    });

    // Rename file
    sidebarBody.querySelectorAll('[data-rename-file]').forEach(span => {
      span.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        startRenameFile(this.dataset.renameFile);
      });
    });

    // Add file
    sidebarBody.querySelectorAll('[data-action="add-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        createNewFile(this.dataset.folderId);
      });
    });

    // Delete folder
    sidebarBody.querySelectorAll('[data-action="delete-folder"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        deleteFolder(this.dataset.folderId);
      });
    });

    // Delete file
    sidebarBody.querySelectorAll('[data-action="delete-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        deleteFile(this.dataset.fileId);
      });
    });

    // Move folder
    sidebarBody.querySelectorAll('[data-action="move-up"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        moveFolder(this.dataset.folderId, 'up');
      });
    });
    sidebarBody.querySelectorAll('[data-action="move-down"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
        moveFolder(this.dataset.folderId, 'down');
      });
    });

    // Select file
    sidebarBody.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', function(e) {
        if (e.target.closest('[data-action], [data-rename-file]')) return;
        selectFile(this.dataset.fileId);
      });
    });
  }

  // ---------- RENAME FUNCTIONS ----------
  function startRenameFolder(folderId) {
    const span = document.querySelector(`[data-rename-folder="${folderId}"]`);
    if (!span) return;
    const oldName = span.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = oldName;
    span.replaceWith(input);
    input.focus();
    input.select();

    function finish() {
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        const folder = appData.folders.find(f => f.id === folderId);
        if (folder) {
          folder.name = newName;
          saveToLocalStorage();
          renderSidebar();
          showToast('📁 Nama folder diubah');
        }
      } else {
        renderSidebar();
      }
    }

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = oldName;
        input.blur();
      }
    });
  }

  function startRenameFile(fileId) {
    const span = document.querySelector(`[data-rename-file="${fileId}"]`);
    if (!span) return;
    const oldName = span.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = oldName;
    span.replaceWith(input);
    input.focus();
    input.select();

    function finish() {
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        const file = appData.files.find(f => f.id === fileId);
        if (file) {
          file.name = newName;
          saveToLocalStorage();
          renderSidebar();
          if (currentFileId === fileId) fileInfo.querySelector('.current-file-name').textContent = newName;
          showToast('✏️ Nama script diubah');
        }
      } else {
        renderSidebar();
      }
    }

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = oldName;
        input.blur();
      }
    });
  }

  function moveFolder(folderId, direction) {
    const index = appData.folders.findIndex(f => f.id === folderId);
    if (index === -1) return;
    if (direction === 'up' && index > 0) {
      [appData.folders[index-1], appData.folders[index]] = [appData.folders[index], appData.folders[index-1]];
    } else if (direction === 'down' && index < appData.folders.length - 1) {
      [appData.folders[index], appData.folders[index+1]] = [appData.folders[index+1], appData.folders[index]];
    }
    saveToLocalStorage();
    const el = document.querySelector(`.folder-group[data-folder-id="${folderId}"]`);
    if (el) { el.classList.add('moving'); setTimeout(() => el.classList.remove('moving'), 400); }
    renderSidebar();
    if (!isPublicMode) syncToGitHub();
  }

  // ---------- FILE OPERATIONS ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / (1000*60*60*24));
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Kemarin';
    if (diff < 7) return `${diff}h lalu`;
    return d.toLocaleDateString('id-ID', { day:'numeric', month:'short' });
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function createNewFile(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    folder._isOpen = true;
    const newFile = {
      id: generateId(),
      name: 'Script Baru ' + new Date().toLocaleDateString('id-ID'),
      folderId,
      content: '',
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    appData.files.push(newFile);
    saveToLocalStorage();
    renderSidebar();
    selectFile(newFile.id);
    showToast('✨ Script baru dibuat di folder "' + folder.name + '"');
  }

  function selectFile(fileId) {
    saveCurrentFileContent();
    currentFileId = fileId;
    const file = appData.files.find(f => f.id === fileId);
    if (!file) return;

    noFileMsg.style.display = 'none';
    editorContent.style.display = 'block';
    editorContent.innerHTML = file.content || '';
    editorContent.style.fontFamily = file.fontFamily || 'Inter, sans-serif';
    editorContent.style.fontSize = file.fontSize || '16px';
    fontFamilySelect.value = file.fontFamily || 'Inter, sans-serif';
    fontSizeSelect.value = file.fontSize || '16px';

    fileInfo.querySelector('.current-file-name').textContent = file.name;
    fileInfo.querySelector('.current-file-meta').innerHTML =
      `<span>📅 Dibuat: ${formatDateFull(file.createdAt)}</span><span>✏️ Diubah: ${formatDateFull(file.updatedAt)}</span>`;

    renderSidebar();
    editorContent.focus();
    isDirty = false;
    updateSaveIndicator();
    setSaveIndicatorUnsaved(false);
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
  }

  function saveCurrentFileContent() {
    if (!currentFileId) return;
    const file = appData.files.find(f => f.id === currentFileId);
    if (!file) return;
    const html = editorContent.innerHTML;
    const fam = editorContent.style.fontFamily || 'Inter, sans-serif';
    const siz = editorContent.style.fontSize || '16px';
    if (file.content !== html || file.fontFamily !== fam || file.fontSize !== siz) {
      file.content = html;
      file.fontFamily = fam;
      file.fontSize = siz;
      file.updatedAt = new Date().toISOString();
      isDirty = false;
      saveToLocalStorage();
      updateFileInfoDisplay();
    }
  }

  function deleteFile(fileId) {
    const file = appData.files.find(f => f.id === fileId);
    if (!file) return;
    if (!confirm(`Hapus script "${file.name}"?`)) return;
    appData.files = appData.files.filter(f => f.id !== fileId);
    if (currentFileId === fileId) resetEditor();
    saveToLocalStorage();
    renderSidebar();
    updateSaveIndicator();
    showToast('🗑️ Script dihapus');
  }

  function deleteFolder(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    const cnt = appData.files.filter(f => f.folderId === folderId).length;
    if (!confirm(`Hapus folder "${folder.name}" beserta ${cnt} script?`)) return;
    if (appData.files.filter(f => f.folderId === folderId).some(f => f.id === currentFileId)) resetEditor();
    appData.files = appData.files.filter(f => f.folderId !== folderId);
    appData.folders = appData.folders.filter(f => f.id !== folderId);
    saveToLocalStorage();
    renderSidebar();
    updateSaveIndicator();
    showToast('🗑️ Folder dihapus');
  }

  function resetEditor() {
    currentFileId = null;
    editorContent.style.display = 'none';
    noFileMsg.style.display = 'flex';
    editorContent.innerHTML = '';
    fileInfo.querySelector('.current-file-name').textContent = 'Pilih script';
    fileInfo.querySelector('.current-file-meta').innerHTML = '';
  }

  function updateFileInfoDisplay() {
    if (!currentFileId) return;
    const file = appData.files.find(f => f.id === currentFileId);
    if (!file) return;
    fileInfo.querySelector('.current-file-meta').innerHTML =
      `<span>📅 Dibuat: ${formatDateFull(file.createdAt)}</span><span>✏️ Diubah: ${formatDateFull(file.updatedAt)}</span>`;
  }

  // ============ TOOLBAR ============
  function setupToolbarEvents() {
    btnBold.addEventListener('click', () => {
      if (isPublicMode) { showToast('🔒 Mode publik', 'error'); return; }
      document.execCommand('bold', false, null);
      editorContent.focus();
      markDirty();
    });
    btnItalic.addEventListener('click', () => {
      if (isPublicMode) { showToast('🔒 Mode publik', 'error'); return; }
      document.execCommand('italic', false, null);
      editorContent.focus();
      markDirty();
    });
    fontFamilySelect.addEventListener('change', () => {
      if (isPublicMode) { showToast('🔒 Mode publik', 'error'); return; }
      const font = fontFamilySelect.value;
      if (editorContent.style.display !== 'none') {
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && !sel.isCollapsed) {
          document.execCommand('fontName', false, font);
        } else {
          editorContent.style.fontFamily = font;
        }
        markDirty();
      }
      editorContent.focus();
    });
    fontSizeSelect.addEventListener('change', () => {
      if (isPublicMode) { showToast('🔒 Mode publik', 'error'); return; }
      const size = fontSizeSelect.value;
      if (editorContent.style.display !== 'none') {
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.style.fontSize = size;
          try { range.surroundContents(span); } catch(e) { editorContent.style.fontSize = size; }
          sel.removeAllRanges();
        } else {
          editorContent.style.fontSize = size;
        }
        markDirty();
      }
      editorContent.focus();
    });
  }

  function setupEditorEvents() {
    // ⚠️ PENTING: cegah edit jika public
    editorContent.addEventListener('input', (e) => {
      if (isPublicMode) {
        showToast('🔒 Mode publik, tidak bisa edit', 'error');
        const file = appData.files.find(f => f.id === currentFileId);
        if (file) editorContent.innerHTML = file.content || '';
        return;
      }
      markDirty();
    });
    editorContent.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isPublicMode) { showToast('🔒 Mode publik', 'error'); return; }
        saveCurrentFileContent();
        syncToGitHub();
        showToast('💾 Script tersimpan');
      }
      setTimeout(updateToolbarButtonStates, 50);
    });
    editorContent.addEventListener('click', updateToolbarButtonStates);
    editorContent.addEventListener('keyup', updateToolbarButtonStates);
  }

  function updateToolbarButtonStates() {
    btnBold.classList.toggle('active', document.queryCommandState('bold'));
    btnItalic.classList.toggle('active', document.queryCommandState('italic'));
  }

  function markDirty() {
    if (!isDirty && currentFileId) {
      isDirty = true;
      setSaveIndicatorUnsaved(true);
    }
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (isDirty && currentFileId && !isPublicMode) {
        saveCurrentFileContent();
        setSaveIndicatorUnsaved(false);
        updateSaveIndicator();
        renderSidebar();
      }
    }, 1500);
  }

  function setSaveIndicatorUnsaved(unsaved) {
    if (unsaved) {
      saveIndicator.textContent = '✏️ Belum tersimpan';
      saveIndicator.className = 'save-indicator unsaved';
    } else {
      saveIndicator.textContent = isPublicMode ? '📖 Mode publik' : '💾 Tersimpan';
      saveIndicator.className = 'save-indicator saved';
    }
  }

  function updateSaveIndicator() {
    const config = getGitHubConfig();
    if (isPublicMode) {
      saveIndicator.textContent = '📖 Mode publik (baca saja)';
      saveIndicator.className = 'save-indicator saved';
    } else {
      saveIndicator.textContent = isDirty ? '✏️ Belum tersimpan' : (config.configured ? '💾 Tersimpan (lokal)' : '💾 Tersimpan');
      saveIndicator.className = isDirty ? 'save-indicator unsaved' : 'save-indicator saved';
    }
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isPublicMode) return;
        saveCurrentFileContent();
        syncToGitHub();
      }
    });
  }

  function setupMobileMenu() {
    mobileMenuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && !sidebar.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ============ GITHUB (SYNC PRIVAT) ============
  function getGitHubConfig() {
    try {
      const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.username && cfg.repo && cfg.token) return { configured: true, ...cfg };
      }
    } catch(e) {}
    return { configured: false };
  }

  async function syncToGitHub() {
    const config = getGitHubConfig();
    if (!config.configured || isPublicMode) return;
    if (isSyncing) return;
    isSyncing = true;
    saveIndicator.textContent = '🔄 Syncing...';
    saveIndicator.className = 'save-indicator syncing';
    try {
      const json = JSON.stringify(appData, null, 2);
      const base64 = btoa(unescape(encodeURIComponent(json)));
      const api = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${DATA_FILE_PATH}`;
      let sha = null;
      try {
        const get = await fetch(api, { headers: { Authorization: `token ${config.token}`, Accept: 'application/vnd.github.v3+json' } });
        if (get.ok) { const d = await get.json(); sha = d.sha; }
      } catch(e) {}
      const body = { message: 'Update ScriptHub data', content: base64 };
      if (sha) body.sha = sha;
      const put = await fetch(api, {
        method: 'PUT',
        headers: { Authorization: `token ${config.token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (put.ok) {
        saveIndicator.textContent = '☁️ Tersimpan ke GitHub';
        saveIndicator.className = 'save-indicator saved';
        showToast('☁️ Data disinkronkan ke GitHub!', 'success');
      } else {
        const err = await put.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal sync');
      }
    } catch(e) {
      saveIndicator.textContent = '⚠️ Gagal sync';
      saveIndicator.className = 'save-indicator unsaved';
      showToast('⚠️ Gagal sync: ' + e.message, 'error');
    } finally {
      isSyncing = false;
      setTimeout(updateSaveIndicator, 2000);
    }
  }

  async function autoSyncFromGitHub() {
    const config = getGitHubConfig();
    if (!config.configured) return;
    try {
      const api = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${DATA_FILE_PATH}`;
      const resp = await fetch(api, { headers: { Authorization: `token ${config.token}`, Accept: 'application/vnd.github.v3+json' } });
      if (!resp.ok) { await syncToGitHub(); return; }
      const data = await resp.json();
      const json = JSON.parse(decodeURIComponent(escape(atob(data.content))));
      const localTime = getLatestUpdateTime(appData);
      const remoteTime = getLatestUpdateTime(json);
      if (remoteTime > localTime) {
        appData = json;
        saveToLocalStorage();
        if (currentFileId && !appData.files.find(f => f.id === currentFileId)) resetEditor();
        renderSidebar();
        if (currentFileId) selectFile(currentFileId);
        showToast('🔄 Data diperbarui dari GitHub', 'success');
      } else if (localTime > remoteTime) {
        await syncToGitHub();
      }
    } catch(e) {
      console.warn('Auto sync gagal:', e);
      await syncToGitHub();
    }
  }

  function getLatestUpdateTime(data) {
    let t = 0;
    (data.files || []).forEach(f => t = Math.max(t, new Date(f.updatedAt || f.createdAt || 0).getTime()));
    (data.folders || []).forEach(f => t = Math.max(t, new Date(f.createdAt || 0).getTime()));
    return t;
  }

  async function testGitHubConnection(username, repo, token) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (resp.ok) return { success: true, message: 'Koneksi berhasil! Repository ditemukan.' };
      if (resp.status === 404) return { success: false, message: 'Repository tidak ditemukan.' };
      if (resp.status === 401) return { success: false, message: 'Token tidak valid.' };
      return { success: false, message: 'Gagal terhubung.' };
    } catch(e) {
      return { success: false, message: 'Gagal: ' + e.message };
    }
  }

  // ============ MODAL ============
  function setupModalEvents() {
    document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
    document.getElementById('btnTestConnection').addEventListener('click', testConnection);
    document.getElementById('btnAddFolder').addEventListener('click', () => {
      if (isPublicMode) { showToast('🔒 Mode publik, tidak bisa edit', 'error'); return; }
      addNewFolder();
    });
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });
  }

  function openSettingsModal() {
    const cfg = getGitHubConfig();
    document.getElementById('githubUser').value = cfg.username || '';
    document.getElementById('githubRepo').value = cfg.repo || '';
    document.getElementById('githubToken').value = cfg.token || '';
    settingsModal.style.display = 'flex';
  }
  function closeSettingsModal() { settingsModal.style.display = 'none'; }

  async function saveSettings() {
    const u = document.getElementById('githubUser').value.trim();
    const r = document.getElementById('githubRepo').value.trim();
    const t = document.getElementById('githubToken').value.trim();
    if (!u || !r || !t) { showToast('⚠️ Isi semua field', 'error'); return; }
    saveGitHubConfig(u, r, t);
    closeSettingsModal();
    showToast('✅ Pengaturan disimpan!', 'success');
    isPublicMode = false;
    await syncToGitHub();
    updateSaveIndicator();
    renderSidebar();
  }

  async function testConnection() {
    const u = document.getElementById('githubUser').value.trim();
    const r = document.getElementById('githubRepo').value.trim();
    const t = document.getElementById('githubToken').value.trim();
    if (!u || !r || !t) { showToast('⚠️ Isi semua field', 'error'); return; }
    const res = await testGitHubConnection(u, r, t);
    showToast(res.success ? '✅ '+res.message : '❌ '+res.message, res.success ? 'success' : 'error');
  }

  function addNewFolder() {
    const name = prompt('Nama folder baru:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (appData.folders.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
      showToast('⚠️ Nama sudah ada', 'error'); return;
    }
    appData.folders.push({ id: generateId(), name: trimmed, createdAt: new Date().toISOString(), _isOpen: true });
    saveToLocalStorage();
    renderSidebar();
    showToast('📁 Folder "' + trimmed + '" dibuat!');
    if (!isPublicMode) syncToGitHub();
  }

  function saveGitHubConfig(username, repo, token) {
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify({ username, repo, token }));
  }

  function showToast(msg, type='') {
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.35s ease forwards';
      setTimeout(() => toast.remove(), 350);
    }, 2800);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      if (window.innerWidth <= 768) sidebar.classList.remove('open');
    }
  });

  // ============ START ============
  init();

  setInterval(() => {
    if (isDirty && currentFileId && !isPublicMode) {
      saveCurrentFileContent();
      setSaveIndicatorUnsaved(false);
      updateSaveIndicator();
      renderSidebar();
    }
    if (!isPublicMode && getGitHubConfig().configured && !isSyncing) syncToGitHub();
  }, 120000);

})();
