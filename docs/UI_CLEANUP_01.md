# JustKvíz — etapa 1A: úklid úvodního rozhraní

Stav k 16. 9. 2026: **LOKÁLNĚ IMPLEMENTOVÁNO A OVĚŘENO. NENASAZENO.**

## Výchozí stav

- Výchozí SHA: `456f3eb62d5c52841afc3f055159711f279d11d3`.
- Pracovní větev: `codex/justkviz-ui-cleanup-01`.
- Worktree: `C:\Projects\filmovy-kviz-worktrees\justkviz-ui-cleanup-01`.
- Základ určen z místního dokončeného release reportu PR #32: `C:\Projects\filmovy-kviz-v2\.local-data\justkviz-event-management\.local-data\event-management\REPORT.md`. Report eviduje dokončené nasazení tohoto SHA a závěrečnou kontrolu 16. 9. 2026 ve 14:20 UTC. Současný cloudový stav nebyl znovu čten.
- Nebyl použit starší hlavní worktree ani automaticky `main`. Historický rebrand `40c124e` je předkem vybraného základu. Novější základ zahrnuje tmavý vzhled, osobní přístupy a správu akcí.
- Před implementací bylo všech 34 existujících worktrees bez sledovaných i nesledovaných rozpracovaných změn. Závěrečná kontrola potvrzuje změny pouze v novém worktree. Ignorované místní release podklady zůstaly zachovány. Úplný seznam cest, větví, HEAD a stavů: [worktree-inventory.json](../.local-data/ui-cleanup/worktree-inventory.json).

| Relevantní worktree / větev | HEAD | Stav při zahájení |
| --- | --- | --- |
| Hlavní / `chore/v2-staging-environment` | `81a24c85b0fc187876a6421c29c15b7d0101a5b3` | Čistý, starší základ |
| `codex/justkviz-rebrand` | `40c124ec38cc709e65bfb33c80de371a01eaba3a` | Čistý |
| `codex/justkviz-dark-mode` | `17526c0fa5c9fdaabeb167a546282f78fb0208e4` | Čistý |
| `codex/owner-takeover` | `be094fd17e18276130678952cf69417ce917245e` | Čistý |
| `codex/justkviz-event-management` | `456f3eb62d5c52841afc3f055159711f279d11d3` | Čistý, poslední místně doložený dokončený release |

## Co se mění pro uživatele

- U značky je na desktopu i mobilu decentní štítek **Testovací verze**. Stejně jako dosud se řídí výhradně `VITE_APP_ENV === 'staging'`.
- Omezení testovacího provozu zůstává přímo viditelné: **Pro zkoušení používejte pouze smyšlená data.** Věta stanoví pravidlo pro zkoušení; netvrdí, že veškerý již uložený obsah je smyšlený. Nic není schováno do tooltipu a žádná data se neupravovala.
- Menší nadpis **Přehled**, méně prázdného místa, sjednocený pás akcí **Nový kvíz / Vytvořit akci / Kvízy / Akce**. Odkazy používají existující cesty a kontroly `can('quiz.create')`, `can('event.create')`, `can('quiz.read')`, `can('event.read')`.
- Vytváření vede na původní formuláře `/admin/quizzes/new` a `/admin/events/new`. Router, formuláře, ověřování členství a serverová oprávnění se nemění. `AuthProvider` nadále odvozuje `can` z aktivního členství; server kontroluje oprávnění a rozsah samostatně.
- **Pokračovat** stále vybírá první koncept ze seznamu seřazeného podle úpravy, jinak první kvíz. Nezaměňuje poslední úpravu za poslední otevření. Zůstává skutečný popis, pokud existuje, a datum úpravy. Obecná věta o připravenosti je odstraněna, počty se nepřidávají.
- Prázdný seznam doporučuje vytvoření kvízu, nebo požádání správce o přístup podle oprávnění. Načítání, chyba a opakování načtení zůstávají funkční.
- Mobilní tlačítka mají dva sloupce, karty se řadí pod sebe a dlouhé názvy se zalamují. Hlavička se již neroztahuje do výšky u krátkého nebo prázdného obsahu.

## Upravené soubory

1. `apps/web/src/app/AdminShell.tsx` — štítek a srozumitelné upozornění.
2. `apps/web/src/routes/admin/AdminPage.tsx` — kompaktní přehled, existující akce a prázdný stav.
3. `apps/web/src/styles/global.css` — styly přehledu, štítku a mobilní výška hlavičky.
4. `tests/adminDashboard.test.tsx` — 14 cílených kontrol UI a počtu čtení.
5. `vitest.config.ts` — zapojení testu do stávající sady.
6. `docs/UI_CLEANUP_01.md` — tento report.

Lokální screenshoty, náhledový server, browser kontrolní skript a logy jsou ignorované pod `.local-data/ui-cleanup/`. `.env.local` je pouze kopie `.env.example` s `demo-filmovy-kviz-v2` a emulátory, mimo Git. Závislosti byly připraveny ze zamčené místní cache přes `pnpm install --offline --frozen-lockfile --ignore-scripts`; lockfile a knihovny se nemění.

## Výsledky kontrol

Před spuštěním byly přečteny package scripts, Vite/Vitest konfigurace a Git hooky. Spuštěné příkazy neobsahují deploy, migraci ani cloudový inventář. Build pouze kompiluje zdroje; nespouští Functions.

