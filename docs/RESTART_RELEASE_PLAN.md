# Restart: lokální akceptace a schvalované vydání V2 staging

Tento plán sám nepovoluje nasazení. Vlastník dne 2026-10-12 schválil sladění `AGENTS.md` a čtecí kontrolu V2 stagingu; její výsledky jsou v [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md). Ověřený aplikační základ na `codex/restart-integration` je `8b6245608850c9cad959fb14ab6a754f485e1dad`; navazující změny doplňují dokumentaci a přípravu artefaktu. Přesná lokální evidence a omezení jsou v [RESTART_VALIDATION.md](RESTART_VALIDATION.md). V1 a produkční Firebase zůstávají mimo rozsah.

## Sjednocený rozsah

Kandidát spojuje kompletní editor a soukromé koncepty/média, sdílenou pracovní kopii a Uložit vše, přesuny v levém outline, osobní účty a scoped memberships, správu životního cyklu akcí a ochrany skórování/live/snapshotů/registrací. Pracovní kopie je pouze v paměti; save-all je sekvence revizovaných zápisů s uchováním nepotvrzené práce, nikoli atomická transakce.

Navrhované zápisy zahrnují frontend, přesných 70 existujících Functions se sdíleným doménovým balíkem a opravené Firestore Rules. Storage Rules a indexy jsou podle preflightu shodné: pouze znovu porovnat, nezapisovat bez nově schváleného diffu. Aplikační oprávnění určují aktuální membership, konkrétní permission a scope; samotné Auth přihlášení ani legacy claims nestačí. Public/projector nesmí získat odpovědi před reveal ani soukromé kontakty.

Hosting-only nestačí: frontend používá `readAccessData` a membership kontrakt, editor zapisuje draft/ready a média, backend musí chránit snapshot/live a všechny souběžné lifecycle operace. Starý claim-only backend by obcházel omezené role; staré ochrany akcí by mohly zpřístupnit trash/deleting obsah. Samotný editorový manifest neobsahuje celý access/event rollout.

Zdrojové inventáře pro sestavení jednoho explicitního manifestu:

- [Editor](../tools/staging/editor-release-manifest.mjs): editor, publikace, snapshot a media endpoints včetně jeho dependencies.
- [Personal access](../tools/access/deployment-manifest.json): všechny legacy cesty pod membership autorizací, privátní čtení, Rules/indexy a invitations.
- [Event management](../tools/event-management/deployment-manifest.json): lifecycle, registrace, scoring/live a nový permission catalog; `deleteEvent`, `restoreEvent`, `trashEvent`.

Sjednocený [restart manifest](../tools/staging/restart-release-manifest.json) zahrnuje 70 Functions. Zbývajících 7 ze 77 zdrojových exportů tvoří datově prázdný `health` a 6 výslovně vyloučených e-mailových endpointů. [Offline kontrakt](../tests/restart-release-manifest.test.mjs) porovnává skutečné exporty, všechny tři inventáře a závislosti; existující nasazené handlery ani jejich bezpečnost tím nejsou ověřené. Týmové e-maily zůstávají vypnuté; žádná aktivace email workerů, skutečné rozesílky ani produkční data. Cloudový preflight musí navíc vyloučit emulatorové proměnné v cloudovém runtime a zkontrolovat případné již nasazené e-mailové workers/fronty.

## Lokální akceptace a evidence

Všechny brány musí mít výsledek pro konečný kandidát; zapsané testy nebo starý PASS nejsou důkaz jejich nynějšího běhu. Evidence obsahuje SHA/dirty stav, Node/runtime, příkaz, čas, výsledek, log a u UI relevantní screenshot/video. Oddělit automatizovaný syntetický fixture od autorství běžným UI.

