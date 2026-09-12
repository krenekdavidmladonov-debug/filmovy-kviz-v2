# Integrovaný kandidát dokončení editoru

Aktivní směr: codex/complete-quiz-editor. Základ main 0d452d8efe4cce9eb003fcce713d3b63c15bb0a4 + PR #26 c92a8b5211b11ce438498fb934a2ddff04c186bb + zachovaná media authoring práce (8d05b46 / 9da7f75, integrované commity 1579c5d / 239d702). Pracovní adresář má historický název .local-data/media-authoring-main-check; nejde o další editor ani větev nad starým stagingem. Původní media staging kandidát se nevydává samostatně.

## Co vysvětluje předchozí ONLINE PASS

Historický ONLINE-REPORT.md pro release 1789157941594000 / Hosting 90df28ec3c46ec01 dokládal hotfix: vytvoření jednoho kvízu, prvního kola, jedné dokončené otázky, zachování existujících dat, konflikt revizí a omezený live smoke. Neprokazoval sestavení 3 kol se všemi typy, uložený neúplný koncept, uploady ani menší obrazovky. Označení ONLINE PASS bylo širší než důkaz.

Předchozí UI mělo strukturální akce blokované při dirty/saving/uploading. Neúplnou otázku přitom neumělo soukromě uložit, takže autor musel vše doplnit nebo zahodit, než mohl pokračovat. Přidat kolo bylo až za seznamem kol. Navíc při změně výběru vykresloval formulář krátce starý draft pod novou sekcí; efekt jej teprve následně přepnul. Nové guardy vykreslení a klíč formuláře tento přenos stavu odstraňují a resetují i ovládání média.

To jsou doložené chyby a mezery testu. Nemáme záznam konkrétní Dejvovy neúspěšné interakce, proto ji nepřipisujeme cache, roli nebo uživatelské chybě. Upload na současném stagingu objektivně nemá bucket ani media endpoints. Lokální oprava není opravou již nasazené verze.

## Reference a zachované základy

Dostupný V1 UI zdroj nebyl nalezen v repozitáři, známých V2 worktrees ani dostupných projektových source/archive inventářích. Odvozené inventáře v .local-data/v1-analysis nejsou původní editor. Obsahové exporty se za zdroj nevydávají, V1 aplikace/API/Storage nebyly kontaktovány. Chybějící V1 reference je přiznané omezení.

Použity jsou existující EditorOutline, EditorForms, QuizEditorPage, lossless editor/model.ts, quiz-domain mappers/semantic/validation, společný SlideRenderer, MediaPlayer/YouTubePlayer a media grant/gateway/Storage foundation. Staré audio se nepřevádí na nově stahované YouTube soubory. Neznámá a legacy pole zachovává autoritativní serverový dokument, explicitní prázdná normalizovaná média odpojí roli bez mazání historie nebo assetu.

## Uložený kontrakt a vlastnictví

- Otázka může nově mít authoringStatus draft nebo ready; absence znamená dosavadní kompatibilní kontrakt. Draft není ready ani po doplnění polí, dokud autor nezvolí Dokončit otázku. Nové dokončené otázky ukládají ready.
- answerMode open/choice je nezávislý na text/image/audio/video zadání. Explicitní choice vyžaduje 2–6 vyplněných odlišných možností a právě jednu platnou správnou volbu. Legacy bez answerMode zachovává stávající interpretaci včetně 5/6 možností a chráněných větších seznamů. Typ free s explicitním choice a open s neprázdnými možnostmi jsou neplatné pro hraní.
- imageLayout split/stacked je předvolba společného rendereru. answerExplanation je samostatný text hráčům po reveal, maximálně 5000 znaků; moderatorNote zůstává soukromá.
- Kvíz může mít defaultAppearance: backgroundImage, backgroundOverlay 0–100 a imageLayout. Ovlivňuje nové otázky; Obnovit výchozí vzhled přenese aktuální nastavení do konkrétního rozepsaného slidu. Nejde o hromadnou změnu existujících otázek ani snapshotů. Vlastní výchozí asset musí být ready image stejného kvízu.
- Globální intro/agenda/rules/end používají explicitní scope quiz; server jej dovolí jen systémovým částem a nepřipojí je k sousednímu kolu. Úvodní části se vkládají v pořadí intro/agenda/rules. Legacy volání bez scope zachovávají dosavadní odvozování kola.
- createQuizRound zapisuje header + recap se stabilními ID v jedné revizované transakci. Chybějící harmonogram materializuje jako automaticAgenda; následné strukturální změny serverem přepočítají jeho názvy a pořadí. Existující ručně/legacy uložené agendy bez markeru se nepřepisují tímto mechanismem.
- Drafty se počítají do soukromého počtu otázek a počtů kol, přesouvají/duplikují se se svým stavem. Blokují preflight a lockEventQuiz; createLiveSession odmítá knihovnu s draftem, načtení slidu do publikačního příkazu odmítá draft znovu. Dokončení vyžaduje aktuální revizi a strict validaci. Strukturální retry se starou revizí je odmítnut, nevytvoří druhé kolo.
- Draft neobchází tvar payloadu, typy/limity polí, bezpečnost URL, vlastnictví assetu, validitu zadaného intervalu ani admin autorizaci. Může chybět zadání, odpověď či úplné časování; neplatný hotový interval se tím nepovoluje. Žádné soukromé odpovědi se nepersistují do localStorage ani veřejné URL.
- Read/write hranice zůstává quizzes / slides / odvozené rounds/questions, se serverovými revizovanými transakcemi. Nové kolekce nebo indexy nepřibyly. Firestore Rules nejsou změněné; přímé klientské zápisy zůstávají zakázané. Administrativní zápisy vyžadují admin, samotné přihlášení nestačí.

