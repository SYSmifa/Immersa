# Una mail quando arriva una segnalazione

Quando qualcuno scrive una segnalazione (dal visore, automatica o dal PC) o ne completa il testo dal PC, ti arriva una mail con il testo,
l'utente, la versione, il progetto, la stanza e le ultime righe del Registro. Il Registro intero resta nella tabella `reports`.

Come funziona: un **Database Webhook** di Supabase chiama la funzione `notify-report` ogni volta che la tabella `reports` cambia; la
funzione manda la mail con **Resend** (gratis fino a 100 mail al giorno, 3000 al mese).

## Cosa fare (una volta, circa 10 minuti)

1. **Resend**: crea un account su resend.com, poi "API Keys" → crea una chiave e copiala (`re_...`).
   - Senza un dominio tuo la mail parte da `onboarding@resend.dev` e può arrivare SOLO all'email con cui ti sei registrato su Resend: per
     ora va bene. Per scrivere ad altri indirizzi o usare un mittente tuo (per esempio `segnalazioni@immersavr.com`) verifica il dominio
     in Resend (Domains) e metti il mittente nel segreto `MAIL_FROM`.
2. **Funzione**: Supabase → Edge Functions → *Create function* → nome `notify-report` → incolla `supabase/functions/notify-report/index.ts` →
   **spegni "Verify JWT"** (la chiamata si autentica con il segreto) → Deploy.
3. **Segreti**: Edge Functions → Secrets (o Project Settings → Edge Functions):
   - `RESEND_API_KEY` = la chiave di Resend
   - `NOTIFY_EMAIL` = la tua mail
   - `WEBHOOK_SECRET` = un testo lungo a caso (per esempio generato da un password manager)
   - facoltativo `MAIL_FROM` = `Immersa <segnalazioni@tuodominio.it>`
4. **Webhook**: Database → Webhooks → *Create a new hook*:
   - Name `notify-report`, Table `reports`, Events **Insert** e **Update**
   - Type *Supabase Edge Functions* (o HTTP Request) → funzione `notify-report`, metodo POST
   - HTTP Headers: aggiungi `x-webhook-secret` = lo stesso `WEBHOOK_SECRET` del punto 3
5. **Prova**: dal PC apri Segnalazioni → Nuova segnalazione → scrivi due righe → Invia. Entro qualche secondo arriva la mail. Se non
   arriva: Edge Functions → `notify-report` → Logs (di solito è la chiave di Resend, il segreto del webhook o il destinatario non
   ammesso dal mittente di prova).

## Note
- Le segnalazioni automatiche possono essere fino a 5 per sessione: se diventano troppe si possono filtrare nella funzione (`row.kind`).
- La mail contiene nomi di progetto e stanza: per i clienti va nell'informativa privacy, come la segnalazione stessa.

## Se nel pannello non trovi "Database Webhooks": un trigger SQL al posto del webhook (provato, funziona)
Nelle versioni nuove di Supabase i Webhook stanno sotto Integrations. In alternativa, SQL Editor → incolla, cambia `IL_TUO_PROGETTO` e
`IL_TUO_WEBHOOK_SECRET` (lo stesso del segreto `WEBHOOK_SECRET`) → Run. NON salvare qui il segreto vero: va solo nella query lanciata.

```sql
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_report() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://IL_TUO_PROGETTO.supabase.co/functions/v1/notify-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'IL_TUO_WEBHOOK_SECRET'),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(new), 'old_record', case when TG_OP = 'UPDATE' then to_jsonb(old) else null end)
  );
  return new;
end $$;

drop trigger if exists notify_report on public.reports;
create trigger notify_report after insert or update on public.reports
  for each row execute function public.notify_report();
```
