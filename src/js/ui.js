/* src/js/ui.js */

/**
 * Muestra una notificación emergente Toast con estilo Material 3.
 *
 * @param {string} message - Mensaje a mostrar.
 * @param {'success'|'error'|'info'|'warning'} [type='success'] - Tipo de notificación.
 */
export function showToast(message, type = 'success') {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `m3-toast ${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  // Auto-eliminar después de 4 segundos
  setTimeout(() => {
    toast.classList.add('m3-toast-fadeout');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

/**
 * Muestra una notificación emergente con acciones interactivas.
 *
 * @param {string} message - Texto informativo.
 * @param {Array<{text: string, class?: string, callback: () => void}>} [actions=[]]
 */
export function showActionToast(message, actions = []) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'm3-toast action-toast';

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  textSpan.innerText = message;
  toast.appendChild(textSpan);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'toast-actions';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.className = action.class || '';
    btn.innerText = action.text;
    btn.addEventListener('click', () => {
      if (action.callback) action.callback();
      toast.classList.add('m3-toast-fadeout');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    });
    actionsDiv.appendChild(btn);
  });

  toast.appendChild(actionsDiv);
  container.appendChild(toast);
}

/**
 * Muestra un diálogo modal de confirmación personalizado de Material Design 3.
 *
 * @param {string} mensaje - Mensaje a mostrar.
 * @param {string} [titulo="Confirmación"] - Título del diálogo.
 * @returns {Promise<boolean>} Resuelve a true si el usuario acepta, o false si cancela.
 */
export function showConfirm(mensaje, titulo = "Confirmación") {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      if (typeof confirm === 'function') {
        resolve(confirm(mensaje));
      } else {
        resolve(true);
      }
      return;
    }

    const overlay = document.getElementById('dialog-confirm');
    const titleEl = document.getElementById('dialog-confirm-title');
    const msgEl = document.getElementById('dialog-confirm-message');
    const btnCancel = document.getElementById('dialog-confirm-cancel');
    const btnAccept = document.getElementById('dialog-confirm-accept');

    if (!overlay || !titleEl || !msgEl || !btnCancel || !btnAccept) {
      if (typeof confirm === 'function') {
        resolve(confirm(mensaje));
      } else {
        resolve(true);
      }
      return;
    }

    titleEl.innerText = titulo;
    msgEl.innerText = mensaje;

    const cancelClone = btnCancel.cloneNode(true);
    const acceptClone = btnAccept.cloneNode(true);
    btnCancel.replaceWith(cancelClone);
    btnAccept.replaceWith(acceptClone);

    cancelClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve(false);
    });

    acceptClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve(true);
    });

    overlay.classList.add('active');
  });
}

// Puente de retrocompatibilidad global
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.showActionToast = showActionToast;
  window.showConfirm = showConfirm;
}
