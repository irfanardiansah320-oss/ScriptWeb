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

  // ============ INIT ============
  function init() {
    loadFromLocalStorage();
    if (!appData.folders.length) {
      createDefaultFolder();
    }
    renderSidebar();
    setupEditorEvents();
    setupToolbarEvents();
    setupModalEvents();
    setupKeyboardShortcuts();
    setupMobileMenu();
    // Auto sync from GitHub if configured
    autoSyncFromGitHub();
    updateSaveIndicator();
  }

  function createDefaultFolder() {
    const defaultFolder = {
      id: generateId(),
      name: 'Umum',
      createdAt: new Date().toISOString(),
    };
    appData.folders.push(defaultFolder);
    saveToLocalStorage();
  }

  function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ============ LOCAL STORAGE ============
  function saveToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
      showToast('⚠️ Gagal menyimpan ke localStorage', 'error');
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.folders && parsed.files) {
          appData = parsed;
        }
      }
    } catch (e) {
      console.warn('Gagal load dari localStorage, menggunakan data default');
    }
  }

  // ============ RENDER SIDEBAR ============
  function renderSidebar() {
    sidebarBody.innerHTML = '';
    if (!appData.folders.length && !appData.files.length) {
      sidebarBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <p>Belum ada folder.<br>Klik 📁 untuk membuat folder pertama.</p>
        </div>`;
      return;
    }
    appData.folders.forEach(folder => {
      const folderFiles = appData.files.filter(f => f.folderId === folder.id);
      const isOpen = folder._isOpen !== false;
      const group = document.createElement('div');
      group.className = 'folder-group';
      group.innerHTML = `
        <div class="folder-header ${isOpen ? 'open' : ''}" data-folder-id="${folder.id}">
          <span class="folder-arrow">▶</span>
          <span class="folder-icon">📁</span>
          <span class="folder-name">${escapeHtml(folder.name)}</span>
          <span class="folder-count">${folderFiles.length}</span>
          <span class="folder-actions">
            <button class="btn-icon" data-action="add-file" data-folder-id="${folder.id}" title="Tambah Script">＋</button>
            <button class="btn-icon" data-action="delete-folder" data-folder-id="${folder.id}" title="Hapus Folder">🗑</button>
          </span>
        </div>
        <div class="file-list ${isOpen ? 'expanded' : ''}" data-folder-id="${folder.id}">
          ${folderFiles.map(f => `
            <div class="file-item ${f.id === currentFileId ? 'active' : ''}" data-file-id="${f.id}">
              <span class="file-dot"></span>
              <span class="file-name">${escapeHtml(f.name)}</span>
              <span class="file-date">${formatDateShort(f.updatedAt)}</span>
              <button class="file-delete" data-action="delete-file" data-file-id="${f.id}">✕</button>
            </div>
          `).join('')}
          ${folderFiles.length === 0 ? '<div class="empty-state" style="padding:12px;font-size:0.7rem;">Kosong — klik ＋ untuk tambah script</div>' : ''}
        </div>`;
      sidebarBody.appendChild(group);
    });

    // Event delegation
    sidebarBody.querySelectorAll('.folder-header').forEach(header => {
      header.addEventListener('click', function(e) {
        if (e.target.closest('[data-action]')) return;
        const folderId = this.dataset.folderId;
        const folder = appData.folders.find(f => f.id === folderId);
        if (folder) {
          folder._isOpen = !(folder._isOpen !== false);
          saveToLocalStorage();
          renderSidebar();
        }
      });
    });

    sidebarBody.querySelectorAll('[data-action="add-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const folderId = this.dataset.folderId;
        createNewFile(folderId);
      });
    });

    sidebarBody.querySelectorAll('[data-action="delete-folder"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const folderId = this.dataset.folderId;
        deleteFolder(folderId);
      });
    });

    sidebarBody.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', function(e) {
        if (e.target.closest('[data-action]')) return;
        const fileId = this.dataset.fileId;
        selectFile(fileId);
      });
    });

    sidebarBody.querySelectorAll('[data-action="delete-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const fileId = this.dataset.fileId;
        deleteFile(fileId);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Hari ini';
    if (diffDays === 1) return 'Kemarin';
    if (diffDays < 7) return `${diffDays}h lalu`;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ============ FILE OPERATIONS ============
  function createNewFile(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    folder._isOpen = true;
    const newFile = {
      id: generateId(),
      name: 'Script Baru ' + new Date().toLocaleDateString('id-ID'),
      folderId: folderId,
      content: '',
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    fileInfo.querySelector('.current-file-meta').innerHTML = `
      <span>📅 Dibuat: ${formatDateFull(file.createdAt)}</span>
      <span>✏️ Diubah: ${formatDateFull(file.updatedAt)}</span>
    `;

    renderSidebar();
    editorContent.focus();
    isDirty = false;
    updateSaveIndicator();
    setSaveIndicatorUnsaved(false);

    if (window.innerWidth <= 768) {
      sidebar.classList.remove('open');
    }
  }

  function saveCurrentFileContent() {
    if (!currentFileId) return;
    const file = appData.files.find(f => f.id === currentFileId);
    if (!file) return;
    const newContent = editorContent.innerHTML;
    const newFontFamily = editorContent.style.fontFamily || 'Inter, sans-serif';
    const newFontSize = editorContent.style.fontSize || '16px';
    if (file.content !== newContent || file.fontFamily !== newFontFamily || file.fontSize !== newFontSize) {
      file.content = newContent;
      file.fontFamily = newFontFamily;
      file.fontSize = newFontSize;
      file.updatedAt = new Date().toISOString();
      isDirty = false;
      saveToLocalStorage();
      updateFileInfoDisplay();
    }
  }

  function deleteFile(fileId) {
    const file = appData.files.find(f => f.id === fileId);
    if (!file) return;
    if (!confirm(`Hapus script "${file.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    appData.files = appData.files.filter(f => f.id !== fileId);
    if (currentFileId === fileId) {
      currentFileId = null;
      editorContent.style.display = 'none';
      noFileMsg.style.display = 'flex';
      editorContent.innerHTML = '';
      fileInfo.querySelector('.current-file-name').textContent = 'Pilih script';
      fileInfo.querySelector('.current-file-meta').innerHTML = '';
    }
    saveToLocalStorage();
    renderSidebar();
    updateSaveIndicator();
    showToast('🗑️ Script dihapus');
  }

  function deleteFolder(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    const fileCount = appData.files.filter(f => f.folderId === folderId).length;
    if (!confirm(`Hapus folder "${folder.name}" beserta ${fileCount} script di dalamnya? Tindakan ini tidak bisa dibatalkan.`)) return;
    const filesToDelete = appData.files.filter(f => f.folderId === folderId);
    if (filesToDelete.some(f => f.id === currentFileId)) {
      currentFileId = null;
      editorContent.style.display = 'none';
      noFileMsg.style.display = 'flex';
      editorContent.innerHTML = '';
      fileInfo.querySelector('.current-file-name').textContent = 'Pilih script';
      fileInfo.querySelector('.current-file-meta').innerHTML = '';
    }
    appData.files = appData.files.filter(f => f.folderId !== folderId);
    appData.folders = appData.folders.filter(f => f.id !== folderId);
    saveToLocalStorage();
    renderSidebar();
    updateSaveIndicator();
    showToast('🗑️ Folder dihapus');
  }

  function updateFileInfoDisplay() {
    if (!currentFileId) return;
    const file = appData.files.find(f => f.id === currentFileId);
    if (!file) return;
    fileInfo.querySelector('.current-file-meta').innerHTML = `
      <span>📅 Dibuat: ${formatDateFull(file.createdAt)}</span>
      <span>✏️ Diubah: ${formatDateFull(file.updatedAt)}</span>
    `;
  }

  // ============ TOOLBAR ============
  function setupToolbarEvents() {
    btnBold.addEventListener('click', () => {
      document.execCommand('bold', false, null);
      editorContent.focus();
      markDirty();
    });
    btnItalic.addEventListener('click', () => {
      document.execCommand('italic', false, null);
      editorContent.focus();
      markDirty();
    });
    fontFamilySelect.addEventListener('change', () => {
      const font = fontFamilySelect.value;
      if (editorContent.style.display !== 'none') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
          document.execCommand('fontName', false, font);
        } else {
          editorContent.style.fontFamily = font;
        }
        markDirty();
      }
      editorContent.focus();
    });
    fontSizeSelect.addEventListener('change', () => {
      const size = fontSizeSelect.value;
      if (editorContent.style.display !== 'none') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const span = document.createElement('span');
          span.style.fontSize = size;
          try {
            range.surroundContents(span);
          } catch (e) {
            editorContent.style.fontSize = size;
          }
          selection.removeAllRanges();
        } else {
          editorContent.style.fontSize = size;
        }
        markDirty();
      }
      editorContent.focus();
    });
  }

  function setupEditorEvents() {
    editorContent.addEventListener('input', () => {
      markDirty();
    });
    editorContent.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
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
    const isBold = document.queryCommandState('bold');
    const isItalic = document.queryCommandState('italic');
    btnBold.classList.toggle('active', isBold);
    btnItalic.classList.toggle('active', isItalic);
  }

  function markDirty() {
    if (!isDirty && currentFileId) {
      isDirty = true;
      setSaveIndicatorUnsaved(true);
    }
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (isDirty && currentFileId) {
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
      saveIndicator.textContent = '💾 Tersimpan';
      saveIndicator.className = 'save-indicator saved';
    }
  }

  function updateSaveIndicator() {
    const config = getGitHubConfig();
    saveIndicator.textContent = isDirty ? '✏️ Belum tersimpan' : (config.configured ? '💾 Tersimpan (lokal)' : '💾 Tersimpan (lokal)');
    saveIndicator.className = isDirty ? 'save-indicator unsaved' : 'save-indicator saved';
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFileContent();
        syncToGitHub();
      }
    });
  }

  function setupMobileMenu() {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 &&
          !sidebar.contains(e.target) &&
          e.target !== mobileMenuBtn &&
          !mobileMenuBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ============ GITHUB INTEGRATION ============
  function getGitHubConfig() {
    try {
      const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
      if (raw) {
        const config = JSON.parse(raw);
        if (config.username && config.repo && config.token) {
          return { configured: true, ...config };
        }
      }
    } catch (e) {}
    return { configured: false };
  }

  function saveGitHubConfig(username, repo, token) {
    const config = { username, repo, token };
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
  }

  async function syncToGitHub() {
    const config = getGitHubConfig();
    if (!config.configured) return;
    if (isSyncing) return;

    isSyncing = true;
    saveIndicator.textContent = '🔄 Syncing...';
    saveIndicator.className = 'save-indicator syncing';

    try {
      const jsonData = JSON.stringify(appData, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(jsonData)));
      const apiUrl = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${DATA_FILE_PATH}`;

      let sha = null;
      try {
        const getResp = await fetch(apiUrl, {
          headers: {
            'Authorization': `token ${config.token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });
        if (getResp.ok) {
          const getData = await getResp.json();
          sha = getData.sha;
        }
      } catch (e) {}

      const putBody = {
        message: 'Update ScriptHub data',
        content: base64Content,
      };
      if (sha) putBody.sha = sha;

      const putResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(putBody),
      });

      if (putResp.ok) {
        saveIndicator.textContent = '☁️ Tersimpan ke GitHub';
        saveIndicator.className = 'save-indicator saved';
        showToast('☁️ Data berhasil disinkronkan ke GitHub!', 'success');
      } else {
        const errData = await putResp.json().catch(() => ({}));
        throw new Error(errData.message || 'Gagal sync ke GitHub');
      }
    } catch (e) {
      console.error('GitHub sync error:', e);
      saveIndicator.textContent = '⚠️ Gagal sync';
      saveIndicator.className = 'save-indicator unsaved';
      showToast('⚠️ Gagal sync ke GitHub: ' + e.message, 'error');
    } finally {
      isSyncing = false;
      setTimeout(updateSaveIndicator, 2000);
    }
  }

  async function autoSyncFromGitHub() {
    const config = getGitHubConfig();
    if (!config.configured) return;

    try {
      const apiUrl = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${DATA_FILE_PATH}`;
      const resp = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (!resp.ok) {
        await syncToGitHub();
        return;
      }
      const data = await resp.json();
      const content = decodeURIComponent(escape(atob(data.content)));
      const remoteData = JSON.parse(content);

      const localLatest = getLatestUpdateTime(appData);
      const remoteLatest = getLatestUpdateTime(remoteData);

      if (remoteLatest > localLatest) {
        appData = remoteData;
        saveToLocalStorage();
        if (currentFileId) {
          const fileStillExists = appData.files.find(f => f.id === currentFileId);
          if (!fileStillExists) {
            currentFileId = null;
            editorContent.style.display = 'none';
            noFileMsg.style.display = 'flex';
            editorContent.innerHTML = '';
          }
        }
        renderSidebar();
        if (currentFileId) selectFile(currentFileId);
        showToast('🔄 Data diperbarui dari GitHub', 'success');
      } else if (localLatest > remoteLatest) {
        await syncToGitHub();
      }
      updateSaveIndicator();
    } catch (e) {
      console.warn('Auto-sync from GitHub failed:', e.message);
      await syncToGitHub();
    }
  }

  function getLatestUpdateTime(data) {
    let latest = 0;
    if (data.files) {
      data.files.forEach(f => {
        const t = new Date(f.updatedAt || f.createdAt || 0).getTime();
        if (t > latest) latest = t;
      });
    }
    if (data.folders) {
      data.folders.forEach(f => {
        const t = new Date(f.createdAt || 0).getTime();
        if (t > latest) latest = t;
      });
    }
    return latest;
  }

  async function testGitHubConnection(username, repo, token) {
    try {
      const apiUrl = `https://api.github.com/repos/${username}/${repo}`;
      const resp = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (resp.ok) {
        return { success: true, message: 'Koneksi berhasil! Repository ditemukan.' };
      } else if (resp.status === 404) {
        return { success: false, message: 'Repository tidak ditemukan. Pastikan repo sudah dibuat di GitHub.' };
      } else if (resp.status === 401) {
        return { success: false, message: 'Token tidak valid atau tidak memiliki akses.' };
      } else {
        return { success: false, message: 'Gagal terhubung. Status: ' + resp.status };
      }
    } catch (e) {
      return { success: false, message: 'Gagal terhubung: ' + e.message };
    }
  }

  // ============ MODAL ============
  function setupModalEvents() {
    document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
    document.getElementById('btnTestConnection').addEventListener('click', testConnection);
    document.getElementById('btnAddFolder').addEventListener('click', addNewFolder);
    settingsModal.addEventListener('click', function(e) {
      if (e.target === settingsModal) closeSettingsModal();
    });

    const config = getGitHubConfig();
    if (config.configured) {
      document.getElementById('githubUser').value = config.username || '';
      document.getElementById('githubRepo').value = config.repo || '';
      document.getElementById('githubToken').value = config.token || '';
    }
  }

  function openSettingsModal() {
    const config = getGitHubConfig();
    document.getElementById('githubUser').value = config.username || '';
    document.getElementById('githubRepo').value = config.repo || '';
    document.getElementById('githubToken').value = config.token || '';
    settingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    settingsModal.style.display = 'none';
  }

  function saveSettings() {
    const username = document.getElementById('githubUser').value.trim();
    const repo = document.getElementById('githubRepo').value.trim();
    const token = document.getElementById('githubToken').value.trim();
    if (!username || !repo || !token) {
      showToast('⚠️ Isi semua field GitHub', 'error');
      return;
    }
    saveGitHubConfig(username, repo, token);
    closeSettingsModal();
    showToast('✅ Pengaturan GitHub disimpan!', 'success');
    syncToGitHub();
  }

  async function testConnection() {
    const username = document.getElementById('githubUser').value.trim();
    const repo = document.getElementById('githubRepo').value.trim();
    const token = document.getElementById('githubToken').value.trim();
    if (!username || !repo || !token) {
      showToast('⚠️ Isi semua field terlebih dahulu', 'error');
      return;
    }
    const result = await testGitHubConnection(username, repo, token);
    if (result.success) {
      showToast('✅ ' + result.message, 'success');
    } else {
      showToast('❌ ' + result.message, 'error');
    }
  }

  function addNewFolder() {
    const name = prompt('Nama folder baru:');
    if (!name || !name.trim()) return;
    const trimmedName = name.trim();
    if (appData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
      showToast('⚠️ Folder dengan nama itu sudah ada', 'error');
      return;
    }
    const newFolder = {
      id: generateId(),
      name: trimmedName,
      createdAt: new Date().toISOString(),
      _isOpen: true,
    };
    appData.folders.push(newFolder);
    saveToLocalStorage();
    renderSidebar();
    showToast('📁 Folder "' + trimmedName + '" dibuat!');
    syncToGitHub();
  }

  // ============ TOAST ============
  function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.35s ease forwards';
      setTimeout(() => toast.remove(), 350);
    }, 2800);
  }

  // ============ GLOBAL ESC KEY ============
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }
    }
  });

  // ============ START ============
  init();

  // Periodic auto-save & sync
  setInterval(() => {
    if (isDirty && currentFileId) {
      saveCurrentFileContent();
      setSaveIndicatorUnsaved(false);
      updateSaveIndicator();
      renderSidebar();
    }
    const config = getGitHubConfig();
    if (config.configured && !isSyncing) {
      syncToGitHub();
    }
  }, 120000);

  console.log('📜 ScriptHub siap!');
})();
