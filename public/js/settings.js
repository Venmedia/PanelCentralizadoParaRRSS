/* =========================================================================
   MÓDULO 5: AJUSTES, MENSAJE DE BIENVENIDA, OPCIONES EXTRA, HORARIO, PDF Y QR (public/js/settings.js)
   ========================================================================= */

async function loadBotSettings() {
  try {
    const res = await fetch('/api/config/templates');
    const data = await res.json();
    applyConfigToUI(data);
  } catch (e) {
    previewScheduleState();
  }
}

async function checkCatalogPdfStatus() {
  try {
    const res = await fetch('/api/config/catalog-pdf');
    const info = await res.json();
    updateCatalogPdfUI(info);
  } catch (e) {}
}

function updateCatalogPdfUI(info) {
  const hiddenName = document.getElementById('t_pdf_name');
  const nameEl = document.getElementById('pdfCurrentName');
  const metaEl = document.getElementById('pdfCurrentMeta');
  const pillEl = document.getElementById('pdfStatusPill');
  const viewBtn = document.getElementById('btnViewPdf');
  const delBtn = document.getElementById('btnDeletePdf');
  const uploadText = document.getElementById('btnUploadPdfText');
  const iconEl = document.getElementById('pdfCardIcon');

  if (!nameEl) return;

  if (info && info.exists && info.fileName) {
    hiddenName.value = info.fileName;
    nameEl.innerText = info.fileName;
    const sizeKb = info.sizeBytes ? `${(info.sizeBytes / 1024).toFixed(1)} KB` : 'Disponible';
    metaEl.innerText = `En el servidor (${sizeKb}) • Listo para enviar`;
    pillEl.className =
      'text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold';
    pillEl.innerText = 'Activo en Servidor';
    iconEl.className = 'fa-solid fa-file-pdf text-rose-500 text-lg shrink-0';
    viewBtn.href = info.url || `/media/${encodeURIComponent(info.fileName)}`;
    viewBtn.classList.remove('hidden');
    delBtn.classList.remove('hidden');
    uploadText.innerText = 'Sustituir por otro PDF de la PC';
  } else {
    hiddenName.value = '';
    nameEl.innerText = 'Ningún catálogo PDF cargado';
    metaEl.innerText = 'Selecciona un archivo PDF desde tu PC para guardarlo';
    pillEl.className =
      'text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-semibold';
    pillEl.innerText = 'Sin archivo';
    iconEl.className = 'fa-solid fa-file-circle-xmark text-slate-500 text-lg shrink-0';
    viewBtn.classList.add('hidden');
    delBtn.classList.add('hidden');
    uploadText.innerText = 'Seleccionar PDF desde la PC y Guardar';
  }
}

function showPdfFeedback(msg, isError = false) {
  const fb = document.getElementById('pdfActionFeedback');
  if (!fb) return;
  fb.classList.remove('hidden');
  fb.className = `text-[10px] font-semibold text-center py-1 px-2 rounded ${
    isError
      ? 'bg-rose-950 text-rose-300 border border-rose-800'
      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
  }`;
  fb.innerText = msg;
  setTimeout(() => {
    fb.classList.add('hidden');
  }, 3500);
}

function handlePdfFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    showPdfFeedback('⚠️ Por favor selecciona un archivo con formato .PDF válido', true);
    event.target.value = '';
    return;
  }

  showPdfFeedback('â³ Subiendo y guardando PDF en el servidor...');
  const reader = new FileReader();
  reader.onload = async function (evt) {
    try {
      const res = await fetch('/api/config/catalog-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: evt.target.result
        })
      });
      const data = await res.json();
      if (data && data.success) {
        updateCatalogPdfUI(data);
        showPdfFeedback(`✅ ¡Guardado en el servidor: ${data.fileName}!`);
      } else {
        showPdfFeedback('âŒ Error al guardar el archivo en el servidor', true);
      }
    } catch (err) {
      showPdfFeedback('❌ Error de conexión al subir el archivo', true);
    }
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

async function deleteCatalogPdf() {
  const current = document.getElementById('t_pdf_name').value;
  if (!current) return;
  if (
    !confirm(
      `¿Seguro que deseas borrar el archivo "${current}" del servidor? Podrás subir uno nuevo cuando quieras.`
    )
  ) {
    return;
  }
  try {
    const res = await fetch('/api/config/catalog-pdf', { method: 'DELETE' });
    const data = await res.json();
    if (data && data.success) {
      updateCatalogPdfUI({ exists: false, fileName: '' });
      showPdfFeedback('🗑️ Catálogo PDF eliminado del servidor correctamente.');
    }
  } catch (e) {
    showPdfFeedback('âŒ Error al eliminar el PDF del servidor', true);
  }
}

function resetGreetingToDefault() {
  const el = document.getElementById('t_greeting_menu');
  if (!el) return;
  let base = DEFAULT_GREETING_TEXT;
  customProgrammedCategories.forEach(cat => {
    const header = cat.headerLine || `${cat.emoji || '📌'} *${cat.number || 4}. ${(cat.title || '').toUpperCase()}*`;
    base += `\n\n${header}`;
    const opts = customProgrammedOptions.filter(o => o.category === cat.id);
    opts.forEach(o => {
      base += `\n • ${o.title}`;
    });
  });
  el.value = base;
}

function getAllCategoryNamesMap() {
  const map = {
    cat1: '📘 1. Catálogo y Desc. Técnica',
    cat2: '💵 2. Costos y Financiamiento',
    cat3: '🧑‍💼 3. Hablar con un Asesor'
  };
  customProgrammedCategories.forEach(cat => {
    map[cat.id] = `${cat.emoji || '📌'} ${cat.number}. ${cat.title}`;
  });
  return map;
}

function renderCategorySelectOptions(selectedValue) {
  const selects = [
    document.getElementById('modalOptCategory'),
    document.getElementById('newOptCategory')
  ];
  const map = getAllCategoryNamesMap();

  selects.forEach(sel => {
    if (!sel) return;
    const currentVal = selectedValue || sel.value || 'cat1';
    sel.innerHTML = '';
    Object.entries(map).forEach(([key, label]) => {
      const optEl = document.createElement('option');
      optEl.value = key;
      optEl.textContent = label;
      sel.appendChild(optEl);
    });
    if (map[currentVal]) {
      sel.value = currentVal;
    }
  });
}

