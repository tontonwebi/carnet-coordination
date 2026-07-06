/* ==========================================================================
   Carnet de coordination  (V2 "application")
   Vanilla JS, aucune dépendance. Données dans un fichier .json partagé
   (Drive) via File System Access API, avec cache localStorage.
   ========================================================================== */

'use strict';

/* ------------------- Stockage cloud (Cloudflare KV) + verrou ------------- */
/* Les données vivent dans Cloudflare KV, via /api/data. Le mot de passe est
   vérifié CÔTÉ SERVEUR : le code public ne contient que le "sel", jamais
   l'empreinte attendue (variable secrète APP_PW_HASH). Le navigateur envoie
   l'empreinte de ce que l'utilisateur tape ; le serveur décide. */
const API_URL = '/api/data';
const GATE_SALT = 'carnetcoord::v1::';
const AUTH_KEY = 'carnetAuth';

let cloudMode = false;         // vrai si l'API cloud répond et l'accès est validé
let serverUpdatedAt = 0;       // horodatage de la version en base (anti-écrasement)
let cloudSaving = false;
let cloudDirty = false;
let saveTimer = null;
let pollTimer = null;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function authToken() { return sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY) || ''; }
function setAuthToken(h, remember) { (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, h); }
function clearAuthToken() { sessionStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_KEY); }

function apiGet(token) {
  return fetch(API_URL, { cache: 'no-store', headers: { 'x-auth': token || authToken() } });
}
function apiPut(token) {
  return fetch(API_URL, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-auth': token || authToken(),
      'x-base-updated': String(serverUpdatedAt)
    },
    body: JSON.stringify(data)
  });
}

/* Applique un document reçu du serveur (ou {empty:true}). */
function applyCloudDoc(d) {
  if (d && !d.empty) { data = normalize(d); serverUpdatedAt = data.updatedAt || 0; }
  else { data = normalize({}); serverUpdatedAt = 0; }
  cloudMode = true;
  persistLocal();
  renderAll();
  updateSyncUI('saved');
}

async function setupGate() {
  const gate = document.getElementById('gate');
  if (!gate) return;
  const pwd = document.getElementById('gatePwd');
  const err = document.getElementById('gateError');
  const btn = document.getElementById('gateBtn');
  const remember = document.getElementById('gateRemember');

  // Tentative automatique avec un jeton déjà mémorisé
  if (authToken()) {
    try {
      const r = await apiGet();
      if (r.status === 200) { applyCloudDoc(await r.json()); gate.classList.add('hidden'); startPolling(); return; }
    } catch (e) { /* réseau indisponible : on affiche le verrou */ }
    clearAuthToken();
  }

  async function submit() {
    err.textContent = 'Vérification…';
    let h;
    try { h = await sha256Hex(GATE_SALT + pwd.value); }
    catch { err.textContent = 'Erreur navigateur (contexte non sécurisé).'; return; }
    let r;
    try { r = await apiGet(h); }
    catch { err.textContent = 'Serveur injoignable. Réessayez.'; return; }
    if (r.status === 200) {
      setAuthToken(h, remember.checked);
      applyCloudDoc(await r.json());
      gate.classList.add('hidden');
      startPolling();
    } else if (r.status === 401) {
      err.textContent = 'Mot de passe incorrect.'; pwd.value = ''; pwd.focus();
    } else if (r.status === 503) {
      err.textContent = 'Protection non configurée côté serveur (variable APP_PW_HASH).';
    } else if (r.status === 500) {
      err.textContent = 'Stockage non configuré côté serveur (binding CARNET_KV).';
    } else {
      err.textContent = 'Erreur serveur (' + r.status + ').';
    }
  }

  btn.addEventListener('click', submit);
  pwd.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  setTimeout(() => pwd.focus(), 50);
}

/* ----------------------------- Constantes ------------------------------- */
const STORAGE_KEY = 'carnetCoordV2';

const DOMAINES = [
  'Communication', 'Autonomie', 'Habiletés sociales',
  'Motricité', 'Comportements adaptatifs', 'Bien-être'
];
const ROLES = ['Famille', 'IME', 'Orthophoniste', 'Psychomotricien', 'Éducateur', 'Enseignant', 'Autre'];
const COULEURS = ['#d67ea1', '#b98fd0', '#e39aa8', '#c9849c', '#8fb0d6', '#e0a86f', '#7bb59a', '#c58fb0'];

const STATUT_COLORS = { 3: '#6f9c5f', 2: '#c9a94a', 1: '#c9736f' };

