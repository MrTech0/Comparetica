export const COMPARISON_STATUS_GRACE_MS = 5000;
export const CONTRACT_STATUSES_LOCKING_COMPARISON = Object.freeze([
  'En trámite', 'Firmado y Activado', 'Rechazado por Scoring'
]);

export function canManageCommissionCollection(comparison) {
  return comparison.estado === 'Aceptada' && comparison.estado_contrato === 'Firmado y Activado';
}

export function getComparisonStatusLock(comparison, now = Date.now()) {
  if (CONTRACT_STATUSES_LOCKING_COMPARISON.includes(comparison.estado_contrato)) {
    return { locked: true, reason: 'contract', remainingMs: 0 };
  }
  if (comparison.estado !== 'Aceptada' && comparison.estado !== 'Rechazada') {
    return { locked: false, reason: null, remainingMs: null };
  }
  const changedAt = Date.parse(comparison.estado_cambiado_en);
  const remainingMs = changedAt + COMPARISON_STATUS_GRACE_MS - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { locked: true, reason: 'elapsed', remainingMs: 0 };
  }
  return { locked: false, reason: null, remainingMs };
}
