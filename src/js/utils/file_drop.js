import { listen } from '../ipc.js';

function isDropTarget(element, position) {
  if (element.getClientRects().length === 0) return false;
  if (!position) return true;
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

export async function setupFileDropzone(element, { onFile, onPaths }) {
  if (!element) return;
  for (const eventName of ['dragenter', 'dragover']) {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      event.stopPropagation();
      element.classList.add('drag-over');
    });
  }
  element.addEventListener('dragleave', () => element.classList.remove('drag-over'));
  element.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) return onFile(file);
  });

  try {
    const hover = event => {
      if (isDropTarget(element, event.payload?.position)) element.classList.add('drag-over');
      else element.classList.remove('drag-over');
    };
    await listen('tauri://drag-enter', hover);
    await listen('tauri://drag-over', hover);
    await listen('tauri://drag-leave', () => element.classList.remove('drag-over'));
    const drop = async event => {
      element.classList.remove('drag-over');
      if (!isDropTarget(element, event.payload?.position)) return;
      const paths = event.payload?.paths || (Array.isArray(event.payload) ? event.payload : []);
      if (paths.length) await onPaths(paths);
    };
    await listen('tauri://drag-drop', drop);
    await listen('tauri://file-drop', drop);
  } catch (error) {
    console.warn('No se pudieron registrar eventos nativos de arrastre:', error);
  }
}
