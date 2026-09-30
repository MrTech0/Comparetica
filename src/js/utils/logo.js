export const PDF_LOGO_MAX_SIDE = 512;
export const SVG_LOGO_FORMAT_ERROR = 'Formato de logotipo no admitido. Solo se permiten archivos .svg. El archivo se ha retirado del campo.';

export function isSvgLogoFile(file) {
  return file?.name?.toLowerCase().endsWith('.svg') ?? false;
}

// SVG is decoded once, when attached. Persist only this bounded, transparent PNG.
export async function optimizeSvgLogo(file) {
  if (!isSvgLogoFile(file)) throw new Error(SVG_LOGO_FORMAT_ERROR);
  let objectUrl;
  try {
    const imageFile = new Blob([file], { type: 'image/svg+xml' });
    objectUrl = URL.createObjectURL(imageFile);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('No se puede leer el SVG. Adjunta un archivo SVG válido. El archivo se ha retirado del campo.'));
      image.src = objectUrl;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0 && height > 0)) throw new Error('El SVG no tiene dimensiones válidas. El archivo se ha retirado del campo.');
    const scale = Math.min(1, PDF_LOGO_MAX_SIDE / width, PDF_LOGO_MAX_SIDE / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUri = canvas.toDataURL('image/png');
    const resized = Math.max(width, height) > PDF_LOGO_MAX_SIDE;
    const message = resized
      ? `El SVG de ${width} × ${height} px supera ${PDF_LOGO_MAX_SIDE} px. Se ha convertido a PNG de ${canvas.width} × ${canvas.height} px para mantener ligero el PDF. Al guardar, solo se conservará el PNG optimizado.`
      : 'SVG convertido a PNG para el PDF. Al guardar, solo se conservará el PNG optimizado.';
    return { dataUri, base64Data: dataUri.split(',')[1], extension: 'png', message, resized };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

// Shared by Settings and the welcome wizard. Pending native reads and image
// decodes are versioned so a replaced/cleared selection cannot be saved later.
export function createLogoSelection(input, notify) {
  let current = null;
  const clear = () => { current = null; if (input) input.value = ''; };
  const validate = file => {
    if (!file || isSvgLogoFile(file)) return true;
    clear();
    notify(SVG_LOGO_FORMAT_ERROR, 'error');
    return false;
  };
  const select = (source = input?.files?.[0], replaceInput = false) => {
    const record = { file: replaceInput ? null : source, reading: replaceInput, failed: false, promise: null };
    current = record;
    if (replaceInput && input) input.value = '';
    // Validate picker/drop names synchronously so invalid files disappear at once.
    if (!replaceInput && !validate(source)) return Promise.resolve(null);
    record.promise = (async () => {
      try {
        const file = await source;
        if (current !== record) return null;
        record.reading = false;
        record.file = file;
        if (!validate(file) || !file) return null;
        if (replaceInput) {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
        }
        const logo = await optimizeSvgLogo(file);
        if (current !== record) return null;
        notify(logo.message, logo.resized ? 'warning' : 'info');
        return logo;
      } catch (error) {
        if (current === record) {
          record.failed = true;
          record.reading = false;
          input.value = '';
          notify(error.message || 'Error al preparar el SVG. El archivo se ha retirado del campo.', 'error');
        }
        return null;
      }
    })();
    return record.promise;
  };
  const ready = async () => {
    for (;;) {
      if (current && !current.reading && input?.files?.[0] !== current.file) current = null;
      if (!current) {
        const file = input?.files?.[0];
        if (!validate(file)) return { ok: false, logo: null };
        if (!file) return { ok: true, logo: null };
        select(file);
      }
      const record = current;
      const logo = await record.promise;
      if (current !== record) continue;
      return { ok: !record.failed && (!record.file || !!logo), logo };
    }
  };
  return { select, ready, validate, clear };
}

export function isOptimizedPngLogo(dataUri) {
  if (!dataUri?.startsWith('data:image/png;base64,')) return false;
  try {
    const header = atob(dataUri.split(',')[1].slice(0, 44));
    if (!header.startsWith('\x89PNG\r\n\x1a\n') || header.slice(12, 16) !== 'IHDR') return false;
    const dimension = offset => ((header.charCodeAt(offset) * 16777216) + (header.charCodeAt(offset + 1) << 16)
      + (header.charCodeAt(offset + 2) << 8) + header.charCodeAt(offset + 3));
    const width = dimension(16), height = dimension(20);
    return width > 0 && height > 0 && Math.max(width, height) <= PDF_LOGO_MAX_SIDE;
  } catch {
    return false;
  }
}
