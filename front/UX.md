# coach-km-app: mobile UX/UI brief

Every front issue follows this brief. The app is used **mostly on a phone, in a mobile browser** (installed as a PWA
when possible). Design for a 360×640 screen first and scale up; never the other way round.

UI language: **French** (all labels, messages, dates `dd/mm/yyyy`, numbers `1 234,5`, money `1 234,56 €`).

---

## 1. Users and context

| Persona | Situation | What they need |
|---|---|---|
| **Coach bénévole** (most users) | In the car park after a match or training, phone in one hand, sometimes poor signal. Not tech-savvy, 20–70 years old. | Log a trip in **under 30 seconds**, see "how much have I accumulated this year", never lose an entry. |
| **Coach, end of year** | At home, once a year. | Check the year, export the récapitulatif, decide to waive reimbursement, get the tax receipt. |
| **Président** | Occasionally, at the end of the year. | See every coach, who has waived, issue receipts in a few taps. |

**Frequency drives priority:** adding a trip happens weekly; everything else is monthly or yearly. The fastest
path in the app must be *open → add trip → save*.

## 2. Key journeys (design and test these first)

1. **Quick log (main):** open the app → big "+" button → form pre-filled (today's date, last vehicle, last
   origin) → type the destination and distance → Save. **3 taps + 2 fields.**
2. **Repeat a recurring trip:** in the trips list, "Refaire" on a past trip → form pre-filled with everything
   except the date (today) → Save.
3. **Offline log:** no signal → the trip is saved locally, a discreet "En attente de synchronisation" chip shows
   on the item → it syncs by itself when the network is back. Never show a blocking error for being offline.
4. **End of year:** Export → pick year → download PDF/CSV → "Renoncer au remboursement" (with a clear warning)
   → once the president issues the receipt, "Télécharger mon reçu fiscal".
5. **President:** Admin → year → list of coaches with status chips → "Émettre le reçu" → download.

## 3. Layout and navigation

- **Bottom navigation bar** (thumb zone), max 4 items: **Accueil**, **Trajets**, **Véhicules**, **Plus**.
  "Plus" opens Export/Abandon de frais, Profil, Admin (president only) and Déconnexion.
- **Floating action button "+" (Ajouter un trajet)** on Accueil and Trajets, bottom right, above the bottom nav.
  This is the primary action of the app.
- **Top app bar**: screen title + **year selector** (chip, defaults to the current year) on the screens that are per year.
- Forms open as a **full-screen dialog on mobile** (Vuetify `v-dialog fullscreen` under `md`), with the
  primary button **at the bottom, full width, sticky**, so it stays reachable above the keyboard.
- From `md` up (tablet/desktop): bottom nav becomes a navigation rail/drawer, and forms become centred dialogs (max 560 px).
  Content max width 960 px.
- Respect safe areas (`env(safe-area-inset-bottom)`) for the bottom nav and sticky buttons.

## 4. Interaction rules

- **Touch targets ≥ 48×48 px**, ≥ 8 px apart. No action reachable only by hover or long-press.
- **Inputs at 16 px font minimum** (prevents iOS zoom on focus). One column. Labels always visible (no placeholder-only fields).
- **Right keyboard for each field:** distance `inputmode="decimal"`, registration number `inputmode="numeric"`,
  email `type="email"` + `autocomplete="email"`, password `autocomplete="current-password"`/`"new-password"`,
  postal code `inputmode="numeric"` + `autocomplete="postal-code"`.
- **Smart defaults everywhere:** date = today, vehicle = the last one used (or the only one), origin = the last origin.
  Offer the coach's frequent destinations as autocomplete suggestions (computed from their trips).
- **Round trip:** a switch "Aller-retour", **on by default** (coaches mostly drive there and back). Show
  "Km retenus : 2 × 32,5 = 65 km" live under it.
