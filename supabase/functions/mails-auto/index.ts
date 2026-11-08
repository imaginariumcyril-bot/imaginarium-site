// Envoi des e-mails automatiques de l'Imaginarium (appelé toutes les 5 min par pg_cron).
// Types : confirmee (réservation validée par le MJ), option_2h (option qui expire),
// rappel_j3 / rappel_j1 (part restant à régler).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://imaginarium-noirpeste.vercel.app";
const SENDER = {
  name: "L'imaginarium du Docteur Noirpeste",
  email: Deno.env.get("MAIL_EXPEDITEUR") ?? "imaginarium.cyril@gmail.com",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const euros = (n: number) =>
  (Math.round(Number(n) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: Number(n) % 1 ? 2 : 0 }) + " €";
const quand = (d: string) => {
  const s = new Date(d).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  return s.replace(" à ", " à ").replace(/(\d{2}):(\d{2})/, "$1h$2");
};
const heure = (d: string) =>
  new Date(d).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", "h");

const F = {
  titre: "font-family:'Pirata One',Georgia,'Times New Roman',serif",
  texte: "font-family:Alegreya,Georgia,'Times New Roman',serif",
  cinzel: "font-family:Cinzel,Georgia,'Times New Roman',serif",
};

function coque(titre: string, corps: string, bouton: string, note: string, lien = `${SITE}/#compte`) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background-color:#0b0a08;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0a08" style="background-color:#0b0a08;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#15120e;border:1px solid #7d5a2c;">
<tr><td style="padding:0;"><img src="${SITE}/assets/banniere.jpg" width="560" alt="L'imaginarium du Docteur Noirpeste, salle de jeux de rôle" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></td></tr>
<tr><td align="center" style="padding:22px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="90" style="border-top:1px solid #7d5a2c;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:0 10px;color:#c8924a;font-size:14px;line-height:14px;">&#9679;</td>
<td width="90" style="border-top:1px solid #7d5a2c;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:18px 36px 6px 36px;${F.titre};font-size:30px;line-height:36px;color:#ede5d3;text-align:center;font-weight:normal;">${esc(titre)}</td></tr>
<tr><td style="padding:10px 36px 0 36px;${F.texte};font-size:17px;line-height:27px;color:#dcd3bf;">${corps}</td></tr>
<tr><td align="center" style="padding:28px 36px 28px 36px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="#c8924a" style="background-color:#c8924a;border-radius:6px;"><a href="${lien}" style="display:inline-block;padding:14px 28px;${F.cinzel};font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:#1a1006;text-decoration:none;font-weight:bold;">${esc(bouton)}</a></td>
</tr></table></td></tr>
${note ? `<tr><td style="padding:0 36px 26px 36px;${F.texte};font-size:14px;line-height:22px;color:#a89c86;font-style:italic;">${note}</td></tr>` : ""}
<tr><td style="padding:0 36px;"><div style="border-top:1px solid #33291c;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:18px 36px 24px 36px;${F.cinzel};font-size:11px;line-height:18px;letter-spacing:2.5px;text-transform:uppercase;color:#a89c86;">L'imaginarium du Docteur Noirpeste<br>
<span style="letter-spacing:1px;text-transform:none;${F.texte};font-size:13px;">Salle de jeux de rôle · Leiterswiller</span></td></tr>
</table></td></tr></table></body></html>`;
}

type Mail = {
  id: string; type: string; email: string; pseudo: string; titre: string; date: string; session_type: string;
  note: string | null; places: number; parts: number | null; ami: boolean; total: number;
  repas: { nom: string; qty: number; prix: number }[]; expires_at: string; mode_paiement: string | null;
  paye: boolean; code: string | null;
};

function recap(m: Mail, adresse: string) {
  const ligne = (k: string, v: string) =>
    `<tr><td style="padding:5px 12px 5px 0;${F.cinzel};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#a89c86;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:5px 0;${F.texte};font-size:16px;line-height:23px;color:#ede5d3;">${v}</td></tr>`;
  const qte = m.session_type === "ouverte"
    ? ligne("Places", String(m.places))
    : ligne(m.ami ? "Parts" : "Table", m.ami ? String(m.parts ?? 0) : `${m.places} joueurs · ${m.parts ?? m.places} part(s) à votre charge`);
  const repas = (m.repas || []).length
    ? ligne("Repas", m.repas.map((x) => `${esc(x.nom)} × ${Number(x.qty)}`).join("<br>"))
    : "";
  const lignes = [
    ligne("Partie", esc(m.titre)),
    ligne("Date", esc(quand(m.date))),
    adresse ? ligne("Adresse", esc(adresse)) : "",
    qte, repas,
    Number(m.total) > 0 ? ligne("Total", euros(m.total)) : "",
  ].join("");
  const note = m.note
    ? `<p style="margin:14px 0 0 0;color:#e0574a;font-weight:bold;">${esc(m.note)}</p>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;border-top:1px solid #33291c;border-bottom:1px solid #33291c;"><tr><td style="padding:10px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${lignes}</table></td></tr></table>${note}`;
}