/* Jeu d'exemple (effaçable) affiché au tout premier lancement. */
function exampleData() {
  const iFamille = uid(), iOrtho = uid(), iIme = uid();
  const oPod = uid(), oHabillage = uid(), oJeu = uid();
  const today = new Date();
  const d = (offset) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  return {
    updatedAt: Date.now(),
    intervenants: [
      { id: iFamille, nom: 'Famille', role: 'Famille', couleur: COULEURS[0] },
      { id: iOrtho, nom: 'Marie (orthophoniste)', role: 'Orthophoniste', couleur: COULEURS[1] },
      { id: iIme, nom: 'IME', role: 'IME', couleur: COULEURS[3] }
    ],
    objectifs: [
      { id: oPod, titre: 'Demander à boire avec le POD', domaine: 'Communication', priorite: 'Haute',
        pourquoi: 'Développer la demande spontanée.', methode: 'Proposer le POD à chaque repas.',
        criteres: 'Utilise le POD sans guidance 3 fois sur 5.' },
      { id: oHabillage, titre: "S'habiller seule le matin", domaine: 'Autonomie', priorite: 'Moyenne',
        pourquoi: 'Gagner en autonomie.', methode: 'Séquence en images.', criteres: 'Met son manteau seule.' },
      { id: oJeu, titre: 'Jouer à tour de rôle', domaine: 'Habiletés sociales', priorite: 'Basse',
        pourquoi: 'Favoriser les interactions.', methode: 'Jeux de société adaptés.', criteres: 'Attend son tour.' }
    ],
    suivi: [
      { id: uid(), date: d(1), intervenantId: iOrtho, objectifId: oPod, statut: '🟢 Réussi / progrès', obs: 'A demandé le verre avec le POD.' },
      { id: uid(), date: d(5), intervenantId: iFamille, objectifId: oPod, statut: '🟡 En cours', obs: 'Guidance légère nécessaire.' },
      { id: uid(), date: d(9), intervenantId: iOrtho, objectifId: oPod, statut: '🔴 Difficulté', obs: 'Peu d\'initiation ce jour.' },
      { id: uid(), date: d(3), intervenantId: iFamille, objectifId: oHabillage, statut: '🟢 Réussi / progrès', obs: 'A mis son manteau seule.' }
    ],
    astuces: [
      { id: uid(), date: d(2), auteurId: iOrtho, objectifId: oPod, texte: 'Laisser 10 secondes de silence avant de reformuler.' }
    ],
    questions: [
      { id: uid(), texte: 'Faut-il ajouter un pictogramme "encore" dans le POD ?', quiId: iOrtho, statut: 'Ouverte', decision: '' }
    ],
    reunions: [
      { id: uid(), date: d(-14), titre: 'Réunion PAP avec l\'IME', type: 'PAP', note: 'Bilan trimestriel.' }
    ]
  };
}

/* ------------------------------- État ----------------------------------- */
let data = loadInitial();
const form = {};                 // sélections transitoires des groupes de boutons

/* ----------------------------- Utilitaires ------------------------------ */
function uid() { return 'id' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysSince(iso) {
  if (!iso) return Infinity;
  const diff = Date.now() - new Date(iso + 'T00:00:00').getTime();
  return Math.floor(diff / 86400000);
}
function statutValue(s) { return s && s.includes('🟢') ? 3 : s && s.includes('🟡') ? 2 : 1; }
function statutClass(s) { return s && s.includes('🟢') ? 'vert' : s && s.includes('🟡') ? 'orange' : 'rouge'; }
function domainClass(d) {
  d = d || '';
  return d.includes('Communication') ? 'com'
    : d.includes('Autonomie') ? 'auto'
    : d.includes('social') ? 'social'
    : d.includes('Motricité') ? 'moteur'
    : d.includes('Comportement') ? 'comport' : 'bien';
}

function objName(id) { const o = data.objectifs.find(x => x.id === id); return o ? o.titre : '—'; }
function interById(id) { return data.intervenants.find(x => x.id === id) || null; }
function interName(id) { const i = interById(id); return i ? i.nom : '—'; }
function interColor(id) { const i = interById(id); return i ? i.couleur : '#ccc'; }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ------------------------- Chargement / migration ----------------------- */
function loadInitial() {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    if (v2) return normalize(JSON.parse(v2));
  } catch (e) { /* ignore */ }
  return exampleData();
}

/* Rend n'importe quel format (V1 ou V2) canonique. */
function normalize(raw) {
  raw = raw || {};
  const out = {
    updatedAt: raw.updatedAt || Date.now(),
    intervenants: Array.isArray(raw.intervenants) ? raw.intervenants.slice() : [],
    objectifs: [], suivi: [], astuces: [], questions: [],
    reunions: Array.isArray(raw.reunions) ? raw.reunions.slice() : []
  };

  // Objectifs
  (raw.objectifs || []).forEach(o => {
    out.objectifs.push({
      id: String(o.id || uid()), titre: o.titre || '', domaine: o.domaine || DOMAINES[0],
      priorite: o.priorite || 'Moyenne', pourquoi: o.pourquoi || '', methode: o.methode || '',
      criteres: o.criteres || ''
    });
  });

  // Index par titre pour la migration des séances V1
  const objByTitle = {};
  out.objectifs.forEach(o => { objByTitle[o.titre] = o.id; });

  // Résolution "nom d'intervenant" -> id (crée l'intervenant si absent)
  const interByName = {};
  out.intervenants.forEach(i => { i.id = String(i.id || uid()); interByName[i.nom] = i.id; });
  function resolveInter(name) {
    if (!name) return null;
    if (interByName[name]) return interByName[name];
    const id = uid();
    out.intervenants.push({ id, nom: name, role: 'Autre', couleur: COULEURS[out.intervenants.length % COULEURS.length] });
    interByName[name] = id;
    return id;
  }

  // Séances
  (raw.suivi || []).forEach(s => {
    out.suivi.push({
      id: String(s.id || uid()), date: s.date || todayISO(),
      intervenantId: s.intervenantId || resolveInter(s.intervenant),
      objectifId: s.objectifId || objByTitle[s.objectif] || null,
      statut: s.statut || '🟡 En cours', obs: s.obs || ''
    });
  });

  // Astuces
  (raw.astuces || []).forEach(a => {
    out.astuces.push({
      id: String(a.id || uid()), date: a.date || todayISO(),
      auteurId: a.auteurId || resolveInter(a.auteur),
      objectifId: a.objectifId || objByTitle[a.objectif] || null,
      texte: a.texte || ''
    });
  });

  // Questions
  (raw.questions || []).forEach(q => {
    out.questions.push({
      id: String(q.id || uid()), texte: q.texte || '',
      quiId: q.quiId || resolveInter(q.qui),
      statut: q.statut === 'Traitée' || q.statut === 'Décidée' ? q.statut : 'Ouverte',
      decision: q.decision || ''
    });
  });

  // Réunions
  out.reunions = out.reunions.map(r => ({
    id: String(r.id || uid()), date: r.date || todayISO(),
    titre: r.titre || '', type: r.type || 'Point', note: r.note || ''
  }));

  return out;
}

