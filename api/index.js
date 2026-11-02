// Point d'entrée Vercel : toutes les adresses du site passent par cette fonction
// (pages, API, QR code). Les fichiers de public/ sont servis directement par Vercel.
import { handleRequest } from '../server/index.js';
import { db } from '../server/db.js';
import { pending } from '../server/notify.js';

export default async function handler(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Plusieurs copies de la fonction peuvent tourner : on relit les données à jour
  if (pathname.startsWith('/api/') || pathname.startsWith('/qr')) await db.load();
  // La réponse ne part qu'une fois les enregistrements et les e-mails terminés :
  // Vercel arrête la fonction juste après.
  const end = res.end.bind(res);
  let ended = null;
  res.end = (...args) => {
    ended = Promise.allSettled([db.queue, ...pending]).then(() => end(...args));
    return res;
  };
  await handleRequest(req, res);
  if (ended) await ended;
}
