/* =========================================================================
   MÓDULO 5: AJUSTES, PLANTILLAS DUALES (AGROPOWER / TRACTOPOWER), BOT Y PDF
   ========================================================================= */

let currentSettingsCompany = 'agropower';

async function loadBotSettings() {
  try {
    const res = await fetch('/api/config/templates');
    const data = await res.json();
    applyConfigToUI(data);
  } catch (e) {
    previewScheduleState();
  }
}

/**
 * Consulta el estado del catálogo PDF para una empresa ('agropower' o 'tractopower')
 */
async function checkCatalogPdfStatus(company = 'agropower') {
  try {
    const res = await fetch('/api/config/catalog-pdf?company=' + encodeURIComponent(company));
    const info = await res.json();
    updateCatalogPdfUI(info, company);
  } catch (e) {}
}

function updateCatalogPdfUI(info, company = 'agropower') {
  const isTracto = String(company || '').toLowerCase().includes('tracto');
  const suffix = isTracto ? '_tracto' : '_agro';

  const hiddenName = document.getElementById('t' + suffix + '_pdf_name');
  const nameEl = document.getElementById('pdfCurrentName' + suffix);
  const metaEl = document.getElementById('pdfCurrentMeta' + suffix);
  const pillEl = document.getElementById('pdfStatusPill' + suffix);
  const viewBtn = document.getElementById('btnViewPdf' + suffix);
  const delBtn = document.getElementById('btnDeletePdf' + suffix);

  if (hiddenName && info && info.fileName) {
    hiddenName.value = info.fileName;
  }
  if (!nameEl) return;

  if (info && info.exists && info.fileName) {
    nameEl.innerText = info.fileName;
    const sizeKb = info.sizeBytes ? `${(info.sizeBytes / 1024).toFixed(1)} KB` : 'Disponible';
    if (metaEl) {
      metaEl.innerText = isTracto
        ? `Catálogo Maquinaria Pesada (${sizeKb}) • Listo para enviar`
        : `Catálogo Tractores Agropower (${sizeKb}) • Listo para enviar`;
    }
    if (pillEl) {
      pillEl.className = 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold';
      pillEl.innerText = 'Activo en Servidor';
    }
    if (viewBtn) {
      viewBtn.href = info.url || `/media/${encodeURIComponent(info.fileName)}`;
      viewBtn.classList.remove('hidden');
    }
    if (delBtn) delBtn.classList.remove('hidden');
  } else {
    nameEl.innerText = isTracto ? 'Ningún catálogo cargado para Tractopower' : 'Ningún catálogo cargado para Agropower';
    if (metaEl) metaEl.innerText = 'Selecciona un archivo PDF desde tu PC para guardarlo';
    if (pillEl) {
      pillEl.className = 'text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-semibold';
      pillEl.innerText = 'Sin archivo';
    }
    if (viewBtn) viewBtn.classList.add('hidden');
    if (delBtn) delBtn.classList.add('hidden');
  }
}

function showPdfFeedback(msg, isError = false, company = 'agropower') {
  const isTracto = String(company || '').toLowerCase().includes('tracto');
  const fb = document.getElementById(isTracto ? 'pdfActionFeedback_tracto' : 'pdfActionFeedback_agro');
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

function handlePdfFileSelected(event, company = 'agropower') {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    showPdfFeedback('⚠️ Por favor selecciona un archivo con formato .PDF válido', true, company);
    event.target.value = '';
    return;
  }

  showPdfFeedback('⏳ Subiendo y guardando PDF en el servidor...', false, company);
  const reader = new FileReader();
  reader.onload = async function (evt) {
    try {
      const res = await fetch('/api/config/catalog-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: evt.target.result,
          company: company
        })
      });
      const data = await res.json();
      if (data && data.success) {
        updateCatalogPdfUI(data, company);
        showPdfFeedback(`✅ ¡Guardado en el servidor: ${data.fileName}!`, false, company);
      } else {
        showPdfFeedback('❌ Error al guardar el archivo en el servidor', true, company);
      }
    } catch (err) {
      showPdfFeedback('❌ Error de conexión al subir el archivo', true, company);
    }
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

async function deleteCatalogPdf(company = 'agropower') {
  const isTracto = String(company || '').toLowerCase().includes('tracto');
  const suffix = isTracto ? '_tracto' : '_agro';
  const current = document.getElementById('t' + suffix + '_pdf_name')?.value;

  if (!current) return;
  if (!confirm(`¿Seguro que deseas borrar el archivo "${current}" de ${isTracto ? 'Tractopower' : 'Agropower'} del servidor?`)) {
    return;
  }
  try {
    const res = await fetch('/api/config/catalog-pdf?company=' + encodeURIComponent(company), { method: 'DELETE' });
    const data = await res.json();
    if (data && data.success) {
      updateCatalogPdfUI({ exists: false, fileName: '' }, company);
      showPdfFeedback('🗑️ Catálogo PDF eliminado correctamente.', false, company);
    }
  } catch (e) {
    showPdfFeedback('❌ Error al eliminar el PDF del servidor', true, company);
  }
}