/* ------------------------------ Persistance ----------------------------- */
function persistLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
}
function save() {
  data.updatedAt = Date.now();
  persistLocal();
  renderAll();
  scheduleCloudSave();
}
function scheduleCloudSave() {
  if (!cloudMode) { updateSyncUI('local'); return; }
  cloudDirty = true;
  updateSyncUI('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runCloudSave, 1000);
}
async function runCloudSave() {
  if (!cloudMode || cloudSaving) return;
  cloudSaving = true; cloudDirty = false;
  updateSyncUI('saving');
  try {
    const r = await apiPut();
    if (r.status === 409) {
      const res = await r.json();
      data = normalize(res.data); serverUpdatedAt = data.updatedAt || 0;
      persistLocal(); renderAll();
      updateSyncUI('saved');
      toast('Données mises à jour ailleurs — rechargées.');
      cloudDirty = false;
    } else if (r.ok) {
      const res = await r.json();
      serverUpdatedAt = res.updatedAt || Date.now();
      data.updatedAt = serverUpdatedAt;
      updateSyncUI('saved');
    } else if (r.status === 401) {
      updateSyncUI('error'); toast('Session expirée — rechargez la page pour vous reconnecter.');
    } else {
      updateSyncUI('error');
    }
  } catch (e) { updateSyncUI('error'); }
  cloudSaving = false;
  if (cloudDirty) scheduleCloudSave();
}
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollCloud, 15000);
}
async function pollCloud() {
  if (!cloudMode || cloudSaving || cloudDirty) return;
  try {
    const r = await apiGet();
    if (!r.ok) return;
    const d = await r.json();
    if (d && !d.empty && d.updatedAt && d.updatedAt > serverUpdatedAt) {
      data = normalize(d); serverUpdatedAt = data.updatedAt;
      persistLocal(); renderAll();
      updateSyncUI('saved');
    }
  } catch (e) { /* silencieux */ }
}
function updateSyncUI(state) {
  const el = document.getElementById('syncState');
  if (!el) return;
  const map = {
    saved:   '☁️ Synchronisé',
    saving:  '⏳ Enregistrement…',
    pending: '✏️ Modifié…',
    error:   '⚠️ Erreur de synchro',
    local:   '💾 Local (non synchronisé)'
  };
  el.textContent = map[state] || '';
  el.classList.toggle('dirty', state === 'error');
}