function paiement(m: Mail, paypal: string) {
  if (m.paye || Number(m.total) <= 0) return "";
  if (m.mode_paiement === "especes") return `<p style="margin:14px 0 0 0;">Le règlement se fera sur place, en espèces.</p>`;
  const lien = m.mode_paiement !== "wero" && paypal
    ? ` ou directement <a href="${esc(paypal)}" style="color:#c8924a;">par PayPal</a>` : "";
  return `<p style="margin:14px 0 0 0;">Il reste <strong>${euros(m.total)}</strong> à régler depuis votre espace joueur${lien}. Pensez à indiquer sur le site que vous avez payé.</p>`;
}

function composer(m: Mail, s: { paypal?: string; adresse?: string }) {
  const bonjour = `<p style="margin:0 0 14px 0;">Bonjour ${esc(m.pseudo || "")},</p>`;
  const rec = recap(m, s.adresse || "");
  switch (m.type) {
    case "confirmee":
      return {
        sujet: `Réservation confirmée : ${m.titre}`,
        html: coque("Réservation confirmée",
          `${bonjour}<p style="margin:0;">Le Docteur Noirpeste a confirmé votre réservation. Votre place vous attend.</p>${rec}${paiement(m, s.paypal || "")}`,
          "Voir mes réservations",
          "Un empêchement ? Prévenez-nous au plus vite en répondant à cet e-mail."),
      };
    case "option_2h":
      return {
        sujet: `Votre option expire à ${heure(m.expires_at)}`,
        html: coque("Votre option expire bientôt",
          `${bonjour}<p style="margin:0;">Votre option sur la partie ci-dessous expire aujourd'hui à <strong>${heure(m.expires_at)}</strong>. Passé ce délai, la place sera libérée pour d'autres joueurs.</p>${rec}${paiement(m, s.paypal || "")}`,
          "Garder ma place",
          "Si vous ne souhaitez plus venir, vous n'avez rien à faire : l'option sera annulée automatiquement."),
      };
    default: {
      const demain = m.type === "rappel_j1";
      return {
        sujet: demain ? `Rappel : votre part pour demain (${m.titre})` : `Rappel : votre part pour ${m.titre}`,
        html: coque(demain ? "C'est demain !" : "Plus que 3 jours",
          `${bonjour}<p style="margin:0;">La partie approche${demain ? " : rendez-vous demain" : ""}. Votre part n'est pas encore réglée.</p>${rec}${paiement(m, s.paypal || "")}`,
          "Régler ma part",
          "Si vous avez déjà payé, indiquez-le dans votre espace joueur et ignorez ce message."),
      };
    }
  }
}

const MODE: Record<string, string> = { paypal: "PayPal", wero: "Wero", especes: "espèces sur place" };

