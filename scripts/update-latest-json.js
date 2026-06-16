import fs from 'fs';
import path from 'path';

try {
  const tauriConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const version = tauriConfig.version;

  const sigFile = `src-tauri/target/release/bundle/msi/Comparetica_${version}_x64.msi.sig`;
  if (!fs.existsSync(sigFile)) {
    console.error(`Error: Signature file not found at ${sigFile}`);
    process.exit(1);
  }

  const signature = fs.readFileSync(sigFile, 'utf8').trim();

  let notes = "Nueva versión disponible con mejoras legales y de estabilidad.";
  if (fs.existsSync('RELEASE_NOTES.md')) {
    const rawNotes = fs.readFileSync('RELEASE_NOTES.md', 'utf8');
    const lines = rawNotes.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    if (lines.length > 0) {
      notes = lines.join(' ');
      if (notes.length > 200) {
        notes = notes.substring(0, 197) + '...';
      }
    }
  }

  const latestJson = {
    version: version,
    notes: notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: signature,
        url: `https://github.com/MrTech0/Comparetica/releases/download/v${version}/Comparetica_${version}_x64.msi`
      }
    }
  };

  fs.writeFileSync('updates/latest.json', JSON.stringify(latestJson, null, 2), 'utf8');
  console.log(`Successfully generated updates/latest.json for version v${version}`);
} catch (err) {
  console.error("Error executing update-latest-json script:", err);
  process.exit(1);
}
