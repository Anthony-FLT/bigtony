// Kit TikTok des actus du jour — un carrousel de 7 images verticales (1080 × 1920), fabriqué juste après l'édition de 3 h :
//   1 couverture · 5 actus (illustration, rubrique, titre anglais, titre français, texte anglais facile) · 1 image d'appel vers l'app.
// Les images sont rangées dans Cloud Storage (dailyNews/{date}/social/…) et listées dans newsSocial/current.
// Une page privée (fonction newsKit, protégée par une clé dans l'adresse) les affiche avec la légende à copier.
// Chargé par dailyNews.js (buildSocialKit) et par index.js (newsKit) : Object.assign(exports, require("./newsSocial"));
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");
const path = require("path");

if (!getApps().length) initializeApp();
const REGION = "europe-west1";

const W = 1080, H = 1920;
// Zones que l'interface de TikTok recouvre : on n'y met rien d'important
const SAFE_TOP = 190, SAFE_BOTTOM = 380, MARGIN = 70, SAFE_RIGHT = 130; // à droite : la colonne de boutons (j'aime, commentaires…)
const C = { bg: "#FFF0E0", ink: "#192947", muted: "#5F6675", orange: "#FF9B50", orangeDeep: "#F2873A", white: "#FFFFFF", lavender: "#E6DFFA", border: "#EFD9C2" };
const FONT = "Inter";

let canvasLib = null;
function loadCanvas() {
  if (canvasLib) return canvasLib;
  const lib = require("@napi-rs/canvas"); // chargé à la demande : la page newsKit n'en a pas besoin
  for (const f of ["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-ExtraBold.ttf"]) lib.GlobalFonts.registerFromPath(path.join(__dirname, "fonts", f), FONT);
  canvasLib = lib;
  return lib;
}

const DAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
// Jour de publication (heure de Paris) : l'édition porte la date de la veille, le carrousel celle du jour où il est posté
function parisToday() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // AAAA-MM-JJ
}
function dateFr(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DAYS_FR[dt.getUTCDay()]} ${d === 1 ? "1er" : d} ${MONTHS_FR[m - 1]}`;
}

// ---------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------
function font(ctx, weight, size) { ctx.font = `${weight} ${size}px ${FONT}`; }
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/[ \n\t]+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
// Écrit un paragraphe et renvoie la position du bas. maxLines : coupe avec « … »
function paragraph(ctx, text, x, y, maxWidth, { weight = 400, size = 40, lineHeight = 1.38, color = C.ink, maxLines = 99, align = "left" } = {}) {
  font(ctx, weight, size);
  ctx.fillStyle = color; ctx.textBaseline = "top"; ctx.textAlign = align;
  let lines = wrap(ctx, text, maxWidth);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,;:.]+\S*$/, "") + "…"; }
  const lh = Math.round(size * lineHeight);
  const ax = align === "center" ? x + maxWidth / 2 : x;
  lines.forEach((l, i) => ctx.fillText(l, ax, y + i * lh));
  ctx.textAlign = "left";
  return y + lines.length * lh;
}
function measureParagraph(ctx, text, maxWidth, { weight = 400, size = 40, lineHeight = 1.38, maxLines = 99 } = {}) {
  font(ctx, weight, size);
  return Math.min(maxLines, wrap(ctx, text, maxWidth).length) * Math.round(size * lineHeight);
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function pill(ctx, text, x, y, { bg = C.white, color = C.ink, size = 30, padX = 26, padY = 14 } = {}) {
  font(ctx, 800, size);
  const w = ctx.measureText(text).width + padX * 2, h = size + padY * 2;
  ctx.fillStyle = bg; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.fillText(text, x + padX, y + h / 2 + 2);
  return { w, h };
}
// Image recadrée pour remplir un rectangle arrondi
function coverImage(ctx, img, x, y, w, h, r) {
  ctx.save(); roundRect(ctx, x, y, w, h, r); ctx.clip();
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
function brand(ctx, x, y, size = 46) {
  font(ctx, 800, size); ctx.textBaseline = "top";
  let cx = x;
  for (const [t, col] of [["d", C.ink], ["é", C.orangeDeep], ["clic.", C.ink]]) { ctx.fillStyle = col; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; }
  return cx - x;
}
function base(ctx) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); }
const CONTENT_W = W - MARGIN - Math.max(MARGIN, SAFE_RIGHT);

function drawCover(lib, edition, images) {
  const canvas = lib.createCanvas(W, H), ctx = canvas.getContext("2d");
  base(ctx);
  brand(ctx, MARGIN, SAFE_TOP, 54);
  // Mosaïque : la première illustration en grand, deux autres dessous
  const withImg = images.filter(Boolean);
  let y = SAFE_TOP + 110;
  if (withImg[0]) { coverImage(ctx, withImg[0], MARGIN, y, CONTENT_W, 520, 36); y += 520 + 20; }
  if (withImg[1] && withImg[2]) {
    const half = (CONTENT_W - 20) / 2;
    coverImage(ctx, withImg[1], MARGIN, y, half, 290, 30); coverImage(ctx, withImg[2], MARGIN + half + 20, y, half, 290, 30); y += 290;
  }
  y += 60;
  pill(ctx, dateFr(edition.day).toUpperCase(), MARGIN, y, { bg: C.orange, size: 28 }); y += 100;
  y = paragraph(ctx, "L'actu du jour", MARGIN, y, CONTENT_W, { weight: 800, size: 104, lineHeight: 1.08 });
  y = paragraph(ctx, "en anglais.", MARGIN, y, CONTENT_W, { weight: 800, size: 104, lineHeight: 1.08, color: C.orangeDeep });
  y = paragraph(ctx, `${edition.items.length} actus françaises à lire en anglais simple. Fais défiler →`, MARGIN, y + 26, CONTENT_W, { weight: 600, size: 40, color: C.muted });
  return canvas;
}

function drawNews(lib, item, index, total, img) {
  const canvas = lib.createCanvas(W, H), ctx = canvas.getContext("2d");
  base(ctx);
  brand(ctx, MARGIN, SAFE_TOP, 46);
  font(ctx, 800, 34); ctx.fillStyle = C.muted; ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillText(`${index + 1}/${total}`, MARGIN + CONTENT_W, SAFE_TOP + 8); ctx.textAlign = "left";

  const text = item.levels.A2.text;
  const bottom = H - SAFE_BOTTOM;
  // La taille du texte s'adapte pour que tout tienne au-dessus de la zone basse de TikTok
  let imgH = 620, titleSize = 66, bodySize = 48;
  const layout = () => {
    const title = measureParagraph(ctx, item.titleEn, CONTENT_W, { weight: 800, size: titleSize, lineHeight: 1.14, maxLines: 3 });
    const fr = item.titleFr ? measureParagraph(ctx, item.titleFr, CONTENT_W, { weight: 600, size: 34, lineHeight: 1.3, maxLines: 2 }) + 14 : 0;
    const body = measureParagraph(ctx, text, CONTENT_W - 72, { size: bodySize, lineHeight: 1.42 }) + 72;
    return SAFE_TOP + 90 + imgH + 36 + title + fr + 34 + body;
  };
  for (let i = 0; i < 30 && layout() > bottom; i++) { if (imgH > 500) imgH -= 40; else if (bodySize > 42) bodySize -= 2; else if (imgH > 420) imgH -= 40; else if (bodySize > 36) bodySize -= 2; else if (imgH > 340) imgH -= 40; else if (titleSize > 54) titleSize -= 4; else break; }

  let y = SAFE_TOP + 90;
  if (img) coverImage(ctx, img, MARGIN, y, CONTENT_W, imgH, 36);
  else { ctx.fillStyle = C.lavender; roundRect(ctx, MARGIN, y, CONTENT_W, imgH, 36); ctx.fill(); }
  pill(ctx, String(item.rubriqueLabelFr || "Actu").toUpperCase(), MARGIN + 22, y + 22, { size: 26 });
  y += imgH + 36;
  y = paragraph(ctx, item.titleEn, MARGIN, y, CONTENT_W, { weight: 800, size: titleSize, lineHeight: 1.14, maxLines: 3 });
  if (item.titleFr) y = paragraph(ctx, item.titleFr, MARGIN, y + 14, CONTENT_W, { weight: 600, size: 34, lineHeight: 1.3, color: C.muted, maxLines: 2 });
  y += 34;
  // Texte encore trop long à la plus petite taille : on le coupe proprement plutôt que de passer sous les boutons de TikTok
  const maxLines = Math.max(3, Math.floor((bottom - y - 72) / Math.round(bodySize * 1.42)));
  const bodyH = measureParagraph(ctx, text, CONTENT_W - 72, { size: bodySize, lineHeight: 1.42, maxLines }) + 72;
  ctx.fillStyle = C.white; roundRect(ctx, MARGIN, y, CONTENT_W, bodyH, 34); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 2; roundRect(ctx, MARGIN, y, CONTENT_W, bodyH, 34); ctx.stroke();
  paragraph(ctx, text, MARGIN + 36, y + 36, CONTENT_W - 72, { size: bodySize, lineHeight: 1.42, maxLines });
  return canvas;
}

function drawOutro(lib) {
  const canvas = lib.createCanvas(W, H), ctx = canvas.getContext("2d");
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  let y = SAFE_TOP + 250;
  y = paragraph(ctx, "Tu as tout compris\u00A0?", MARGIN, y, CONTENT_W, { weight: 800, size: 96, lineHeight: 1.1, color: C.white });
  y = paragraph(ctx, "Maintenant, raconte-le en anglais.", MARGIN, y + 20, CONTENT_W, { weight: 800, size: 72, lineHeight: 1.14, color: C.orange });
  y += 70;
  for (const line of ["Un quiz pour vérifier que tu as compris.", "Un coach pour raconter l'actu à l'oral.", "De nouvelles actus chaque matin."]) {
    ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(MARGIN + 16, y + 30, 12, 0, Math.PI * 2); ctx.fill();
    y = paragraph(ctx, line, MARGIN + 56, y, CONTENT_W - 56, { weight: 600, size: 44, lineHeight: 1.36, color: C.white }) + 26;
  }
  y += 50;
  ctx.fillStyle = C.orange; roundRect(ctx, MARGIN, y, CONTENT_W, 150, 44); ctx.fill();
  paragraph(ctx, "Déclic Anglais · lien en bio", MARGIN, y + 48, CONTENT_W, { weight: 800, size: 50, color: C.ink, align: "center" });
  return canvas;
}

// ---------------------------------------------------------------
// Fabrication du kit (appelée par dailyNews.js après la publication de l'édition)
// ---------------------------------------------------------------
function buildCaption(edition) {
  const titles = edition.items.map((it, i) => `${i + 1}. ${it.titleEn}`).join("\n");
  return `L'actu du ${dateFr(edition.day)}, en anglais 🇬🇧\n\n${titles}\n\nLaquelle tu avais déjà comprise ? Dans Déclic Anglais, tu les lis, tu fais le quiz, puis tu les racontes à ton coach. Lien en bio.\n\n#anglais #apprendrelanglais #english #actu #vocabulaireanglais #declicanglais`;
}