/**
 * Cambia la pestaña visible en Ajustes entre Agropower y Tractopower.
 * No intercambia datos en memoria: muestra el contenedor DOM correspondiente.
 */
function switchSettingsCompanyTab(company) {
  const isTracto = company === 'tractopower';
  currentSettingsCompany = isTracto ? 'tractopower' : 'agropower';

  const panelAgro = document.getElementById('settingsPanelAgro');
  const panelTracto = document.getElementById('settingsPanelTracto');
  const btnAgro = document.getElementById('tabBtnSettingsAgro');
  const btnTracto = document.getElementById('tabBtnSettingsTracto');
  const notice = document.getElementById('settingsCompanyScopeNotice');

  if (isTracto) {
    if (panelAgro) panelAgro.classList.add('hidden');
    if (panelTracto) panelTracto.classList.remove('hidden');
    if (btnTracto) {
      btnTracto.className = 'px-3.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition bg-amber-600 text-white shadow';
    }
    if (btnAgro) {
      btnAgro.className = 'px-3.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition bg-slate-800 text-slate-300 hover:text-white';
    }
    if (notice) {
      notice.className = 'text-[11px] font-semibold text-amber-400 flex items-center gap-1.5';
      notice.innerHTML = '<i class="fa-solid fa-circle-check text-[10px]"></i> <span>Editando respuestas, bot y catálogo de <b>Tractopower</b> (Maquinaria Pesada • +58 424-9578682)</span>';
    }
    checkCatalogPdfStatus('tractopower');
  } else {
    if (panelAgro) panelAgro.classList.remove('hidden');
    if (panelTracto) panelTracto.classList.add('hidden');
    if (btnAgro) {
      btnAgro.className = 'px-3.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition bg-emerald-600 text-white shadow';
    }
    if (btnTracto) {
      btnTracto.className = 'px-3.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition bg-slate-800 text-slate-300 hover:text-white';
    }
    if (notice) {
      notice.className = 'text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5';
      notice.innerHTML = '<i class="fa-solid fa-circle-check text-[10px]"></i> <span>Editando respuestas, bot y catálogo de <b>Agropower</b> (Tractores Agrícolas • +58 422-8333876)</span>';
    }
    checkCatalogPdfStatus('agropower');
  }
}