- **Live € preview** under the distance: "≈ +20,67 € sur l'année", computed with the tiered barème from `/rates`
  (the extra amount this trip adds to the vehicle's year). Label it as an estimate.
- **Validation:** inline, on blur and on submit, in plain French ("Indiquez la distance en km"). Map API `{ error }`
  messages to the field when possible. Never clear the form on error.
- **Feedback:** after a save, a snackbar "Trajet enregistré" with an **"Annuler"** action (undo = delete) instead of
  a confirmation dialog. Use confirmation dialogs only for irreversible or heavy actions (waiver, issuing a receipt).
- **Loading:** skeleton loaders for lists and cards, never a full-screen spinner. Buttons show their own loading state
  and are disabled while submitting (no double submit).
- **Empty states** explain and offer the next action: "Aucun trajet en 2026. Ajoutez votre premier trajet." + button.
- **Locked year (waiver done):** trips of that year are shown read-only with a lock icon and the banner
  "Année 2025 clôturée : vous avez renoncé au remboursement." The edit, delete and FAB actions are hidden for that year.
- **Offline:** a thin banner at the top, "Hors ligne : vos trajets seront synchronisés", plus a sync chip on pending items.
- **Swipe** is optional sugar only; every swipe action must also exist as a visible button or menu.

## 5. Screens

### Connexion / Inscription
- Logo + app name, one column, big fields. Inscription: e-mail, numéro de licence (13 digits, hint
  "Commence par 5655006"; spaces allowed), prénom, nom, mot de passe (≥ 8, show/hide toggle).
- Errors 409 → under the relevant field ("Cet e-mail est déjà inscrit").

### Accueil (dashboard)
- **Hero card:** "2026 · 1 234,56 €" (big) + "2 345 km" + small note "Estimation selon le barème" (the barème source in a
  tooltip or bottom sheet).
- **Mini bar chart by month** (12 bars, current month highlighted, tap a bar for km and €). Keep it simple and readable at 360 px.
- **Per-vehicle list** (label, category "Voiture 5 CV", km, €).
- **Last 3 trips** with "Voir tout" and "Refaire".
- If the address is missing at year end, or the year is waivable, show a gentle call-to-action card to Export.

### Trajets
- Grouped by month (sticky month headers with the month's km), newest first.
- Each item: date (short "sam. 12/04"), "Créteil → Évry", purpose (secondary line), billed km on the right,
  "A/R" chip, and a pending-sync chip if any.
- Tap the item to open it for editing; an overflow menu has Refaire / Supprimer.

### Formulaire trajet (full screen)
Order: Date · Véhicule (select, only shown if there's more than one vehicle) · Départ · Arrivée · Motif (with
suggestions: Match, Entraînement, Tournoi, Réunion) · Distance (km, one way) · Aller-retour switch · live km and € preview
· sticky **Enregistrer**.

### Véhicules
- Cards: label, "Voiture · 5 CV · électrique". Add/edit form: Libellé, Type (segmented buttons Voiture / Moto /
  Cyclomoteur), Puissance fiscale (CV) (hidden for Cyclomoteur; hint "Voir la case P.6 de la carte grise"),
  Électrique switch (hint "+20 % sur le barème").
- No vehicle yet → the trip form first asks to create one (inline, not a dead end).

### Export & abandon de frais (from "Plus")
- Year selector, two big buttons: "Télécharger le PDF" / "Télécharger le CSV".
- **Abandon de frais** card, step by step:
  1. Explain in 2 lines (you give up the reimbursement and receive a tax receipt giving 66% back as a tax reduction).
  2. If the address is missing → a button to Profil.
  3. "Renoncer au remboursement de X €" → confirmation dialog stating that the year's trips will be locked.
  4. Status: Renonciation enregistrée (withdraw possible) → Reçu émis n° 2025-0001 → "Télécharger mon reçu fiscal".

### Profil
- Identity (read-only: e-mail, numéro de licence), editable first/last name and **postal address**, then Déconnexion.

### Admin (président only, hidden otherwise)
- Year selector, filter chips (Tous / À émettre / Émis / Sans renonciation).
- One card per coach: name, licence number, km, €, status chip; the primary action "Émettre le reçu" when waived and
  no receipt yet (confirmation dialog), then "Télécharger".

## 6. Visual system (Vuetify 3 theme)

- Material 3 base via Vuetify. **One primary colour**: handball/sport blue `#1E5AA8`; secondary orange `#F28C28`
  (used sparingly for the FAB and highlights); success `#2E7D32`, warning `#ED6C02`, error `#C62828`.
- Background `#F6F7F9`, surfaces white, rounded corners 12 px (cards) / 24 px (FAB), soft elevation (1–2).
- **Dark theme** supported via `prefers-color-scheme`; check contrast in both themes.
- Typography: Vuetify default (Roboto) or system font stack; body 16 px, money figures with `font-variant-numeric: tabular-nums`.
- Icons: `@mdi/font` (`mdi-car`, `mdi-motorbike`, `mdi-moped`, `mdi-lightning-bolt` for electric, `mdi-lock` for locked, `mdi-cloud-sync` for pending).
- Spacing scale 4/8/16/24. Screen side padding 16 px.

## 7. Accessibility (WCAG 2.1 AA)

- Text contrast ≥ 4.5:1, never colour alone for status (chips have icon + text).
- Every icon-only button has an `aria-label` in French. Focus visible. Logical tab order in forms.
- Respect `prefers-reduced-motion`. Zoom up to 200% without horizontal scroll at 360 px.
- `lang="fr"` on `<html>`.

## 8. Performance (mobile, possibly 3G)

- Route-level code splitting (lazy routes). Only the Vuetify components actually used (auto-import via `vite-plugin-vuetify`).
- Initial JS ≤ ~200 KB gzip; Lighthouse mobile Performance ≥ 90, Accessibility ≥ 95.
- Cache-first app shell (service worker), network-first for API GETs, optimistic UI for trip mutations.
- No layout shift: reserve space for charts and skeletons.

## 9. Definition of done (UI)

- Verified at **360×640** and **390×844** in the browser's device mode, in light and dark themes.
- The quick-log journey takes ≤ 3 taps + 2 fields from the dashboard.
- No horizontal scroll and no element under the bottom nav or the keyboard.