// Chemin du fichier dans le bucket, retrouvé depuis son lien de téléchargement (…/o/<chemin encodé>?alt=media&token=…)
function storagePath(url) {
  const m = /\/o\/([^?]+)/.exec(String(url || ""));
  try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
}

async function buildSocialKit({ db, bucket, edition }) {
  const lib = loadCanvas();
  const items = edition.items.filter((it) => it && it.hidden !== true);
  const view = { date: edition.date, day: parisToday(), items };
  // Illustrations déjà rangées par l'édition (dailyNews/{date}/{n}/cover.jpg)
  const images = await Promise.all(items.map(async (it) => {
    const filePath = storagePath(it.image?.url);
    if (!filePath) return null;
    try { const [buf] = await bucket.file(filePath).download(); return await lib.loadImage(buf); }
    catch (e) { console.warn(`[kit] illustration ${it.id} illisible:`, e?.message || e); return null; }
  }));
  const canvases = [drawCover(lib, view, images), ...items.map((it, i) => drawNews(lib, it, i, items.length, images[i])), drawOutro(lib)];
  const slides = [];
  for (let i = 0; i < canvases.length; i++) {
    const p = `dailyNews/${edition.date}/social/tiktok-${String(i + 1).padStart(2, "0")}.jpg`;
    await bucket.file(p).save(canvases[i].toBuffer("image/jpeg", 90), { resumable: false, metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" } });
    slides.push(p);
  }
  // Clé de la page privée : créée une fois, gardée dans config/news.socialKey
  const cfgRef = db.doc("config/news");
  let key = (await cfgRef.get()).data()?.socialKey;
  if (typeof key !== "string" || key.length < 16) { key = crypto.randomBytes(18).toString("base64url"); await cfgRef.set({ socialKey: key }, { merge: true }); }
  await db.doc("newsSocial/current").set({ date: edition.date, day: view.day, bucket: bucket.name, slides, caption: buildCaption(view), generatedAt: Date.now() });
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  console.log(`[kit] ${slides.length} images prêtes. Page : https://${REGION}-${project}.cloudfunctions.net/newsKit?k=${key}`);
  return { slides: slides.length };
}

// ---------------------------------------------------------------
// Page privée : https://europe-west1-<projet>.cloudfunctions.net/newsKit?k=<clé>
//   sans paramètre « s » : la page (images du jour + légende à copier) ; avec s=1…7 : l'image elle-même ; refresh=1 : refaire les images
// ---------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function handleKit(req, res, db, storage) {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("Cache-Control", "private, no-store");
  const cfgSnap = await db.doc("config/news").get();
  const key = cfgSnap.data()?.socialKey;
  const given = typeof req.query.k === "string" ? req.query.k : "";
  const ok = typeof key === "string" && key.length >= 16 && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) { res.status(404).send("Not found"); return; }
  let kit = (await db.doc("newsSocial/current").get()).data();
  // Kit absent ou en retard sur l'édition du jour (fabrication de 3 h en échec, édition relancée à la main) : on le fabrique ici
  if (!Number.isInteger(Number(req.query.s))) {
    const edition = (await db.doc("dailyNews/current").get()).data();
    if (edition?.date && Array.isArray(edition.items) && (kit?.date !== edition.date || req.query.refresh === "1")) {
      try {
        const cfg = cfgSnap.data() || {};
        await buildSocialKit({ db, bucket: cfg.bucket ? storage.bucket(cfg.bucket) : storage.bucket(), edition });
        kit = (await db.doc("newsSocial/current").get()).data();
      } catch (e) { console.error("[kit] fabrication en échec:", e?.message || e); }
    }
  }
  if (!kit || !Array.isArray(kit.slides) || kit.slides.length === 0) { res.status(200).send("Pas encore de kit pour aujourd'hui."); return; }

  const n = Number(req.query.s);
  if (Number.isInteger(n) && n >= 1 && n <= kit.slides.length) {
    try {
      const [buf] = await storage.bucket(kit.bucket).file(kit.slides[n - 1]).download();
      res.set("Content-Type", "image/jpeg");
      res.set("Content-Disposition", `inline; filename="actus-${kit.date}-${String(n).padStart(2, "0")}.jpg"`);
      res.status(200).send(buf);
    } catch (e) { console.warn("[kit] image introuvable:", e?.message || e); res.status(404).send("Not found"); }
    return;
  }

  const k = encodeURIComponent(key);
  const imgs = kit.slides.map((_, i) => `<a href="?k=${k}&s=${i + 1}" download="actus-${esc(kit.date)}-${String(i + 1).padStart(2, "0")}.jpg"><img src="?k=${k}&s=${i + 1}" alt="Image ${i + 1}" loading="lazy"></a>`).join("");
  res.status(200).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Kit TikTok · ${esc(kit.day || kit.date)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#FFFAF5;color:#192947}
main{max-width:720px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:24px;margin:8px 0 4px}p{color:#5F6675;margin:0 0 16px;line-height:1.45}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0}
.grid img{width:100%;border-radius:14px;display:block;border:1px solid #EFD9C2}
button{font:inherit;font-weight:800;border:0;border-radius:14px;padding:14px 16px;width:100%;background:#FF9B50;color:#192947;margin-top:10px}
button.alt{background:#fff;border:2px solid #192947}
textarea{width:100%;box-sizing:border-box;min-height:230px;border-radius:14px;border:1px solid #EFD9C2;padding:12px;font:inherit;font-size:15px;background:#fff;color:#192947}
#msg{min-height:22px;font-weight:700;color:#278966;margin-top:8px}
</style></head><body><main>
<h1>Kit TikTok du ${esc(dateFr(kit.day || kit.date))}</h1>
<p>${kit.slides.length} images, dans l'ordre du carrousel. Enregistre-les (bouton ci-dessous, ou appui long sur chaque image), puis publie-les en mode photo.</p>
<button id="share">Enregistrer ou partager les ${kit.slides.length} images</button>
<div class="grid">${imgs}</div>
<h1>Légende</h1>
<textarea id="cap" readonly>${esc(kit.caption || "")}</textarea>
<button class="alt" id="copy">Copier la légende</button>
<div id="msg" role="status"></div>
<script>
const k=${JSON.stringify(k)}, n=${kit.slides.length}, date=${JSON.stringify(kit.date)}, msg=document.getElementById("msg");
document.getElementById("copy").onclick=async()=>{const t=document.getElementById("cap");try{await navigator.clipboard.writeText(t.value)}catch(e){t.select();document.execCommand("copy")}msg.textContent="Légende copiée."};
document.getElementById("share").onclick=async()=>{
  msg.textContent="Préparation des images…";
  try{
    const files=[];
    for(let i=1;i<=n;i++){const r=await fetch("?k="+k+"&s="+i);files.push(new File([await r.blob()],"actus-"+date+"-"+String(i).padStart(2,"0")+".jpg",{type:"image/jpeg"}))}
    if(navigator.canShare&&navigator.canShare({files})){await navigator.share({files});msg.textContent="Images partagées."}
    else{for(const f of files){const a=document.createElement("a");a.href=URL.createObjectURL(f);a.download=f.name;a.click();await new Promise(r=>setTimeout(r,350))}msg.textContent="Images téléchargées."}
  }catch(e){msg.textContent=e&&e.name==="AbortError"?"":"Échec : fais un appui long sur chaque image pour l'enregistrer."}
};
</script></main></body></html>`);
}

exports.newsKit = onRequest({ region: REGION, invoker: "public", memory: "1GiB", timeoutSeconds: 120, maxInstances: 2 }, (req, res) => handleKit(req, res, getFirestore(), getStorage()));

Object.defineProperty(module.exports, "buildSocialKit", { enumerable: false, value: buildSocialKit });
Object.defineProperty(module.exports, "_internal", { enumerable: false, value: { handleKit, drawCover, drawNews, drawOutro, buildCaption, loadCanvas, dateFr } });
