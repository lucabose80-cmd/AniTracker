# Architektur-Blueprint: Der echte Offline-Modus (Local-First)

Dieses Dokument beschreibt das finale Zielbild und die notwendige technische Architektur, um AniTracker zu einer echten Offline-First App zu machen. Die App soll sich offline zu **100% identisch** anfühlen wie online, ohne Ladehemmungen oder eingeschränkte Funktionalitäten. 

## 1. Das Zielbild (Die Nutzererfahrung)
- Der Nutzer öffnet die App im Flugzeug oder Funkloch. Die App startet sofort (0ms Verzögerung).
- Die Bibliothek, alle Statistiken und der komplette aktuelle Social Feed (inklusive der aktiven Threads) sind vollständig vorhanden und lesbar.
- Der Nutzer kann ein Werk "einchecken" (z.B. Folge 5) und einen Kommentar verfassen.
- Die App erstellt *sofort* einen neuen Thread im Feed. Der Nutzer wird dorthin weitergeleitet, kann seinen Thread sehen, darauf antworten oder seine Bewertung anpassen.
- Sobald das Gerät wieder online ist, passiert im Hintergrund die "Magie": Die App synchronisiert alles lautlos. Wenn ein anderer Nutzer in der Zwischenzeit ebenfalls Folge 5 eingecheckt hat, werden die Threads intelligent zusammengeführt (gemergt). Erst dann gehen die Push-Benachrichtigungen an andere Nutzer raus.

---

## 2. Warum der Standard-Weg (Firebase Cache) hier nicht reicht
Der ursprüngliche Versuch, sich einfach auf den eingebauten `persistentLocalCache` von Firebase zu verlassen, ist für dieses Level an Funktionalität ungeeignet:
- **Keine echte Konfliktlösung:** Firebase lädt Offline-Änderungen einfach stur hoch. Wenn zwei Nutzer offline denselben Episoden-Thread erstellen, entstehen online zwei identische Threads (Duplikate).
- **Hänger & Timeouts:** Firebase versucht im Hintergrund oft zu lange, eine Verbindung aufzubauen, was das UI blockiert.
- **Tab-Limits:** Der Standard-Cache crasht, wenn der Nutzer die App in zwei Tabs öffnet.

Um das perfekte 1:1 Offline-Gefühl zu erreichen, müssen wir Firebase die Kontrolle über den Cache entziehen und eine **Local-First Architecture** bauen.

---

## 3. Der Masterplan: Local-First Architecture

Wir bauen eine eigene "Schatten-Datenbank" im Browser des Nutzers. Das Frontend kommuniziert *immer* nur mit dieser lokalen Datenbank, und eine separate Hintergrund-Engine kümmert sich um den Server-Abgleich.

### Phase A: Pre-Caching (Das Offline-Universum)
Wir nutzen eine robuste lokale Datenbank-Bibliothek wie **Dexie.js** (ein Wrapper für IndexedDB).
- Beim Login lädt die App die gesamte Bibliothek, alle Profilstatistiken und die relevanten Social-Feed-Threads herunter und schreibt sie in Dexie.js.
- Das Frontend (React/Zustand) liest **ausschließlich** aus dieser lokalen Dexie-Datenbank. Dadurch lädt alles immer in 0ms, egal ob online oder offline.

### Phase B: Offline Agieren & Temporäre IDs
Wenn der Nutzer offline einen Check-In macht und einen Thread erstellt:
- Die Aktion wird in Dexie.js gespeichert.
- Da wir offline keine echte Firebase-ID generieren können, erstellt die App eine **temporäre ID** (z.B. `temp_thread_001`).
- Die UI navigiert den Nutzer sofort zu `/feed/temp_thread_001`. Der Nutzer kann dort weitere Antworten verfassen, die als `temp_comment_01` an den temporären Thread gehangen werden. Alles funktioniert lokal perfekt.

### Phase C: Der Sync- & Merge-Engine
Der Browser (via `window.addEventListener('online')` oder Service Worker Background Sync) registriert, dass das Internet wieder da ist. Die Hintergrund-Engine beginnt ihre Arbeit:

1. **Konflikt-Prüfung:** Die Engine will `temp_thread_001` (Check-In für Folge 5) hochladen. Sie fragt bei Firebase an: *"Gibt es für dieses Werk bereits einen Thread zu Folge 5?"*
2. **Der Merge (Die Zusammenführung):** 
   - Antwortet der Server "Ja, User B hat vor 5 Minuten einen erstellt", verweigert die Engine das Anlegen eines neuen Threads.
   - Stattdessen konvertiert sie den Offline-Check-In in einen einfachen Kommentar und hängt ihn an den *existierenden* Thread von User B an.
3. **ID-Swapping:** Die Engine geht in die lokale Dexie-Datenbank und tauscht blitzschnell überall die ID `temp_thread_001` gegen die echte Firebase-ID von User B aus.
4. Für den Nutzer, der vielleicht gerade auf den Bildschirm schaut, fügen sich die Dinge nahtlos zusammen, ohne dass er einen Fehler sieht.

### Phase D: Side-Effects & Push-Benachrichtigungen
Normale Push-Benachrichtigungen dürfen im Offline-Modus nicht sofort in der lokalen Queue landen, da sich IDs und Ziele (wie im Merge-Szenario beschrieben) ändern können.
- Erst **nachdem** die Sync-Engine den Upload und eventuelle Merges erfolgreich beim Server bestätigt hat, triggert der Server (z.B. via Firebase Cloud Functions) die Push-Benachrichtigungen an die anderen Nutzer.
- So bekommt niemand einen Link zu einem `temp_thread`, der gar nicht existiert.

