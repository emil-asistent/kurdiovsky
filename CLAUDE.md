# Kurdiovsky.cz — redesign

## What This Is
Redesign webu kurdiovsky.cz — Jan Kurdiovský, osobní finanční poradce (PFP). Nahrazuje starý WordPress/Elementor web i rozdělaný teal/gold návrh (`~/Desktop/Projekty Mac Mini/4 - Webové projekty (dev)/kurdiovsky-web`, preview kurdiovsky-web.djai.cz).

## Current State
- Status: CELÝ WEB POSTAVEN (homepage A na / + 6 podstránek), živý na preview — čeká na Emilovo OK a přepnutí kurdiovsky.cz
- Created: 2026-06-04
- Last session: 2026-06-05

## AI grafika — POZOR
- Google/Gemini API MRTVÉ (403 denied oba GCP projekty, i text modely) → grafika se generuje přes **Replicate FLUX**: `flux-kontext-pro` s `input_image` = živá URL hero fotky (grade-match) + „no readable text" v promptu; token v `~/Desktop/Claude code project/AI-API-KEYS.md`; na 429 rate-limit jet sekvenčně s retry (vzor /tmp/kurdiovsky-redesign/gen_replicate2.py)
- Vygenerováno (assets/img/): svc-plan, svc-notebook, svc-carkey (4:3 moody still-life od svíčky), chart-red + stmt-graph (červená křivka na černém papíře); originály v assets/gen/

## Reálná fakta (1:1 ze živého webu — NIKDY nevymýšlet!)
- Jan Kurdiovský, **PFP** (oborová zkouška), reference EFPA
- Claim: „Finanční poradenství bez přehnaných formalit, s důrazem na profesionalitu."
- **NEPRODÁVÁM PRODUKTY!** — tvoří smysluplné řešení v přehledném finančním plánu
- Osobní + **firemní** poradenství (spravuje několika firmám celé finanční portfolio)
- Specializace: financování a pojištění automobilů, poradenství pro malé a střední firmy, investice (konzervativní i krypto/NFT)
- Založil s přítelkyní firmu na potisk textilu **SUORIGO** → pohled majitele firmy
- Member of **money2u** (fotka před money2u stěnou)
- Instagram @jan_kurdiovsky (finanční reels), Facebook, TikTok
- Kontakt: jan@kurdiovsky.cz, tel 799 794 670, Tolstého 35, 616 00 Brno
- ŽÁDNÉ smyšlené statistiky (250+ klientů, 850M…), ŽÁDNÉ fake reference — starý návrh je měl, nový NE

## Brand
- Logo: bílé „JK" + červené stoupající sloupce/šipka (assets/img/jk-logo.webp)
- Brand barvy: tmavá (charcoal/black) + červená (#cf1f1f-ish z loga), živý web je dark+red
- Fotky: profi focení Sony A7R — assets/img/ (hero-table, jan-portrait, jan-money2u, jan-cutout s alfa kanálem)

## Design pravidla (Emilovy globální)
- Awwwards laťka — silná typografie, custom animace, asymetrie, NE basic landing
- Žádné AI-tells: žádné plovoucí glassmorphism dashboard kartičky, generické marketing fráze, emoji ikony
- Clean URLs — žádné `.html` v odkazech, vercel.json `cleanUrls: true, trailingSlash: false`
- Fotky vždy WebP, hero ≤200 KB

## Rozsah (Emil potvrdil 2026-06-04)
- 3 varianty homepage → Emil vybere → dotáhnout celý web
- Varianty: A) tmavá+červená editorial (JK brand), B) světlá premium krém/černá+červený akcent, C) bold brutalist
- Plný web: homepage, služby, o mně, rezervace, kontakt + **klientský portál (login + dashboard demo)**

## Key Files
- `a.html`, `b.html`, `c.html` — varianty homepage (každá self-contained CSS)
- `index.html` — rozcestník variant pro výběr
- `assets/img/` — optimalizované WebP fotky
- `assets/src/` — originály z živého webu

## Deployments
- **Preview variant ŽIVÉ: https://kurdiovsky-redesign.vercel.app** (/a, /b, /c; rozcestník na /)
- Vercel projekt: kurdiovsky-redesign (emilasistent-7377s-projects)
- Starý návrh: kurdiovsky-web.djai.cz (Coolify :8219) — nemazat, dokud Emil nevybere
- Produkce (později): kurdiovsky.cz — DNS v CF účtu cbe463a934abec056b2f9c9cb951f116

