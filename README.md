# Alfa Plast — Praćenje poslova

Web aplikacija (mobilna + desktop, responsive) za praćenje bauštela, zadataka, voznog parka, farbanja i narudžbi. Tri uloge: **Administrator**, **Majstor**, **Vozač**. Sve na hrvatskom.

## Funkcionalnosti

**To-do lista**
- Admin (Toni/Josip) kreira zadatke i **dodjeljuje ih većem broju ljudi odjednom**
- Statusi: **Poslano → Primljeno → Završeno** — **svaki izvršitelj vodi svoj status**; zadatak je završen tek kad su svi gotovi
- Admin može postaviti status pojedinoj osobi ili svima odjednom, te naknadno mijenjati popis izvršitelja
- Komentari na svakom zadatku (npr. "rok čekanja", "staklo dolazi 27.7.")
- Obavijest kad je zadatak poslan; automatski podsjetnik svaka 24 h svakom izvršitelju koji je zadatak "Primljeno" (podesivo kroz `REMINDER_HOURS`)

**Bauštele**
- Ime bauštele, adresa, napomena i planirani datum montaže
- Status bauštele postavlja administrator: **U pripremi → Spremno za montažu → U tijeku → Završeno**; od "Spremno za montažu" nadalje bauštela je **vidljiva majstorima i vozačima** (prije toga vide je samo admini)
- Planirani datum montaže → 3 dana ranije automatski se kreira podsjetnik u to-do listi (podesivo kroz `JOB_REMINDER_DAYS`)
- Komentari, dnevni napredak, napomena za sljedeću ekipu, fotografije i prijava problema s fotkom

**Tijek rade (majstori i admin)**
- Dvije sekcije na bauštelima: **Što je odrađeno** i **Što se mora odradit**
- Svaki zapis ima **koje majstore** (može ih biti više), **datum** kad su bili i **komentar** — sve je opcionalno
- Stavke iz "Što se mora odradit" označavaju se gumbom **✔ Odrađeno** (postaju zelene)
- Vozači tijek rade vide, ali ne upisuju

**Arhiva bauštela (admin)**
- U bauštelama su dvije kartice: **Aktivne** i **Arhiva**
- Pri arhiviranju administrator upisuje **ime majstora (može ih biti više)** i **datum**; ti se podaci vide na kartici u arhivi i mogu se naknadno urediti
- Bauštela se može vratiti iz arhive, a upisani podaci ostaju sačuvani

**Vozila (vozni park)**
- Vozila su vidljiva svim ulogama; **kvar može prijaviti bilo koja uloga**, a na istom vozilu može biti **više otvorenih kvarova** istovremeno
- Status vozila je izveden: **U kvaru** dok postoji ijedna neriješena prijava; kvar rješava administrator (prijavitelj dobiva obavijest)
- Klikom na **karticu vozila** otvara se detalj s kvarovima i servisnom poviješću (ne kroz "Uredi")
- Servisnu povijest upisuje samo administrator: **izmjena ulja, registracija, periodični tehnički pregled**
- **Izmjenu ulja vide sve uloge** (datum, kilometraža i **kilometraža iduće izmjene**); registracija i tehnički su **privatni — vidi ih samo administrator**

**Farbanje**
- Administrator vodi evidenciju artikala za farbanje; evidencije su vidljive svim ulogama
- Atributi evidencije: **vozač, datum, mjesto farbanja** i popis **artikala**
- Mjesta farbanja su u bazi (početno **Nova bila** i **Herkam**) — administrator ih može dodavati; mjesto koje se već koristi se deaktivira umjesto brisanja
- **Kvačica po artiklu** označava da je ofarbano — artikl u evidenciji postaje zelen; kvačicu smiju staviti administrator i vozač s te evidencije
- **Pretraga po datumu (raspon), mjestu farbanja i nazivu artikla**

