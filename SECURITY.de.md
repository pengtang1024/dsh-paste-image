# Sicherheitsrichtlinie

## Unterstützte Versionen

| Version         | Unterstützt                                        |
| --------------- | -------------------------------------------------- |
| 0.6.x           | Ja — aktuelle Release-Linie                        |
| 0.5.x und älter | Nein — bitte auf die neueste Version aktualisieren |

Das Plugin hat noch keine Version 1.0 veröffentlicht; Sicherheitskorrekturen werden daher mit einer neuen Patch-Version der aktuellen Minor-Version veröffentlicht und nicht auf ältere Versionslinien zurückportiert.

> 🔒 **Bitte melden Sie Schwachstellen vertraulich.** Nutzen Sie die private Schwachstellenmeldung von GitHub (Reiter **Security** des Repositories → **Report a vulnerability**); geben Sie keine Details zur Ausnutzung in öffentlichen Issues bekannt.

## Schwachstellen melden

Bitte melden Sie dies vertraulich. Nutzen Sie die private Schwachstellenmeldung von GitHub: Öffnen Sie den Reiter **Security** des Repositories und wählen Sie **Report a vulnerability**. Falls dieser Ablauf nicht verfügbar ist, kontaktieren Sie den Maintainer [@pengtang1024](https://github.com/pengtang1024) auf GitHub, um einen vertraulichen Kanal zu erhalten — geben Sie keine Details zur Ausnutzung der Schwachstelle in öffentlichen Issues bekannt.

Ein guter Bericht sollte Folgendes enthalten:

- Die DSH-Version und wie das Plugin installiert wurde.
- Betriebssystem und Desktop-Sitzung.
- Das betroffene Format bzw. der betroffene Decoder (XPM, BMP, Sniffing, Drop-Back-Pfad).
- Ein minimales Reproduktionsmaterial: die Datei oder die exakten Bytes sowie die Schritte zur Reproduktion.
- Die Konsolenausgabe auf Verbose-Ebene, einschließlich aller Zeilen mit `[dsh-paste-image]`.

Wir bestätigen den Eingang von Meldungen nach bestem Bemühen; sofern eine Meldung bestätigt wurde, wird die Korrektur mit einer Patch-Version veröffentlicht. Sofern Sie nichts anderes wünschen, erwähnen wir Sie in den Versionshinweisen.

## Geltungsbereich

`dsh-paste-image` läuft vollständig im Renderer-Prozess von DSH. Es greift nicht auf das Netzwerk zu, hat keine Hintergrundprozesse, fragt die Zwischenablage nicht ab und verändert keinen Host-Code von DSH. Seine gesamte Aufgabe besteht darin, Dateien aus `paste`- oder `drop`-Ereignissen zu lesen, sie lokal zu dekodieren, im gewählten Ausgabeformat (standardmäßig WebP) neu zu kodieren und anschließend ein synthetisches `drop`-Ereignis im selben Fenster auszulösen.

Im Geltungsbereich:

- Abstürze, Hängenbleiben oder Speichererschöpfung, verursacht durch speziell gestaltete XPM- oder BMP-Dateien.
- Fehlerhafte Pixel aufgrund von Parser-Fehlern, die Benutzer in die Irre führen können.
- Umgehung der dokumentierten Beschränkungen (8 Dateien pro Ereignis, maximale Kantenlänge von 4096 px bei konvertierten Bildern).
- Methoden, die das Plugin dazu bringen, Daten außerhalb der eingefügten oder hineingezogenen Dateien zu lesen oder zu übertragen.

Außerhalb des Geltungsbereichs:

- Schwachstellen in DSH selbst, in Electron/Chromium oder im Betriebssystem.
- Angriffe, die bereits die Kontrolle über den Renderer-Prozess oder die Fähigkeit, Plugins zu installieren, voraussetzen; solcher Code verfügt ohnehin über vollständige Seitenberechtigungen.
- Berichte zu Social Engineering sowie Denial-of-Service durch übergroße, aber normale Dateien, die bereits der Browser selbst nicht verarbeiten kann.

## Design-Anmerkungen

- Das Plugin liest Bytes ausschließlich aus `clipboardData.files` oder `dataTransfer.files` des Ereignisses.
- Zum Dekodieren werden die integrierten Codecs des Browsers sowie zwei kleine lokale Parser verwendet; es werden keinerlei Daten nach außen gesendet.
- Die konvertierten Dateien sind neue `File`-Objekte im Speicher. Es wird nichts auf die Festplatte geschrieben, und beim Entladen der Seite bleibt nichts zurück.
- Keine Laufzeitabhängigkeiten von Drittanbietern.