// deno-lint-ignore no-explicit-any
function composerMJ(kind: string, d: any) {
  const lien = `${SITE}/#mj`;
  if (kind === "message") {
    return {
      replyTo: { email: d.email, name: d.nom },
      sujet: `Question de ${d.nom}`,
      html: coque("Une question pour vous",
        `<p style="margin:0 0 6px 0;"><strong>${esc(d.nom)}</strong> &lt;<a href="mailto:${esc(d.email)}" style="color:#c8924a;">${esc(d.email)}</a>&gt; vous écrit :</p>
<div style="margin:14px 0 0 0;padding:14px 16px;border-left:3px solid #c8924a;background:#1c1812;white-space:pre-wrap;">${esc(d.texte)}</div>`,
        "Ouvrir le site", "Répondez directement à cet e-mail : la réponse partira vers le joueur.", SITE),
    };
  }
  const m = { ...d, session_type: d.stype, ami: !!d.parent_id, note: null } as Mail;
  const rec = recap(m, "");
  const msg = d.note ? `<p style="margin:14px 0 0 0;"><em>Message du joueur :</em> ${esc(d.note)}</p>` : "";
  if (kind === "paiement") {
    return {
      sujet: `Paiement signalé : ${d.pseudo} · ${euros(d.total)}${d.mode_paiement ? " (" + (MODE[d.mode_paiement] || d.mode_paiement) + ")" : ""}`,
      html: coque("Paiement signalé",
        `<p style="margin:0;"><strong>${esc(d.pseudo)}</strong> indique avoir réglé <strong>${euros(d.total)}</strong>${d.mode_paiement ? " par " + esc(MODE[d.mode_paiement] || d.mode_paiement) : ""}. Vérifiez la réception, puis validez dans votre espace MJ.</p>${rec}`,
        "Vérifier dans l'espace MJ", "", lien),
    };
  }
  const sujet = d.parent_id
    ? `${d.pseudo} a rejoint la table de ${d.org_pseudo || "?"} · ${d.titre}`
    : d.stype === "ouverte"
    ? `Nouvelle option : ${d.pseudo} · ${d.places} place${d.places > 1 ? "s" : ""} · ${d.titre}`
    : `Nouvelle privatisation : ${d.pseudo} · ${d.titre}`;
  const intro = d.parent_id
    ? `<strong>${esc(d.pseudo)}</strong> a rejoint la table privatisée de <strong>${esc(d.org_pseudo || "?")}</strong>.`
    : `<strong>${esc(d.pseudo)}</strong> (<a href="mailto:${esc(d.pemail)}" style="color:#c8924a;">${esc(d.pemail)}</a>) vient de poser une option${d.stype === "ouverte" ? "" : " de privatisation"}.`;
  return {
    sujet,
    html: coque(d.parent_id ? "Un joueur rejoint une table" : "Nouvelle option",
      `<p style="margin:0;">${intro}${d.mode_paiement ? " Paiement prévu : " + esc(MODE[d.mode_paiement] || d.mode_paiement) + "." : ""}</p>${rec}${msg}`,
      "Valider dans l'espace MJ", "", lien),
  };
}

