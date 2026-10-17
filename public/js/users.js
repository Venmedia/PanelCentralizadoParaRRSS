/* =========================================================================
   MÓDULO 6: GESTIÓN DE USUARIOS (ADMIN Y ASESORES) (public/js/users.js)
   ========================================================================= */

async function loadUsersList() {
  if (!authenticatedUser || !authenticatedUser.isAdmin) return;
  try {
    const res = await fetch('/api/users');
    if (res.ok) {
      usersList = await res.json();
      renderSettingsUsersTable();
    }
  } catch (e) {}
}

function renderSettingsUsersTable() {
  const tbody = document.getElementById('settingsUsersTableBody');
  const badge = document.getElementById('usersCountBadge');
  if (!tbody) return;
  if (badge) badge.innerText = `${usersList.length} Usuarios Registrados`;

  tbody.innerHTML = '';
  usersList.forEach(u => {
    const isAdmin = u.role === 'admin';
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 transition';
    tr.innerHTML = `
      <td class="p-2.5 font-bold text-white flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${u.online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}"></span>
        <span>${u.firstName} ${u.lastName}</span>
      </td>
      <td class="p-2.5 text-slate-300">${u.email || '—'}</td>
      <td class="p-2.5 font-mono text-blue-300 font-semibold">${u.username}</td>
      <td class="p-2.5 font-mono text-amber-300">${u.password}</td>
      <td class="p-2.5">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${
          isAdmin ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-blue-950 text-blue-300 border-blue-800'
        }">
          ${isAdmin ? '👑 Administrador Principal' : '👤 Usuario Administrable'}
        </span>
      </td>
      <td class="p-2.5 text-[11px] text-slate-400">
        <div>Entrada: <span class="text-slate-200 font-semibold">${u.lastLogin || '—'}</span></div>
        <div class="text-[10px] text-slate-500">Últ. actividad: ${u.lastActive || '—'}</div>
      </td>
      <td class="p-2.5 text-right space-x-1">
        <button onclick="editUserById(${u.id})" class="bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/40 px-2 py-1 rounded text-[10px] font-bold transition">
          <i class="fa-solid fa-pen"></i> Modificar
        </button>
        ${
          u.id !== 1
            ? `
          <button onclick="deleteUserById(${u.id})" class="bg-rose-950 hover:bg-rose-800 text-rose-300 border border-rose-700/50 px-2 py-1 rounded text-[10px] font-bold transition">
            <i class="fa-solid fa-trash"></i>
          </button>
        `
            : ''
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editUserById(id) {
  const u = usersList.find(x => Number(x.id) === Number(id));
  if (!u) return;
  document.getElementById('editUserId').value = u.id;
  document.getElementById('u_firstName').value = u.firstName || '';
  document.getElementById('u_lastName').value = u.lastName || '';
  document.getElementById('u_email').value = u.email || '';
  document.getElementById('u_username').value = u.username || '';
  document.getElementById('u_password').value = u.password || '';
  document.getElementById('u_role').value = u.role || 'operator';

  document.getElementById('userFormTitle').innerHTML = `<i class="fa-solid fa-user-pen"></i> Modificando Usuario: ${u.firstName} ${u.lastName}`;
  document.getElementById('btnSubmitUserText').innerText = 'Guardar Modificación';
  document.getElementById('btnCancelEditUser').classList.remove('hidden');
}

function resetUserForm() {
  document.getElementById('editUserId').value = '';
  document.getElementById('u_firstName').value = '';
  document.getElementById('u_lastName').value = '';
  document.getElementById('u_email').value = '';
  document.getElementById('u_username').value = '';
  document.getElementById('u_password').value = '';
  document.getElementById('u_role').value = 'operator';

  document.getElementById('userFormTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear Nuevo Usuario';
  document.getElementById('btnSubmitUserText').innerText = 'Crear Usuario';
  document.getElementById('btnCancelEditUser').classList.add('hidden');
}

async function saveUserForm() {
  const editId = document.getElementById('editUserId').value;
  const payload = {
    firstName: document.getElementById('u_firstName').value.trim(),
    lastName: document.getElementById('u_lastName').value.trim(),
    email: document.getElementById('u_email').value.trim(),
    username: document.getElementById('u_username').value.trim(),
    password: document.getElementById('u_password').value.trim(),
    role: document.getElementById('u_role').value
  };

  const fb = document.getElementById('userFormFeedback');
  if (!payload.firstName || !payload.lastName || !payload.username || !payload.password) {
    fb.className = 'text-[11px] font-semibold text-rose-400';
    fb.innerText = '⚠️ Completa nombre, apellido, usuario y clave.';
    return;
  }

  try {
    const url = editId ? `/api/users/${editId}` : '/api/users';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      fb.className = 'text-[11px] font-semibold text-rose-400';
      fb.innerText = `❌ ${data.error || 'Error guardando usuario'}`;
      return;
    }
    fb.className = 'text-[11px] font-semibold text-emerald-400';
    fb.innerText = editId
      ? '✅ Usuario modificado correctamente.'
      : '✅ Nuevo usuario creado exitosamente.';
    setTimeout(() => {
      fb.innerText = '';
    }, 3000);
    resetUserForm();
    await loadUsersList();
    await loadAnalyticsSummary();
  } catch (e) {
    fb.className = 'text-[11px] font-semibold text-rose-400';
    fb.innerText = '❌ Error de red al guardar usuario.';
  }
}

async function deleteUserById(id) {
  const u = usersList.find(x => Number(x.id) === Number(id));
  if (!u) return;
  if (!confirm(`¿Seguro que deseas eliminar al usuario "${u.firstName} ${u.lastName}" (${u.username})?`)) {
    return;
  }
  try {
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    await loadUsersList();
    await loadAnalyticsSummary();
  } catch (e) {}
}
