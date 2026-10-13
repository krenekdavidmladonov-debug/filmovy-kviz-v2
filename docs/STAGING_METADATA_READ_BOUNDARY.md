# Zbývající čtecí kontrola metadat syntetických médií

Stav: **NEPROVEDENO — operátorskému účtu chybí `storage.objects.get`.** Tento dokument nepovoluje změnu IAM. Nahrávání, finalize, soukromá zkouška a chráněný přístup již prošly; nezávislá kontrola raw Storage metadat je samostatný neuzavřený bod.

Čtecí pokus v `.local-data/restart-qa/staging-qa-ddb862f-20261012-01/owned-media-metadata.json` vrací HTTP 403 a výslovně chybějící `storage.objects.get`. Úzký field mask a `projection=noAcl` výsledek nezměnily. Nejde o důkaz veřejného zpřístupnění média. Další stejné pokusy ani změny oprávnění se neprovádějí.

## Přesné dva objekty

Projekt `filmovy-kviz-v2-staging`, bucket `filmovy-kviz-v2-staging.firebasestorage.app`, quiz `quiz_baba5c0ac925bc2f8ead8485651af958c9465e16719aa98a44c00e016375e32c`.

| Syntetické médium | Asset ID | Zachycená generation | Bajty |
| --- | --- | --- | --- |
| PNG | `967805e802c97d000adfb7da18235c557b220ac0d0bee2626475d7d8a1df3b22` | `1791849391879749` | 84 |
| WAV | `33d5b69f01c2bd4fe561a1cbcc8cde96d302983d09b1eebd81aec075649b0bd1` | `1791849400478039` | 64044 |

Každá přesná cesta je `quiz-assets/{quizId}/{assetId}/source`. Generace a velikosti pocházejí z authoritative `ready` dokumentů a úspěšného editorového běhu; nejsou tvrzením o nezávisle přečteném objektu. Původní expirovaný grant zůstává zachovaný a jeho objekt nebyl při poslední úspěšné inspekci přítomen.

## Konkrétní další krok

Oprávněný správce může dodat čerstvý read-only výpis metadat právě těchto dvou objektů, nebo zvlášť schválit dočasné čtecí oprávnění pro stávající ověřený CLI účet. Totožnost je v chráněném původním `approval.json`; žádný nový principal, klíč ani service-account impersonation.

Případný samostatně schválený IAM postup má použít existující bucket, policy version 3 a podmínku omezenou na `resource.type == 'storage.googleapis.com/Object'` a přesný `resource.name` jednoho z uvedených dvou objektů. Nejvýše 30 minut od provedení; bez wildcardů a bez obecného přístupu k bucketu. Návrh role `roles/storage.objectViewer` obsahuje také list, ale podmínka pouze pro dva object resources nepovoluje bucket-level list. Role dovoluje i čtení bajtů těchto dvou syntetických souborů, nejen metadat. Žádné write/delete/update. Ostatní bindings se musí zachovat přes čerstvé etag; cizí drift znamená nové posouzení, nikoli přepsání policy. Expirovaná podmínka může zůstat v policy; její odstranění je samostatná pozdější změna.

Bucket již měl zapnuté uniform bucket-level access a public access prevention; žádné přepínání těchto ochran není navržené. Lead pouze dvěma GET přečetl aktuální policy v3 a `testPermissions`: stávající ověřený operátor má `storage.buckets.getIamPolicy` a `storage.buckets.setIamPolicy`. Připravený policy diff zachovává etag a všechny existující bindings, přidává pouze výše uvedenou podmíněnou roli pro tentýž účet. Chráněný `metadata-access-proposal-private.json` obsahuje přesný principal/policy; veřejný souhrn `metadata-access-proposal.json` jeho sémantický JSON hash (kompaktní serializace, nikoli hash bajtů odsazeného souboru) `d0583e45eeecc3db2319265d9250a4331905cc9a1eb7e338ac9aeb24597a0fb1`. Oba jsou v privátním QA root, žádná IAM změna neproběhla. Šablona má záměrně neplatný expiry placeholder, takže není spustitelným payloadem. Po samostatném schválení rozsahu připnout aktuální UTC expiry nejvýše +30 minut a znovu ověřit etag/shodu bindings; drift zastaví operaci. Schválení předchozího Storage Rules-only deploymentu IAM změnu neobsahovalo.

Semantiku rolí a podmínek dokládají [Cloud Storage IAM](https://docs.cloud.google.com/storage/docs/access-control/iam#conditions) a [Storage role definitions](https://docs.cloud.google.com/storage/docs/access-control/iam-roles). Přístup je aditivní; tento návrh netvrdí, že mění jiná existující oprávnění účtu.

IAM `resource.name` omezuje cestu, nikoli generaci. Po zpřístupnění připnout každý GET na zachycenou generation, přečíst jen `name,bucket,generation,size,contentType,metadata`, porovnat název, bucket, generaci, velikost a MIME a uložit pouze metadata keys plus `downloadTokensPresent`; žádné token values do logů nebo Gitu. Nesoulad znamená zastavení bez automatického přechodu na jinou generaci. Úspěch znamená skutečně potvrzenou absenci download tokenů na těchto objektech, nikoli automatickou produkční či provozní akceptaci.