| Kontrola | Výsledek a důkaz |
| --- | --- |
| `pnpm check` — typecheck, lint, build | **PASS**, včetně opakování po opravě mobilní hlavičky; [check.log](../.local-data/ui-cleanup/check.log) |
| `pnpm test:unit` | **PASS**, 41 souborů / 377 testů, z toho 14 kontrol přehledu; [unit.log](../.local-data/ui-cleanup/unit.log) |
| Štítek podle konfigurace | **PASS**, staging zobrazuje štítek i viditelné omezení; production/development/nezadaná hodnota je nezobrazují. Jde o test UI, nikoli připojení k produkci. |
| Čtyři hlavní odkazy | **PASS**, skutečný router otevřel existující seznamy a formuláře. |
| Uživatel bez práva vytvářet | **PASS**, odkazy chybí, přímé cesty odmítá původní PermissionGate, Pokračovat vede do detailu. Testovány také oddělené sady oprávnění pro kvízy a akce. |
| Načítání, chyba, opakování, prázdný seznam | **PASS**, oba prázdné stavy dle oprávnění, chyba nezobrazuje prázdný seznam, retry obnoví obsah. |
| Desktop/mobil a dlouhé názvy | **PASS**, Chromium 1440/1100/1024/768/390/320 px, bez vodorovného přetečení, tlačítka nejméně 44 px, mobilní hlavička se nenatahuje. Snímky vizuálně zkontrolovány. |
| Klávesnice a čitelnost | **PASS**, Tab prochází akce v pořadí, viditelný 3px focus, Enter otevře sekci. Nejnižší naměřený kontrast kontrolovaných textů 6,40 : 1; nejde o úplný audit přístupnosti. |
| Žádná nová čtení | **PASS**, před i po `[quizzes, quizzes]` v development StrictMode; při renderu bez StrictMode unit test potvrzuje jedno čtení. U profilu bez `quiz.read` nula. Repository, effects a datová vrstva beze změny. |
| Externí požadavky browser QA | **PASS**, povolen pouze `127.0.0.1`, externí pokusy 0, chyby browseru 0. |
| Rozsah diffu a zachování původních worktrees | **PASS**, `git diff --check`; beze změn Functions, Auth, Rules, indexů, Storage, konfigurace nasazení, závislostí a datových dotazů. |
| Skutečné přihlášení, serverové vytváření a Security Rules v emulátoru | **NEOVĚŘENO** v tomto kroku: browser používá náhradu Auth a datového rozhraní s lokálními fixtures. Nebyla spuštěna emulator E2E ani `pnpm test:rules`; autorizační implementace se nemění. |
| Nasazená aplikace a cloudová data | **NEOVĚŘENO**, záměrně bez cloudového přístupu. |

Browser ověření spouští skutečnou aplikaci a původní router, nahrazuje jen AuthProvider a hranici privateRead. Data pocházejí z deklarovaných fixtures v `functions/src/dev/seed-quizzes.ts`; seed skript se nespouští. Zápisy jsou v náhledu zakázané. [Browser výsledky](../.local-data/ui-cleanup/browser-results.json), [srovnání čtení před úpravou](../.local-data/ui-cleanup/before-results.json).

Při přípravě QA byly opraveny lokální ESM cesta na Windows a tvar fixture odpovědi stránkovaného seznamu akcí. Následný kompletní browser běh je PASS. Při vizuální kontrole nalezené natažení mobilní hlavičky je opraveno a znovu ověřeno. Build hlásí stávající upozornění na velikost JS balíčku a lokální Node 24 oproti deklarovanému Functions Node 22; backendový runtime zde nebyl spouštěn.

## Screenshoty před a po

Všechny snímky vznikly lokálně se stejnými testovacími podklady, nikoli z cloudových dat.

| Velikost | Před | Po |
| --- | --- | --- |
| Desktop 1440 × 900 | [before-desktop.png](../.local-data/ui-cleanup/before-desktop.png) | [after-desktop.png](../.local-data/ui-cleanup/after-desktop.png) |
| Mobil 390 px | [before-mobile.png](../.local-data/ui-cleanup/before-mobile.png) | [after-mobile-390.png](../.local-data/ui-cleanup/after-mobile-390.png) |

Další důkazy: `after-mobile-320.png`, `after-long-title-320.png`, `after-empty-owner.png`, `after-empty-viewer.png`, `after-loading.png`, `after-error.png`, `after-keyboard-focus.png` ve stejném adresáři.

## Další krok a hranice práce

Obě možnosti vytvoření jsou připravené a využité, žádné nefunkční tlačítko nebylo přidáno. Bez dalšího dotazu nelze spolehlivě určit poslední otevření ani nejbližší akci; nic takového se nedoplňuje. Existující názvy včetně „Normalizované“ zůstávají beze změny.

Předchozí release report popisuje samostatný problém uploadu médií v rozsahu „vlastní kvízy“. Zůstává mimo tuto úpravu; Storage ani editor nebyly měněny. Historické provozní dokumenty nebyly globálně přepisovány.

Doporučený nejbližší malý krok: zkontrolovat tyto screenshoty a lokální diff jako celek; případné nasazení řešit samostatně s novým ověřením tehdejšího výchozího stavu a výslovným souhlasem.

**Push: ne. PR vytvořen nebo přepsán: ne. Merge: ne. Deploy: ne. Cloudové operace / Firebase přístup: ne. V1 nebyla kontaktována ani pro čtení.**