## Uživatel a soukromá zkouška

V knihovně lze založit kvíz, upravit úvod a pravidla, přidat pojmenované kolo s rekapitulací, přidávat všechny typy, volit otevřenou nebo ABCD odpověď, uložit koncept nebo dokončenou otázku a pokračovat přes Uložit a přidat další. K dispozici jsou kopie, změny pořadí, přesuny mezi koly a odstranění kola s uvedeným dopadem a možností zrušení/přesunu otázek. Návrat do knihovny je přímo v hlavičce; Ctrl/Cmd+S a navigační ochrana sdílejí uložení.

Soukromá zkouška používá společný renderer celého kvízu, navigaci, ruční reveal, jednotlivé odpovědi rekapitulace a ruční média. Nevytváří sessions/publicSessions ani BroadcastChannel. Při otevření odpojí editorový přehrávač. Přechod mezi otázkami resetuje přehrávání. Návrat k vlastnímu obrázku znovu načítá platný Blob URL, nikdy znovu nepoužije odvolané URL.

Výchozí chování je explicitní Save, ruční média, ruční přechody, bez promíchávání možností. Body a odpočet nejsou dekorativní přepínače: jejich budoucí změna potřebuje samostatný scoring/snapshot/live kontrakt. Upload vlastního videa, transcoding, offline sync a další typy jsou mimo tuto dodávku. Skutečné přehrání externího YouTube nebylo tímto localhost testem prokázáno; parser/adapter a hlášení nedostupnosti jsou oddělená ověření.

## Ověření a důkazy

Přijímací test tests/browser/complete-editor.spec.mjs zakládá pouze syntetickou Auth identitu a claim před prohlížečem. Žádný obsah kvízu nepřipravuje databází, seedem nebo vedlejší API cestou. Od prázdné knihovny vytváří 3 kola × 5 typů, následně koncept a kopii, uloží/reopen/refresh, přesouvá, mění pořadí, ověřuje bezpečné odstranění a projde soukromou zkouškou. Záznam videa je souvislý. Test servíruje produkční Vite build s demo konfigurací; build.json eviduje SHA a čistotu zdroje. Na konci je zvlášť označené technické ověření uzamčení akce, neměnnosti snapshotu a veřejného reveal; toto není náhrada autorského scénáře.

Důkazy jsou v .local-data/complete-editor: browser/**/video.webm, evidence.json, form-*.png, content-*.png, preview-*.png, practice-intro.png, practice-end.png. Síťový záznam obsahuje jen názvy endpointů a statusy. Screenshoty 1366×768, 1024×768 a 390×844 ověřují běžné ovládání bez vodorovného přetékání. Samostatné complete-editor-boundaries.mjs ověřuje role, revize, malformed draft, duplikaci a odmítnutí live/snapshotu.

Samostatný výkonový test vytváří technicky syntetické sady 60 a 180 otázek, 120 / 48 přepnutí a náhledů plus 12 / 5 skutečných uložení. Měření Chromium/produkční Vite build/lokální emulátory: načtení 890 / 882 ms; medián přepnutí 73 / 54 ms; medián náhledu 41 / 46 ms; medián uložení 242 / 257 ms. Aktivní měřená práce trvala 20,4 / 8,6 s; netvrdíme tím ověření několikahodinové relace. Nejvýše 1 aktivní přehrávač, po odchodu 0. Nejde o cloudový benchmark ani tvrzení o zlepšení proti dřívějšímu měření. Bezpečnostní strop transakce zůstává 475 odhadovaných zápisů a 400 slidů; neznamená příslib 400 otázek v jedné transakci.