/* =========================================================================
   MODAL 1: AGREGAR NUEVA CATEGORÍA AL MENSAJE DE BIENVENIDA
   ========================================================================= */
function openAddCategoryModal() {
  const modal = document.getElementById('addCategoryModal');
  if (!modal) return;
  const nextNum = 4 + customProgrammedCategories.length;
  const numInput = document.getElementById('modalCatNumber');
  const titleInput = document.getElementById('modalCatTitle');
  const firstOptTitle = document.getElementById('modalCatFirstOptTitle');
  const firstOptReply = document.getElementById('modalCatFirstOptReply');

  if (numInput) numInput.value = nextNum;
  if (titleInput) titleInput.value = '';
  if (firstOptTitle) firstOptTitle.value = '';
  if (firstOptReply) firstOptReply.value = '';

  updateCategoryModalPreview();
  modal.classList.remove('hidden');
  setTimeout(() => titleInput?.focus(), 60);
}

function closeAddCategoryModal() {
  const modal = document.getElementById('addCategoryModal');
  if (modal) modal.classList.add('hidden');
}

function selectCategoryEmoji(emoji) {
  const inp = document.getElementById('modalCatEmoji');
  if (inp) {
    inp.value = emoji;
    updateCategoryModalPreview();
  }
}

function updateCategoryModalPreview() {
  const emoji = (document.getElementById('modalCatEmoji')?.value || '🔧').trim() || '🔧';
  const num = (document.getElementById('modalCatNumber')?.value || '4').trim() || '4';
  const rawTitle = (document.getElementById('modalCatTitle')?.value || '').trim();
  const firstOpt = (document.getElementById('modalCatFirstOptTitle')?.value || '').trim();
  const previewEl = document.getElementById('modalCatPreview');
  if (!previewEl) return;

  const cleanTitle = rawTitle.replace(/^\d+[\.\)\-\s]+/, '').trim();
  const upperTitle = (cleanTitle || 'NUEVA CATEGORÍA').toUpperCase();
  let text = `${emoji} *${num}. ${upperTitle}*`;
  if (firstOpt) {
    text += `\n • ${firstOpt}`;
  }
  previewEl.innerText = text;
}

async function submitAddCategoryModal(event) {
  if (event) event.preventDefault();
  const emoji = (document.getElementById('modalCatEmoji')?.value || '🔧').trim() || '🔧';
  const num = Number(document.getElementById('modalCatNumber')?.value) || (4 + customProgrammedCategories.length);
  const rawTitle = (document.getElementById('modalCatTitle')?.value || '').trim();
  const color = document.getElementById('modalCatColor')?.value || 'emerald';
  const firstOptTitle = (document.getElementById('modalCatFirstOptTitle')?.value || '').trim();
  const firstOptReply = (document.getElementById('modalCatFirstOptReply')?.value || '').trim();

  if (!rawTitle) {
    alert('Por favor ingresa el nombre de la nueva categoría.');
    return;
  }

  const cleanTitle = rawTitle.replace(/^\d+[\.\)\-\s]+/, '').trim();
  const headerLine = `${emoji} *${num}. ${cleanTitle.toUpperCase()}*`;
  const catId = `cat_custom_${Date.now()}`;

  const newCat = {
    id: catId,
    emoji,
    number: num,
    title: cleanTitle,
    headerLine,
    color
  };

  customProgrammedCategories.push(newCat);

  // Insertar el nuevo bloque de categoría en el Mensaje de Bienvenida (#t_greeting_menu)
  const greetingEl = document.getElementById('t_greeting_menu');
  if (greetingEl) {
    const currentText = (greetingEl.value || DEFAULT_GREETING_TEXT).trimEnd();
    if (!currentText.includes(headerLine)) {
      greetingEl.value = `${currentText}\n\n${headerLine}`;
    }
  }

  // Si el usuario también llenó la primera opción opcional dentro del modal de categoría
  if (firstOptTitle) {
    const optId = `custom_${Date.now() + 1}`;
    const defaultReply =
      firstOptReply ||
      `${emoji} *${firstOptTitle}:* Con gusto te brindamos toda la información sobre ${firstOptTitle}. Un asesor te asistirá en breve.`;
    customProgrammedOptions.push({
      id: optId,
      title: firstOptTitle,
      category: catId,
      reply: defaultReply
    });
    insertOptionIntoGreetingText(firstOptTitle, catId);
  }

  renderCategorySelectOptions(catId);
  renderCustomOptionsUI();
  closeAddCategoryModal();

  if (authenticatedUser && authenticatedUser.isAdmin) {
    await saveTemplates('btnSaveTemplates');
  }
}

async function removeCustomProgrammedCategory(catId) {
  const cat = customProgrammedCategories.find(c => c.id === catId);
  if (!cat) return;

  if (
    !confirm(
      `¿Deseas eliminar la categoría "${cat.emoji} ${cat.number}. ${cat.title}" y sus opciones asociadas del Mensaje de Bienvenida?`
    )
  ) {
    return;
  }

  const associatedOpts = customProgrammedOptions.filter(o => o.category === catId);
  customProgrammedCategories = customProgrammedCategories.filter(c => c.id !== catId);
  customProgrammedOptions = customProgrammedOptions.filter(o => o.category !== catId);

  const greetingEl = document.getElementById('t_greeting_menu');
  if (greetingEl && greetingEl.value) {
    let txt = greetingEl.value;
    associatedOpts.forEach(opt => {
      txt = txt.replace(`\n • ${opt.title}`, '');
    });
    if (cat.headerLine) {
      txt = txt.replace(`\n\n${cat.headerLine}`, '').replace(cat.headerLine, '');
    }
    greetingEl.value = txt.trim();
  }

  renderCategorySelectOptions('cat1');
  renderCustomOptionsUI();

  if (authenticatedUser && authenticatedUser.isAdmin) {
    await saveTemplates('btnSaveTemplates');
  }
}

/* =========================================================================
   MODAL 2: AGREGAR NUEVA OPCIÓN AL MENSAJE DE BIENVENIDA
   ========================================================================= */
