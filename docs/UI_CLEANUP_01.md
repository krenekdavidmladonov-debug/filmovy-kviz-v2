# JustKvíz — etapa 1A: úklid úvodního rozhraní

Stav etapy 1A k 16. 9. 2026: **LOKÁLNĚ IMPLEMENTOVÁNO A OVĚŘENO. NENASAZENO.** Následné review etapy 1B a cílená oprava CI v etapě 1C jsou zaznamenány na konci tohoto reportu.

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

Browser ověření etapy 1A spouští skutečnou aplikaci a původní router, nahrazuje AuthProvider a modul access/api. Data pocházejí z deklarovaných fixtures v `functions/src/dev/seed-quizzes.ts`; seed skript se nespouští. Náhled blokoval accessCall a externí hosty; přímé create callable tehdy samostatně blokovány nebyly. Formuláře se pouze otevíraly, neodesílaly. Původní širší tvrzení o zákazu všech zápisů bylo při review opraveno; žádný skutečný zápis nebyl zjištěn. [Browser výsledky](../.local-data/ui-cleanup/browser-results.json), [srovnání čtení před úpravou](../.local-data/ui-cleanup/before-results.json).

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

**V etapě 1A:** Push: ne. PR vytvořen nebo přepsán: ne. Merge: ne. Deploy: ne. Cloudové operace / Firebase přístup: ne. V1 nebyla kontaktována ani pro čtení.

## Etapa 1B — nezávislé review a příprava Draft PR

Ověřený commit úklidu: `0d340d2f8e0a47dd4a3d6db701bfdce54354d99d`, potomek výše uvedeného základu. Worktree byl na začátku čistý a skutečný diff obsahoval právě šest uvedených souborů. Etapa 1B nepřidává změnu produkčního kódu; nový commit pouze zpřesňuje tento report. Původní commit se nepřepisuje.

Samostatný read-only review agent zkontroloval přesný diff, router, oprávnění, CSS selektory, konfiguraci testů a místní screenshoty. **Bez blokujícího nálezu a bez zjištěné regrese produkčního UI.** Review není finální schválení PR.

| Nález | Stav |
| --- | --- |
| P3: historické tvrzení o zákazu všech zápisů v náhledu nebylo plně doloženo | **Opraveno** — historický popis výše zpřesněn. Nový lokální náhled odmítá inicializaci Firebase services, eviduje případné pokusy a browser povoluje pouze přesný origin `http://127.0.0.1:5208`, nikoli ostatní localhost porty. |
| CI nemá správnou PR base v seznamu spouštěcích větví | **Blokující pro označení CI jako PASS**, nikoli pro vznik Draft PR. Workflow nebylo měněno a jiná base se nepoužívá k vynucení zelené kontroly. |
| Dříve dokumentovaný upload médií ve scope „vlastní kvízy“ | **Neblokující pro tento UI diff, odloženo** — nebyl znovu ověřován ani opravován. |

### Rozsah sdílených stylů a běhové ověření

Dashboard selektory používá pouze AdminPage. Brand, upozornění a mobilní `grid-template-rows: auto 1fr` záměrně platí pro celý AdminShell. Editor a live control mají vlastní router větve mimo tento shell; mimo něj jsou také projektor, veřejné registrace a rozhodčí. Nové selektory na tyto obrazovky nedopadají.

Nový lokální browser běh: **PASS**. Přehled ověřen na 1440, 1280, 1100, 1024, 768, 390 a 320 px; šest dalších sdílených povrchů na 1440/1280/390/320 px: knihovna kvízů, nový kvíz, seznam akcí, nová akce, editovatelný detail akce a uživatelé/přístupy. Bez vodorovného přetečení stránky, chyb browseru a pokusů o spojení mimo náhled. Tab/Enter, viditelný focus, textový kontrast nejméně 6,40 : 1, načítání, chyba s retry a oba prázdné stavy prošly. Snímky byly vizuálně zkontrolovány.

