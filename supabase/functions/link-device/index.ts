// Supabase Edge Function "link-device": signs the headset in with a code approved on the PC.
//
//   start   (headset, no login)  -> { code, secret }   a 6-character code to show, and a secret that only the headset knows
//   approve (PC, signed in)      -> { ok }             the signed-in user confirms the code: a one-time sign-in token is stored
//   poll    (headset)            -> { status }         'wait' | 'expired' | 'ok' + token_hash (given once, then the row is deleted)
//
// The table public.device_links has row level security and no policies: only this function (service role) touches it.
// Deploy: Supabase dashboard -> Edge Functions -> Create function "link-device" -> paste this file -> Deploy.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0 / O / 1 / I: easy to read and type
const TTL_MS = 10 * 60 * 1000;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => ALPHABET[x % ALPHABET.length]).join('');
const cleanCode = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const now = Date.now();
  await admin.from('device_links').delete().lt('expires_at', new Date(now).toISOString()); // old codes go

  if (body.action === 'start') {
    const secret = hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
    for (let i = 0; i < 6; i++) {
      const code = randomCode();
      const { error } = await admin.from('device_links').insert({ code, secret_hash: await sha256(secret), expires_at: new Date(now + TTL_MS).toISOString() });
      if (!error) return json({ code, secret });
    }
    return json({ error: 'Non riesco a creare un codice, riprova.' }, 500);
  }

  if (body.action === 'approve') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
    const { data: auth } = await admin.auth.getUser(jwt);
    const user = auth?.user;
    if (!user?.email) return json({ error: 'Non sei collegato: accedi sul PC e riprova.' }, 401);
    const code = cleanCode(body.code);
    const { data: row } = await admin.from('device_links').select('code, token_hash, expires_at').eq('code', code).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < now) return json({ error: 'Codice non valido o scaduto.' }, 404);
    if (row.token_hash) return json({ error: 'Questo codice è già stato usato.' }, 409);
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email }); // makes a token, sends no email
    const token = link?.properties?.hashed_token;
    if (error || !token) return json({ error: error?.message ?? 'Non riesco a collegare il visore.' }, 500);
    await admin.from('device_links').update({ token_hash: token, user_id: user.id }).eq('code', code);
    return json({ ok: true });
  }

  if (body.action === 'poll') {
    const code = cleanCode(body.code);
    const { data: row } = await admin.from('device_links').select('code, secret_hash, token_hash, expires_at').eq('code', code).maybeSingle();
    // Wrong secret looks like an unknown code: nobody can watch a code that is not theirs.
    if (!row || row.secret_hash !== (await sha256(String(body.secret ?? ''))) || new Date(row.expires_at).getTime() < now) return json({ status: 'expired' });
    if (!row.token_hash) return json({ status: 'wait' });
    await admin.from('device_links').delete().eq('code', code); // the token is given once
    return json({ status: 'ok', token_hash: row.token_hash });
  }

  return json({ error: 'Azione sconosciuta.' }, 400);
});