/* -------------------------- Navigation onglets -------------------------- */
function showTab(id) {
  document.querySelectorAll('section').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* --------------------- Groupes de boutons (choix) ----------------------- */
function wireGroup(id, attr, key) {
  const c = document.getElementById(id);
  if (!c) return;
  c.addEventListener('click', e => {
    const b = e.target.closest('.choice');
    if (!b || !c.contains(b)) return;
    c.querySelectorAll('.choice').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    form[key] = b.getAttribute(attr);
  });
}
function fillChoices(id, items) {
  const c = document.getElementById(id);
  if (!c) return;
  c.innerHTML = items.length
    ? items.map(i => `<button type="button" class="choice ${i.cls || ''}" data-value="${esc(i.value)}">${i.label}</button>`).join('')
    : '<span class="small empty">Aucun élément — ajoutez-en d\'abord.</span>';
}
function clearGroup(id, key) {
  const c = document.getElementById(id);
  if (c) c.querySelectorAll('.choice').forEach(x => x.classList.remove('selected'));
  if (key) form[key] = null;
}
function selectGroupValue(id, attr, key, value) {
  const c = document.getElementById(id);
  if (!c) { form[key] = null; return; }
  let found = null;
  c.querySelectorAll('.choice').forEach(x => {
    const m = x.getAttribute(attr) === String(value);
    x.classList.toggle('selected', m);
    if (m) found = value;
  });
  form[key] = found;
}

/* ------------------------------ Objectifs ------------------------------- */
function openObjModal(id) {
  document.getElementById('objModalTitle').textContent = id ? 'Modifier l\'objectif' : 'Ajouter un objectif';
  const o = id ? data.objectifs.find(x => x.id === id) : null;
  document.getElementById('oId').value = id || '';
  document.getElementById('oTitre').value = o ? o.titre : '';
  document.getElementById('oPourquoi').value = o ? o.pourquoi : '';
  document.getElementById('oMethode').value = o ? o.methode : '';
  document.getElementById('oCriteres').value = o ? o.criteres : '';
  selectGroupValue('oDomaineChoices', 'data-value', 'oDomaine', o ? o.domaine : DOMAINES[0]);
  selectGroupValue('oPrioriteChoices', 'data-prio', 'oPrio', o ? o.priorite : 'Moyenne');
  openModal('objModal');
}
function editObjectif(id) { openObjModal(id); }
function saveObjectif() {
  const titre = document.getElementById('oTitre').value.trim();
  if (!titre) { toast('Indiquez un intitulé d\'objectif.'); return; }
  const id = document.getElementById('oId').value;
  const rec = {
    titre,
    domaine: form.oDomaine || DOMAINES[0],
    priorite: form.oPrio || 'Moyenne',
    pourquoi: document.getElementById('oPourquoi').value.trim(),
    methode: document.getElementById('oMethode').value.trim(),
    criteres: document.getElementById('oCriteres').value.trim()
  };
  if (id) {
    Object.assign(data.objectifs.find(x => x.id === id), rec);
  } else {
    data.objectifs.push(Object.assign({ id: uid() }, rec));
  }
  closeModal('objModal');
  save();
  toast('Objectif enregistré ✔');
}
function deleteObjectif(id) {
  if (!confirm('Supprimer cet objectif ? Les séances associées seront détachées.')) return;
  data.objectifs = data.objectifs.filter(o => o.id !== id);
  data.suivi.forEach(s => { if (s.objectifId === id) s.objectifId = null; });
  data.astuces.forEach(a => { if (a.objectifId === id) a.objectifId = null; });
  save();
}

/* Mini-graphique SVG d'évolution des statuts. */
function sparkSVG(entries) {
  if (!entries.length) return '<div class="spark-empty">Pas encore de séance enregistrée.</div>';
  const W = 260, H = 54, pad = 9;
  const vals = entries.map(e => statutValue(e.statut));
  const n = vals.length;
  const stepX = n > 1 ? (W - 2 * pad) / (n - 1) : 0;
  const y = v => H - pad - ((v - 1) / 2) * (H - 2 * pad);
  const coords = vals.map((v, i) => [pad + i * stepX, y(v)]);
  const path = coords.map((c, i) => (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ');
  const dots = coords.map((c, i) =>
    `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="4" fill="${STATUT_COLORS[vals[i]]}"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des statuts">
    <path d="${path}" fill="none" stroke="#b8c4ad" stroke-width="2"/>${dots}</svg>`;
}

function renderObjectifs() {
  const list = document.getElementById('objectiveList');
  if (!data.objectifs.length) { list.innerHTML = '<p class="empty">Aucun objectif enregistré pour le moment.</p>'; return; }
  list.innerHTML = data.objectifs.map(o => {
    const entries = data.suivi.filter(s => s.objectifId === o.id)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    return `<div class="card">
      <div class="row"><h3>${esc(o.titre)}</h3><div class="spacer"></div>
        <button class="btn ghost smallbtn" onclick="editObjectif('${o.id}')">✏️</button>
        <button class="btn ghost smallbtn" onclick="deleteObjectif('${o.id}')">🗑️</button></div>
      <div>
        <span class="tag ${domainClass(o.domaine)}">${esc(o.domaine)}</span>
        <span class="prio ${(o.priorite || '').toLowerCase()}">${esc(o.priorite || '')}</span>
      </div>
      ${o.pourquoi ? `<p class="small"><strong>Pourquoi :</strong> ${esc(o.pourquoi)}</p>` : ''}
      ${o.methode ? `<p class="small"><strong>Méthode :</strong> ${esc(o.methode)}</p>` : ''}
      ${o.criteres ? `<p class="small"><strong>Réussite :</strong> ${esc(o.criteres)}</p>` : ''}
      <div class="small mt"><strong>Évolution</strong> — ${entries.length} séance${entries.length > 1 ? 's' : ''}</div>
      ${sparkSVG(entries)}
    </div>`;
  }).join('');
}

/* ------------------------------- Suivi ---------------------------------- */
function addSuivi() {
  if (!form.sObjectif) { toast('Choisissez l\'objectif travaillé.'); return; }
  if (!form.sStatut) { toast('Choisissez un statut (🟢 / 🟡 / 🔴).'); return; }
  const statutLabel = { '🟢': '🟢 Réussi / progrès', '🟡': '🟡 En cours', '🔴': '🔴 Difficulté' }[form.sStatut];
  data.suivi.unshift({
    id: uid(),
    date: document.getElementById('sDate').value || todayISO(),
    intervenantId: form.sIntervenant || null,
    objectifId: form.sObjectif,
    statut: statutLabel,
    obs: document.getElementById('sObs').value.trim()
  });
  document.getElementById('sObs').value = '';
  clearGroup('sStatutChoices', 'sStatut');
  save();
  toast('Séance enregistrée ✔');
}
function deleteSuivi(id) {
  data.suivi = data.suivi.filter(s => s.id !== id);
  save();
}
function renderSuivi() {
  const tb = document.getElementById('suiviTable');
  tb.innerHTML = data.suivi.length ? data.suivi.map(s => `<tr>
    <td>${esc(s.date)}</td>
    <td>${s.intervenantId ? personChip(s.intervenantId) : '—'}</td>
    <td>${esc(objName(s.objectifId))}</td>
    <td><span class="status ${statutClass(s.statut)}">${esc(s.statut)}</span></td>
    <td>${esc(s.obs)}</td>
    <td><button class="btn ghost smallbtn" onclick="deleteSuivi('${s.id}')">🗑️</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Aucune séance enregistrée.</td></tr>';
}

function personChip(id) {
  const i = interById(id);
  if (!i) return '—';
  return `<span class="person-chip"><span class="dot" style="background:${esc(i.couleur)}"></span>${esc(i.nom)}</span>`;
}

/* --------------------------- Qui fait quoi ------------------------------ */
function openInterModal(id) {
  document.getElementById('interModalTitle').textContent = id ? 'Modifier l\'intervenant' : 'Ajouter un intervenant';
  const i = id ? interById(id) : null;
  document.getElementById('iId').value = id || '';
  document.getElementById('iNom').value = i ? i.nom : '';
  selectGroupValue('iRoleChoices', 'data-value', 'iRole', i ? i.role : ROLES[0]);
  selectGroupValue('iCouleurChoices', 'data-value', 'iCouleur', i ? i.couleur : COULEURS[data.intervenants.length % COULEURS.length]);
  openModal('interModal');
}
function editIntervenant(id) { openInterModal(id); }
function saveIntervenant() {
  const nom = document.getElementById('iNom').value.trim();
  if (!nom) { toast('Indiquez un nom.'); return; }
  const id = document.getElementById('iId').value;
  const rec = { nom, role: form.iRole || ROLES[0], couleur: form.iCouleur || COULEURS[0] };
  if (id) Object.assign(interById(id), rec);
  else data.intervenants.push(Object.assign({ id: uid() }, rec));
  closeModal('interModal');
  save();
  toast('Intervenant enregistré ✔');
}
function deleteIntervenant(id) {
  if (!confirm('Supprimer cet intervenant ?')) return;
  data.intervenants = data.intervenants.filter(i => i.id !== id);
  save();
}
function renderQuiFaitQuoi() {
  const list = document.getElementById('intervenantList');
  list.innerHTML = data.intervenants.length ? data.intervenants.map(i => {
    const nb = data.suivi.filter(s => s.intervenantId === i.id).length;
    return `<div class="card">
      <div class="row"><h3><span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(i.couleur)}"></span> ${esc(i.nom)}</h3>
        <div class="spacer"></div>
        <button class="btn ghost smallbtn" onclick="editIntervenant('${i.id}')">✏️</button>
        <button class="btn ghost smallbtn" onclick="deleteIntervenant('${i.id}')">🗑️</button></div>
      <span class="tag">${esc(i.role)}</span>
      <p class="small mt">${nb} séance${nb > 1 ? 's' : ''} enregistrée${nb > 1 ? 's' : ''}.</p>
    </div>`;
  }).join('') : '<p class="empty">Aucun intervenant. Ajoutez-en pour construire la matrice.</p>';

  // Matrice objectif × intervenant
  const head = document.getElementById('matrixHead');
  const body = document.getElementById('matrixBody');
  if (!data.objectifs.length || !data.intervenants.length) {
    head.innerHTML = ''; body.innerHTML = '<tr><td class="empty">Ajoutez des objectifs et des intervenants pour voir la matrice.</td></tr>';
    return;
  }
  head.innerHTML = '<tr><th class="obj-name">Objectif</th>' +
    data.intervenants.map(i => `<th title="${esc(i.nom)}"><span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(i.couleur)}"></span></th>`).join('') + '</tr>';
  body.innerHTML = data.objectifs.map(o => {
    const cells = data.intervenants.map(i => {
      const nb = data.suivi.filter(s => s.objectifId === o.id && s.intervenantId === i.id).length;
      return `<td>${nb ? `<span class="check">✔</span><br><span class="small">${nb}</span>` : '<span class="small muted">·</span>'}</td>`;
    }).join('');
    return `<tr><td class="obj-name">${esc(o.titre)}</td>${cells}</tr>`;
  }).join('');
}

/* ----------------------------- Calendrier ------------------------------- */
function openReunionModal(id) {
  document.getElementById('reunionModalTitle').textContent = id ? 'Modifier' : 'Ajouter une réunion / échéance';
  const r = id ? data.reunions.find(x => x.id === id) : null;
  document.getElementById('rId').value = id || '';
  document.getElementById('rDate').value = r ? r.date : todayISO();
  document.getElementById('rTitre').value = r ? r.titre : '';
  document.getElementById('rNote').value = r ? r.note : '';
  selectGroupValue('rTypeChoices', 'data-type', 'rType', r ? r.type : 'PAP');
  openModal('reunionModal');
}
function editReunion(id) { openReunionModal(id); }
function saveReunion() {
  const titre = document.getElementById('rTitre').value.trim();
  if (!titre) { toast('Indiquez un titre.'); return; }
  const id = document.getElementById('rId').value;
  const rec = {
    date: document.getElementById('rDate').value || todayISO(),
    titre, type: form.rType || 'Point',
    note: document.getElementById('rNote').value.trim()
  };
  if (id) Object.assign(data.reunions.find(x => x.id === id), rec);
  else data.reunions.push(Object.assign({ id: uid() }, rec));
  closeModal('reunionModal');
  save();
  toast('Réunion enregistrée ✔');
}
function deleteReunion(id) {
  data.reunions = data.reunions.filter(r => r.id !== id);
  save();
}
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function calItem(r) {
  const [y, m, d] = r.date.split('-');
  const cls = r.type === 'PAP' ? 'pap' : r.type === 'Échéance' ? 'echeance' : '';
  return `<div class="cal-item ${cls} ${r.date < todayISO() ? 'past' : ''}">
    <div class="cal-date"><div class="d">${d}</div><div class="m">${MOIS[parseInt(m, 10) - 1]}</div></div>
    <div style="flex:1">
      <div class="row"><strong>${esc(r.titre)}</strong> <span class="tag">${esc(r.type)}</span>
        <div class="spacer"></div>
        <button class="btn ghost smallbtn" onclick="editReunion('${r.id}')">✏️</button>
        <button class="btn ghost smallbtn" onclick="deleteReunion('${r.id}')">🗑️</button></div>
      <div class="small">${esc(r.date)}${r.note ? ' — ' + esc(r.note) : ''}</div>
    </div>
  </div>`;
}
function renderCalendrier() {
  const t = todayISO();
  const sorted = data.reunions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const future = sorted.filter(r => r.date >= t);
  const past = sorted.filter(r => r.date < t).reverse();
  document.getElementById('calFuture').innerHTML = future.length ? future.map(calItem).join('') : '<p class="empty">Aucune réunion à venir.</p>';
  document.getElementById('calPast').innerHTML = past.length ? past.map(calItem).join('') : '<p class="empty">Aucune réunion passée.</p>';
}

/* ------------------------------- Astuces -------------------------------- */
function addAstuce() {
  const texte = document.getElementById('aTexte').value.trim();
  if (!texte) { toast('Écrivez l\'astuce.'); return; }
  data.astuces.unshift({
    id: uid(), date: todayISO(),
    auteurId: form.aAuteur || null,
    objectifId: form.aObjectif || null,
    texte
  });
  document.getElementById('aTexte').value = '';
  save();
  toast('Astuce ajoutée ✔');
}
function deleteAstuce(id) { data.astuces = data.astuces.filter(a => a.id !== id); save(); }
function renderAstuces() {
  const list = document.getElementById('astuceList');
  list.innerHTML = data.astuces.length ? data.astuces.map(a => `<div class="card">
    <div class="row"><h3>${a.objectifId ? esc(objName(a.objectifId)) : '💡 Astuce'}</h3><div class="spacer"></div>
      <button class="btn ghost smallbtn" onclick="deleteAstuce('${a.id}')">🗑️</button></div>
    <p>${esc(a.texte)}</p>
    <p class="small">${esc(a.date)}${a.auteurId ? ' — ' + esc(interName(a.auteurId)) : ''}</p>
  </div>`).join('') : '<p class="empty">Aucune astuce partagée.</p>';
}

/* ------------------------------ Questions ------------------------------- */
function addQuestion() {
  const texte = document.getElementById('qTexte').value.trim();
  if (!texte) { toast('Écrivez la question.'); return; }
  data.questions.unshift({ id: uid(), texte, quiId: form.qQui || null, statut: 'Ouverte', decision: '' });
  document.getElementById('qTexte').value = '';
  clearGroup('qQuiChoices', 'qQui');
  save();
  toast('Question ajoutée ✔');
}
function cycleQuestion(id) {
  const q = data.questions.find(x => x.id === id);
  const order = ['Ouverte', 'Traitée', 'Décidée'];
  q.statut = order[(order.indexOf(q.statut) + 1) % order.length];
  save();
}
function setDecision(id, value) {
  const q = data.questions.find(x => x.id === id);
  if (q) { q.decision = value; data.updatedAt = Date.now(); persistLocal(); scheduleCloudSave(); renderDashboard(); }
}
function deleteQuestion(id) { data.questions = data.questions.filter(q => q.id !== id); save(); }
function renderQuestions() {
  const tb = document.getElementById('qTable');
  tb.innerHTML = data.questions.length ? data.questions.map(q => {
    const statutCls = q.statut === 'Décidée' ? 'vert' : q.statut === 'Traitée' ? 'orange' : 'rouge';
    const decisionRow = q.statut === 'Décidée'
      ? `<br><input placeholder="Décision prise…" value="${esc(q.decision)}" onchange="setDecision('${q.id}', this.value)" style="margin-top:6px">`
      : '';
    return `<tr>
      <td>${esc(q.texte)}${decisionRow}</td>
      <td>${q.quiId ? esc(interName(q.quiId)) : '—'}</td>
      <td><button class="btn smallbtn ${statutCls === 'vert' ? '' : 'secondary'}" onclick="cycleQuestion('${q.id}')">${esc(q.statut)}</button></td>
      <td><button class="btn ghost smallbtn" onclick="deleteQuestion('${q.id}')">🗑️</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">Aucune question.</td></tr>';
}

/* --------------------------- Tableau de bord ---------------------------- */
function lastSeanceDate(objId) {
  const dates = data.suivi.filter(s => s.objectifId === objId).map(s => s.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
function renderDashboard() {
  document.getElementById('kpiObj').textContent = data.objectifs.length;
  document.getElementById('kpiObs').textContent = data.suivi.length;
  document.getElementById('kpiAst').textContent = data.astuces.length;
  document.getElementById('kpiQ').textContent = data.questions.filter(q => q.statut === 'Ouverte').length;

  // Objectifs peu travaillés
  const seuil = parseInt(document.getElementById('seuilJours').value, 10);
  const peu = data.objectifs.map(o => ({ o, last: lastSeanceDate(o.id) }))
    .filter(x => daysSince(x.last) > seuil)
    .sort((a, b) => daysSince(b.last) - daysSince(a.last));
  document.getElementById('peuTravailles').innerHTML = peu.length ? peu.map(({ o, last }) => {
    const j = last ? daysSince(last) : null;
    return `<div class="card alert">
      <h3>${esc(o.titre)}</h3>
      <span class="tag ${domainClass(o.domaine)}">${esc(o.domaine)}</span>
      <span class="prio ${(o.priorite || '').toLowerCase()}">${esc(o.priorite || '')}</span>
      <p class="small mt">${last ? `Dernière séance il y a <strong>${j} jours</strong> (${esc(last)}).` : '<strong>Jamais travaillé</strong> pour le moment.'}</p>
    </div>`;
  }).join('') : '<p class="empty">👍 Tous les objectifs ont été travaillés récemment.</p>';

  // Réussites récentes (🟢) / vigilance (🔴)
  const recent = data.suivi.slice().sort((a, b) => b.date.localeCompare(a.date));
  const rea = recent.filter(s => s.statut.includes('🟢')).slice(0, 5);
  const vig = recent.filter(s => s.statut.includes('🔴')).slice(0, 5);
  document.getElementById('reussites').innerHTML = rea.length
    ? rea.map(s => `<p class="small">✅ ${esc(objName(s.objectifId))} <span class="muted">(${esc(s.date)})</span></p>`).join('')
    : '<p class="small empty">Aucune pour l\'instant.</p>';
  document.getElementById('vigilance').innerHTML = vig.length
    ? vig.map(s => `<p class="small">🔴 ${esc(objName(s.objectifId))} <span class="muted">(${esc(s.date)})</span>${s.obs ? ' — ' + esc(s.obs) : ''}</p>`).join('')
    : '<p class="small empty">Aucun point de vigilance.</p>';

  // Décisions
  const dec = data.questions.filter(q => q.statut === 'Décidée' && q.decision);
  document.getElementById('decisions').innerHTML = dec.length
    ? dec.map(q => `<p class="small">🧩 <strong>${esc(q.texte)}</strong><br>→ ${esc(q.decision)}</p>`).join('')
    : '<p class="small empty">Aucune décision enregistrée.</p>';
}

/* ----------------------------- Synthèse PAP ----------------------------- */
function generateSynthese() {
  let t = 'SYNTHÈSE DE COORDINATION\n';
  t += 'Généré le ' + new Date().toLocaleDateString('fr-FR') + '\n\n';

  t += '── OBJECTIFS EN COURS ──\n';
  data.objectifs.forEach(o => {
    const entries = data.suivi.filter(s => s.objectifId === o.id);
    const last = lastSeanceDate(o.id);
    t += `• ${o.titre} (${o.domaine}, priorité ${o.priorite})\n`;
    if (o.pourquoi) t += `   Pourquoi : ${o.pourquoi}\n`;
    if (o.criteres) t += `   Réussite visée : ${o.criteres}\n`;
    t += `   Séances : ${entries.length}${last ? ` — dernière le ${last}` : ' — jamais travaillé'}\n`;
  });

  const seuil = parseInt(document.getElementById('seuilJours').value, 10);
  const peu = data.objectifs.filter(o => daysSince(lastSeanceDate(o.id)) > seuil);
  if (peu.length) {
    t += `\n── OBJECTIFS PEU TRAVAILLÉS (> ${seuil} j) ──\n`;
    peu.forEach(o => t += `• ${o.titre}\n`);
  }

  t += '\n── OBSERVATIONS RÉCENTES ──\n';
  data.suivi.slice(0, 15).forEach(s => {
    t += `• ${s.date} | ${interName(s.intervenantId)} | ${objName(s.objectifId)} | ${s.statut}${s.obs ? ' : ' + s.obs : ''}\n`;
  });

  t += '\n── ASTUCES QUI FONCTIONNENT ──\n';
  data.astuces.forEach(a => t += `• ${a.texte}${a.auteurId ? ' (' + interName(a.auteurId) + ')' : ''}\n`);

  const dec = data.questions.filter(q => q.statut === 'Décidée' && q.decision);
  if (dec.length) {
    t += '\n── DÉCISIONS ──\n';
    dec.forEach(q => t += `• ${q.texte} → ${q.decision}\n`);
  }

  t += '\n── QUESTIONS À DISCUTER ──\n';
  data.questions.filter(q => q.statut === 'Ouverte').forEach(q =>
    t += `• ${q.texte}${q.quiId ? ' (réponse attendue : ' + interName(q.quiId) + ')' : ''}\n`);

  const future = data.reunions.filter(r => r.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date));
  if (future.length) {
    t += '\n── PROCHAINES RÉUNIONS / ÉCHÉANCES ──\n';
    future.forEach(r => t += `• ${r.date} — ${r.titre} (${r.type})${r.note ? ' : ' + r.note : ''}\n`);
  }

  document.getElementById('syntheseText').value = t;
  toast('Synthèse générée ✔');
}
function copySynthese() {
  const el = document.getElementById('syntheseText');
  if (!el.value) generateSynthese();
  el.select();
  if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast('Copié ✔'), () => toast('Sélectionnez et copiez manuellement.'));
  else { document.execCommand('copy'); toast('Copié ✔'); }
}

/* --------------------- Sauvegarde / restauration ------------------------ */
/* Le stockage principal est le cloud (Cloudflare KV). Ces boutons servent de
   filet de sécurité : télécharger une copie, restaurer, ou tout réinitialiser. */
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'carnet_coordination.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Sauvegarde téléchargée ✔');
}
function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      data = normalize(JSON.parse(reader.result));
      persistLocal(); renderAll();
      scheduleCloudSave();
      toast('Données restaurées ✔');
    } catch (err) { toast('Fichier illisible.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}
function resetData() {
  if (!confirm('Réinitialiser toutes les données ? (Téléchargez une sauvegarde d\'abord si besoin.)')) return;
  data = normalize({});
  persistLocal(); renderAll();
  scheduleCloudSave();
  toast('Données réinitialisées.');
}

/* ------------------------------- Modales -------------------------------- */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ------------------------------- Rendu ---------------------------------- */
function refreshDynamicChoices() {
  const persons = data.intervenants.map(i => ({
    value: i.id, label: `<span class="dot" style="background:${esc(i.couleur)}"></span> ${esc(i.nom)}`
  }));
  const objs = data.objectifs.map(o => ({ value: o.id, label: esc(o.titre) }));
  fillChoices('sIntervenantChoices', persons);
  fillChoices('aAuteurChoices', persons);
  fillChoices('qQuiChoices', persons);
  fillChoices('sObjectifChoices', objs);
  fillChoices('aObjectifChoices', objs);
}
function renderAll() {
  refreshDynamicChoices();
  renderDashboard();
  renderObjectifs();
  renderSuivi();
  renderQuiFaitQuoi();
  renderCalendrier();
  renderAstuces();
  renderQuestions();
}

/* ---------------------------- Initialisation ---------------------------- */
function init() {
  // Navigation
  document.getElementById('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  // Groupes statiques (constantes)
  fillChoices('oDomaineChoices', DOMAINES.map(d => ({ value: d, label: d })));
  fillChoices('iRoleChoices', ROLES.map(r => ({ value: r, label: r })));
  fillChoices('iCouleurChoices', COULEURS.map(c => ({
    value: c, label: `<span class="dot" style="background:${c};width:16px;height:16px"></span>`
  })));

  // Câblage des groupes de boutons
  wireGroup('sIntervenantChoices', 'data-value', 'sIntervenant');
  wireGroup('sObjectifChoices', 'data-value', 'sObjectif');
  wireGroup('sStatutChoices', 'data-status', 'sStatut');
  wireGroup('aAuteurChoices', 'data-value', 'aAuteur');
  wireGroup('aObjectifChoices', 'data-value', 'aObjectif');
  wireGroup('qQuiChoices', 'data-value', 'qQui');
  wireGroup('oDomaineChoices', 'data-value', 'oDomaine');
  wireGroup('oPrioriteChoices', 'data-prio', 'oPrio');
  wireGroup('iRoleChoices', 'data-value', 'iRole');
  wireGroup('iCouleurChoices', 'data-value', 'iCouleur');
  wireGroup('rTypeChoices', 'data-type', 'rType');

  // Seuil du tableau de bord
  document.getElementById('seuilJours').addEventListener('change', renderDashboard);

  // Fermer les modales en cliquant sur le fond
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });

  // Date du jour par défaut
  document.getElementById('sDate').value = todayISO();

  // Rendu initial (derrière le verrou), puis authentification/chargement cloud
  renderAll();
  updateSyncUI('local');
  setupGate();
}

// Expose les fonctions appelées depuis le HTML (onclick)
Object.assign(window, {
  openObjModal, editObjectif, saveObjectif, deleteObjectif,
  addSuivi, deleteSuivi,
  openInterModal, editIntervenant, saveIntervenant, deleteIntervenant,
  openReunionModal, editReunion, saveReunion, deleteReunion,
  addAstuce, deleteAstuce,
  addQuestion, cycleQuestion, setDecision, deleteQuestion,
  generateSynthese, copySynthese,
  exportData, importData, resetData,
  openModal, closeModal
});

document.addEventListener('DOMContentLoaded', init);
