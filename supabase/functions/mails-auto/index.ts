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

function coque(titre: string, corps: string, bouton: string, note: string) {
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
<td bgcolor="#c8924a" style="background-color:#c8924a;border-radius:6px;"><a href="${SITE}/#compte" style="display:inline-block;padding:14px 28px;${F.cinzel};font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:#1a1006;text-decoration:none;font-weight:bold;">${esc(bouton)}</a></td>
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

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const cle = Deno.env.get("BREVO_API_KEY");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await db.rpc("mails_a_envoyer", { p_secret: secret });
  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 401 });
  const mails: Mail[] = data?.mails ?? [];
  if (!mails.length) return Response.json({ envoyes: 0 });
  if (!cle) return Response.json({ erreur: "BREVO_API_KEY manquante", en_attente: mails.length }, { status: 500 });

  const rapport: unknown[] = [];
  for (const m of mails) {
    const { sujet, html } = composer(m, data.settings || {});
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cle, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: SENDER, replyTo: { email: SENDER.email, name: SENDER.name },
        to: [{ email: m.email, name: m.pseudo || m.email }],
        subject: sujet, htmlContent: html,
      }),
    });
    if (r.ok) await db.rpc("mails_marquer", { p_secret: secret, p_id: m.id, p_type: m.type });
    rapport.push({ id: m.id, type: m.type, ok: r.ok, statut: r.status, ...(r.ok ? {} : { detail: await r.text() }) });
  }
  return Response.json({ envoyes: rapport.filter((x: any) => x.ok).length, rapport });
});
