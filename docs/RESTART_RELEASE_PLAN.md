# Restart: lokální akceptace a schvalované vydání V2 staging

Tento plán sám nepovoluje nasazení. Vlastník dne 2026-10-12 schválil sladění `AGENTS.md` a čtecí kontrolu V2 stagingu; její výsledky jsou v [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md). Ověřený aplikační základ na `codex/restart-integration` je `8b6245608850c9cad959fb14ab6a754f485e1dad`; navazující změny doplňují dokumentaci a přípravu artefaktu. Přesná lokální evidence a omezení jsou v [RESTART_VALIDATION.md](RESTART_VALIDATION.md). V1 a produkční Firebase zůstávají mimo rozsah.

## Sjednocený rozsah

Kandidát spojuje kompletní editor a soukromé koncepty/média, sdílenou pracovní kopii a Uložit vše, přesuny v levém outline, osobní účty a scoped memberships, správu životního cyklu akcí a ochrany skórování/live/snapshotů/registrací. Pracovní kopie je pouze v paměti; save-all je sekvence revizovaných zápisů s uchováním nepotvrzené práce, nikoli atomická transakce.

Dodávka zahrnuje frontend, dotčené Functions a jejich sdílený doménový balík, Firestore Rules/indexy, Storage Rules a mediální gateway. Aplikační oprávnění určují aktuální membership, konkrétní permission a scope; samotné Auth přihlášení ani legacy claims nestačí. Public/projector nesmí získat odpovědi před reveal ani soukromé kontakty.

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

Čtecí preflight musí potvrdit aktuální Hosting release/source, Functions source/build, Rules/indexy, Auth provider a kompatibilitu membership/issuerů existujících referee grantů. Inventář původního obsahu a přesných QA IDs musí umožnit prokázat zachování dat; soukromé payloady nesmí skončit ve veřejné evidenci.

Samostatně ověřit potřebná API, skutečný application bucket a jeho lokalitu, `FIREBASE_CONFIG.storageBucket`, Storage service agenta a cross-service Rules oprávnění; runtime potřebuje na přesném bucketu `storage.objects.get` a `storage.objects.update`. Bucket nesmí mít veřejné čtení. Nové invoker bindings, případné API/bucket/IAM změny musí být jmenovitě zahrnuty ve schválení; nepovoluje je tento plán. Viz mediální prerequisites v [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md).

Kompatibilní memberships připravit pouze pro nově ověřené přesné identity podle [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md); žádná automatická povýšení na owner. Stav skutečného osobního ownera nově ověřit: historické dokumenty se v tomto bodě nesmějí vydávat za dnešní stav. Owner handoff/takeover je oddělený schvalovaný postup. Invitations ponechat vypnuté až do kompletního online ověření.

Vlastník dne 2026-10-12 schválil změnu pravidla v `AGENTS.md`: oprávnění určují aktivní serverem spravované membership, konkrétní permissions a resource scopes. Samotné přihlášení, název role ani legacy claims nestačí. Pravidlo bylo takto sjednoceno; tato dřívější blokace je vyřešena.

## Pořadí schválení a delivery

1. **Schválený čtecí preflight:** dokončen v rozsahu projektu a `europe-west1`, bez obsahu kvízů/kontaktů/mediálních objektů. Aktuální evidence je v RESTART_PREFLIGHT.md; metadata nejsou důkaz runtime autorizace. Pozvánky jsou již zapnuté (`collaborationEnabled=true`, revision 18), proto budoucí rollout vyžaduje konkrétní schválení auditovaného CAS pozastavení. Stávající memberships a pozvánky se tím neodvolají.
2. **Konkrétní schválení zápisů:** předložit konečné SHA, checksums, sjednocený manifest, zjištěné cloud rozdíly, přesné infrastructure/membership/IAM změny, izolovaný QA rozsah a rollback. Zvlášť uvést aktivaci invitations a owner postup, pokud se navrhují. Chybějící předpoklad znamená stop, nikoli implicitní souhlas s opravou infrastruktury.
3. **Schválené nasazení:** zachovat invitations vypnuté; připravit jen schválené kompatibilní memberships a předpoklady. Nasadit explicitní backend guards a ověřit je, poté odpovídající indexy/Firestore Rules/Storage Rules a frontend ze stejného artefaktu. Nevytvářet omezené aktivní spolupracovníky, dokud zůstává starý unrestricted backend. Bez plošného deploye, automatického mazání jiných Functions nebo backfillu původních dat.
4. **Schválený staging smoke:** jednorázové izolované QA identity a obsah; povolené i zamítnuté scopes, revokace, editor/save-all/conflict/reload, lifecycle/live/snapshot/print a public reveal. U médií ověřit upload/finalize/read, chybějící download tokeny a odmítnutý anonymní replay; emulator toto cloudové chování sám neprokazuje. Reálné YouTube přehrání evidovat samostatně.
5. **Uzavření:** porovnat skutečně nasazený inventory a hashes, původní content fingerprints a záznamy smoke. Invitations aktivovat pouze samostatně výslovně schválenou auditovanou akcí po všech gates. Vyčistit jen vlastní QA IDs; audit a původní obsah zachovat. Zaznamenat nové release/version identifikátory a omezení.

## Fail-closed rollback

Při neúspěchu zastavit rollout a neoznamovat hotové vydání. Nechat invitations vypnuté; podezřelé omezené účty suspendovat pouze schválenou scoped akcí. Frontend lze vrátit na zaznamenaný kompatibilní artefakt, avšak ponechat současné membership, lifecycle, Storage a privátní gateway ochrany.

Nikdy nevracet claim-only backend nad aktivní restricted memberships ani pre-disposition backend po vzniku trash/deleting dat. Backend opravit cíleným reviewed forward fixem; předchozí artefakt je použitelný jen při prokázané kompatibilitě bezpečnostních a uložených kontraktů. Nemazat bucket/ready assets, obsah, snapshoty, memberships ani audit jako rollback. Viz rollback části [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md), [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) a [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md).

## Historie versus nyní potvrzený stav

[STAGING.md](STAGING.md) popisuje bootstrap ze září, staré claim roles a tehdy chybějící application Storage. Complete-editor/access/event runbooky zachycují další odlišné cloud inventáře, handoff stavy a prerequisites. Jsou podklady a historické receipts, nikoli dnešní cloud validace ani oprávnění pro nové akce.

Lokální výsledky mají samostatnou [evidenci](RESTART_VALIDATION.md); nová schválená čtecí kontrola je odděleně v [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md). Nasazení, vzdálené CI a online akceptace neproběhly. Souhlas se čtením nesmí být zaměněn za souhlas s konkrétními zápisy, které budou předloženy s hotovým artefaktem.