const fNum = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// deno-lint-ignore no-explicit-any
function composerBilan(b: any, vendredi: string) {
  const [y, m, d] = vendredi.split("-").map(Number);
  const jour = (k: number) => new Date(Date.UTC(y, m - 1, d + k, 12)).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" });
  const h3 = (t: string) => `<p style="margin:22px 0 8px 0;${F.cinzel};font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c8924a;">${t}</p>`;
  const li = (a: string, b2: string) => `<tr><td style="padding:4px 12px 4px 0;border-bottom:1px dotted #33291c;color:#ede5d3;">${a}</td><td align="right" style="padding:4px 0;border-bottom:1px dotted #33291c;color:#ede5d3;white-space:nowrap;"><strong>${b2}</strong></td></tr>`;
  const tab = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${F.texte};font-size:16px;line-height:22px;">${rows}</table>`;
  // deno-lint-ignore no-explicit-any
  const repas = (r: any[]) => (r || []).map((x) => Array.isArray(x.choix) ? `${esc(x.nom)} : ${x.choix.map(esc).join(", ")}` : `${esc(x.nom)} × ${x.qty}`).join(" ; ") || "pas de repas";
  // deno-lint-ignore no-explicit-any
  const sessions = (b.sessions as any[]).map((s) => {
    // deno-lint-ignore no-explicit-any
    const js = (s.joueurs as any[]).map((j) => {
      const qte = s.type === "ouverte" ? `${j.places} pl.` : j.ami ? `${j.parts ?? 0} part(s)` : `${j.places} joueurs`;
      const reg = j.paye ? "payé" : j.paiement_declare ? "paiement signalé" : j.mode === "especes" ? "espèces sur place" : "à régler";
      return `<li style="margin:0 0 6px 0;"><strong>${esc(j.pseudo)}</strong>${j.statut === "option" ? ' <span style="color:#e07f45;">(option)</span>' : ""} · ${qte} · ${reg}<br><span style="color:#a89c86;">${repas(j.repas)}</span>${j.note ? `<br><em style="color:#a89c86;">« ${esc(j.note)} »</em>` : ""}</li>`;
    }).join("");
    return `<div style="margin:0 0 14px 0;padding:12px 14px;background:#1c1812;border-left:3px solid #c8924a;">
<strong style="color:#ede5d3;">${esc(quand(s.date))}</strong><br><span style="color:#dcd3bf;">${esc(s.titre)} · ${s.type === "ouverte" ? "partie ouverte" : "privatisation"}</span>
${js ? `<ul style="margin:10px 0 0 0;padding-left:18px;">${js}</ul>` : `<p style="margin:8px 0 0 0;color:#a89c86;">Aucun joueur inscrit.</p>`}</div>`;
  }).join("");
  // deno-lint-ignore no-explicit-any
  const plats = (b.plats as any[]).map((p) => li(esc(p.plat) + (p.n_option ? ` <span style="color:#a89c86;">(dont ${fNum(p.n_option)} en option)</span>` : ""), "× " + fNum(p.n))).join("");
  // deno-lint-ignore no-explicit-any
  const courses = (b.courses as any[]).map((c) => c.q != null && !c.sans_q
    ? li(esc(c.label) + (c.q % 1 ? ` <span style="color:#a89c86;">(${fNum(c.q)} nécessaires)</span>` : ""), String(Math.ceil(c.q - 1e-9)))
    : li(esc(c.label) + ` <span style="color:#a89c86;">(pour ${fNum(c.pour)})</span>`, "à prévoir")).join("");
  const corps = `<p style="margin:0;">Voici le programme du week-end du ${jour(0)} au ${jour(2)}. Réservations confirmées et options en cours.</p>
${h3("Les parties")}${sessions || '<p style="margin:0;color:#a89c86;">Aucune partie ce week-end.</p>'}
${h3("À préparer")}${plats ? tab(plats) : '<p style="margin:0;color:#a89c86;">Rien de commandé.</p>'}
${h3("Liste de courses")}${courses ? tab(courses) : '<p style="margin:0;color:#a89c86;">Rien à acheter.</p>'}`;
  return {
    sujet: `Le week-end du ${jour(0)} : ${b.sessions.length} partie${b.sessions.length > 1 ? "s" : ""}, ${b.plats.reduce((a: number, p: { n: number }) => a + Number(p.n), 0)} plat(s) à préparer`,
    html: coque("Le programme du week-end", corps, "Ouvrir l'espace MJ", "Les quantités sont arrondies au-dessus pour les courses. À consulter à tout moment dans l'espace MJ, onglet Week-end.", `${SITE}/#mj`),
  };
}

