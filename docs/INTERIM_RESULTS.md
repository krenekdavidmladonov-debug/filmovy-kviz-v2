# Průběžné výsledky řízené moderátorem

## Ovládání

Akce → detail `/admin/events/:eventId` → **Otevřít moderování akce** → existující `/admin/live/:sessionId` → **Průběžné výsledky**. Pokud prezentace čeká, nejprve ji spusťte tlačítkem Další. Projektor zůstává `/projector/:sessionId`.

Vyberte Výsledky po kole, načtěte interní náhled, zkontrolujte zahrnutá kola a úplnost a stiskněte Zobrazit výsledky. Načtení náhledu nic nepublikuje. Panel odděleně uvádí právě zveřejněnou verzi a její stránku. Po opravě skóre načtěte nový náhled a použijte Aktualizovat zobrazené výsledky. Projektor i náhled používají `ResultsTable` a ruční stránky po osmi týmech; jejich stránky jsou nezávislé. Ovládání stránky projektoru mění serverový prezentační stav.

## Výpočet a potvrzení

Server sečte existující celočíselné půlbody od prvního kola po zvolené kolo podle pořadí immutable snapshotu akce. Zahrne všechny aktuálně přijaté registrace, ruční i online, podle stabilního ID. Zrušené a nepřijaté týmy vynechá. Null a chybějící zápis jsou nezadáno, nikoli nula: náhled vypíše konkrétní tým a kolo a publikace je zablokovaná. Prázdnou tabulku také nelze publikovat.

Vyšší součet vede, shody mají dense pořadí 1/2/2/3. Shodné řádky mají stabilní pořadí podle NFC názvu a ID; toto řazení nerozhoduje remízu. Půlbody se česky zobrazují například 17,5. Poslední kolo se nenabízí a server je odmítá. Jednokolová akce má vysvětlení místo průběžného zveřejnění.

`previewInterimResults` provede privátní transakční čtení. `controlInterimResults` při publish znovu transakčně čte vazbu event/session/snapshot, stav akce, přijatý roster a skóre. Ověří fingerprint zahrnutých kol, ID/názvů/revizí týmů a relevantních hodnot/revizí skóre, spolu s přesnou očekávanou revizí session. Změněné relevantní skóre, přijetí/zrušení nebo název týmu způsobí `aborted`, nikoli tichou publikaci jiné podoby. Změny pozdějších kol neovlivní součet ani fingerprint.

Každý pokus transakce kontroluje aktuální Auth účet a staff claim (`admin` nebo `moderator`), včetně disabled stavu. Referee capability ani registrační management token tento nárok nenahrazují. Server nepřijímá klientské součty nebo pořadí.

## Uložení a veřejná hranice

- `events/{eventId}.liveSessionId` a privátní `sessions/{sessionId}.{eventId,snapshotId}` tvoří jednoznačnou vazbu. `createEventLiveSession` ji vytváří atomicky. Existující session se znovu otevře; nevzniká druhý projektor. Event session čte slidy ze snapshotu, knihovní practice session zůstávají samostatné. Po vytvoření vazby nelze změnit uzamčený snapshot.
- `sessions/{sessionId}/interimVersions/{versionId}` uchovává neměnnou schválenou tabulku, rozsah kol, fingerprint, event/session/snapshot, aktéra a čas. Je privátní a klientsky nezapisovatelná. Jedinou evidencí vstupních bodů nadále zůstává `events/.../scores`; historie skóre se nemění.
- `sessions/{sessionId}/interimOperations/{operationId}` obsahuje privátní idempotentní receipt, odvozený stávajícím hash helperem z aktéra/session/request ID. Stejný dokončený příkaz vrací receipt bez dalšího zápisu; jiný obsah téhož ID se odmítne. Opakování publish po hide nemůže starou tabulku obnovit. Dva různé příkazy nad stejnou revizí nemohou oba změnit stav.
- `publicSessions/{sessionId}.interimResults` obsahuje jen versionId, roundNumber, page, pageCount a aktuálních nejvýše osm řádků rank/teamName/halfPoints. Zbytek dokumentu obsahuje bezpečná lifecycle metadata. Neobsahuje kontakty, team ID, jednotlivá skóre, audit, snapshot, staff UID, klíče ani správné odpovědi. Veřejná kolekce verzí neexistuje. Anonymous get známé session je povolen; list, privátní čtení a veškeré přímé zápisy zůstávají zakázané existujícími Rules.

Publikace, privátní verze, receipt a nahrazení veřejného dokumentu jsou atomické. Stránkování čte uloženou verzi; pozdější oprava skóre, přejmenování nebo zrušení týmu ji nepřepočítá. Změna vyžaduje nový náhled a explicitní publish.

## Média, návrat a spojení

Publish i hide používají existující navigační lifecycle na stejné pozici: zvýší generaci médií, vyčistí reveal a vybraný recap a nastaví idle. Výsledky odstraní mediální přehrávač; návrat nic automaticky nespustí. Běžné prezentační příkazy během výsledků vyžadují nejprve hide, kromě end. End, cancel a archive atomicky odstraní výsledkový payload. Stará mediální hlášení/generace jsou odmítnuta.

Projector nepřijímá žádný výsledkový ani jiný prezentační stav přes BroadcastChannel; autoritou je výhradně Firestore. Channel zůstává pro odchozí lifecycle hlášení přehrávače. Projektor odmítá cache-only data, cizí session, starší revize a callbacky ukončeného odběru. Při události offline nebo chybě odběru vyčistí obraz. Při online znovu načte dokument přímo ze serveru a obnoví odběr. Neměnící se revize se proto po reconnectu také obnoví.

Detekce výpadku není okamžitá; do jejího zjištění může zařízení držet poslední obraz. Skrytí nemůže zpětně odebrat již doručená data ani vymazat jejich znalost. Nová offline cache ani offline infrastruktura nevzniká.

## Ověření a omezení

`tests/interimResults.test.ts`, rozšířená Rules sada, `tests/e2e/interim-results-emulator.mjs` a `tests/browser/interim-results.spec.ts` pokrývají výpočet, oprávnění, transakční souběh, soukromí a skutečné ovládání tří klientů. Browser mění skóre přes skutečnou referee stránku, testuje 12 týmů, ruční stránky, 1920×1080, 1280×720, moderátora 768 px, podvržené channel zprávy a hide během odpojení. Standardní CI obsahuje samostatný krok pro nové kontrakty a browser. Fixtures fail-closed vyžadují lokální emulátory a `demo-*`; browser blokuje nelokální síťové požadavky.

Limit této implementace je 1000 přijatých týmů, osm řádků na stránku. Extrémně dlouhý název se vizuálně zkrátí s výpustkou. Event má jednu navázanou session; po jejím END tato iterace nenabízí restart. Nový obecný reportovací model, uzamykání kol, finální vyhlašování, vítězná hudba a nový END nejsou součástí.

## Budoucí nasazovací závislosti — nyní nenasazeno

Po samostatném schválení bude potřeba společně nasadit web, nové Functions `createEventLiveSession`, `previewInterimResults`, `controlInterimResults`, změněné live mutation/report Functions a `cancelEvent`, `archiveEvent`, `lockEventQuiz`. Výběrový deploy musí zahrnout všechny změněné exporty, nikoli jen nové funkce. Firestore Rules a indexy se nemění, nejsou potřeba migrace ani nové secrets/role. Stávající akce se navážou až explicitním otevřením moderování. Staging, V1 a vzdálená data se v této feature práci nemění.
