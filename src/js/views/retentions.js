import { getRetenciones, addRetencion, updateRetencion, deleteRetencion } from '../db.js';
import { formatRetentionPercent, parseRetentionPercent } from '../commission_split.js';
import { showToast, showConfirm } from '../ui.js';

let cachedRetentions = [];

export async function initRetentionsView() {
  const form = document.getElementById('dialog-retention-form');
  const dialog = document.getElementById('dialog-retention');
  const open = document.getElementById('open-retention-dialog-btn');
  if (form && dialog && open && !form.dataset.listenerAdded) {
    form.dataset.listenerAdded = 'true';
    open.addEventListener('click', () => openRetentionDialog());
    document.getElementById('dialog-retention-close')?.addEventListener('click', () => dialog.classList.remove('active'));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.saving === 'true') return;
      const percent = document.getElementById('dialog-retention-percent').value.trim();
      const id = document.getElementById('dialog-retention-id').value;
      const button = form.querySelector('button[type="submit"]');
      try {
        parseRetentionPercent(percent);
        form.dataset.saving = 'true';
        button.disabled = true;
        button.textContent = 'Guardando…';
        if (id) await updateRetencion(Number(id), percent);
        else await addRetencion(percent);
        dialog.classList.remove('active');
        form.reset();
        showToast('Retención guardada correctamente.', 'success');
        await loadRetentionsTable();
      } catch (error) { showToast(error.message || String(error), 'error'); }
      finally {
        form.dataset.saving = 'false';
        button.disabled = false;
        button.textContent = 'Guardar Retención';
      }
    });
  }
  await loadRetentionsTable();
}

function openRetentionDialog(retention = null) {
  document.getElementById('dialog-retention-form').reset();
  document.getElementById('dialog-retention-title').textContent = retention ? 'Editar Retención' : 'Nueva Retención';
  document.getElementById('dialog-retention-id').value = retention?.id ?? '';
  document.getElementById('dialog-retention-percent').value = retention ? formatRetentionPercent(retention.porcentaje_centesimas) : '';
  document.getElementById('dialog-retention').classList.add('active');
  document.getElementById('dialog-retention-percent').focus();
}

export async function loadRetentionsTable() {
  const tbody = document.getElementById('table-retentions-body');
  if (!tbody) return;
  try {
    cachedRetentions = await getRetenciones();
    tbody.innerHTML = '';
    if (!cachedRetentions.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:32px;">No hay retenciones. Puedes crear una o dejar a los comerciales sin retención.</td></tr>';
      return;
    }
    for (const retention of cachedRetentions) {
      const row = document.createElement('tr');
      row.innerHTML = `<td><strong>${formatRetentionPercent(retention.porcentaje_centesimas)} %</strong></td>
        <td>${retention.num_agentes}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="m3-btn m3-btn-outlined edit-retention-btn" data-id="${retention.id}">Editar</button>
          <button type="button" class="m3-btn m3-btn-text delete-retention-btn" data-id="${retention.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(row);
    }
    tbody.querySelectorAll('.edit-retention-btn').forEach(button => button.addEventListener('click', () => {
      const retention = cachedRetentions.find(item => item.id === Number(button.getAttribute('data-id')));
      if (retention) openRetentionDialog(retention);
    }));
    tbody.querySelectorAll('.delete-retention-btn').forEach(button => button.addEventListener('click', async () => {
      const retention = cachedRetentions.find(item => item.id === Number(button.getAttribute('data-id')));
      if (!retention) return;
      if (retention.num_agentes > 0) {
        showToast('Esta retención está asignada a comerciales. Cambia primero su asignación para poder eliminarla.', 'error');
        return;
      }
      if (!await showConfirm(`¿Eliminar la retención del ${formatRetentionPercent(retention.porcentaje_centesimas)} %? Los repartos de las comparativas guardadas se conservarán.`, 'Eliminar Retención')) return;
      try {
        await deleteRetencion(retention.id);
        showToast('Retención eliminada correctamente.', 'success');
        await loadRetentionsTable();
      } catch (error) { showToast(error.message || String(error), 'error'); }
    }));
  } catch (error) {
    cachedRetentions = [];
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No se pudieron cargar las retenciones. Vuelve a entrar para reintentar.</td></tr>';
    showToast(`Error al cargar retenciones: ${error.message || error}`, 'error');
  }
}
