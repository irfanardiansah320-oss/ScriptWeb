(function() {
  // DOM elements
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

  // State
  const STORAGE_KEY = 'scripthub_data';
  const GITHUB_CONFIG_KEY = 'scripthub_github_config';
  const DATA_FILE_PATH = 'data.json';

  let appData = { folders: [], files: [] };
  let currentFileId = null;
  let isDirty = false;
  let saveTimeout = null;
  let isSyncing = false;

  function init() {
    loadFromLocalStorage();
    if (!appData.folders.length) createDefaultFolder();
    renderSidebar();
    setupEditorEvents();
    setupToolbarEvents();
    setupModalEvents();
    setupKeyboardShortcuts();
    setupMobileMenu();
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

  // Local storage
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
    } catch (e) { console.warn('Gagal load localStorage'); }
  }

  // Render sidebar with rename & reorder
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
            <button class="folder-move-arrow" data-action="move-up" data-folder-id="${folder.id}" ${index === 0 ? 'disabled' : ''} title="Geser ke atas">⬆️</button>
            <button class="folder-move-arrow" data-action="move-down" data-folder-id="${folder.id}" ${index === appData.folders.length-1 ? 'disabled' : ''} title="Geser ke bawah">⬇️</button>
            <button class="btn-icon" data-action="add-file" data-folder-id="${folder.id}" title="Tambah Script">＋</button>
            <button class="btn-icon" data-action="delete-folder" data-folder-id="${folder.id}" title="Hapus Folder">🗑</button>
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
          ${folderFiles.length === 0 ? '<div class="empty-state" style="padding:12px;font-size:0.7rem;">Kosong — klik ＋ untuk tambah script</div>' : ''}
        </div>`;
      sidebarBody.appendChild(group);
    });

    attachSidebarEvents();
  }

  function attachSidebarEvents() {
    // Folder toggle
    sidebarBody.querySelectorAll('.folder-header').forEach(header => {
      header.addEventListener('click', function(e) {
        if (e.target.closest('[data-action]') || e.target.closest('.folder-move-arrow') || e.target.closest('[data-rename-folder]')) return;
        const folderId = this.dataset.folderId;
        const folder = appData.folders.find(f => f.id === folderId);
        if (folder) {
          folder._isOpen = !(folder._isOpen !== false);
          saveToLocalStorage();
          renderSidebar();
        }
      });
    });

    // Rename folder (double-click)
    sidebarBody.querySelectorAll('[data-rename-folder]').forEach(nameSpan => {
      nameSpan.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        startRenameFolder(this.dataset.renameFolder);
      });
    });

    // Rename file (double-click)
    sidebarBody.querySelectorAll('[data-rename-file]').forEach(nameSpan => {
      nameSpan.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        startRenameFile(this.dataset.renameFile);
      });
    });

    // Add file
    sidebarBody.querySelectorAll('[data-action="add-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        createNewFile(this.dataset.folderId);
      });
    });

    // Delete folder
    sidebarBody.querySelectorAll('[data-action="delete-folder"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteFolder(this.dataset.folderId);
      });
    });

    // Delete file
    sidebarBody.querySelectorAll('[data-action="delete-file"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteFile(this.dataset.fileId);
      });
    });

    // Move folder up/down
    sidebarBody.querySelectorAll('[data-action="move-up"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        moveFolder(this.dataset.folderId, 'up');
      });
    });
    sidebarBody.querySelectorAll('[data-action="move-down"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        moveFolder(this.dataset.folderId, 'down');
      });
    });

    // File selection
    sidebarBody.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', function(e) {
        if (e.target.closest('[data-action]') || e.target.closest('[data-rename-file]')) return;
        selectFile(this.dataset.fileId);
      });
    });
  }

  // ---------- RENAME FUNCTIONS ----------
  function startRenameFolder(folderId) {
    const folderNameSpan = document.querySelector(`[data-rename-folder="${folderId}"]`);
    if (!folderNameSpan) return;
    const currentName = folderNameSpan.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;
    input.style.width = (folderNameSpan.offsetWidth + 20) + 'px';
    folderNameSpan.replaceWith(input);
    input.focus();
    input.select();

    function finish() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
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
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  function startRenameFile(fileId) {
    const fileNameSpan = document.querySelector(`[data-rename-file="${fileId}"]`);
    if (!fileNameSpan) return;
    const currentName = fileNameSpan.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;
    fileNameSpan.replaceWith(input);
    input.focus();
    input.select();

    function finish() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        const file = appData.files.find(f => f.id === fileId);
        if (file) {
          file.name = newName;
          saveToLocalStorage();
          renderSidebar();
          if (currentFileId === fileId) {
            fileInfo.querySelector('.current-file-name').textContent = newName;
          }
          showToast('✏️ Nama script diubah');
        }
      } else {
        renderSidebar();
      }
    }

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  // ---------- MOVE FOLDER ----------
  function moveFolder(folderId, direction) {
    const index = appData.folders.findIndex(f => f.id === folderId);
    if (index === -1) return;
    if (direction === 'up' && index > 0) {
      [appData.folders[index-1], appData.folders[index]] = [appData.folders[index], appData.folders[index-1]];
    } else if (direction === 'down' && index < appData.folders.length - 1) {
      [appData.folders[index], appData.folders[index+1]] = [appData.folders[index+1], appData.folders[index]];
    }
    saveToLocalStorage();
    // Animate reorder
    const movedGroup = document.querySelector(`.folder-group[data-folder-id="${folderId}"]`);
    if (movedGroup) {
      movedGroup.classList.add('moving');
      setTimeout(() => movedGroup.classList.remove('moving'), 400);
    }
    renderSidebar();
    syncToGitHub();
  }

  // ---------- FILE OPERATIONS (adjustments) ----------
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

    if (window.innerWidth <= 768) sidebar.classList.remove('open');
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
    const fileCount = appData.files.filter(f => f.folderId === folderId).length;
    if (!confirm(`Hapus folder "${folder.name}" beserta ${fileCount} script?`)) return;
    const filesToDelete = appData.files.filter(f => f.folderId === folderId);
    if (filesToDelete.some(f => f.id === currentFileId)) resetEditor();
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

  // Rest of the original functions (toolbar, GitHub, modal, etc.) remain unchanged.
  // I'll include them but not repeat to save space; the full script is in the previous answer.
  // Make sure to copy the complete script.js from the previous message and add the rename/move functions above.

  // ---------- PLACEHOLDER FOR REMAINING CODE (Your existing script.js) ----------
  // (Paste the entire script.js from my previous answer here, then overwrite the renderSidebar and attachSidebarEvents with the new ones above)

})();