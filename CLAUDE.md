# Kurdiovsky.cz — redesign

## What This Is
Redesign webu kurdiovsky.cz — Jan Kurdiovský, osobní finanční poradce (PFP). Nahrazuje starý WordPress/Elementor web i rozdělaný teal/gold návrh (`~/Desktop/Projekty Mac Mini/4 - Webové projekty (dev)/kurdiovsky-web`, preview kurdiovsky-web.djai.cz).

## Current State
- Status: VARIANTY — 3 designové směry pro Emilův výběr
- Created: 2026-06-04
- Last session: 2026-06-04

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
- Preview variant: Vercel (nový projekt kurdiovsky-redesign)
- Starý návrh: kurdiovsky-web.djai.cz (Coolify :8219) — nemazat, dokud Emil nevybere
- Produkce (později): kurdiovsky.cz — DNS v CF účtu cbe463a934abec056b2f9c9cb951f116

## Session Log
### 2026-06-04 — Setup + varianty
- Projekt založen, fotky staženy z živého webu + WebP optimalizace
- Analýza: živý web (WP/Elementor, dark+red, reálný obsah) vs starý návrh (teal/gold, fake obsah, AI-look)
- Emil: chce 3 varianty k výběru, web včetně klientského portálu

## Open Threads
- Emil vybere variantu A/B/C → dotáhnout celý web
- Rozhodnutí o produkci (nahradit WordPress) — viz coolify-migrace-mapa