1. `pnpm check`, unit a Functions testy; staging/config guardy bez cloudového přístupu. Zaznamenat nezávislé review bezpečnostních hranic a oprav, nikoli jen typovou kontrolu.
2. Firestore a Storage Rules v emulátorech: default deny, scopes, redakce odpovědí/kontaktů, zákaz přímých zápisů, grant/version revokace a privátní gateway. Testy memberships/invitations včetně identity switch a zastavení starých queued příkazů.
3. Editor UI od prázdné knihovny: 3 kola a podporované typy, koncept/dokončení, uložit/reopen/refresh, média, soukromá zkouška a menší viewporty; immutable snapshot a reveal ověřit odděleně. Viz [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md).
4. Save-all a outline: navigace zachová více draftů, neaktivní validace před všemi zápisy, Ctrl+S, metadata/kola, partial retry, lost response/conflict, potvrzené reload se zamčenými formuláři a navigací, přerušený přesun a skutečné pořadí. Viz [EDITOR_WORKING_COPY.md](EDITOR_WORKING_COPY.md), [EDITOR_OUTLINE.md](EDITOR_OUTLINE.md) a příslušné browser/unit sady.
5. Akce a live: lifecycle/disposition, archive/trash/restore, izolované dávkové delete/resume, souběh revokace/scoring/registrace/snapshot/live, bearer capability a veřejná projekce. Viz [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md); print a referee regrese zůstávají součástí gate.
6. Před cloudovými zápisy doložit CI pro přesné konečné SHA, nikoli převzít zelený výsledek předchozí větve. Lokální runtime výsledky, CI a cloud smoke vést jako tři samostatné evidence.

## Předpoklady před návrhem nasazení

Jediný navrhovaný cíl je `filmovy-kviz-v2-staging`, region `europe-west1`. Potřebné operátorské credentials zůstávají mimo repozitář; žádné klíče, tokeny ani `.env` změny. Vyžadovat čistý schválený commit, Node 22 a auditovatelný artefakt frontend/backend/Rules/indexy ze stejného SHA s checksums a pevným staging cílem.

Historické buildery a jejich branch guardy zůstávají zachované. Nový [build-restart.mjs](../tools/staging/build-restart.mjs) připravuje offline sjednocený artefakt pro čistý přesný SHA větve `codex/restart-integration`: čerstvý domain pro frontend i backend, přesných 70 exportů, uzavřený balík závislostí, kopie Rules/indexů, relativní konfiguraci a checksums. Bere pouze explicitní veřejný SDK config a schváleně ověřená bucket metadata ze souborů mimo Git. Nic neinstaluje ani nenasazuje; samostatná lokální kontrola zabaleného runtime a skutečný výsledek přípravy musí být zaznamenány před žádostí o deployment.

Dokončený preflight ověřil metadata, nikoli úplné nasazené zdroje nebo autorizační chování. Firestore Rules odpovídají `8106c4a` a chybí jim oprava přístupu k nahrazeným snapshotům. Storage Rules a dva READY indexy odpovídají kandidátovi. V regionu je přesných 70 plánovaných Functions plus `health`; e-mailové endpointy nejsou nasazeny. Před schválenými zápisy znovu porovnat tento stav a zastavit při neschválené odchylce.

Preflight potvrdil požadovaná API, bucket v `EUROPE-WEST1`, uniform access a public access prevention, očekávaný service-agent binding i runtime bucket role s `storage.objects.get/update`. Všech 71 runtime konfigurací odpovídá stagingu bez emulatorových proměnných. Návrh nepovoluje změny IAM, invoker bindings, API ani bucketu.

Preflight našel tři Auth účty a dvě aktivní memberships s ověřenými owner/moderator účty. Owner nemá `event.delete`; žádné automatické doplnění permission ani owner handoff není součástí návrhu. Pozvánky jsou nyní zapnuté, proto níže uvedený návrh obsahuje samostatně schvalovaný CAS pause.

Vlastník dne 2026-10-12 schválil změnu pravidla v `AGENTS.md`: oprávnění určují aktivní serverem spravované membership, konkrétní permissions a resource scopes. Samotné přihlášení, název role ani legacy claims nestačí. Pravidlo bylo takto sjednoceno; tato dřívější blokace je vyřešena.

## Pořadí schválení a delivery

Před žádostí koordinátor doplní **zdrojové SHA, absolutní kořen offline artefaktu, receipt a checksums**. Tyto hodnoty zatím nejsou vyplněné ani schválené. Požadován je úspěšný GitHub CI běh přesného zdrojového SHA. GitHub API/CLI 404 je skutečná přístupová blokace; lokální PASS ani funkční Git transport tuto bránu nenahrazují.

