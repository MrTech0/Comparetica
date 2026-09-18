/**
 * Catálogo inmutable de nombres de eventos estándar de la aplicación.
 */
export const APP_EVENTS = Object.freeze({
  COMPARISON_SAVED: 'comparison-saved',
  CLIENTS_UPDATED: 'clients-updated',
  AGENTS_UPDATED: 'agents-updated',
  TARIFFS_UPDATED: 'tariffs-updated',
  SETTINGS_UPDATED: 'settings-updated'
});

/**
 * Emite un evento de aplicación desacoplado a través del objeto global.
 *
 * @param {string} eventName - Nombre del evento (utilizar constantes de APP_EVENTS).
 * @param {any} [detail=null] - Payload asociado al evento.
 */
export function emitAppEvent(eventName, detail = null) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

/**
 * Suscribe un manejador a un evento de aplicación y retorna la función de desuscripción.
 *
 * @param {string} eventName - Nombre del evento (utilizar constantes de APP_EVENTS).
 * @param {(event: CustomEvent) => void} handler - Callback a ejecutar al dispararse el evento.
 * @returns {() => void} Función para desuscribir el listener.
 */
export function onAppEvent(eventName, handler) {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }
  return () => {};
}