function openAddOptionModal(preselectedCatId) {
  const modal = document.getElementById('addOptionModal');
  if (!modal) return;
  renderCategorySelectOptions(preselectedCatId || 'cat1');

  const titleEl = document.getElementById('modalOptTitle');
  const replyEl = document.getElementById('modalOptReply');
  if (titleEl) titleEl.value = '';
  if (replyEl) replyEl.value = '';

  modal.classList.remove('hidden');
  setTimeout(() => titleEl?.focus(), 60);
}

function closeAddOptionModal() {
  const modal = document.getElementById('addOptionModal');
  if (modal) modal.classList.add('hidden');
}

async function submitAddOptionModal(event) {
  if (event) event.preventDefault();
  const titleEl = document.getElementById('modalOptTitle');
  const catEl = document.getElementById('modalOptCategory');
  const replyEl = document.getElementById('modalOptReply');

  const title = (titleEl?.value || '').trim();
  const category = catEl?.value || 'cat1';
  const reply = (replyEl?.value || '').trim();

  if (!title || !reply) {
    alert('Por favor ingresa el nombre de la nueva opción y el texto de respuesta rápida.');
    return;
  }

  const id = `custom_${Date.now()}`;
  customProgrammedOptions.push({ id, title, category, reply });
  insertOptionIntoGreetingText(title, category);
  renderCustomOptionsUI();
  closeAddOptionModal();

  if (authenticatedUser && authenticatedUser.isAdmin) {
    await saveTemplates('btnSaveTemplates');
  }
}

function insertOptionIntoGreetingText(title, categoryKey) {
  const el = document.getElementById('t_greeting_menu');
  if (!el) return;
  const current = el.value || DEFAULT_GREETING_TEXT;
  const bullet = ` • ${title}`;
  if (current.includes(bullet)) return;

  if (categoryKey === 'cat1' && current.includes('💵 *2.')) {
    el.value = current.replace('\n\n💵 *2.', `\n${bullet}\n\n💵 *2.`);
  } else if (categoryKey === 'cat2' && current.includes('🧑‍💼 *3.')) {
    el.value = current.replace('\n\n🧑‍💼 *3.', `\n${bullet}\n\n🧑‍💼 *3.`);
  } else if (categoryKey === 'cat3') {
    // Si existen categorías personalizadas después de la 3, insertar antes de la primera categoría personalizada
    const firstCustomCat = customProgrammedCategories[0];
    if (firstCustomCat && firstCustomCat.headerLine && current.includes(`\n\n${firstCustomCat.headerLine}`)) {
      el.value = current.replace(
        `\n\n${firstCustomCat.headerLine}`,
        `\n${bullet}\n\n${firstCustomCat.headerLine}`
      );
    } else {
      el.value = `${current.trimEnd()}\n${bullet}`;
    }
  } else {
    // Es una categoría personalizada (cat_custom_...)
    const customCat = customProgrammedCategories.find(c => c.id === categoryKey);
    if (customCat && customCat.headerLine && current.includes(customCat.headerLine)) {
      const headerIdx = current.indexOf(customCat.headerLine);
      const afterHeaderIdx = headerIdx + customCat.headerLine.length;
      const nextDoubleNewline = current.indexOf('\n\n', afterHeaderIdx);
      if (nextDoubleNewline !== -1) {
        el.value =
          current.slice(0, nextDoubleNewline) +
          `\n${bullet}` +
          current.slice(nextDoubleNewline);
      } else {
        el.value = `${current.trimEnd()}\n${bullet}`;
      }
    } else {
      el.value = `${current.trimEnd()}\n${bullet}`;
    }
  }
}

async function addCustomProgrammedOption() {
  const titleEl = document.getElementById('newOptTitle');
  const catEl = document.getElementById('newOptCategory');
  const replyEl = document.getElementById('newOptReply');

  const title = (titleEl?.value || '').trim();
  const category = catEl?.value || 'cat1';
  const reply = (replyEl?.value || '').trim();

  if (!title || !reply) {
    alert('Por favor ingresa el nombre de la nueva opción y el texto de respuesta rápida.');
    return;
  }

  const id = `custom_${Date.now()}`;
  customProgrammedOptions.push({ id, title, category, reply });
  insertOptionIntoGreetingText(title, category);
  renderCustomOptionsUI();

  if (titleEl) titleEl.value = '';
  if (replyEl) replyEl.value = '';

  if (authenticatedUser && authenticatedUser.isAdmin) {
    await saveTemplates('btnSaveTemplates');
  }
}

async function removeCustomProgrammedOption(id) {
  const opt = customProgrammedOptions.find(o => o.id === id);
  customProgrammedOptions = customProgrammedOptions.filter(o => o.id !== id);
  if (opt) {
    const el = document.getElementById('t_greeting_menu');
    if (el && el.value) {
      el.value = el.value.replace(`\n • ${opt.title}`, '');
    }
  }
  renderCustomOptionsUI();
  if (authenticatedUser && authenticatedUser.isAdmin) {
    await saveTemplates('btnSaveTemplates');
  }
}

function updateCustomOptionReply(id, newVal) {
  const opt = customProgrammedOptions.find(o => o.id === id);
  if (opt) opt.reply = newVal;
}