---

## 4. Sicherer Entwicklungs- und Test-Workflow

Ein so tiefer Eingriff in die Datenbank-Logik birgt bei direkter Entwicklung am Live-System ein hohes Risiko für Datenverlust. Zudem muss sichergestellt werden, dass die Limits der Gratis-Tarife (Firebase Spark Plan & Vercel Hobby Plan) nicht gesprengt werden.

### A. Ressourcenschonung (Gratis-Plan sichern)
Eine Local-First Architektur ist bei richtiger Implementierung das Beste, was dem **Firebase Spark Plan** passieren kann (Limit: 50.000 Reads/Tag).
- **Delta-Sync:** Die App lädt beim Öffnen nicht die gesamte Datenbank herunter. Sie fragt den Server nur nach einem Zeitstempel: *"Gib mir alle neuen Beiträge seit meinem letzten Login gestern 14:00 Uhr."*
- Da der Nutzer beim Navigieren durch die App zu 99% aus der lokalen `Dexie.js`-Datenbank liest, gehen die Leseanfragen (Reads) an Firebase massiv zurück.

### B. Die Entwicklungs- und Test-Umgebung (Dev & Live Trennung)
Um die echten Nutzerdaten zu 100% zu schützen, wird die Entwicklung komplett isoliert:
1. **Zweite Firebase-Datenbank:** Wir erstellen im selben Google-Konto ein zweites, komplett kostenloses Firebase-Projekt (z.B. `anitracker-dev`). Dieses erhält seinen eigenen, frischen Gratis-Plan.
2. **Vercel Preview Deployments:** Anstatt den Code auf die Live-Seite (`main`-Branch) zu pushen, wird ein neuer GitHub-Branch (`feature-offline-modus`) genutzt. Vercel erstellt dafür automatisch eine geheime Test-URL.
3. **Der Test-Sandkasten:** Diese geheime Vercel-Test-URL wird mit der `anitracker-dev` Datenbank verknüpft. Wir können die Sync-Logik ohne Risiko testen.
4. **Live-Gang:** Erst wenn alles fehlerfrei ist, wird der Code zusammengeführt (gemergt) und für die echten Nutzer bereitgestellt.

---

## 5. Fehlervermeidung & Wichtige Edge Cases

Damit der Umbau von Beginn an stabil ist und nicht an unvorhergesehenen Systemgrenzen scheitert, müssen vier kritische Randfälle (Edge Cases) in der Architektur berücksichtigt werden:

1. **Speicherplatz & Automatische Löschung (Data Eviction):**
   - *Problem:* Wenn wir den gesamten Feed dauerhaft lokal speichern, wird die IndexedDB zu groß. Ist der Handy-Speicher des Nutzers voll, löscht der Browser (z.B. Safari iOS) IndexedDB-Daten oft ungefragt, was zu Totalverlust der Offline-Daten führt.
   - *Lösung:* Wir implementieren eine "Garbage Collection". Die App löscht alte, gelesene Feed-Posts (z.B. älter als 14 Tage) automatisch aus Dexie.js, um die Datenbank klein und performant zu halten.

2. **Bilder-Caching vs. Daten-Caching:**
   - *Problem:* Dexie.js speichert nur Texte und JSON-Objekte. Wenn der Nutzer offline geht, laden Cover-Bilder und Profilbilder nicht.
   - *Lösung:* Bilder müssen separat verwaltet werden. Die App muss die `CacheStorage API` des Service Workers anweisen, die Cover-Bilder der Bibliothek beim Start aktiv herunterzuladen und zwischenzuspeichern, andernfalls sieht der Offline-Modus "kaputt" aus.

3. **Uhrzeit-Konflikte (Falsche Systemzeit):**
   - *Problem:* Handys haben oft leicht verstellte Uhrzeiten. Verlässt sich die Merge-Engine auf die lokale Handy-Zeit, um zu klären, welcher Post zuerst da war, entsteht Chaos im Feed.
   - *Lösung:* Der Offline-Sync darf sich nicht auf die lokale Uhrzeit verlassen. Die Server-Logik (`serverTimestamp()` in Firebase) muss die finale Chronologie bestimmen und beim Sync die Zeiten korrigieren.

4. **Sitzungsablauf (Auth-Timeout):**
   - *Problem:* Der Nutzer ist tagelang im Offline-Modus unterwegs, checkt etliche Episoden ein und schreibt Kommentare. In der Zwischenzeit läuft seine Login-Sitzung bei Firebase aus Sicherheitsgründen ab.
   - *Lösung:* Die Sync-Engine muss Zugriffsfehler intelligent abfangen. Bekommt sie beim Sync einen `Unauthorized`-Fehler, darf sie die Offline-Queue nicht einfach verwerfen. Sie muss den Sync stoppen, den Nutzer auffordern, sich neu einzuloggen, und **danach** den Sync-Prozess der Offline-Daten fortsetzen.

---

## Fazit

Dieser Architektur-Blueprint macht AniTracker zu einer vollwertigen, robusten Desktop-/Mobile-Anwendung, die ihre Daten lediglich im Hintergrund synchronisiert. Der Umbau ist komplex, aber er ist der einzige Weg, das versprochene konfliktfreie, blitzschnelle 1:1 Online-/Offline-Erlebnis zu liefern.