**Narudžbe (samo administratori)**
- Ulaz su **kartice dobavljača** (početno **REHAU, FEAL, Emerus, Kristal**) — administrator ih može dodavati
- **Klikom na karticu** ulazi se u dobavljača, gdje se kreira narudžba: **datum, artikli (naziv + količina), rok isporuke (opcionalno)**
- **Kvačica po artiklu** = zaprimljeno, artikl postaje zelen; rok isporuke se boji kad se bliži ili je probijen
- **Pretraživanje po artiklu** — unutar dobavljača i kroz sve dobavljače odjednom

**Obavijesti**
- Svi dobivaju obavijesti o relevantnim događajima (zvono u headeru, brojač nepročitanih)
- Svaki korisnik u Postavkama može **utišati obavijesti od pojedinog korisnika**
- Problemi se šalju svima, tijek rade i ostali zapisi adminima, "spremno za montažu" svima

## Struktura

```
├── db/schema.sql        # PostgreSQL shema (pokreće se automatski pri startu)
├── server/              # Express API (Node 20+, ESM)
│   ├── index.js         # ulaz + scheduler podsjetnika
│   ├── seed.js          # početni korisnici
│   └── routes/          # users, tasks, jobs, notifications, vehicles, painting, orders
├── client/              # React + Vite + TypeScript
└── Dockerfile           # build za Railway
```

## Lokalno pokretanje

1. PostgreSQL baza (lokalno ili Docker), pa u `server/`:
```bash
cd server
npm install
cp ../.env.example .env      # i uredi DATABASE_URL, JWT_SECRET (.env se automatski učitava)
npm run seed                  # kreira Tonija, Josipa, Iku...
npm run dev                   # API na :3000
```
2. U drugom terminalu:
```bash
cd client
npm install
npm run dev                   # frontend na :5173, proxy prema :3000
```

Početni korisnici (odmah promijeniti lozinke!):
| Korisničko ime | Lozinka | Uloga |
|---|---|---|
| toni | toni1234 | Administrator |
| josip | josip1234 | Administrator |
| iko | iko1234 | Majstor |
| vozac | vozac1234 | Vozač |

## Deploy na Railway

1. Push repozitorija na GitHub, u Railwayu **New Project → Deploy from GitHub** (Dockerfile se detektira sam)
2. Dodaj **PostgreSQL** servis — Railway sam ubaci `DATABASE_URL` (poveži varijablu na app servis: `${{Postgres.DATABASE_URL}}`) i postavi `PGSSL=true`
3. Postavi `JWT_SECRET` na dugi nasumični string
4. **Volume**: dodaj Railway Volume montiran na `/data` (tu se spremaju fotografije — bez volumena nestaju pri svakom deployu!)
5. Jednokratno pokreni seed: `railway run npm run seed` (iz `server/` direktorija) ili privremeno dodaj `node seed.js &&` ispred CMD-a
6. Generiraj VAPID ključeve za push obavijesti i postavi ih kao env varijable (vidi ispod)

## Push obavijesti (rade i kad je aplikacija zatvorena)

Aplikacija koristi Web Push (PWA service worker + VAPID), ne treniranje na Firebase/APNs — radi u Chromeu/Edgeu na Androidu odmah, a na iOS-u tek nakon što korisnik doda app na Home Screen (Safari ograničenje, ne naše).

1. Generiraj ključeve jednom:
```bash
npx web-push generate-vapid-keys
```
2. Postavi u env (Railway varijable ili `server/.env`):
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:tvoj@email.hr
```
3. Korisnik uključuje obavijesti u **Postavke → Push obavijesti** (traži dozvolu preglednika, radi po uređaju/pregledniku — treba uključiti na svakom uređaju posebno)
4. Bez postavljenih ključeva aplikacija radi normalno, samo se push tiho preskače (server ispiše upozorenje u log)

## Napomene za širenje

- Kategorije bauštela već postoje u shemi (`staklene_ograde`, `pvc_stolarija`, `alu_stolarija`) — PVC i ALU se kasnije dodaju bez promjene baze
- Tablica `job_items` ostaje u shemi radi povijesnih zapisa, ali se više ne koristi (zamijenio ju je tijek rade)