function renderCustomCategoriesUI() {
  const catSettingsList = document.getElementById('customCategoriesSettingsList');
  if (catSettingsList) catSettingsList.innerHTML = '';

  const inboxGrid = document.getElementById('customCategoriesInboxGrid');
  if (inboxGrid) inboxGrid.innerHTML = '';

  const colorClasses = {
    emerald: { text: 'text-emerald-400', border: 'border-emerald-800/70', badge: 'bg-emerald-950 text-emerald-300 border-emerald-700' },
    blue: { text: 'text-blue-400', border: 'border-blue-800/70', badge: 'bg-blue-950 text-blue-300 border-blue-700' },
    amber: { text: 'text-amber-400', border: 'border-amber-800/70', badge: 'bg-amber-950 text-amber-300 border-amber-700' },
    purple: { text: 'text-purple-400', border: 'border-purple-800/70', badge: 'bg-purple-950 text-purple-300 border-purple-700' },
    cyan: { text: 'text-cyan-400', border: 'border-cyan-800/70', badge: 'bg-cyan-950 text-cyan-300 border-cyan-700' },
    rose: { text: 'text-rose-400', border: 'border-rose-800/70', badge: 'bg-rose-950 text-rose-300 border-rose-700' }
  };

  customProgrammedCategories.forEach(cat => {
    const theme = colorClasses[cat.color] || colorClasses.emerald;
    const catOptions = customProgrammedOptions.filter(o => o.category === cat.id);

    // 1. Renderizar tarjeta de Categoría en Ajustes
    if (catSettingsList) {
      const card = document.createElement('div');
      card.className = `bg-slate-950 border ${theme.border} rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2`;
      card.innerHTML = `
        <div class="space-y-0.5">
          <div class="text-xs font-extrabold ${theme.text} flex items-center gap-2">
            <span>${cat.emoji || '📌'} ${cat.number}. ${cat.title}</span>
            <span class="text-[9px] px-1.5 py-0.5 rounded border ${theme.badge} font-semibold">Categoría Personalizada (${catOptions.length} opciones)</span>
          </div>
          <div class="text-[10px] text-slate-400 font-mono">${cat.headerLine || ''}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onclick="openAddOptionModal('${cat.id}')" class="bg-blue-600/25 hover:bg-blue-600/40 text-blue-300 border border-blue-500/40 px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition">
            <i class="fa-solid fa-plus"></i> Agregar Opción aquí
          </button>
          <button type="button" onclick="removeCustomProgrammedCategory('${cat.id}')" class="bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/60 px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can"></i> Eliminar Categoría
          </button>
        </div>
      `;
      catSettingsList.appendChild(card);
    }

    // 2. Renderizar tarjeta de Categoría en la Consola de Envío Rápido de la Bandeja de Entrada
    if (inboxGrid) {
      const box = document.createElement('div');
      box.className = `bg-slate-950/90 border ${theme.border} rounded-lg p-2 space-y-1.5`;
      box.innerHTML = `
        <div class="text-[10px] font-bold ${theme.text} flex items-center justify-between border-b border-slate-800/80 pb-1">
          <span>${cat.emoji || '📌'} ${cat.number}. ${cat.title}</span>
        </div>
        <div id="customBtns_${cat.id}" class="flex flex-wrap gap-1"></div>
      `;
      inboxGrid.appendChild(box);
    }
  });
}

