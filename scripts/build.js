import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

try {
  console.log('Iniciando compilación de Tauri...');
  // Ejecutar tauri build con salida heredada para ver progreso
  execSync('pnpm tauri build', { stdio: 'inherit' });

  const msiDir = path.join('src-tauri', 'target', 'release', 'bundle', 'msi');
  if (fs.existsSync(msiDir)) {
    const files = fs.readdirSync(msiDir);
    files.forEach(file => {
      if (file.includes('_en-US')) {
        const oldPath = path.join(msiDir, file);
        const newName = file.replace('_en-US', '');
        const newPath = path.join(msiDir, newName);
        
        // Renombrar en el directorio de salida
        fs.renameSync(oldPath, newPath);
        console.log(`[ÉXITO] Renombrado local: ${file} -> ${newName}`);
        
        // Copiar a la carpeta de descargas del usuario en Windows
        const downloadsDir = path.join(process.env.USERPROFILE || '', 'Downloads');
        if (fs.existsSync(downloadsDir)) {
          const destPath = path.join(downloadsDir, newName);
          fs.copyFileSync(newPath, destPath);
          console.log(`[ÉXITO] Copiado a descargas: ${destPath}`);
        }
      }
    });
  } else {
    console.warn('[ADVERTENCIA] No se encontró el directorio de bundles MSI.');
  }
} catch (error) {
  console.error('[ERROR] Error durante la compilación o renombrado:', error.message);
  process.exit(1);
}