const uuidDe = async (t: string) => {
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const cle = Deno.env.get("BREVO_API_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // deno-lint-ignore no-explicit-any
  const corpsReq: any = await req.json().catch(() => ({}));
  if (corpsReq?.bilan) {
    const paris = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    if (!corpsReq.force && (paris.getDay() !== 5 || paris.getHours() !== 12)) return Response.json({ bilan: "pas l'heure" });
    const vendredi = corpsReq.vendredi || `${paris.getFullYear()}-${String(paris.getMonth() + 1).padStart(2, "0")}-${String(paris.getDate()).padStart(2, "0")}`;
    const b = await db.rpc("mails_bilan", { p_secret: secret, p_vendredi: vendredi });
    if (b.error) return new Response(JSON.stringify({ erreur: b.error.message }), { status: 401 });
    if (!cle) return Response.json({ erreur: "BREVO_API_KEY manquante" }, { status: 500 });
    const ref = await uuidDe("bilan:" + vendredi + (corpsReq.force ? ":" + Date.now() : ""));
    const pris = (await db.rpc("mails_reserver", { p_secret: secret, p_table: "mj", p_kind: "bilan", p_id: ref })).data === true;
    if (!pris) return Response.json({ bilan: "déjà envoyé" });
    const c = composerBilan(b.data, vendredi);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cle, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: SENDER, to: (b.data.dest as string[]).map((e) => ({ email: e, name: "MJ" })), subject: c.sujet, htmlContent: c.html }),
    });
    if (!r.ok) await db.rpc("mails_liberer", { p_secret: secret, p_table: "mj", p_kind: "bilan", p_id: ref });
    return Response.json({ bilan: r.ok ? "envoyé" : "échec", statut: r.status });
  }

  const [j, mj] = await Promise.all([
    db.rpc("mails_a_envoyer", { p_secret: secret }),
    db.rpc("mails_mj_a_envoyer", { p_secret: secret }),
  ]);
  if (j.error || mj.error) return new Response(JSON.stringify({ erreur: (j.error || mj.error)!.message }), { status: 401 });
  const mails: Mail[] = j.data?.mails ?? [];
  // deno-lint-ignore no-explicit-any
  const items: { kind: string; ref_id: string; d: any }[] = mj.data?.items ?? [];
  const dest: string[] = mj.data?.dest ?? [];
  if (!mails.length && !items.length) return Response.json({ envoyes: 0 });
  if (!cle) return Response.json({ erreur: "BREVO_API_KEY manquante" }, { status: 500 });

  const envoyer = async (to: { email: string; name: string }[], sujet: string, html: string, replyTo = { email: SENDER.email, name: SENDER.name }) => {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cle, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: SENDER, replyTo, to, subject: sujet, htmlContent: html }),
    });
    return { ok: r.ok, statut: r.status, detail: r.ok ? undefined : await r.text() };
  };
  const reserver = async (table: string, kind: string, id: string) =>
    (await db.rpc("mails_reserver", { p_secret: secret, p_table: table, p_kind: kind, p_id: id })).data === true;
  const liberer = (table: string, kind: string, id: string) =>
    db.rpc("mails_liberer", { p_secret: secret, p_table: table, p_kind: kind, p_id: id });

  const rapport: unknown[] = [];
  for (const m of mails) {
    if (!(await reserver("joueur", m.type, m.id))) continue;
    const { sujet, html } = composer(m, j.data.settings || {});
    const r = await envoyer([{ email: m.email, name: m.pseudo || m.email }], sujet, html);
    if (!r.ok) await liberer("joueur", m.type, m.id);
    rapport.push({ id: m.id, type: m.type, ...r });
  }
  for (const it of items) {
    if (!(await reserver("mj", it.kind, it.ref_id))) continue;
    // une réservation créée directement confirmée (par le MJ) ne déclenche pas d'alerte
    if (it.kind === "option" && it.d.statut === "confirmee") continue;
    if (!dest.length) continue;
    const c = composerMJ(it.kind, it.d);
    const r = await envoyer(dest.map((e) => ({ email: e, name: "MJ" })), c.sujet, c.html, c.replyTo);
    if (!r.ok) await liberer("mj", it.kind, it.ref_id);
    rapport.push({ id: it.ref_id, type: "mj_" + it.kind, ...r });
  }
  // deno-lint-ignore no-explicit-any
  return Response.json({ envoyes: rapport.filter((x: any) => x.ok).length, rapport });
});