function renderCustomOptionsUI() {
  renderCustomCategoriesUI();
  renderCategorySelectOptions();

  const c1 = document.getElementById('customBtnsCat1');
  const c2 = document.getElementById('customBtnsCat2');
  const c3 = document.getElementById('customBtnsCat3');
  if (c1) c1.innerHTML = '';
  if (c2) c2.innerHTML = '';
  if (c3) c3.innerHTML = '';

  const settingsList = document.getElementById('customOptionsSettingsList');
  if (settingsList) settingsList.innerHTML = '';

  const catNames = getAllCategoryNamesMap();

  customProgrammedOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.onclick = () => sendPreprogrammed(opt.id);
    btn.className =
      'bg-slate-800 hover:bg-slate-700 border border-slate-600/60 text-slate-100 px-2 py-1 rounded text-[10px] font-semibold transition';
    btn.textContent = `✨ ${opt.title}`;

    if (opt.category === 'cat1' && c1) c1.appendChild(btn);
    else if (opt.category === 'cat2' && c2) c2.appendChild(btn);
    else if (opt.category === 'cat3' && c3) c3.appendChild(btn);
    else {
      const customContainer = document.getElementById(`customBtns_${opt.category}`);
      if (customContainer) customContainer.appendChild(btn);
      else if (c3) c3.appendChild(btn);
    }

    if (settingsList) {
      const row = document.createElement('div');
      row.className = 'bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5';
      row.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="text-[11px] font-bold text-white flex items-center gap-2">
            <span>✨ ${opt.title}</span>
            <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-blue-300 border border-slate-700">${catNames[opt.category] || 'Opción'}</span>
          </div>
          <button type="button" onclick="removeCustomProgrammedOption('${opt.id}')" class="text-rose-400 hover:text-rose-300 text-[10px] font-bold flex items-center gap-1">
            <i class="fa-solid fa-trash-can"></i> Eliminar Opción
          </button>
        </div>
        <textarea rows="2" oninput="updateCustomOptionReply('${opt.id}', this.value)" class="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-slate-200">${opt.reply}</textarea>
      `;
      settingsList.appendChild(row);
    }
  });
}

function applyConfigToUI(data) {
  if (!data) return;
  if (data.greeting && document.getElementById('t_greeting_menu')) {
    document.getElementById('t_greeting_menu').value = data.greeting;
  }
  if (Array.isArray(data.customCategories)) {
    customProgrammedCategories = data.customCategories;
  }
  if (Array.isArray(data.customOptions)) {
    customProgrammedOptions = data.customOptions;
  }
  renderCustomOptionsUI();
  if (data.schedule) {
    if (data.schedule.workStart) document.getElementById('workStartInput').value = data.schedule.workStart;
    if (data.schedule.workEnd) document.getElementById('workEndInput').value = data.schedule.workEnd;
    if (data.schedule.mode) document.getElementById('scheduleModeInput').value = data.schedule.mode;
    if (data.schedule.autoReplySource && document.getElementById('autoReplySourceInput')) {
      document.getElementById('autoReplySourceInput').value = data.schedule.autoReplySource;
    }
    if (data.schedule.welcomeMessage && document.getElementById('t_welcome_message')) {
      document.getElementById('t_welcome_message').value = data.schedule.welcomeMessage;
    }
  }
  if (data.testWhatsappChannel && document.getElementById('testWhatsappChannelSelect')) {
    document.getElementById('testWhatsappChannelSelect').value = data.testWhatsappChannel;
  }
  if (data.companies) {
    const ag = data.companies.agropower || {};
    const tr = data.companies.tractopower || {};
    if (ag.instagram && document.getElementById('c_agro_ig')) document.getElementById('c_agro_ig').value = ag.instagram;
    if (ag.tiktok && document.getElementById('c_agro_tk')) document.getElementById('c_agro_tk').value = ag.tiktok;
    if (ag.facebook && document.getElementById('c_agro_fb')) document.getElementById('c_agro_fb').value = ag.facebook;
    if (ag.whatsapp && document.getElementById('c_agro_wa')) document.getElementById('c_agro_wa').value = ag.whatsapp;

    if (tr.instagram && document.getElementById('c_tracto_ig')) document.getElementById('c_tracto_ig').value = tr.instagram;
    if (tr.tiktok && document.getElementById('c_tracto_tk')) document.getElementById('c_tracto_tk').value = tr.tiktok;
    if (tr.facebook && document.getElementById('c_tracto_fb')) document.getElementById('c_tracto_fb').value = tr.facebook;
    if (tr.whatsapp && document.getElementById('c_tracto_wa')) document.getElementById('c_tracto_wa').value = tr.whatsapp;
  }
  if (data.categories) {
    const cat1 = data.categories.catalogo_tecnico?.items;
    if (cat1) {
      if (cat1.cat_modelos?.reply) document.getElementById('t_cat_modelos').value = cat1.cat_modelos.reply;
      if (cat1.cat_modelos?.attachment !== undefined) document.getElementById('t_pdf_name').value = cat1.cat_modelos.attachment;
      if (cat1.repuestos?.reply) document.getElementById('t_repuestos').value = cat1.repuestos.reply;
      if (cat1.garantia?.reply) document.getElementById('t_garantia').value = cat1.garantia.reply;
    }
    const cat2 = data.categories.costos_financiamiento?.items;
    if (cat2) {
      if (cat2.precios?.reply) document.getElementById('t_precios').value = cat2.precios.reply;
      if (cat2.financiamiento?.reply) document.getElementById('t_financiamiento').value = cat2.financiamiento.reply;
      if (cat2.compras_prog?.reply) document.getElementById('t_compras_prog').value = cat2.compras_prog.reply;
    }
    const cat3 = data.categories.atencion_asesor?.items;
    if (cat3 && cat3.asesor?.reply) {
      document.getElementById('t_asesor').value = cat3.asesor.reply;
    }
  }
  previewScheduleState();
}

function previewScheduleState() {
  const workStart = document.getElementById('workStartInput')?.value || '08:00';
  const workEnd = document.getElementById('workEndInput')?.value || '17:00';
  const mode = document.getElementById('scheduleModeInput')?.value || 'outside_work_hours';
  const badge = document.getElementById('scheduleStatusBadge');
  const textEl = document.getElementById('scheduleStatusText');
  if (!badge || !textEl) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sH, sM] = workStart.split(':').map(Number);
  const [eH, eM] = workEnd.split(':').map(Number);
  const startMinutes = (sH || 8) * 60 + (sM || 0);
  const endMinutes = (eH || 17) * 60 + (eM || 0);

  let isInside = false;
  if (startMinutes <= endMinutes) {
    isInside = currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    isInside = currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  let active = false;
  if (mode === 'outside_work_hours') active = !isInside;
  else if (mode === 'inside_work_hours') active = isInside;
  else if (mode === 'always') active = true;
  else active = false;

  if (active) {
    badge.className =
      'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
    textEl.innerText =
      mode === 'always'
        ? '⚡ Bot Activo (Modo 24h)'
        : `🌙 Fuera de Horario (${workStart}-${workEnd}) • Bot ACTIVO`;
  } else {
    badge.className =
      'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 flex items-center gap-1.5';
    textEl.innerText =
      mode === 'disabled'
        ? '🛑 Bot Desactivado'
        : `☀️ En Horario Laboral (${workStart}-${workEnd}) • Bot en Espera`;
  }
}

async function checkWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();
    updateWhatsAppUI(data);
  } catch (e) {}
}

function updateWhatsAppUI(data) {
  if (!data) return;

  const agroData = data.agro || (data.company === 'agro' ? data : (data.company === 'tracto' ? null : data));
  const tractoData = data.tracto || (data.company === 'tracto' ? data : null);

  // 1. ACTUALIZAR AGROPOWER (LÍNEA 1)
  if (agroData) {
    const qrImg = document.getElementById('qrImageElement');
    const spinner = document.getElementById('qrLoadingSpinner');
    const connectedState = document.getElementById('qrConnectedState');
    const badge = document.getElementById('qrStatusBadge');
    const headerBadge = document.getElementById('headerWaBadge');
    const phoneLabel = document.getElementById('connectedPhoneLabel');

    if (agroData.status === 'connected') {
      qrImg?.classList.add('hidden');
      spinner?.classList.add('hidden');
      connectedState?.classList.remove('hidden');
      if (agroData.user && phoneLabel) phoneLabel.innerText = `Número: +${agroData.user.phone}`;

      if (badge) {
        badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> WhatsApp Conectado';
      }

      if (headerBadge) {
        headerBadge.className = 'text-[9px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold flex items-center gap-1';
        headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> WA Conectado';
      }
    } else if (agroData.status === 'qr_ready' && agroData.qr) {
      connectedState?.classList.add('hidden');
      spinner?.classList.add('hidden');
      if (qrImg) {
        qrImg.classList.remove('hidden');
        qrImg.src = agroData.qr;
      }

      if (badge) {
        badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> QR Listo para Escanear';
      }

      if (headerBadge) {
        headerBadge.className = 'text-[9px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 font-semibold flex items-center gap-1';
        headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Escanear QR';
      }
    } else {
      qrImg?.classList.add('hidden');
      connectedState?.classList.add('hidden');
      spinner?.classList.remove('hidden');

      if (badge) {
        badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
        badge.innerHTML = 'Generando Conexión...';
      }
    }
  }

  // 2. ACTUALIZAR TRACTOPOWER (LÍNEA 2)
  if (tractoData) {
    const qrImgTracto = document.getElementById('qrImageElementTracto');
    const spinnerTracto = document.getElementById('qrLoadingSpinnerTracto');
    const connectedStateTracto = document.getElementById('qrConnectedStateTracto');
    const pendingTracto = document.getElementById('qrPendingStateTracto');
    const badgeTracto = document.getElementById('qrStatusBadgeTracto');
    const phoneLabelTracto = document.getElementById('connectedPhoneLabelTracto');

    if (tractoData.status === 'connected') {
      qrImgTracto?.classList.add('hidden');
      spinnerTracto?.classList.add('hidden');
      pendingTracto?.classList.add('hidden');
      connectedStateTracto?.classList.remove('hidden');
      if (tractoData.user && phoneLabelTracto) phoneLabelTracto.innerText = `Número: +${tractoData.user.phone}`;

      if (badgeTracto) {
        badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
        badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> WhatsApp Conectado';
      }
    } else if (tractoData.status === 'qr_ready' && tractoData.qr) {
      connectedStateTracto?.classList.add('hidden');
      pendingTracto?.classList.add('hidden');
      spinnerTracto?.classList.add('hidden');
      if (qrImgTracto) {
        qrImgTracto.classList.remove('hidden');
        qrImgTracto.src = tractoData.qr;
      }

      if (badgeTracto) {
        badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
        badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Escanear QR Tractopower';
      }
    } else if (tractoData.status === 'connecting') {
      qrImgTracto?.classList.add('hidden');
      connectedStateTracto?.classList.add('hidden');
      pendingTracto?.classList.add('hidden');
      spinnerTracto?.classList.remove('hidden');

      if (badgeTracto) {
        badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
        badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Generando QR Tractopower...';
      }
    } else {
      // disconnected / idle
      qrImgTracto?.classList.add('hidden');
      spinnerTracto?.classList.add('hidden');
      connectedStateTracto?.classList.add('hidden');
      pendingTracto?.classList.remove('hidden');

      if (badgeTracto) {
        badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
        badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Pendiente por vincular';
      }
    }
  }
}

async function restartWhatsAppConnection(company = 'agro') {
  if (company === 'tracto') {
    const spinnerTracto = document.getElementById('qrLoadingSpinnerTracto');
    const pendingTracto = document.getElementById('qrPendingStateTracto');
    const qrImgTracto = document.getElementById('qrImageElementTracto');
    const badgeTracto = document.getElementById('qrStatusBadgeTracto');
    if (pendingTracto) pendingTracto.classList.add('hidden');
    if (spinnerTracto) spinnerTracto.classList.remove('hidden');
    if (qrImgTracto) qrImgTracto.classList.add('hidden');
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Preparando QR Tractopower...';
    }
    try {
      await fetch('/api/whatsapp/restart?company=tracto', { method: 'POST' });
    } catch (e) {}
    return;
  }

  const spinner = document.getElementById('qrLoadingSpinner');
  const qrImg = document.getElementById('qrImageElement');
  if (spinner) spinner.classList.remove('hidden');
  if (qrImg) qrImg.classList.add('hidden');
  await fetch('/api/whatsapp/restart?company=agro', { method: 'POST' });
}

async function logoutWhatsApp(company = 'agro') {
  const compName = company === 'tracto' ? 'Tractopower' : 'Agropower';
  if (confirm(`¿Deseas desvincular el WhatsApp de ${compName} para escanear otro número?`)) {
    await fetch(`/api/whatsapp/logout?company=${company}`, { method: 'POST' });
  }
}

async function saveTemplates(btnId) {
  if (!authenticatedUser || !authenticatedUser.isAdmin) {
    alert('Acceso denegado: Solo el Administrador Principal puede modificar horarios y plantillas.');
    return;
  }
  const payload = {
    greeting: document.getElementById('t_greeting_menu')?.value || DEFAULT_GREETING_TEXT,
    customCategories: customProgrammedCategories,
    customOptions: customProgrammedOptions,
    schedule: {
      workStart: document.getElementById('workStartInput').value || '08:00',
      workEnd: document.getElementById('workEndInput').value || '17:00',
      mode: document.getElementById('scheduleModeInput').value || 'outside_work_hours',
      autoReplySource: document.getElementById('autoReplySourceInput')?.value || 'greeting_menu',
      welcomeMessage: document.getElementById('t_welcome_message')?.value || ''
    },
    testWhatsappChannel: document.getElementById('testWhatsappChannelSelect')?.value || 'wa_agro',
    companies: {
      agropower: {
        name: 'Agropower',
        instagram: document.getElementById('c_agro_ig')?.value || 'agropower_venezuela',
        tiktok: document.getElementById('c_agro_tk')?.value || 'agropower_venezuela',
        facebook: document.getElementById('c_agro_fb')?.value || 'Pendiente por configurar',
        whatsapp:
          document.getElementById('c_agro_wa')?.value ||
          'Pendiente por configurar (Usando WhatsApp de prueba)'
      },
      tractopower: {
        name: 'Tractopower',
        instagram: document.getElementById('c_tracto_ig')?.value || 'Tractopower_venezuela',
        tiktok: document.getElementById('c_tracto_tk')?.value || 'tractopowervenezuela',
        facebook: document.getElementById('c_tracto_fb')?.value || 'Pendiente por configurar',
        whatsapp:
          document.getElementById('c_tracto_wa')?.value ||
          'Pendiente por configurar (Usando WhatsApp de prueba)'
      }
    },
    categories: {
      catalogo_tecnico: {
        title: 'Catálogo y Descripción Técnica',
        items: {
          cat_modelos: {
            title: 'Catálogo de modelos',
            reply: document.getElementById('t_cat_modelos').value,
            attachment: document.getElementById('t_pdf_name').value
          },
          repuestos: {
            title: 'Repuestos',
            reply: document.getElementById('t_repuestos').value
          },
          garantia: {
            title: 'Garantía',
            reply: document.getElementById('t_garantia').value
          }
        }
      },
      costos_financiamiento: {
        title: 'Costos y Financiamiento',
        items: {
          precios: {
            title: 'Precio de los modelos',
            reply: document.getElementById('t_precios').value
          },
          financiamiento: {
            title: 'Sistema de financiamiento',
            reply: document.getElementById('t_financiamiento').value
          },
          compras_prog: {
            title: 'Compras programadas',
            reply: document.getElementById('t_compras_prog').value
          }
        }
      },
      atencion_asesor: {
        title: 'Hablar con un asesor',
        items: {
          asesor: {
            title: 'Hablar con un asesor',
            reply: document.getElementById('t_asesor').value,
            waitingAdvisor: true
          }
        }
      }
    }
  };

  try {
    await fetch('/api/config/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    previewScheduleState();

    const btn = document.getElementById(btnId || 'btnSaveTemplates');
    if (btn) {
      const origHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>¡Guardado con éxito!</span>';
      setTimeout(() => {
        btn.innerHTML = origHTML;
      }, 2200);
    }
  } catch (e) {
    console.error('Error guardando configuración:', e);
  }
}

/* =========================================================================
   MÓDULO 10: CONFIGURACIÓN META GRAPH API — DUAL EMPRESA
   Soporta Agropower y Tractopower con Meta Apps independientes.
   ========================================================================= */

/**
 * Guarda la configuración de la Meta App para una empresa específica.
 * @param {'agro'|'tracto'} company
 */
async function saveMetaAppConfig(company = 'agro') {
  const suffix = company === 'tracto' ? 'Tracto' : 'Agro';
  const companyLabel = company === 'tracto' ? 'Tractopower' : 'Agropower';

  const appId = document.getElementById(`metaAppIdInput${suffix}`)?.value.trim();
  const appSecret = document.getElementById(`metaAppSecretInput${suffix}`)?.value.trim();
  const verifyToken = document.getElementById(`metaVerifyTokenInput${suffix}`)?.value.trim();
  const fb = document.getElementById(`metaConfigFeedback${suffix}`);

  if (!appId || !appSecret) {
    if (fb) {
      fb.classList.remove('hidden');
      fb.className = 'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-rose-950 text-rose-200 border border-rose-700';
      fb.textContent = `⚠️ Debes ingresar el App ID y el App Secret para ${companyLabel}.`;
    }
    return;
  }

  try {
    if (fb) {
      fb.classList.remove('hidden');
      fb.className = 'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-blue-950 text-blue-200 border border-blue-700';
      fb.textContent = `🔍 Guardando configuración de ${companyLabel}...`;
    }

    const headers = typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : { 'Content-Type': 'application/json' };
    const res = await fetch('/api/channels/meta/save-config', {
      method: 'POST',
      headers,
      body: JSON.stringify({ appId, appSecret, verifyToken, company })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (fb) {
        fb.className = 'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-emerald-950 text-emerald-200 border border-emerald-700';
        fb.textContent = '✅ ' + data.message;
      }
      updateMetaConnectionBadge(company, true);
    } else {
      if (fb) {
        fb.className = 'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-rose-950 text-rose-200 border border-rose-700';
        fb.textContent = 'âŒ ' + (data.error || 'Error desconocido');
      }
    }
  } catch (e) {
    if (fb) {
      fb.className = 'text-[11px] font-semibold p-2.5 rounded-xl text-center bg-rose-950 text-rose-200 border border-rose-700';
      fb.textContent = '❌ Error de conexión con el servidor.';
    }
  }
}

/**
 * Construye el HTML del estado de tokens para una empresa
 */
function buildMetaTokensHTML(companyData) {
  if (!companyData) return '<p class="text-[10px] text-slate-500 italic">Sin datos.</p>';

  const { pages = [], igAccounts = [], hasUserToken, updatedAt } = companyData;

  if (!hasUserToken && pages.length === 0) {
    return '<p class="text-[10px] text-slate-500 italic">Aún no se ha vinculado ninguna cuenta. Configura la Meta App y luego haz clic en "Vincular Cuentas".</p>';
  }

  let html = '';

  if (pages.length > 0) {
    html += '<div class="space-y-1.5">';
    html += '<p class="text-[10px] font-bold text-blue-400 uppercase tracking-wider">📄 Páginas de Facebook</p>';
    for (const page of pages) {
      const statusClass = page.hasToken ? 'text-emerald-400 border-emerald-800 bg-emerald-950' : 'text-slate-400 border-slate-700 bg-slate-900';
      html += `
        <div class="flex items-center justify-between p-2 rounded-lg border ${statusClass} text-[10px]">
          <div class="flex items-center gap-2">
            <i class="fa-brands fa-facebook text-blue-400"></i>
            <span class="font-bold text-white">${page.name}</span>
            <span class="text-slate-500 font-mono">${page.id}</span>
          </div>
          <div class="flex items-center gap-2">
            ${page.channelKey ? `<span class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">${page.channelKey}</span>` : '<span class="text-amber-400">Sin asignar</span>'}
            ${page.hasToken ? '<span class="text-emerald-400">✅ Token activo</span>' : '<span class="text-rose-400">❌ Sin token</span>'}
          </div>
        </div>`;
    }
    html += '</div>';
  }

  if (igAccounts.length > 0) {
    html += '<div class="space-y-1.5 mt-3">';
    html += '<p class="text-[10px] font-bold text-pink-400 uppercase tracking-wider">📸 Cuentas de Instagram</p>';
    for (const ig of igAccounts) {
      const isConnected = Boolean(ig.connected !== false && (ig.hasToken || ig.channelKey));
      const statusBadge = isConnected
        ? '<span class="text-emerald-400 font-semibold flex items-center gap-1">✅ Cuenta enlazada exitosamente</span>'
        : '<span class="text-rose-400 font-semibold flex items-center gap-1">❌ Sin enlace activo</span>';

      const pageLabel = (ig.pageName && ig.pageName !== 'undefined')
        ? `<span class="text-slate-400 text-[9px]">(vía Página: ${ig.pageName})</span>`
        : (ig.name && ig.name !== 'undefined')
        ? `<span class="text-slate-400 text-[9px]">(vía Página: ${ig.name})</span>`
        : '';

      html += `
        <div class="flex items-center justify-between p-2 rounded-lg border border-pink-800 bg-pink-950/50 text-[10px]">
          <div class="flex items-center gap-2">
            <i class="fa-brands fa-instagram text-pink-400"></i>
            <span class="font-bold text-white">@${ig.username}</span>
            <span class="text-slate-500 font-mono">${ig.igBusinessId}</span>
            ${pageLabel}
          </div>
          <div class="flex items-center gap-2">
            ${ig.channelKey ? `<span class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-slate-300">${ig.channelKey}</span>` : '<span class="text-amber-400">Sin asignar</span>'}
            ${statusBadge}
          </div>
        </div>`;
    }
    html += '</div>';
  }

  if (updatedAt) {
    html += `<p class="text-[9px] text-slate-500 mt-2">Última actualización: ${new Date(updatedAt).toLocaleString()}</p>`;
  }

  return html;
}

/**
 * Carga y muestra el estado actual de los tokens de Meta (ambas empresas)
 */
async function loadMetaTokensStatus() {
  const containerAgro = document.getElementById('metaTokensStatusContainerAgro');
  const containerTracto = document.getElementById('metaTokensStatusContainerTracto');

  try {
    const headers = typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : { 'Content-Type': 'application/json' };
    const res = await fetch('/api/channels/meta/tokens-status', { headers });
    if (!res.ok) {
      const errMsg = '<p class="text-[10px] text-slate-500 italic">No se pudo cargar el estado de Meta.</p>';
      if (containerAgro) containerAgro.innerHTML = errMsg;
      if (containerTracto) containerTracto.innerHTML = errMsg;
      return;
    }

    const data = await res.json();
    // data = { agro: {...}, tracto: {...} }

    if (containerAgro) {
      containerAgro.innerHTML = buildMetaTokensHTML(data.agro);
      updateMetaConnectionBadge('agro', Boolean(data.agro?.hasUserToken || (data.agro?.pages && data.agro.pages.length > 0)),
        data.agro?.pages?.length, data.agro?.igAccounts?.length);
    }

    if (containerTracto) {
      containerTracto.innerHTML = buildMetaTokensHTML(data.tracto);
      updateMetaConnectionBadge('tracto', Boolean(data.tracto?.hasUserToken || (data.tracto?.pages && data.tracto.pages.length > 0)),
        data.tracto?.pages?.length, data.tracto?.igAccounts?.length);
    }

  } catch (e) {
    const errMsg = '<p class="text-[10px] text-rose-400 italic">Error cargando estado de Meta.</p>';
    if (containerAgro) containerAgro.innerHTML = errMsg;
    if (containerTracto) containerTracto.innerHTML = errMsg;
  }
}

/**
 * Actualiza el badge de estado de conexión de Meta para una empresa
 * @param {'agro'|'tracto'} company
 */
function updateMetaConnectionBadge(company, configured, pagesCount, igCount) {
  const badgeId = company === 'tracto' ? 'metaConnectionStatusBadgeTracto' : 'metaConnectionStatusBadgeAgro';
  const badge = document.getElementById(badgeId);
  if (!badge) return;

  if (configured && (pagesCount > 0 || igCount > 0)) {
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700';
    badge.textContent = `✅ ${pagesCount || 0} pág + ${igCount || 0} IG`;
  } else if (configured) {
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700';
    badge.textContent = '⚙️ Configurada (sin vincular)';
  } else {
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700';
    badge.textContent = 'Sin configurar';
  }
}

/**
 * Carga la configuración actual de Meta para ambas empresas al abrir la sección
 */
async function loadMetaConfigState() {
  const headers = typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : { 'Content-Type': 'application/json' };

  const loadForCompany = async (company) => {
    try {
      const res = await fetch(`/api/channels/meta/config?company=${company}`, { headers });
      if (!res.ok) return;
      const data = await res.json();

      const suffix = company === 'tracto' ? 'Tracto' : 'Agro';
      const appIdInput = document.getElementById(`metaAppIdInput${suffix}`);
      const verifyInput = document.getElementById(`metaVerifyTokenInput${suffix}`);
      const secretInput = document.getElementById(`metaAppSecretInput${suffix}`);

      if (appIdInput && data.appId) appIdInput.value = data.appId;
      if (verifyInput && data.verifyToken) verifyInput.value = data.verifyToken;
      if (data.appSecretSet && secretInput) secretInput.placeholder = '•••••••••••••••• (ya configurado)';

      updateMetaConnectionBadge(company, Boolean(data.appId));
    } catch (e) {
      // Silencioso
    }
  };

  await Promise.all([loadForCompany('agro'), loadForCompany('tracto')]);

  // Cargar estado de tokens
  loadMetaTokensStatus();
}

/**
 * Inicia el flujo OAuth autenticado con Meta para vincular páginas e Instagram
 * @param {'agro'|'tracto'} company
 */
async function startMetaOAuth(company = 'agro') {
  const channelKey = company === 'tracto' ? 'ig_tracto' : 'ig_agro';
  const companyLabel = company === 'tracto' ? 'Tractopower' : 'Agropower';

  try {
    const headers = typeof getAuthHeadersForChannels === 'function' ? getAuthHeadersForChannels() : { 'Content-Type': 'application/json' };
    const res = await fetch(`/api/channels/meta/oauth-url/${channelKey}`, { headers });
    const data = await res.json();

    if (!res.ok || !data.url) {
      alert(`⚠️ ${data.error || 'No se pudo generar la URL de autorización para ' + companyLabel}`);
      return;
    }

    // Redirigir al flujo de autorización oficial de Facebook
    window.location.href = data.url;
  } catch (e) {
    alert(`❌ Error iniciando vinculación con Meta (${companyLabel}): ${e.message}`);
  }
}

/**
 * Detecta si venimos de un redirect OAuth exitoso y muestra feedback
 */
function checkMetaOAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const metaAuth = params.get('meta_auth');
  const message = params.get('message');

  if (metaAuth === 'success') {
    window.history.replaceState({}, '', '/');
    setTimeout(() => {
      alert(`✅ Meta vinculado correctamente: ${decodeURIComponent(message || 'Cuentas conectadas')}`);
      if (typeof loadChannelsVaultStatus === 'function') loadChannelsVaultStatus();
      if (typeof loadMetaTokensStatus === 'function') loadMetaTokensStatus();
    }, 500);
  } else if (metaAuth === 'error') {
    window.history.replaceState({}, '', '/');
    setTimeout(() => {
      alert(`❌ Error vinculando Meta: ${decodeURIComponent(message || 'Error desconocido')}`);
    }, 500);
  }
}
