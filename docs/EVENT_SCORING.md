# Interní bodování akce

## Použití
V detailu akce otevřete **Bodování → Otevřít bodování**, vyberte kolo a u týmu
zadejte součet bodů. Každý řádek má vlastní **Uložit**; autosave není.
Desetinná čárka i tečka jsou přijímány. Prázdné pole není příkaz ke smazání.
První zápis důvod nevyžaduje. Oprava uložené hodnoty a samostatně potvrzené
**Vrátit na nezadáno** důvod vyžadují (1–300 znaků po oříznutí).
Historie ukazuje UID aktéra, serverový čas, původní/novou hodnotu a důvod.
Zrušené týmy mají historické záznamy dostupné pouze ke čtení.

Změna kola a odchod s rozepsanými hodnotami vyžadují potvrzení. Příchozí
aktualizace nezmění rozepsaný vstup. Konflikt ukáže aktuální hodnotu i rozepsanou;
tlačítko **Připravit opravu aktuální revize** pouze změní základ pro další
výslovné uložení. Nic automaticky nepřepisuje ani neslučuje.
Chyba ponechá vstup. Po ztracené odpovědi lze zopakovat stejnou operaci;
samotná příchozí revize se nepovažuje za úspěšnou odpověď na rozpracovanou operaci.

## Datový kontrakt
- Tým je existující `events/{eventId}/registrations/{teamId}`. Online a ruční
  registrace (včetně ruční bez e-mailu) používají stejná stabilní ID.
- Kolo je `quizSnapshots/{snapshotId}/rounds/{roundId}` z aktuálního
  `event.quizAssignment.snapshotId`. Po prvním zápisu server nastaví
  `scoring.started = true` a zvýší revizi akce; existující transakční ochrana
  relocku pak nepovolí nahradit snapshot. První zápis také posílá očekávané ID
  snapshotu, aby se rozepsané body nepřiřadily mezitím nahrazenému kvízu.
- `events/{eventId}/scores/{scoreId}`: `scoreId` je SHA-256 JSON dvojice
  `[teamId, roundId]`. Dokument obsahuje `teamId, roundId, snapshotId,
  halfPoints, revision, updatedAt, updatedBy`.
- `halfPoints` je celé číslo 0 až `Number.MAX_SAFE_INTEGER`, nebo `null`
  pro nezadáno. Nula je uložený výsledek. UI převádí desetinné číslice přes
  BigInt, takže nemůže potichu zaokrouhlit velký zlomek. Současný snapshot
  nedefinuje herní maximum; žádné maximum podle počtu otázek se nepřidává.
- Chybějící zápis má očekávanou revizi 0. Každá změna přidá 1; vymazání
  uchová dokument s null a pokračující revizí. Stejná hodnota je odmítnuta
  jako změna bez účinku. Revize musí zůstat bezpečným celým číslem.
- `scores/{scoreId}/history/{revision}` je pouze přidávaná historie:
  `revision, previousHalfPoints, halfPoints, actorUid, createdAt, reason`.
- `events/{eventId}/scoreOperations/{operationKey}` je serverová účtenka:
  fingerprint normalizovaného požadavku, odpověď, aktér a serverový čas.
  Klíč hashuje JSON `[uid, eventId, "saveEventScore", requestId]`.
  Stejný klíč s jiným obsahem je odmítnut. Účtenka se čte před kontrolou
  revize, takže retry po pozdější opravě stále rozpozná původní úspěch.
  Účtenka potvrzuje historickou operaci i po zrušení týmu/akce a nic nemění.
  Nový zápis po zrušení je vždy odmítnut.

Skóre, historie, účtenka a případné zahájení bodování se zapisují v jediné
Firestore transakci. Dva rozdílné zápisy nad stejnou revizí nemohou oba uspět.
Zrušení registrace záznamy ani historii nemaže.

## Oprávnění a stavy
`saveEventScore` vyžaduje ověřenou roli admin/moderator a při každém volání
včetně retry načte aktuální serverový Auth profil (role a disabled).
Dosavadní model má globální staff přístup, žádná per-event přiřazení.
Nevzniká nová role ani token rozhodčího. Nový zápis je povolen pouze pro
přijatý tým ve stavech ready/live/finalizing; draft/scheduled nemají připravený
provozní stav a completed/cancelled/archived jsou uzavřené.

Rules umožňují čtení skóre a historie pouze stávajícím rolím admin/moderator
podle ověřeného ID tokenu, stejně jako u ostatních privátních provozních dat.
Přímé klientské create/update/delete jsou zakázané všem. Účtenky jsou
server-only. Registrační management token ani veřejný QR nemají oprávnění.
Bodování nerozšiřuje existující přístup ke kontaktům a do svého view modelu
vybírá jen ID, název a stav týmu. Nezapisuje do publicEvents, publicSessions,
projektoru ani BroadcastChannel; nečte otázky nebo správné odpovědi.

## Lokální ověření
Pouze demo-* a lokální Auth/Firestore/Functions emulátory:
- `pnpm check`
- `pnpm test:unit`
- `pnpm test:rules` (samostatná sada, čistí databázi)
- Po spuštění emulátorů a syntetickém seedu: `pnpm test:e2e:scoring`.
  Stejný scénář je součástí `pnpm test:e2e:events`, který spouští existující CI.
- `pnpm test:e2e:scoring-browser` spouští lokální Vite na 127.0.0.1:5193
  a browser scénář. Potřebuje lokální demo env a stejné emulátory/seed.

Browser scénář ověřuje první zápis, reload, opravu s důvodem, dva pohledy,
historii, ztracenou odpověď, potvrzené vrácení na nezadáno a mobilní šířku.
Scénáře zapisují jen syntetická data do emulátorů; serverový E2E wrapper
ověří demo projekt i všechny lokální endpointy před inicializací SDK.
Tato feature se tím nenasazuje. Staging, produkce V1, leaderboard a referee QR
nejsou součástí tohoto rozsahu.
