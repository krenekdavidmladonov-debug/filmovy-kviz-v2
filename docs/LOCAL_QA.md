# Local Human QA on Windows

## RYCHLÉ SPUŠTĚNÍ PRO HUMAN QA

1. V Průzkumníku otevřete root projektu.
2. Dvakrát klikněte na `START_LOCAL_QA.cmd`.
3. Počkejte na zprávu **JustKvíz běží lokálně** a otevření prohlížeče.
4. Na `http://localhost:5173/admin/login` použijte:
   - login: `admin@example.test`
   - heslo: `LocalQuiz123!`
5. Po testování dvakrát klikněte na `STOP_LOCAL_QA.cmd`.

Přihlašovací údaje se pouze zobrazí. Launcher je nevkládá do formuláře.

## Co launcher provádí

Launcher postupně:

1. vyžaduje přesně `demo-filmovy-kviz-v2` a bezpečné Vite emulator flags;
2. ověří, že projektový příkaz používá `firebase emulators:start --project demo-filmovy-kviz-v2`;
3. najde Node.js 22+, pnpm 11+ a Java 21+ bez změny uživatelského `PATH`;
4. odstraní Firebase credential proměnné z prostředí child procesů a použije izolovanou, Git-ignored Firebase CLI konfiguraci;
5. ověří porty z `firebase.json` spolu s Emulator Hub/Logging a Vite portem;
6. spustí Firebase Emulator Suite ve skrytém worker procesu;
7. provede existující `pnpm seed:emulators`, který má vlastní emulator-only a `demo-*` pojistky;
8. spustí Vite na `127.0.0.1:5173`, ověří login endpoint a otevře jej ve výchozím prohlížeči.

Při druhém spuštění rozpozná vlastní běžící procesy a nevytváří duplicity. Bezpečné ručně spuštěné prostředí umí znovu použít jen tehdy, když ověří demo Emulator Hub, všechny očekávané lokální porty a správný web endpoint.

## Bezpečné zastavení

`STOP_LOCAL_QA.cmd` načte `.local-data/local-qa/run-state.json`. Před ukončením porovná:

- repository a demo project ID;
- PID a přesný čas vzniku procesu;
- worker command line, roli a unikátní token daného běhu.

Teprve potom ukončí konkrétní procesový strom. Nikdy nepoužívá plošné ukončování všech `node.exe` nebo `java.exe`. Pokud identitu nelze potvrdit, fail-closed nic neukončí.

Logy zůstávají v `.local-data/local-qa/`; celý adresář je ignorován Gitem.

## Jak launcher hledá nástroje

Pořadí zahrnuje standardní `PATH`, běžné per-user instalace, přenosné nástroje v Git-ignored `.tools/`, Corepack bez automatického stahování a relativně nalezený Codex runtime. Cesty neobsahují hardcoded uživatelské jméno ani verzi Codex runtime. Git je diagnostikován, ale pro spuštění aplikace není nutný.

Na aktuálním QA počítači standardní per-user/system `PATH` obsahuje Windows a GitHub CLI, nikoli Node, pnpm, Javu nebo Git. Codex tyto nástroje přidává pouze do izolovaného PATH svých tasků. Běžný PowerShell spuštěný mimo Codex tento PATH nezdědí; proto dříve zobrazoval chybu, že `pnpm` nebo `git` nezná. Launcher systémové nastavení nemění a nástroje najde sám.

## Lidské chyby

- **Node.js nebyl nalezen:** nainstalujte Node.js 22 LTS nebo otevřete projekt v Codex prostředí s lokálním runtime.
- **Java nebyla nalezena:** nainstalujte Temurin JDK 21.
- **pnpm nebyl nalezen:** nainstalujte pnpm 11 nebo jej připravte přes Corepack.
- **Port 5173 už používá jiná aplikace:** zavřete pouze uvedenou konfliktní aplikaci a spusťte launcher znovu.
- **Emulátory nebo seed selhaly:** zkontrolujte `.local-data/local-qa/emulators.log` a zkuste nejprve `STOP_LOCAL_QA.cmd`.

Launcher neopravuje per-user `PATH`, nic nedeployuje a nemá podporovaný production override.

## Ruční postup pro vývojáře

Technický postup zůstává podporovaný:

```powershell
pnpm emulators
```

Ve druhém terminálu:

```powershell
pnpm seed:emulators
pnpm dev
```

Také ruční postup smí používat pouze lokální emulátory a `demo-*` project ID.
