/* src/js/ipc.js */

/**
 * Invoca un comando expuesto por el backend de Tauri.
 * Soporta de forma transparente tanto window.__TAURI__.core.invoke (Tauri v2)
 * como window.__TAURI__.invoke.
 *
 * @template T
 * @param {string} cmd - Nombre del comando registrado en Tauri.
 * @param {Record<string, any>} [args={}] - Argumentos a transferir al comando.
 * @returns {Promise<T>} Resultado devuelto por el backend.
 */
export async function invoke(cmd, args = {}) {
  if (typeof window !== 'undefined' && window.__TAURI__) {
    const fn = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
    if (typeof fn === 'function') {
      return await fn(cmd, args);
    }
  }
  throw new Error(`[Tauri IPC] Comando '${cmd}' no disponible en este entorno.`);
}

/**
 * Escucha eventos nativos emitidos desde el backend de Tauri.
 *
 * @param {string} eventName - Nombre del evento (ej: 'tauri://drag-drop').
 * @param {(event: any) => void} handler - Callback a ejecutar cuando se reciba el evento.
 * @returns {Promise<() => void>} Función para desuscribir el listener.
 */
export async function listen(eventName, handler) {
  if (typeof window !== 'undefined' && window.__TAURI__?.event?.listen) {
    return await window.__TAURI__.event.listen(eventName, handler);
  }
  return () => {};
}
