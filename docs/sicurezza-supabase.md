# Sicurezza di Supabase: controllo del 18/11

Controllo di `supabase/schema.sql`, delle due Edge Functions e del codice che le usa. Le correzioni sono già in `schema.sql`
(in fondo, sezione "Hardening"): **da rieseguire nel SQL Editor** (si può rieseguire senza danni).

## Cosa è a posto
- `rooms`, `projects`, `reports`: sicurezza a livello di riga attiva, ogni utente vede e modifica solo le sue righe (`owner` /
  `user_id` = `auth.uid()`), anche in scrittura (`with check`). Nessun accesso per chi non ha un account.
- Bucket `models`: privato; ogni utente tocca solo la cartella `<suo id>/`; i file si leggono con link firmati da 1 ora.
- `device_links` e `device_link_failures`: sicurezza attiva e nessuna regola, quindi solo la funzione (con la chiave di servizio) le legge.
- `link-device`: codici di 6 caratteri (2^30 combinazioni), validi 10 minuti; chi approva è limitato a 5 codici sbagliati ogni 10
  minuti; il visore deve conoscere anche un segreto per ritirare il token; il token si consegna una volta sola; al massimo 5 richieste
  aperte per rete.
- `notify-report`: risponde solo con il segreto condiviso; il testo delle segnalazioni è protetto (HTML) nella mail.
- Nel codice del sito non ci sono chiavi di servizio; `.env*` è in `.gitignore` (resta pubblica solo la chiave "anon", che è fatta così).
- Nessun uso di `innerHTML` con testi scritti dall'utente.

## Cosa ho corretto (in `schema.sql`)
1. **Tetti di dimensione**: stanze fino a 20 MB, progetti fino a 5 MB per elenco (modelli, strutture, note), nomi fino a 200
   caratteri. Prima un client malevolo poteva riempire il database. Valgono per le righe nuove o modificate.
2. **Progetti e stanze di altri**: un progetto può puntare solo a una stanza dello stesso proprietario (prima la chiave esterna
   accettava qualsiasi id e rivelava se esisteva).
3. **Segnalazioni**: solo i tre tipi noti e al massimo 60 all'ora per account (ognuna manda una mail: niente inondazioni).
4. **Doppio lucchetto**: tolti tutti i permessi a chi non ha un account sulle tabelle dei dati, e a tutti i client sulle tabelle
   delle funzioni.
5. **Bucket**: limite di 50 MB per file.
6. Nella finestra "Collega un visore" ho aggiunto l'avviso di approvare solo codici visti sul proprio visore (vedi il punto sotto).

## Rischio che resta e come ridurlo
- **Collegamento con codice scritto a mano**: se qualcuno convince un utente a digitare sul PC il codice che vede sul visore di un
  altro, quel visore entra nell'account dell'utente. È il rischio tipico di questo tipo di accesso. È ridotto dall'elenco automatico
  (il PC mostra solo i codici che arrivano dalla propria rete) e dall'avviso nuovo; il codice scritto a mano resta per chi è su
  un'altra rete. Per i clienti più attenti si può togliere del tutto la digitazione.
- **Dati dei clienti dopo la cancellazione dell'account**: i file nel bucket non si cancellano da soli quando l'utente sparisce.
  Serve, prima di vendere, una procedura di cancellazione (privacy / GDPR).

## Da controllare nella dashboard (non si può fare dal codice)
Authentication → Providers / URL Configuration / Policies:
- **Site URL** e **Redirect URLs**: solo `https://app.immersavr.com` (e il dominio di prova), niente caratteri jolly.
- **Conferma dell'email** attiva per le nuove registrazioni; password lunga almeno 10 e, se il piano lo permette,
  **protezione contro le password già violate**.
- Se l'app non è aperta a chiunque: **disattiva le nuove registrazioni** e crea gli account a mano, oppure attiva un **CAPTCHA**
  (Turnstile) su accesso e registrazione.
- **Limiti di richieste** (Auth → Rate Limits): lasciali ai valori standard o più stretti.
- Edge Functions: `link-device` con "Verify JWT" **attivo**; `notify-report` con "Verify JWT" **spento** (usa il segreto condiviso).
- Project Settings → API: la chiave `service_role` non deve comparire in nessun posto del sito o dei file `.env` che escono dal tuo PC.
- **Backup**: attiva i backup automatici (piano Pro) o fai un'esportazione periodica; è anche parte del lavoro "prima di vendere".
