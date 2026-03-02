# ❤️ Daglig Helse – Helseapp for Besteforeldre

En enkel, brukervennlig helseapp designet spesielt for eldre brukere. Store knapper, tydelig tekst og alle viktige funksjoner for å holde oversikt over daglig helse.

## 🌟 Funksjoner

### Kjernefunksjoner
- **💧 Vanninntak** – Tell glass med vann, se måloppnåelse med visuell fremgang
- **🚽 Toalettlogg** – Registrer dobesøk (nr. 2) med tidspunkt og merknader
- **💊 Medisinsporing** – Legg inn faste medisiner, motta påminnelser, registrer når tatt
- **❤️ Helselogg** – Humør, smertenivå, blodtrykk, puls og vekt
- **🆘 Nødkontakter** – Én-knapp-anrop til 113/110/112/legevakt + egne kontakter

### Livsstil
- **😴 Søvnsporing** – Registrer leggetid, våknetid og søvnkvalitet
- **🚶 Bevegelse** – Logg gåturer, hagearbeid, gymnastikk m.m.
- **📝 Dagbok** – Skriv daglige notater om livet
- **🛒 Handleliste** – Enkel handleliste med avkrysning

### Smarte funksjoner
- **🔔 Påminnelser** – Varsler for vann, medisin, bevegelse og daglig innsjekk
- **📅 Historikk** – Se data fra tidligere dager
- **✅ Daglig innsjekk** – "Jeg har det bra"-knapp for trygghet
- **🔤 Justerbar tekststørrelse** – Normal, stor eller ekstra stor tekst
- **📱 PWA** – Kan installeres som app på telefonen

### Teknisk
- **Firebase Firestore** synkronisering – data lagres trygt i skyen
- **Google-innlogging** – enkel og sikker pålogging
- **Offline-støtte** via Service Worker
- **Responsive design** – fungerer på mobil, nettbrett og PC

---

## 🚀 Slik setter du opp appen

### 1. Opprett Firebase-prosjekt

1. Gå til [Firebase Console](https://console.firebase.google.com/)
2. Klikk **Opprett prosjekt** → Gi det et navn (f.eks. `daglig-helse`)
3. Klikk på **</>** (web-app) for å legge til en webapp
4. Kopier `firebaseConfig`-verdiene

### 2. Konfigurer Firebase

**Authentication:**
1. Gå til **Authentication** → **Sign-in method**
2. Aktiver **Google** som innloggingsmetode
3. Under **Settings** → **Authorized domains**, legg til:
   - `dittbrukernavn.github.io`

**Firestore:**
1. Gå til **Firestore Database** → **Create database**
2. Velg **Start in production mode**
3. Velg en lokasjon nær deg (f.eks. `europe-west1`)

### 3. Oppdater firebase-config.js

Åpne `firebase-config.js` og erstatt plassholder-verdiene med dine egne fra steg 1.

### 4. Deploy til GitHub Pages

1. Opprett et nytt repository på GitHub (f.eks. `daglig-helse`)
2. Push koden:

```bash
git init
git add .
git commit -m "Initial commit - Daglig Helse app"
git branch -M main
git remote add origin https://github.com/DITTBRUKERNAVN/daglig-helse.git
git push -u origin main
```

3. Gå til **Settings** → **Pages** i GitHub-repoet
4. Under **Source**, velg **GitHub Actions**
5. Appen er nå tilgjengelig på: `https://dittbrukernavn.github.io/daglig-helse/`

### 5. Installer som app på telefonen

**Android (Chrome):**
1. Åpne appen i Chrome
2. Trykk på ⋮ menyen → **Installer app** / **Legg til på startskjermen**

**iPhone (Safari):**
1. Åpne appen i Safari
2. Trykk på Del-ikonet (↑) → **Legg til på Hjem-skjerm**

---

## 📁 Filstruktur

```
Besteforeldre-appen/
├── index.html              # Hoved-HTML med alle views
├── style.css               # Alle stiler (eldrevennlig design)
├── app.js                  # All app-logikk
├── firebase-config.js      # Firebase-konfigurasjon (REDIGER DENNE)
├── sw.js                   # Service Worker for offline & caching
├── manifest.json           # PWA-manifest
├── firebase.json           # Firebase-prosjektkonfigurasjon
├── firestore.rules         # Sikkerhetsregler for Firestore
├── firestore.indexes.json  # Firestore-indekser
├── package.json            # Prosjektinformasjon
├── README.md               # Denne filen
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions deploy-workflow
└── icons/
    ├── icon.svg            # App-ikon (SVG)
    ├── icon-192.png        # App-ikon 192x192
    └── icon-512.png        # App-ikon 512x512
```

## 🔒 Sikkerhet

- All data er beskyttet med Firebase Authentication
- Firestore-regler sørger for at brukere kun kan lese/skrive sine egne data
- Ingen sensitiv informasjon lagres i klient-koden
- HTTPS kreves via GitHub Pages

## 🖊️ Firestore-datastruktur

```
users/{uid}/
├── settings                     # Brukerinnstillinger
├── medicines/{medicineId}       # Faste medisiner
├── emergencyContacts/{id}       # Nødkontakter
├── lists/shopping               # Handleliste
├── waterLogs/{YYYY-MM-DD}       # Daglig vannlogg
├── bathroomLogs/{YYYY-MM-DD}    # Daglig toalettlogg
├── medicineLogs/{YYYY-MM-DD}    # Daglig medisinlogg
├── healthLogs/{YYYY-MM-DD}      # Daglig helselogg
├── sleepLogs/{YYYY-MM-DD}       # Daglig søvnlogg
├── movementLogs/{YYYY-MM-DD}    # Daglig bevegelseslogg
├── diaryLogs/{YYYY-MM-DD}       # Daglig dagbok
└── checkins/{YYYY-MM-DD}        # Daglig innsjekk
```

## 💡 Tips for besteforeldre

1. **Installer appen** på hjemskjermen for enkel tilgang
2. **Aktiver påminnelser** i innstillingene
3. **Legg til nødkontakter** – barnebarn, barn, lege
4. **Bruk "Ekstra stor" tekst** om det er vanskelig å lese
5. **Sjekk inn daglig** – det gir familiemedlemmer trygghet

---

Laget med ❤️ for besteforeldre som trenger litt ekstra hjelp i hverdagen.