## Session Log
### 2026-06-04 — Setup + 3 varianty živé
- Projekt založen, fotky staženy z živého webu + WebP optimalizace (hero 52 KB)
- Analýza: živý web (WP/Elementor, dark+red, reálný obsah) vs starý návrh (teal/gold, fake obsah, AI-look)
- Emil: chce 3 varianty k výběru, web včetně klientského portálu
- Workflow (9 agentů): build → adversariální kritika → fix pro každou variantu, vizuální Playwright smyčky
- A = tmavá editorial (Fraunces×Manrope, moody hero, číslované služby 01–04, verdict good-with-fixes)
- B = světlá premium (krém, serif, rámovaná tmavá fotka mimo osu, pullquote „Neprodávám produkty.", verdict excellent)
- C = bold brutalist (15vw KURDIOVSKÝ, červené plochy, accordion služby, marquee, verdict good-with-fixes)
- Deploy na Vercel prod, všechny stránky 200, žádné rozbité obrázky

### 2026-06-04 (večer) — A vybrána + de-AI přestavba
- Emil vybral A; feedback: moc textu, nesmí vypadat jako AI, grafiku dogenerovat
- Text seškrtán ~50 % (hero/statement/služby/o mně/money2u/insta/footer)
- Služby: popisy pryč → hover image reveal (lerp tracking kurzoru, pointer:fine only); mobil = full-width image strip v položce
- Statement dostal stmt-graph.webp asymetricky; Instagram sekce teď používá jan-cutout na červeném panelu
- Kritika „excellent", 6 issues opraveno (duplicity obrázků, kontrast, marquee, EFPA formulace)
- Ověřeno mnou: hover reveal funguje (pozn. v headless testu vyžaduje pohyb myši se steps, ne teleport), mobil OK, live 200

### 2026-06-04 (noc) — Elevate na Awwwards úroveň
- Hero VIDEO: fotka rozpohybovaná přes Replicate bytedance/seedance-1-pro (Veo mrtvé) → ořez na stabilní úsek + ping-pong loop + color-match ffmpeg (eq brightness −0.055) → assets/video/hero-loop.mp4 (7,7 s, 1,5 MB) + hero-poster.webp; na mobilu/reduced-motion se video vůbec nenačítá (src vkládá JS jen na desktopu)
- Motion design: maskované line-revealy (H1 + nadpisy), custom cursor (tečka+lag kroužek), magnetická CTA, parallax fotek, SVG červená křivka kreslená scrollem ve statementu, tilt hover-revealu dle rychlosti myši, 2 protiběžné skloněné marquee (outlined text), PFP badge rotace, full-bleed money2u sekce, ghost „KURDIOVSKÝ" wordmark nad footerem, dýchající glow CTA
- Jeden sdílený rAF loop, vše vyplé při prefers-reduced-motion, žádný h-overflow 320–1920, konzole čistá
- Kritici motion+typo (oba good-with-fixes), 6/7 oprav (specificity dim/hover, footer sloupce, ořez Ý, re-routing křivky, full-bleed feature)
- Můj fix navíc: svc hover-reveal obrázky lazy+hidden = probliknutí na 1. hover → desktop idle preload (requestIdleCallback)
- POZN. pro testy: hover v headless Playwright vyžaduje mouse.move se steps PŘES element, hover() teleport eventy nespustí

### 2026-06-05 — Celý web postaven (podstránky + portál demo)
- FACTS.md = jediný zdroj faktů (vytěženo ze živého webu + ARES): IČO 11762390, reálné Google recenze (12, Trustindex), Calendly calendly.com/kurdiovsky, klientská appka MyPlann (App Store/Google Play), TikTok @jankurdiovsk; Facebook na živém webu nefunkční → nepoužívat; Reservio existuje, ale primární je Calendly
- Workflow 19 agentů: 6× build (sonnet jednoduché / opus složité) → 6× adversariální kritika → opravy → kontrola konzistence napříč
- Nové stránky: /sluzby (4 oblasti + 3 kroky spolupráce), /o-mne (příběh, SUORIGO, Co je PFP, money2u, 6 reálných recenzí), /rezervace (Calendly inline lazy embed v rámované kartě), /kontakt (velké kontakty, tmavá mapa lazy, fakturační údaje), /portal (DEMO login→dashboard, SVG křivka, jasně značená ukázková data + reálné MyPlann odkazy), /ochrana-osobnich-udaju (správce dle ARES, bez vymyšlených lhůt)
- index.html = varianta A (rozcestník přesunut na /varianty); a.html převedeno na absolutní /assets/ cesty
- Konzistence sjednocena: absolutní cesty, aria-current jen v nav (ne footer), „O mně" bez nbsp, CTA labely
- Ověřeno Playwright (desktop 1440 + mobil 390): 0 console errors, 0 failed requests, 0 h-overflow, revealy 100 % (POZOR: full-page screenshot s rychlým smooth-scrollem ukáže černé pásy — artefakt; pro screenshoty použít reduced_motion='reduce'), demo login/logout funkční, mapa se načítá (lazy, nutno scroll_into_view)
- Deploy Vercel prod, všech 9 URL 200

### 2026-06-05 (odpoledne) — Přecílení na hypotéky + investiční nemovitosti, uhlazení
- Emil: web byl „přeplácaný" + nové zaměření: investice, příprava na vlastní bydlení, investiční nemovitosti, financování s myšlením na DALŠÍ hypotéky (FACTS.md sekce ZAMĚŘENÍ — přepisuje starou strukturu služeb; firemní/auta pryč ze služeb)
- Hero video BEZ tváře: FLUX kontext-pro still-life (svíčka+klíče+půdorysy+červená křivka, grade-match na starý hero) → seedance-1-pro (Veo stále 403! Google API: listing 200, ale generativní modely denied) → 1. pokus měl artefakt (stoupající světelná tečka nad plamenem) → regenerace s „no sparks/embers/particles" = čistá → ping-pong loop 10 s, eq brightness +0.0217, 1,5 MB
- Nové AI fotky služeb: svc-klice/svc-pudorys/svc-dum.webp (1100×817), hero-poster + hero-table-mobile nahrazeny (stejné názvy = beze změny markup)
- Uhlazení: dvojitý marquee ODSTRANĚN, badge-spin → statický, pills max 3, breathe glow → statický gradient, kratší texty
- Workflow 18 agentů (rework→kritika→fix), pak ověřeno Playwright: 0 chyb, 0 overflow, video hraje, revealy 100 %; deploy Vercel prod OK
- a.html zůstává PŮVODNÍ varianta A (archiv) — aktuální web jen v index.html + podstránky

### 2026-06-05 (večer) — Vlastní rezervační systém (Calendly pryč)
- Zadání Emil: vlastní „calendly", termíny JEN út/st/čt 15:00, min 7 dní / max 2 měsíce dopředu, 1 termín na den
- **Backend:** `/api/slots` + `/api/book` (Vercel Functions, `api/_shared.js` = logika oken/termínů v Europe/Prague); úložiště **Vercel Blob** privátní store `kurdiovsky-rezervace` (store_laDiNwKBkqyqN9mm), klíč `bookings/<YYYY-MM-DD>.json`; honeypot pole `web`; dvojitá rezervace → 409
- **E-maily: Resend z `rezervace@kurdiovsti.cz`** (doména kurdiovsti.cz ověřena v Resend účtu tisk3d — DNS záznamy už v CF zóně byly; kurdiovsky.cz zóna NENÍ v našich tokenech dostupná → až bude, přidat doménu do Resend a přepnout env FROM_EMAIL). Notifikace jde na env `NOTIFY_EMAIL` (zatím emil.asistent@gmail.com — PŘED ostrým provozem přepnout/přidat jan@kurdiovsky.cz!), klient dostává potvrzení s ICS pozvánkou, reply-to jan@kurdiovsky.cz
- **Frontend:** booking widget na /rezervace (měsíční skupiny karet út/st/čt, výběr → formulář → potvrzení), lazy load přes IntersectionObserver; GDPR stránka aktualizována (Vercel+Resend místo Calendly)
- Env vars projektu: BLOB_READ_WRITE_TOKEN, RESEND_API_KEY, FROM_EMAIL, NOTIFY_EMAIL (production+development; preview nešlo přes CLI — nevadí)
- E2E ověřeno dev i PROD: validace (špatný den/okno/e-mail), rezervace, 409 na obsazený, oba e-maily doručeny do inboxu, slot se obsadí a po smazání blobu uvolní; testovací rezervace smazány
- Admin přehled rezervací zatím není (bloby + e-maily) — kandidát na /admin v další fázi
- POZOR lokální vývoj: `vercel dev --listen <port>` + `.env.local` (vercel env pull); mazání rezervace: node + @vercel/blob del('bookings/<date>.json')

## Open Threads
- **Emil: schválit přecílený web** → pak přepnout kurdiovsky.cz (DNS v CF účtu cbe463a934abec056b2f9c9cb951f116; rozhodnout Vercel vs Coolify dle deploy-routing pravidla — POZOR: rezervace běží na Vercel Functions + Blob, při přesunu na Coolify nutno přepsat API na Node server + lokální úložiště)
- **Před ostrým provozem rezervací:** NOTIFY_EMAIL přepnout na jan@kurdiovsky.cz (+ ponechat Emila v kopii?), zvážit FROM rezervace@kurdiovsky.cz (potřeba přístup k CF zóně kurdiovsky.cz)
- Ověřit s Janem přesný vztah k EFPA (certifikace vs reference) PŘED ostrým nasazením
- Portál je DEMO — ostrý klientský portál = samostatná budoucí fáze
- Varianty B/C nechány živé na /b /c pro porovnání (zatím bez video/motion upgradu)