Oba create formuláře byly otevřeny z přehledu, vyplněny bez odeslání, opuštěny pomocí Zpět v prohlížeči a původního zpětného odkazu. Při opětovném otevření jsou pole prázdná; nebyl zaznamenán žádný pokus o backendové volání. Existující idempotency ID kvízu v sessionStorage není databázový záznam. Původní formuláře, PermissionGate, can a feature flags se nemění. UI test není důkazem serverové autorizace.

Kvízové fixtures vycházejí z původního lokálního seedu, data detailu akce z existujícího `events-form-ux.mocks.ts`. Read-only seznamy přístupů mají prázdné lokální odpovědi. Všechny tyto náhrady zůstávají pouze v ignorovaném náhledovém skriptu. Běžný build ani aplikace je neimportují.

### Test discovery a kontroly

`vitest.config.ts` má explicitní seznam testů, proto bylo nutné přidat nový soubor. Porovnání přes `vitest list --json` s původní konfigurací z výchozího commitu: **40 souborů / 363 případů před**, **41 souborů / 377 případů po**, **0 odebraných**, **14 přidaných**. Žádné nové skip/only, potlačení chyb nebo oslabení původních kontrol.

- **PASS:** opakované `pnpm check` (typecheck, lint, build).
- **PASS:** opakované `pnpm test:unit`, 41 souborů / 377 testů.
- **PASS:** výše popsaný rozšířený lokální browser běh a porovnání počtu čtení; přehled má stále dvě volání v development StrictMode, bez quiz.read nulu.
- **NEOVĚŘENO:** skutečné přihlášení, serverové mutace a Rules v emulátoru. V tomto kroku nebyly spuštěny, serverová implementace je beze změny.
- **NEOVĚŘENO běhově v etapě 1B:** plný editor a náhled slidů, živý projektor, veřejné registrace a obrazovka rozhodčího. Jsou mimo dotčený AdminShell a nový fixture náhled neposkytuje jejich živé datové kontrakty. Izolace CSS byla ověřena staticky; úspěšný build není vydáván za jejich vizuální test.
- **NEOVĚŘENO:** cloudová aplikace a data — bez přístupu.

Místní důkazy jsou pod `.local-data/ui-cleanup/review-1b/`: `check.log`, `unit.log`, `tests-before.json`, `tests-after.json`, `browser-results.json`, `after-desktop.png`, `after-width-1280.png`, `after-width-390.png`, `after-width-320.png` a snímky sdílených stránek. Tyto soubory nejsou veřejně hostované ani součástí PR.

### PR base, workflow a CI

Remote ověřen jako zadaný soukromý GitHub repozitář. Vzdálená `codex/justkviz-event-management` je stále přesně `456f3eb62d5c52841afc3f055159711f279d11d3`; navržený PR diff je proto totožný s diffem úklidu proti předanému základu. `main` by navíc přibalil 26 nesouvisejících commitů a není vhodnou base. Před publikací nebylo pro pracovní větev žádné existující PR.

Přečteny workflow na pracovní, cílové i výchozí větvi, relevantní package skripty, lokální emulator guard a Git hooky; vzdálené workflow na cílové větvi mají stejná Git blob SHA jako lokální soubory. Bez reusable workflow, workflow_run/pull_request_target, deploy kroku, cloudových credentials, secrets nebo id-token oprávnění; deklarované Firebase testy používají pouze localhost emulátory a demo projekty. Žádný aktivní lokální Git hook ani repository webhook nebyl nalezen.

**CI: NEOVĚŘENO — pro tento PR se automaticky nespouští.** Hlavní workflow reaguje na push jen do main a na PR do vyjmenovaných větví, mezi kterými `codex/justkviz-event-management` chybí. Operátorské workflow nesplňuje path filtr tohoto diffu. Žádné z nich nemá workflow_dispatch. Starší zelené běhy nejsou výsledkem tohoto HEAD. Konečné SHA, odkaz na Draft PR a přesný stav vzdálených kontrol patří do popisu PR a závěrečného předání.