Regrese zahrnuje check, unit/legacy/snapshot/live testy, Firestore Rules, media Storage/grant/reveal kontrakty, mediální browser a původní hotfix workflow. Nový souvislý test, draft hranice i výkon jsou zapojeny do CI bez cloudového deploye. Přesné finální počty a git SHA uvádí závěrečný report, nikoli tento průběžný dokument.

## Skutečný staging a nasazovací manifest

Read-only 2026-09-12 07:22:58 UTC: Hosting release 1789157941594000, verze 90df28ec3c46ec01, 55 Functions. Oba názvy výchozího bucketu (.firebasestorage.app i .appspot.com) vracejí 404. Evidence: .local-data/complete-editor/staging-readonly.json. Nebyl proveden cloudový zápis, deploy, merge, změna IAM/billingu/rolí ani kontakt s V1.

Build-only příprava: tools/staging/build-complete-editor.mjs vyžaduje čistý commit na codex/complete-quiz-editor, Node 22, přesnou staging konfiguraci a VITE_ENABLE_TEAM_EMAIL=false. Sestaví Hosting i privátní serverový balík ze stejného SHA, vygeneruje firebase.complete-editor.json a manifest.json s checksums v .local-data/complete-editor-release/<SHA>.

Přesný seznam 33 Functions (4 nové: createQuizRound, beginQuizMediaUpload, finalizeQuizMediaUpload, readQuizMedia; 29 aktualizovaných) je zdrojem pravdy v tools/staging/editor-release-manifest.mjs. Zahrnuje editorové mutace (draft, metadata, automatická agenda), lockEventQuiz (strict snapshot + asset validace), všechny live příkazy používající změněný publikační model, controlInterimResults a controlFinalReveal (obnova slidu), a 3 media endpoints. Pouhé nasazení createQuizSlide/updateQuizSlide by bylo neúplné. Již nasazené createQuiz, repairQuizPreflightIssue a běžné event/read dependencies jsou v manifestu uvedené odděleně.

Týmové e-maily mají skutečnou capability hranici: ve vydání false; panel se neimportuje ani neinicializuje a API adapter před inicializací Firebase odmítne volání. Serverová autorizace se neuvolňuje. Email workers/campaign callables nejsou exportované v balíku k nasazení. Lokální stávající e-mailový browser test používá explicitní VITE_ENABLE_TEAM_EMAIL=true; veřejné registrační funkce nejsou součástí tohoto rollout cíle.

Po budoucím samostatně autorizovaném nasazení postupovat cíleně:

1. Znovu zaznamenat aktuální Hosting/Functions/Rules/bucket metadata a porovnat je s manifestem.
2. Připravit výchozí bucket filmovy-kviz-v2-staging.firebasestorage.app; navržená lokalita europe-west1 odpovídá Functions, dosud nejde o existující lokalitu. Bez veřejných IAM oprávnění. Ověřit runtime FIREBASE_CONFIG.storageBucket na tento přesný bucket a oprávnění runtime service accountu ke čtení objektů/metadat pro finalize/gateway; v tomto běhu se IAM nemění. Nasadit storage.rules z artefaktu. Nutné cross-service Rules oprávnění Storage service agenta pro čtení Firestore řešit až v autorizovaném rollout kroku.
3. Nasadit pouze 33 explicitních functions:<name> z manifestu přes vygenerovaný config. Žádný plošný deploy, nesouvisející exporty ani potvrzení mazání jiných funkcí. Není potřeba deploy Firestore Rules nebo indexů.
4. Ověřit backend kontrakty na jednorázovém syntetickém staging obsahu, grant/upload/finalize/read a CORS autentizovaného gateway. Pro soukromé čtení se nepoužívají veřejné Storage download URL. Bucket CORS nastavení se bez důkazu neodhaduje.
5. Teprve potom Hosting ze stejného artefaktu. Zopakovat UI autorství/refresh/rehearsal/snapshot/reveal online. Media bucket nesmí blokovat textové otázky/kola; bez media předpokladů se ale celý kandidát neoznačuje za nasazený.

Obnova: před backend dokončením zůstává starý Hosting. Frontend lze vrátit na předem zaznamenanou verzi. Jakmile obsah nebo snapshot používá vlastní asset/draft, nesmí se slepě vracet starý backend, který jej neumí bezpečně číst/validovat; zachovat kompatibilní gateway/Rules a řešit cíleným forward fixem. Nikdy nemazat bucket, ready objekty, kvízy, snapshoty nebo jejich generace jako rollback. E-mailové moduly zůstávají mimo rollout.