1. **Návrh schválení CAS pause:** na `accessControl/state` čerstvě ověřit `collaborationEnabled=true`, revision `18` a updateTime `2026-09-16T06:11:29.023025Z`. Jen při přesné shodě provést auditovaný compare-and-set na `false`, revision `19`, s precondition tohoto updateTime. Při odchylce nebo konfliktu stop; nepřepisovat novější stav. Zachovat ostatní pole a audit dle access kontraktu. Pause neodvolává existující memberships ani již vydané pozvánky. Obnovení není automaticky schváleno.
2. **Návrh schválení deploymentu:** pouze projekt `filmovy-kviz-v2-staging`, region `europe-west1`; aktualizovat přesných 70 existujících Functions z restart manifestu, opravené Firestore Rules a Hosting z téhož schváleného offline artefaktu. `health` zachovat. Žádné plošné deploye, mazání Functions, e-mailové endpointy, backfill ani produkce. Storage Rules/indexy pouze porovnat; nový diff znamená stop a nové schválení. Žádné změny IAM/API/bucketu/identit/grantů/mailů.
3. **Po schválení:** provést CAS pause, nasadit backend guards, ověřit inventář a nasazené revize; poté opravené Firestore Rules a odpovídající Hosting. Při nesplněné bráně zastavit další kroky. Uchovat receipt s přesnými targets, hashes, revizemi a předchozím stavem bez citlivých payloadů.
4. **Oddělené schválení online QA:** předložit přesný seznam nových syntetických Auth identit a QA IDs, jejich dočasné permissions/scopes a úplný cleanup rozsah. Minimální návrh: dvě izolované ověřené QA identity (operátor s konkrétními quiz/event/media permissions pouze na QA resources a omezený čtenář bez odpovědí/kontaktů), jeden QA kvíz, akce, snapshot/live session, dva syntetické týmy a malé syntetické image/audio assety. Žádné změny existujících účtů nebo grantů, žádné skutečné kontakty či e-maily. Pokud vytvoření konkrétní identity nelze schválenou cestou provést při pause, stop a předložit konkrétní postup; neobcházet gate.
5. **Schválený smoke a cleanup:** operátor přes UI vytvoří/uloží/reloadne QA kvíz a event snapshot; ověří scoring konflikt/lost response, live/reveal/history a print. Omezený klient a anonymní projector musí před reveal odmítnout odpovědi, kontakty a privátní média; po výměně snapshotu ověřit zákaz starého snapshotu. Média: upload/finalize/read bez download tokenů a zamítnutí anonymního replay. Cleanup jen schválených QA IDs včetně Auth/memberships, týmů, snapshot/session a vlastních assetů, přes podporované backend cesty; audit zachovat. Potřebné delete permissions musí být součástí odděleného QA schválení, nikoli automaticky přidány existujícímu ownerovi. Evidovat výsledek a zbývající QA IDs; invitations obnovit jen novým výslovným CAS schválením.

## Fail-closed rollback

Při neúspěchu zastavit rollout a neoznamovat hotové vydání. Po úspěšném schváleném pause nechat invitations vypnuté; podezřelé QA účty suspendovat pouze v samostatně schváleném rozsahu. Zachovat poslední bezpečné membership, lifecycle, snapshot, Storage a privátní gateway guards. Frontend vracet jen na předem prokázaný kompatibilní artefakt. Historická Hosting verze `752720637f78079b` z preflightu není automaticky kompatibilní rollback.

Nikdy nevracet claim-only backend nad aktivní restricted memberships ani pre-disposition backend po vzniku trash/deleting dat. Backend opravit cíleným reviewed forward fixem; předchozí artefakt je použitelný jen při prokázané kompatibilitě bezpečnostních a uložených kontraktů. Nemazat bucket/ready assets, obsah, snapshoty, memberships ani audit jako rollback. Viz rollback části [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md), [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) a [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md).

## Historie versus nyní potvrzený stav

[STAGING.md](STAGING.md) popisuje bootstrap ze září, staré claim roles a tehdy chybějící application Storage. Complete-editor/access/event runbooky zachycují další odlišné cloud inventáře, handoff stavy a prerequisites. Jsou podklady a historické receipts, nikoli dnešní cloud validace ani oprávnění pro nové akce.

Lokální výsledky mají samostatnou [evidenci](RESTART_VALIDATION.md); nová schválená čtecí kontrola je odděleně v [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md). Nasazení, vzdálené CI a online akceptace neproběhly. Souhlas se čtením nesmí být zaměněn za souhlas s konkrétními zápisy, které budou předloženy s hotovým artefaktem.
