/* ==========================================================================
   Cloudflare Pages Function — point d'accès /api/data
   Stocke/charge le carnet complet (un seul document JSON) dans Cloudflare KV.

   Réglages à faire dans le tableau de bord Cloudflare Pages :
     • Binding KV  : nom  CARNET_KV   → un namespace KV que vous créez.
     • Variable secrète : APP_PW_HASH → l'empreinte SHA-256 (salée) du mot de
       passe partagé. Si elle est définie, l'API exige l'en-tête X-Auth = cette
       empreinte (protection côté serveur : le secret n'est jamais dans le code
       public). Tant qu'elle n'est pas définie, l'API refuse (503) par sécurité.
   ========================================================================== */

const KEY = 'carnet';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/* Refuse tant que le secret n'est pas configuré ; sinon compare l'en-tête. */
function authError(request, env) {
  if (!env.APP_PW_HASH) return json({ error: 'not_configured' }, 503);
  if (request.headers.get('x-auth') !== env.APP_PW_HASH) return json({ error: 'unauthorized' }, 401);
  return null;
}

export async function onRequestGet({ request, env }) {
  if (!env.CARNET_KV) return json({ error: 'kv_missing' }, 500);
  const err = authError(request, env);
  if (err) return err;
  const raw = await env.CARNET_KV.get(KEY);
  if (!raw) return json({ empty: true, updatedAt: 0 });
  return new Response(raw, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestPut({ request, env }) {
  if (!env.CARNET_KV) return json({ error: 'kv_missing' }, 500);
  const err = authError(request, env);
  if (err) return err;

  let incoming;
  try { incoming = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return json({ error: 'invalid_data' }, 400);
  }

  // Anti-écrasement : si la version stockée est plus récente que la base du client → conflit.
  const base = Number(request.headers.get('x-base-updated') || 0);
  const existingRaw = await env.CARNET_KV.get(KEY);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      if (existing.updatedAt && base && existing.updatedAt > base) {
        return json({ error: 'conflict', data: existing }, 409);
      }
    } catch { /* stockage corrompu : on écrase */ }
  }

  incoming.updatedAt = Date.now();
  await env.CARNET_KV.put(KEY, JSON.stringify(incoming));
  return json({ ok: true, updatedAt: incoming.updatedAt });
}

// POST traité comme PUT (compatibilité)
export const onRequestPost = onRequestPut;