Závěr: **připraveno pouze k dalšímu review**. Před samostatným rozhodnutím o staging nasazení chybí dostupné CI pro správnou base a přesný commit. Workflow ani cílová větev nebyly upraveny za účelem obejití této mezery. Etapa 1B povoluje pouze standardní push pracovní větve a Draft PR; merge, deploy, Firebase operace a kontakt s V1 nejsou součástí tohoto kroku.

## Etapa 1C — cílené spuštění stávajícího CI

Výchozí stav znovu ověřen: lokální i vzdálený HEAD `05b8d2a0901cabad06ce8494041ddaa47aee1854`, čistý worktree, Draft PR [#33](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/pull/33) s base `codex/justkviz-event-management` na `456f3eb62d5c52841afc3f055159711f279d11d3`. Ancestry souhlasí; base ani předchozí commity se nemění.

Na výslovné zadání etapy 1C se do existujícího `.github/workflows/ci.yml`, `on.pull_request.branches`, přidává jediná přesná větev `codex/justkviz-event-management`. Všechny původní větve zůstávají. Žádné rozšíření wildcardem, nový trigger, změna oprávnění, verzí, příkazů, test discovery nebo checkout strategie. Výchozí `pull_request` události již zahrnují `synchronize`, proto běžný push do head větve stačí; nejsou přítomné path/types filtry ani podmínky vynechávající Draft PR. Viz [GitHub dokumentace pull_request](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

YAML obou workflow byl úspěšně parsován. Po odebrání právě jedné přidané položky je načtená struktura hlavního workflow přesně shodná s původní: job `quality-gate` / „Quality gate“, všech 25 kroků, `contents: read`, push pouze do `main`, runtime verze i bezpečnostní guardy. Druhé workflow `owner-takeover.yml` zůstává beze změny; jeho paths zahrnují pouze konkrétní vlastní workflow a operátorské soubory, nikoli `ci.yml` ani ostatní soubory PR. Žádný navazující `workflow_run`, reusable workflow, deploy krok, cloudové credentials či aktivní Git/repository hook nebyl nalezen.

Stávající Firebase testy používají pouze lokální emulátory a `demo-*` projekty. Syntetické regresní testy v adresáři `migration-v1` pracují s lokálními fixtures a emulátorem přes localhost/demo guard; nečtou V1 a nespouštějí cloudovou migraci. Stažení závislostí a emulátorových binárek je součástí povoleného CI.

Cílené nezávislé read-only review samostatným agentem: **bez nálezů**. Reviewer ověřil YAML, přesný strukturální diff, ostatní triggery, lokální guardy i nezměněný aplikační a testovací kód; aktuální GitHub base ověřil hlavní agent. Review není náhradou výsledku skutečného CI ani finálním schválením PR.

Proti výchozímu HEAD etapy 1C se mění pouze jeden řádek workflow a tento report. Aplikační kód, CSS, testy, závislosti, lockfile i ostatní konfigurace zůstávají shodné. Dosavadní PR diff se rozšiřuje ze šesti na sedm souborů. Lokální UI/build/unit výsledky etapy 1B se nevydávají za nové vzdálené CI.

**Výsledek běhu se při tomto commitu nepředjímá.** Konečné HEAD, run URL/ID, událost, výsledky jednotlivých kroků a skutečný checkout SHA budou doplněny do popisu Draft PR a závěrečného předání, bez následného dokumentačního commitu. Případný dočasný merge checkout musí mít jako rodiče ověřenou base a přesný aktuální HEAD. Předchozí neověřené oblasti zůstávají platné, dokud konkrétní dokončený test nedoloží opak; cloudová aplikace a skutečná cloudová data jsou nadále mimo rozsah.

Tato změna opravuje spouštění kontrol; nepovoluje merge ani nasazení. PR zůstává Draft, bez auto-merge, bez změny base, bez přístupu k Firebase cloudu a bez kontaktu s V1.