function resetGreetingToDefault(company = 'agropower') {
  if (company === 'tractopower') {
    const el = document.getElementById('t_tracto_greeting_menu');
    if (el) el.value = DEFAULT_TRACTOPOWER_GREETING_TEXT;
  } else {
    const el = document.getElementById('t_agro_greeting_menu');
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

function submitAddCategoryModal(event) {
  event.preventDefault();
  const emoji = (document.getElementById('modalCatEmoji')?.value || '🔧').trim() || '🔧';
  const num = parseInt(document.getElementById('modalCatNumber')?.value, 10) || (4 + customProgrammedCategories.length);
  const rawTitle = (document.getElementById('modalCatTitle')?.value || '').trim();
  const color = document.getElementById('modalCatColor')?.value || 'purple';
  const firstOptTitle = (document.getElementById('modalCatFirstOptTitle')?.value || '').trim();
  const firstOptReply = (document.getElementById('modalCatFirstOptReply')?.value || '').trim();

  if (!rawTitle) return;

  const cleanTitle = rawTitle.replace(/^\d+[\.\)\-\s]+/, '').trim();
  const upperTitle = cleanTitle.toUpperCase();
  const catId = 'cat_custom_' + Date.now();
  const headerLine = `${emoji} *${num}. ${upperTitle}*`;

  const newCat = {
    id: catId,
    number: num,
    emoji,
    title: cleanTitle,
    headerLine,
    color
  };

  customProgrammedCategories.push(newCat);

  if (firstOptTitle) {
    customProgrammedOptions.push({
      id: 'opt_' + Date.now(),
      category: catId,
      title: firstOptTitle,
      reply: firstOptReply || `Información de ${firstOptTitle}.`
    });
  }

  // Insertar en textarea de Agropower
  const elAgro = document.getElementById('t_agro_greeting_menu');
  if (elAgro) {
    let current = elAgro.value.trim();
    current += `\n\n${headerLine}`;
    if (firstOptTitle) {
      current += `\n • ${firstOptTitle}`;
    }
    elAgro.value = current;
  }

  closeAddCategoryModal();
  renderCustomCategoriesUI();
  renderCustomOptionsUI();
  renderCategorySelectOptions(catId);
}

function openAddOptionModal(preselectedCatId) {
  const modal = document.getElementById('addOptionModal');
  if (!modal) return;
  renderCategorySelectOptions(preselectedCatId);
  const titleInput = document.getElementById('modalOptTitle');
  const replyInput = document.getElementById('modalOptReply');
  if (titleInput) titleInput.value = '';
  if (replyInput) replyInput.value = '';
  modal.classList.remove('hidden');
  setTimeout(() => titleInput?.focus(), 60);
}

function closeAddOptionModal() {
  const modal = document.getElementById('addOptionModal');
  if (modal) modal.classList.add('hidden');
}

function submitAddOptionModal(event) {
  event.preventDefault();
  const category = document.getElementById('modalOptCategory')?.value || 'cat1';
  const title = (document.getElementById('modalOptTitle')?.value || '').trim();
  const reply = (document.getElementById('modalOptReply')?.value || '').trim();

  if (!title || !reply) return;

  const newOpt = {
    id: 'opt_' + Date.now(),
    category,
    title,
    reply
  };

  customProgrammedOptions.push(newOpt);
  insertOptionIntoGreetingText(title, category);

  closeAddOptionModal();
  renderCustomOptionsUI();
}

function insertOptionIntoGreetingText(title, categoryKey) {
  const el = document.getElementById('t_agro_greeting_menu');
  if (!el) return;
  let text = el.value;

  const patterns = {
    cat1: new RegExp('(📘[^\\n]*\\n)([\\s\\S]*?)(?=\\n\\s*[💵🧑‍💼📌🔧📍🚜📦🛠️📋⭐🌾]|\\n*$)', 'i'),
    cat2: new RegExp('(💵[^\\n]*\\n)([\\s\\S]*?)(?=\\n\\s*[🧑‍💼📌🔧📍🚜📦🛠️📋⭐🌾]|\\n*$)', 'i'),
    cat3: new RegExp('(🧑‍💼[^\\n]*\\n)([\\s\\S]*?)(?=\\n\\s*[📌🔧📍🚜📦🛠️📋⭐🌾]|\\n*$)', 'i')
  };

  let matched = false;
  if (patterns[categoryKey] && patterns[categoryKey].test(text)) {
    text = text.replace(patterns[categoryKey], (m, h, body) => {
      matched = true;
      const cleanBody = body.replace(/\s+$/, '');
      return h + cleanBody + '\n • ' + title + '\n';
    });
  }

  if (!matched) {
    const customCat = customProgrammedCategories.find(c => c.id === categoryKey);
    if (customCat && customCat.headerLine) {
      const idx = text.indexOf(customCat.headerLine);
      if (idx !== -1) {
        const nextBreak = text.indexOf('\n\n', idx);
        if (nextBreak !== -1) {
          text = text.slice(0, nextBreak) + '\n • ' + title + text.slice(nextBreak);
        } else {
          text = text + '\n • ' + title;
        }
        matched = true;
      }
    }
  }

  if (!matched) {
    text += '\n • ' + title;
  }

  el.value = text;
}

function addCustomProgrammedOption() {
  const titleInput = document.getElementById('newOptTitle');
  const catInput = document.getElementById('newOptCategory');
  const replyInput = document.getElementById('newOptReply');

  const title = (titleInput?.value || '').trim();
  const category = catInput?.value || 'cat1';
  const reply = (replyInput?.value || '').trim();

  if (!title || !reply) {
    alert('Ingresa el nombre de la opción y el texto de respuesta rápida.');
    return;
  }

  customProgrammedOptions.push({
    id: 'opt_' + Date.now(),
    category,
    title,
    reply
  });

  insertOptionIntoGreetingText(title, category);

  if (titleInput) titleInput.value = '';
  if (replyInput) replyInput.value = '';

  renderCustomOptionsUI();
}

function removeCustomProgrammedOption(id) {
  customProgrammedOptions = customProgrammedOptions.filter(o => o.id !== id);
  renderCustomOptionsUI();
}

function updateCustomOptionReply(id, newVal) {
  const opt = customProgrammedOptions.find(o => o.id === id);
  if (opt) opt.reply = newVal;
}

function renderCustomCategoriesUI() {
  const container = document.getElementById('customCategoriesSettingsList');
  if (!container) return;
  container.innerHTML = '';

  customProgrammedCategories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'bg-slate-950 border border-purple-800/50 rounded-xl p-3 flex items-center justify-between gap-2 shadow-sm';
    row.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-base shrink-0">${cat.emoji || '📌'}</span>
        <div class="min-w-0">
          <div class="text-xs font-extrabold text-purple-300 truncate">${cat.number}. ${cat.title}</div>
          <div class="text-[10px] text-slate-400 font-mono truncate">${cat.headerLine}</div>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" onclick="openAddOptionModal('${cat.id}')" class="px-2 py-1 rounded bg-blue-950 text-blue-300 hover:bg-blue-900 border border-blue-700/60 text-[10px] font-bold transition">
          + Opción
        </button>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderCustomOptionsUI() {
  const settingsList = document.getElementById('customOptionsSettingsList');
  const c1 = document.getElementById('customBtnsCat1');
  const c2 = document.getElementById('customBtnsCat2');
  const c3 = document.getElementById('customBtnsCat3');

  if (c1) c1.innerHTML = '';
  if (c2) c2.innerHTML = '';
  if (c3) c3.innerHTML = '';
  if (settingsList) settingsList.innerHTML = '';

  const catNames = getAllCategoryNamesMap();

  customProgrammedOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded text-[10px] transition border border-slate-700/60 flex items-center gap-1';
    btn.onclick = () => sendPreprogrammed(opt.id);
    btn.innerHTML = `<span>✨ ${opt.title}</span>`;

    if (opt.category === 'cat1' && c1) c1.appendChild(btn);
    else if (opt.category === 'cat2' && c2) c2.appendChild(btn);
    else if (opt.category === 'cat3' && c3) c3.appendChild(btn);
    else if (c3) c3.appendChild(btn);

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

/**
 * Carga la configuración guardada en el backend en los formularios del DOM.
 * Desacoplado: llena independientemente Agropower y Tractopower.
 */
function applyConfigToUI(data) {
  if (!data) return;
  window.botConfigData = data;
  if (!window.botConfigData.companies) window.botConfigData.companies = {};

  const agro = data.companies?.agropower || {};
  const tracto = data.companies?.tractopower || {};

  // 1. AGROPOWER
  const agroGreeting = agro.greeting || data.greeting || (typeof DEFAULT_GREETING_TEXT !== 'undefined' ? DEFAULT_GREETING_TEXT : '');
  if (document.getElementById('t_agro_greeting_menu')) document.getElementById('t_agro_greeting_menu').value = agroGreeting;
  if (document.getElementById('t_greeting_menu')) document.getElementById('t_greeting_menu').value = agroGreeting;

  const agroCat1 = agro.categories?.catalogo_tecnico?.items || data.categories?.catalogo_tecnico?.items || {};
  const agroCat2 = agro.categories?.costos_financiamiento?.items || data.categories?.costos_financiamiento?.items || {};
  const agroCat3 = agro.categories?.atencion_asesor?.items || data.categories?.atencion_asesor?.items || {};

  if (document.getElementById('t_agro_cat_modelos')) document.getElementById('t_agro_cat_modelos').value = agroCat1.cat_modelos?.reply || '';
  if (document.getElementById('t_agro_pdf_name')) document.getElementById('t_agro_pdf_name').value = agroCat1.cat_modelos?.attachment || '1792614914044_5atuoj.pdf';
  if (document.getElementById('t_agro_repuestos')) document.getElementById('t_agro_repuestos').value = agroCat1.repuestos?.reply || '';
  if (document.getElementById('t_agro_garantia')) document.getElementById('t_agro_garantia').value = agroCat1.garantia?.reply || '';

  if (document.getElementById('t_agro_precios')) document.getElementById('t_agro_precios').value = agroCat2.precios?.reply || '';
  if (document.getElementById('t_agro_financiamiento')) document.getElementById('t_agro_financiamiento').value = agroCat2.financiamiento?.reply || '';
  if (document.getElementById('t_agro_compras_prog')) document.getElementById('t_agro_compras_prog').value = agroCat2.compras_prog?.reply || '';
  if (document.getElementById('t_agro_asesor')) document.getElementById('t_agro_asesor').value = agroCat3.asesor?.reply || '';

  // 2. TRACTOPOWER
  const tractoGreeting = tracto.greeting || (typeof DEFAULT_TRACTOPOWER_GREETING_TEXT !== 'undefined' ? DEFAULT_TRACTOPOWER_GREETING_TEXT : '');
  if (document.getElementById('t_tracto_greeting_menu')) document.getElementById('t_tracto_greeting_menu').value = tractoGreeting;

  const tractoCat1 = tracto.categories?.catalogo_tecnico?.items || {};
  const tractoCat2 = tracto.categories?.costos_financiamiento?.items || {};
  const tractoCat3 = tracto.categories?.atencion_asesor?.items || {};

  if (document.getElementById('t_tracto_cat_modelos')) document.getElementById('t_tracto_cat_modelos').value = tractoCat1.cat_modelos?.reply || '';
  if (document.getElementById('t_tracto_pdf_name')) document.getElementById('t_tracto_pdf_name').value = tractoCat1.cat_modelos?.attachment || 'catalogo_tractopower.pdf';
  if (document.getElementById('t_tracto_repuestos')) document.getElementById('t_tracto_repuestos').value = tractoCat1.repuestos?.reply || '';
  if (document.getElementById('t_tracto_garantia')) document.getElementById('t_tracto_garantia').value = tractoCat1.garantia?.reply || '';

  if (document.getElementById('t_tracto_precios')) document.getElementById('t_tracto_precios').value = tractoCat2.precios?.reply || '';
  if (document.getElementById('t_tracto_financiamiento')) document.getElementById('t_tracto_financiamiento').value = tractoCat2.financiamiento?.reply || '';
  if (document.getElementById('t_tracto_compras_prog')) document.getElementById('t_tracto_compras_prog').value = tractoCat2.compras_prog?.reply || '';
  if (document.getElementById('t_tracto_asesor')) document.getElementById('t_tracto_asesor').value = tractoCat3.asesor?.reply || '';

  // Sincronizar inputs ocultos antiguos
  if (document.getElementById('t_cat_modelos')) document.getElementById('t_cat_modelos').value = agroCat1.cat_modelos?.reply || '';
  if (document.getElementById('t_pdf_name')) document.getElementById('t_pdf_name').value = agroCat1.cat_modelos?.attachment || '1792614914044_5atuoj.pdf';
  if (document.getElementById('t_repuestos')) document.getElementById('t_repuestos').value = agroCat1.repuestos?.reply || '';
  if (document.getElementById('t_garantia')) document.getElementById('t_garantia').value = agroCat1.garantia?.reply || '';
  if (document.getElementById('t_precios')) document.getElementById('t_precios').value = agroCat2.precios?.reply || '';
  if (document.getElementById('t_financiamiento')) document.getElementById('t_financiamiento').value = agroCat2.financiamiento?.reply || '';
  if (document.getElementById('t_compras_prog')) document.getElementById('t_compras_prog').value = agroCat2.compras_prog?.reply || '';
  if (document.getElementById('t_asesor')) document.getElementById('t_asesor').value = agroCat3.asesor?.reply || '';

  // Categorías y opciones personalizadas
  if (Array.isArray(data.customCategories)) {
    customProgrammedCategories = data.customCategories;
  }
  if (Array.isArray(data.customOptions)) {
    customProgrammedOptions = data.customOptions;
  }
  renderCustomCategoriesUI();
  renderCustomOptionsUI();

  // Horario y automatización
  if (data.schedule) {
    if (data.schedule.workStart && document.getElementById('workStartInput')) {
      document.getElementById('workStartInput').value = data.schedule.workStart;
    }
    if (data.schedule.workEnd && document.getElementById('workEndInput')) {
      document.getElementById('workEndInput').value = data.schedule.workEnd;
    }
    if (data.schedule.mode && document.getElementById('scheduleModeInput')) {
      document.getElementById('scheduleModeInput').value = data.schedule.mode;
    }
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

  // Redes Sociales de ambas empresas
  if (agro.instagram && document.getElementById('c_agro_ig')) document.getElementById('c_agro_ig').value = agro.instagram;
  if (agro.tiktok && document.getElementById('c_agro_tk')) document.getElementById('c_agro_tk').value = agro.tiktok;
  if (agro.facebook && document.getElementById('c_agro_fb')) document.getElementById('c_agro_fb').value = agro.facebook;
  if (agro.whatsapp && document.getElementById('c_agro_wa')) document.getElementById('c_agro_wa').value = agro.whatsapp;

  if (tracto.instagram && document.getElementById('c_tracto_ig')) document.getElementById('c_tracto_ig').value = tracto.instagram;
  if (tracto.tiktok && document.getElementById('c_tracto_tk')) document.getElementById('c_tracto_tk').value = tracto.tiktok;
  if (tracto.facebook && document.getElementById('c_tracto_fb')) document.getElementById('c_tracto_fb').value = tracto.facebook;
  if (tracto.whatsapp && document.getElementById('c_tracto_wa')) document.getElementById('c_tracto_wa').value = tracto.whatsapp;

  checkCatalogPdfStatus('agropower');
  checkCatalogPdfStatus('tractopower');
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
    badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
    textEl.innerText = mode === 'always'
      ? '⚡ Bot Activo (Modo 24h)'
      : `🌙 Fuera de Horario (${workStart}-${workEnd}) • Bot ACTIVO`;
  } else {
    badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 flex items-center gap-1.5';
    textEl.innerText = `☀️ En Horario Laboral (${workStart}-${workEnd}) • Asesores activos`;
  }
}

async function checkWhatsAppStatus() {
  try {
    const token = (typeof authToken === 'string' && authToken) ? authToken : (sessionStorage.getItem('omnipanel_token') || '');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/whatsapp/status?t=' + Date.now(), { headers });
    if (!res.ok) return;
    const data = await res.json();
    updateWhatsAppUI(data);
  } catch (e) {
    console.warn('[WA Status] Error:', e);
  }
}

function updateWhatsAppUI(data) {
  if (!data) return;

  const agro = data.agro || data.agropower || (data.company === 'agro' ? data : null) || {};
  const tracto = data.tracto || data.tractopower || (data.company === 'tracto' ? data : null) || {};

  // 1. Canal Agropower (Línea Oficial 1)
  const dotAgro = document.getElementById('topWaAgroDot');
  const textAgro = document.getElementById('topWaAgroText');
  const badgeAgro = document.getElementById('qrStatusBadge');
  const imgAgro = document.getElementById('qrImageElement');
  const spinnerAgro = document.getElementById('qrLoadingSpinner');
  const connStateAgro = document.getElementById('qrConnectedState');
  const phoneLabelAgro = document.getElementById('connectedPhoneLabel');

  if (agro.status === 'connected') {
    if (dotAgro) dotAgro.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    if (textAgro) textAgro.innerText = 'WA Agropower: Conectado';
    if (badgeAgro) {
      badgeAgro.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
      const phoneStr = (agro.user && agro.user.phone) ? '(+' + agro.user.phone + ')' : '(+58 422-8333876)';
      badgeAgro.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Conectado ' + phoneStr;
    }
    if (imgAgro) imgAgro.classList.add('hidden');
    if (spinnerAgro) spinnerAgro.classList.add('hidden');
    if (connStateAgro) {
      connStateAgro.classList.remove('hidden');
      connStateAgro.classList.add('flex');
    }
    if (phoneLabelAgro) {
      phoneLabelAgro.innerText = (agro.user && agro.user.phone) ? '+' + agro.user.phone : '+58 422-8333876';
    }
  } else if (agro.qr) {
    if (dotAgro) dotAgro.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    if (textAgro) textAgro.innerText = 'WA Agropower: Escanear QR';
    if (badgeAgro) {
      badgeAgro.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeAgro.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Escanear QR para conectar';
    }
    if (spinnerAgro) spinnerAgro.classList.add('hidden');
    if (connStateAgro) {
      connStateAgro.classList.add('hidden');
      connStateAgro.classList.remove('flex');
    }
    if (imgAgro) {
      imgAgro.src = agro.qr;
      imgAgro.classList.remove('hidden');
    }
  } else if (agro.status === 'connecting') {
    if (dotAgro) dotAgro.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    if (textAgro) textAgro.innerText = 'WA Agropower: Conectando...';
    if (badgeAgro) {
      badgeAgro.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeAgro.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Conectando...';
    }
    if (imgAgro) imgAgro.classList.add('hidden');
    if (connStateAgro) {
      connStateAgro.classList.add('hidden');
      connStateAgro.classList.remove('flex');
    }
    if (spinnerAgro) spinnerAgro.classList.remove('hidden');
  } else {
    if (badgeAgro) {
      badgeAgro.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
      badgeAgro.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Desconectado';
    }
    if (imgAgro) imgAgro.classList.add('hidden');
    if (spinnerAgro) spinnerAgro.classList.add('hidden');
    if (connStateAgro) {
      connStateAgro.classList.add('hidden');
      connStateAgro.classList.remove('flex');
    }
  }

  // 2. Canal Tractopower (Línea Oficial 2)
  const dotTracto = document.getElementById('topWaTractoDot');
  const textTracto = document.getElementById('topWaTractoText');
  const badgeTracto = document.getElementById('qrStatusBadgeTracto');
  const imgTracto = document.getElementById('qrImageElementTracto');
  const spinnerTracto = document.getElementById('qrLoadingSpinnerTracto');
  const pendingTracto = document.getElementById('qrPendingStateTracto');
  const connStateTracto = document.getElementById('qrConnectedStateTracto');
  const phoneLabelTracto = document.getElementById('connectedPhoneLabelTracto');

  if (tracto.status === 'connected') {
    if (dotTracto) dotTracto.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    if (textTracto) textTracto.innerText = 'WA Tractopower: Conectado';
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1.5';
      const phoneStr = (tracto.user && tracto.user.phone) ? '(+' + tracto.user.phone + ')' : '(+58 424-9578682)';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Conectado ' + phoneStr;
    }
    if (imgTracto) imgTracto.classList.add('hidden');
    if (spinnerTracto) {
      spinnerTracto.classList.add('hidden');
      spinnerTracto.classList.remove('flex');
    }
    if (pendingTracto) {
      pendingTracto.classList.add('hidden');
      pendingTracto.classList.remove('flex');
    }
    if (connStateTracto) {
      connStateTracto.classList.remove('hidden');
      connStateTracto.classList.add('flex');
    }
    if (phoneLabelTracto) {
      phoneLabelTracto.innerText = (tracto.user && tracto.user.phone) ? '+' + tracto.user.phone : '+58 424-9578682';
    }
  } else if (tracto.qr) {
    if (dotTracto) dotTracto.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    if (textTracto) textTracto.innerText = 'WA Tractopower: Escanear QR';
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Escanear QR para conectar';
    }
    if (spinnerTracto) {
      spinnerTracto.classList.add('hidden');
      spinnerTracto.classList.remove('flex');
    }
    if (pendingTracto) {
      pendingTracto.classList.add('hidden');
      pendingTracto.classList.remove('flex');
    }
    if (connStateTracto) {
      connStateTracto.classList.add('hidden');
      connStateTracto.classList.remove('flex');
    }
    if (imgTracto) {
      imgTracto.src = tracto.qr;
      imgTracto.classList.remove('hidden');
    }
  } else if (tracto.status === 'connecting') {
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Generando QR Tractopower...';
    }
    if (imgTracto) imgTracto.classList.add('hidden');
    if (connStateTracto) {
      connStateTracto.classList.add('hidden');
      connStateTracto.classList.remove('flex');
    }
    if (pendingTracto) {
      pendingTracto.classList.add('hidden');
      pendingTracto.classList.remove('flex');
    }
    if (spinnerTracto) {
      spinnerTracto.classList.remove('hidden');
      spinnerTracto.classList.add('flex');
    }
  } else {
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Pendiente por vincular';
    }
    if (imgTracto) imgTracto.classList.add('hidden');
    if (spinnerTracto) {
      spinnerTracto.classList.add('hidden');
      spinnerTracto.classList.remove('flex');
    }
    if (connStateTracto) {
      connStateTracto.classList.add('hidden');
      connStateTracto.classList.remove('flex');
    }
    if (pendingTracto) {
      pendingTracto.classList.remove('hidden');
      pendingTracto.classList.add('flex');
    }
  }

  // 3. Actualizar Badge Central en Barra Superior (headerWaBadge)
  const headerBadge = document.getElementById('headerWaBadge');
  if (headerBadge) {
    const isAgroConn = (agro.status === 'connected');
    const isTractoConn = (tracto.status === 'connected');
    if (isAgroConn && isTractoConn) {
      headerBadge.className = 'text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold flex items-center gap-1';
      headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> <span class="hidden sm:inline">WA: </span>Conectado (Dual)';
    } else if (isAgroConn) {
      headerBadge.className = 'text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold flex items-center gap-1';
      headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> <span class="hidden sm:inline">WA: </span>Agropower Conectado';
    } else if (isTractoConn) {
      headerBadge.className = 'text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold flex items-center gap-1';
      headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> <span class="hidden sm:inline">WA: </span>Tractopower Conectado';
    } else {
      headerBadge.className = 'text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 font-semibold flex items-center gap-1';
      headerBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> <span class="hidden sm:inline">WA: </span>Desconectado';
    }
  }
}

