// Supabase Edge Function "notify-report": sends an email when a report is written (a new row in public.reports) or when its text is
// completed (the PC editor's "Aggiungi dettagli"). Called by a Database Webhook (see docs/notifiche-segnalazioni.md), not by the app.
//
// Secrets (Edge Functions -> Secrets): RESEND_API_KEY (resend.com), NOTIFY_EMAIL (where the mail goes), WEBHOOK_SECRET (any long text,
// the same as in the webhook's header `x-webhook-secret`), optional MAIL_FROM (default "Immersa <onboarding@resend.dev>"; that sender
// can only write to the email of the Resend account: to write to others verify a domain in Resend).
// Deploy: Supabase dashboard -> Edge Functions -> Create function "notify-report" -> paste this file -> Deploy
// (turn OFF "Verify JWT": the webhook authenticates with the shared secret instead).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KIND: Record<string, string> = { manual: 'dal visore', auto: 'errore automatico', pc: 'dal PC' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return new Response('unauthorized', { status: 401 });
  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('NOTIFY_EMAIL');
  if (!key || !to) return new Response('RESEND_API_KEY or NOTIFY_EMAIL missing', { status: 500 });

  const hook = await req.json().catch(() => null);
  const row = hook?.record;
  if (!row || hook?.table !== 'reports') return new Response('ignored', { status: 200 });
  const isUpdate = hook.type === 'UPDATE';
  if (isUpdate && (hook.old_record?.note ?? '') === (row.note ?? '')) return new Response('no change in the text', { status: 200 }); // an update of something else

  // Who wrote it: the account's email.
  let who = row.user_id as string;
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data } = await admin.auth.admin.getUserById(row.user_id);
    if (data?.user?.email) who = data.user.email;
  } catch {
    /* the id will do */
  }

  const p = (row.payload ?? {}) as Record<string, unknown>;
  const project = p.project as { name?: string } | null | undefined;
  const room = p.room as { name?: string; matched?: number; total?: number } | null | undefined;
  const log = Array.isArray(p.log) ? (p.log as string[]).slice(-15) : [];
  const kind = KIND[row.kind] ?? row.kind;
  const subject = `[Immersa] ${isUpdate ? 'Dettagli aggiunti' : 'Segnalazione'} (${kind}) da ${who}`;
  const facts = [
    `Utente: ${who}`,
    `Tipo: ${kind}`,
    `Versione: ${row.app_version ?? '?'}`,
    project?.name ? `Progetto: ${project.name}` : '',
    room?.name ? `Stanza riconosciuta: ${room.name} (${room.matched ?? '?'}/${room.total ?? '?'} piani)` : '',
    `Quando: ${row.created_at}`,
  ].filter(Boolean);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="margin:0 0 8px">${esc(subject)}</h2>
    <p style="white-space:pre-wrap;font-size:16px;background:#f4f6f8;padding:12px;border-radius:8px">${esc(row.note || '(nessun testo)')}</p>
    <p style="color:#555;line-height:1.6">${facts.map(esc).join('<br>')}</p>
    ${log.length ? `<pre style="font-size:12px;background:#111;color:#cde;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(log.join('\n'))}</pre>` : ''}
    <p style="color:#777;font-size:13px">Il Registro completo e lo stato della sessione sono nella tabella <code>reports</code> (campo <code>payload</code>) di Supabase.</p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM') ?? 'Immersa <onboarding@resend.dev>', to: [to], subject, html }),
  });
  if (!res.ok) return new Response(`mail not sent: ${res.status} ${await res.text()}`, { status: 502 });
  return new Response('sent', { status: 200 });
});
