# Ostré vydání JustKvízu V2

Vlastník dne 16. října 2026 požádal o ostré nasazení, odstranění testovacího označení a adresu obsahující JustKvíz. Výslovně si nepřeje další testování.

- Veřejná adresa: **https://justkviz-v2.web.app**. Administrace: **https://justkviz-v2.web.app/admin**.
- Nový Hosting `justkviz-v2` používá již nasazené zázemí V2. Technické ID projektu zůstává `filmovy-kviz-v2-staging`; přejmenování projektu ani migrace dat nejsou součástí vydání. Existující účty, členství, kvízy, akce a oprávnění zůstávají zachované.
- Původní adresa V2 dál obsluhuje starší odkazy. Nové QR kódy, sdílené registrace a nové registrační e-maily vedou na novou adresu. Privátní token zůstává ve fragmentu odkazu, nikoli v logu.
- Zachována je stávající aktivace registračních e-mailů a její časová hranice. Jde o potvrzení, změnu a zrušení registrace; toto vydání nepřidává rozesílky ani další příjemce.
- Interní build režim `staging` zůstává kompatibilním názvem pro pevně povolený V2 projekt. Označení v běžném UI je „V2“; správce najde technické ID v popisku. V1 a její produkční projekt se nemění.

Předchozí funkční důkazy verze `b8cac786` zůstávají zachované. Toto vydání mění texty a adresy; nepředstírá nové funkční ani fyzické ověření. Provádí se sestavení a potvrzení nasazené verze, bez dalších testovacích scénářů a e-mailů.
