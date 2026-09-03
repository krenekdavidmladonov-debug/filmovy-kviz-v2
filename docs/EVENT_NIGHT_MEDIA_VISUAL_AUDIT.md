# Event-night media and visual audit

Tento nástroj provádí izolovaný, výchozím nastavením read-only audit privátního kandidáta. Používá výhradně projekt `demo-filmovy-kviz-v2-background-audit`, alternativní localhost porty a produkční webový build servírovaný Hosting Emulatorem.

## Bezpečnostní hranice

- Původní V1 export se pouze čte a jeho SHA-256 se ověřuje před i po auditu.
- Kandidát se migruje jen do čerstvého izolovaného emulatoru.
- Vizuální sweep používá moderátorský read-only editor. Lokální answer preview nic nepublikuje.
- Síťové, media lifecycle a recap scénáře používají pouze syntetické fixtures.
- Nástroj nemá production override, deployment ani cestu k V1 Firebase.
- Screenshoty, media ID/URL a detailní výsledky zůstávají pod `.local-data/background-event-night-audit/`.

## Příkazy

```text
pnpm audit:event-night:visual
pnpm audit:event-night:media
pnpm audit:event-night:network
pnpm audit:event-night:all
```

Kompletní běh vytváří lokální galerii `visual-gallery/index.html`, sanitizovaný JSON souhrn a krátký fyzický QA shortlist. Výsledky automatických layout kontrol jsou technické diagnostiky; nejsou estetickým schválením.

## Rozsah posledního auditu

Auditovaný kandidát měl revision `0`, 63 prezentačních záznamů, 5 kol a 50 otázek: 15 Choice, 10 Free, 5 legacy PL, 10 Audio a 10 Video. Readiness před i po běhu zůstal na 16 blockerech a 26 warnings; jeden Video timing problém zůstává jako `R2 Q8 — HUMAN TIMING REQUIRED`.

| Kontrola | Výsledek |
| --- | --- |
| Production build + Hosting Emulator | PASS |
| Vizuální průchod | 63 slidů, 252 viewport kontrol, 113 local-only screenshotů |
| Viewporty | 1920×1080, 1600×900, 1366×768, 1280×720; admin 390×844 |
| Směr průchodu | 2× vpřed, 2× zpět |
| Layout P0/P1/P2/P3 | 0 / 0 / 0 / 0 |
| Console / page / request errors | 0 / 0 / 0 |
| Přechod mezi slidy | medián 8 ms, p95 12 ms |
| DOM růst | 0 |
| Candidate mutation / candidate public session | žádná / žádná |
| Network/error browser matrix | 4/4 PASS se dvěma P2 findings |

Automatický sweep technicky pokryl celý kandidát v question a privátním recap preview. Nejde o estetické schválení. Candidate nemá Image otázku; syntetický Image scénář ověřil oddělený contained obrázek, černé pozadí a neveřejný answer model, ale odhalil chybějící profesionální fallback pro rozbitý obrázek.

## Média

Aktuální inventory obsahuje 20 Audio a 20 Video raw referencí, 20 sémantických použití a 20 unikátních validně parsovaných YouTube zdrojů. Jeden zdroj může být v privátním modelu reprezentován více zachovanými raw poli; číslo raw referencí proto není počet playerů.

| Klasifikace unikátních zdrojů | Počet |
| --- | ---: |
| PLAYABLE | 0 |
| PLAYABLE_AFTER_ACTIVATION | 0 |
| EMBED_DENIED | 3 |
| UNAVAILABLE | 0 |
| TIMEOUT | 17 |
| INVALID_SOURCE | 0 |
| UNVERIFIED | 0 |

Schválený read-only probe všech 20 unikátních zdrojů proběhl sekvenčně přes oficiální YouTube IFrame API, s nejvýše dvěma pokusy na zdroj, omezeným timeoutem a nejvýše jedním playerem. API bylo dostupné; 20 playerů bylo vytvořeno a 20 zničeno, po cleanupu nezůstal žádný aktivní player. `EMBED_DENIED`: `R2 Q7 AUDIO`, `R2 Q8 VIDEO`, `R5 Q7 AUDIO`. `TIMEOUT`: `R1 Q6 AUDIO`, `R1 Q7 AUDIO`, `R1 Q8 VIDEO`, `R1 Q9 VIDEO`, `R2 Q6 AUDIO`, `R2 Q9 VIDEO`, `R3 Q6 AUDIO`, `R3 Q7 AUDIO`, `R3 Q8 VIDEO`, `R3 Q9 VIDEO`, `R4 Q6 AUDIO`, `R4 Q7 AUDIO`, `R4 Q8 VIDEO`, `R4 Q9 VIDEO`, `R5 Q6 AUDIO`, `R5 Q8 VIDEO`, `R5 Q9 VIDEO`. Candidate revision a fingerprint zůstaly shodné, nevznikla žádná candidate session a zdrojový read-only hash se nezměnil.

## Findings

- `P2 OFFLINE_SAFETY_COPY_OVERWRITTEN`: projektor při offline stavu správně odstraní stale slide i answer, ale následná listener chyba přepíše přesnější bezpečnostní vysvětlení obecným connection textem. Recovery funguje.
- `P2 SYNTHETIC_IMAGE_BROKEN_FALLBACK_MISSING`: layout Image otázky zůstane stabilní, ale při chybě zdroje není vlastní profesionální fallback.
- P0: 0.
- P1: 0 v provedených lokálních kontrolách. Externí probe nepotvrdil žádný přehratelný zdroj a kandidát má nadále 16 známých content blockerů.

## Quality gate

Node 22 a JDK 21: dependency lock PASS; `pnpm check` PASS; unit/component/audit 154/154; Functions 29/29; Rules 15/15 na izolovaném portu; migration validate a dry-run PASS pro 4 kvízy / 315 slidů / 23 kol / 263 otázek; fresh isolated migration, browser matrix, source read-only hash a candidate fingerprint PASS. Kontrolovaný soak pokrývá 1 000 state transitions a 300 media lifecycle operací bez unauthorized answer renderu; heap/listener/timer profilování zůstává `UNVERIFIED`.

## Human QA

Před eventem je stále nutné opravit 16 obsahových blockerů. `R2 Q7 AUDIO`, `R2 Q8 VIDEO` a `R5 Q7 AUDIO` vyžadují náhradu nebo ruční ověření embedu; `R2 Q8 VIDEO` navíc potřebuje lidské rozhodnutí o timingu. Všech 17 položek se stavem `TIMEOUT` vyžaduje fyzické ověření dostupnosti, user activation, slyšitelného zvuku, START/END, STOP/REPLAY, HDMI, fullscreen/projektoru a recap od 0:00. Tento audit neopravňuje merge ani deployment.