async function restartWhatsAppConnection(company = 'agro') {
  const isTracto = company === 'tracto' || company === 'tractopower';
  const targetCompany = isTracto ? 'tracto' : 'agro';

  if (isTracto) {
    const spinnerTracto = document.getElementById('qrLoadingSpinnerTracto');
    const pendingTracto = document.getElementById('qrPendingStateTracto');
    const qrImgTracto = document.getElementById('qrImageElementTracto');
    const badgeTracto = document.getElementById('qrStatusBadgeTracto');
    const connStateTracto = document.getElementById('qrConnectedStateTracto');
    if (connStateTracto) { connStateTracto.classList.add('hidden'); connStateTracto.classList.remove('flex'); }
    if (pendingTracto) { pendingTracto.classList.add('hidden'); pendingTracto.classList.remove('flex'); }
    if (spinnerTracto) { spinnerTracto.classList.remove('hidden'); spinnerTracto.classList.add('flex'); }
    if (qrImgTracto) qrImgTracto.classList.add('hidden');
    if (badgeTracto) {
      badgeTracto.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badgeTracto.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Preparando QR Tractopower...';
    }
  } else {
    const spinner = document.getElementById('qrLoadingSpinner');
    const qrImg = document.getElementById('qrImageElement');
    const connState = document.getElementById('qrConnectedState');
    if (connState) { connState.classList.add('hidden'); connState.classList.remove('flex'); }
    if (spinner) spinner.classList.remove('hidden');
    if (qrImg) qrImg.classList.add('hidden');
    const badge = document.getElementById('qrStatusBadge');
    if (badge) {
      badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1.5';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Preparando QR Agropower...';
    }
  }

  const token = (typeof authToken === 'string' && authToken) ? authToken : (sessionStorage.getItem('omnipanel_token') || '');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (typeof csrfToken === 'string' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    const res = await fetch('/api/whatsapp/restart?company=' + targetCompany + '&t=' + Date.now(), {
      method: 'POST',
      headers
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Error al solicitar nuevo código QR');
    } else {
      setTimeout(() => checkWhatsAppStatus(), 1200);
      setTimeout(() => checkWhatsAppStatus(), 2800);
    }
  } catch (e) {
    console.error('Error restarting WA:', e);
  }
}

async function logoutWhatsApp(company = 'agro') {
  const isTracto = company === 'tracto' || company === 'tractopower';
  const targetCompany = isTracto ? 'tracto' : 'agro';
  const compName = isTracto ? 'Tractopower' : 'Agropower';

  if (!confirm('¿Deseas desvincular el WhatsApp de ' + compName + ' para escanear otro número?')) {
    return;
  }

  const token = (typeof authToken === 'string' && authToken) ? authToken : (sessionStorage.getItem('omnipanel_token') || '');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (typeof csrfToken === 'string' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    const res = await fetch('/api/whatsapp/logout?company=' + targetCompany + '&t=' + Date.now(), {
      method: 'POST',
      headers
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Error al desvincular WhatsApp');
    } else {
      await checkWhatsAppStatus();
    }
  } catch (e) {
    console.error('Error logout WA:', e);
  }
}

/**
 * Guarda simultáneamente la configuración de Agropower y Tractopower sin sobreescribirse mutuamente.
 */
async function saveTemplates(btnId) {
  if (!authenticatedUser || !authenticatedUser.isAdmin) {
    alert('Acceso denegado: Solo el Administrador Principal puede modificar horarios y plantillas.');
    return;
  }

  // 1. Categorías Agropower (Tractores)
  const agroCategories = {
    catalogo_tecnico: {
      title: 'Catálogo y Descripción Técnica',
      items: {
        cat_modelos: {
          title: 'Catálogo de modelos',
          reply: document.getElementById('t_agro_cat_modelos')?.value || '',
          attachment: document.getElementById('t_agro_pdf_name')?.value || '1792614914044_5atuoj.pdf'
        },
        repuestos: {
          title: 'Repuestos',
          reply: document.getElementById('t_agro_repuestos')?.value || ''
        },
        garantia: {
          title: 'Garantía',
          reply: document.getElementById('t_agro_garantia')?.value || ''
        }
      }
    },
    costos_financiamiento: {
      title: 'Costos y Financiamiento',
      items: {
        precios: {
          title: 'Precio de los modelos',
          reply: document.getElementById('t_agro_precios')?.value || ''
        },
        financiamiento: {
          title: 'Sistema de financiamiento',
          reply: document.getElementById('t_agro_financiamiento')?.value || ''
        },
        compras_prog: {
          title: 'Compras programadas',
          reply: document.getElementById('t_agro_compras_prog')?.value || ''
        }
      }
    },
    atencion_asesor: {
      title: 'Hablar con un asesor',
      items: {
        asesor: {
          title: 'Hablar con un asesor',
          reply: document.getElementById('t_agro_asesor')?.value || '',
          waitingAdvisor: true
        }
      }
    }
  };

  // 2. Categorías Tractopower (Maquinaria Pesada)
  const tractoCategories = {
    catalogo_tecnico: {
      title: 'Catálogo y Maquinaria Pesada',
      items: {
        cat_modelos: {
          title: 'Catálogo de maquinaria pesada',
          reply: document.getElementById('t_tracto_cat_modelos')?.value || '',
          attachment: document.getElementById('t_tracto_pdf_name')?.value || 'catalogo_tractopower.pdf'
        },
        repuestos: {
          title: 'Repuestos',
          reply: document.getElementById('t_tracto_repuestos')?.value || ''
        },
        garantia: {
          title: 'Garantía',
          reply: document.getElementById('t_tracto_garantia')?.value || ''
        }
      }
    },
    costos_financiamiento: {
      title: 'Costos y Venta al Contado',
      items: {
        precios: {
          title: 'Precio de los modelos',
          reply: document.getElementById('t_tracto_precios')?.value || ''
        },
        financiamiento: {
          title: 'Condición de Venta Contado',
          reply: document.getElementById('t_tracto_financiamiento')?.value || ''
        },
        compras_prog: {
          title: 'Compras programadas',
          reply: document.getElementById('t_tracto_compras_prog')?.value || ''
        }
      }
    },
    atencion_asesor: {
      title: 'Hablar con un asesor',
      items: {
        asesor: {
          title: 'Hablar con un asesor',
          reply: document.getElementById('t_tracto_asesor')?.value || '',
          waitingAdvisor: true
        }
      }
    }
  };

  const payload = {
    greeting: document.getElementById('t_agro_greeting_menu')?.value || DEFAULT_GREETING_TEXT,
    customCategories: customProgrammedCategories,
    customOptions: customProgrammedOptions,
    schedule: {
      workStart: document.getElementById('workStartInput')?.value || '08:00',
      workEnd: document.getElementById('workEndInput')?.value || '17:00',
      mode: document.getElementById('scheduleModeInput')?.value || 'outside_work_hours',
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
        whatsapp: document.getElementById('c_agro_wa')?.value || '+58 422-8333876',
        greeting: document.getElementById('t_agro_greeting_menu')?.value || DEFAULT_GREETING_TEXT,
        categories: agroCategories
      },
      tractopower: {
        name: 'Tractopower',
        instagram: document.getElementById('c_tracto_ig')?.value || 'Tractopower_venezuela',
        tiktok: document.getElementById('c_tracto_tk')?.value || 'tractopowervenezuela',
        facebook: document.getElementById('c_tracto_fb')?.value || 'Pendiente por configurar',
        whatsapp: document.getElementById('c_tracto_wa')?.value || '+58 424-9578682',
        greeting: document.getElementById('t_tracto_greeting_menu')?.value || DEFAULT_TRACTOPOWER_GREETING_TEXT,
        categories: tractoCategories
      }
    },
    categories: agroCategories
  };

  try {
    const res = await fetch('/api/config/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resData = await res.json();
    if (resData && resData.config) {
      window.botConfigData = resData.config;
    }
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
