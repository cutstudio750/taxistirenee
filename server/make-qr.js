// Génère le QR code permanent pour l'imprimeur : npm run qr
// Il contient <SITE_URL>/qr ; la destination se règle ensuite dans /chauffeur.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { brandedQrSvg, qrUrl, QR_THEMES } from './qr.js';

const dir = path.join(ROOT, 'qr');
await mkdir(dir, { recursive: true });
for (const theme of QR_THEMES) {
  const file = path.join(dir, `qr-code-taxi-saint-irenee-${theme}.svg`);
  await writeFile(file, brandedQrSvg(qrUrl(), { theme }));
  console.log(`QR code créé : ${file}`);
}
console.log(`Il mène à ${qrUrl()} (adresse définie par SITE_URL = ${config.siteUrl}).`);
