# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

Fügen Sie fast jedes Bild in DeepSeek Harness ein oder ziehen Sie es hinein – selbst wenn die Zwischenablage `image/xpm` meldet oder beim MIME-Typ lügt.

## Warum es dieses Plugin gibt

Der DSH-Desktop-Client (Electron/Chromium) akzeptiert genau vier Anhangstypen: `image/png`, `image/jpeg`, `image/webp` und `image/gif`. Alles andere wird mit einer roten Fehlermeldung abgelehnt, die nur PNG, JPG, WebP und GIF aufführt.

Diese Whitelist macht zwei Dinge kaputt, die unter Linux ständig vorkommen:

- **Screenshots, die als XPM deklariert sind.** Manche Screenshot-Werkzeuge – insbesondere unter Ubuntu/Wayland – legen das Bild mit dem Typ `image/xpm` in die Zwischenablage. Die Pixel sind in Ordnung; die Bezeichnung steht nicht auf der Whitelist, also wird das Einfügen abgelehnt.
- **BMP-Bytes mit PNG-Etikett.** Manche Anwendungen übergeben eine BMP-(oder TIFF-)Nutzlast und deklarieren dabei `image/png`. Der deklarierte Typ besteht die Whitelist-Prüfung, der Decoder scheitert später, und es erscheint dieselbe rote Fehlermeldung.

`dsh-paste-image` behandelt beide Fälle im Renderer: Es sieht sich die tatsächlichen Bytes an, decodiert, was die Zwischenablage wirklich enthält, codiert das Ergebnis als PNG neu und gibt es an den normalen Anhangskanal zurück.

## So funktioniert es

1. **Abfangen.** `install()` registriert `paste`- und `drop`-Listener auf `document` in der Capture-Phase, sodass das Plugin das Ereignis sieht, bevor der Composer es verarbeitet.
2. **Erkennen.** `handle()` liest die `File`-Objekte aus `clipboardData` oder `dataTransfer`, und `sniff()` bestimmt das echte Format anhand der Magic Bytes – nicht anhand des deklarierten MIME-Typs.
3. **Neu codieren.** `normalize()` reicht native Dateien unverändert durch. Alles andere wird decodiert (eigene Pfade für XPM, BMP/DIB und SVG, für den Rest der browser-eigene Codec), auf eine Canvas gezeichnet, deren längste Seite auf 4096 px begrenzt ist, und als `image/png` mit einem `.png`-Dateinamen exportiert.
4. **Umleiten.** `handle()` löst ein synthetisches `drop`-Ereignis mit der neuen `File` an `[data-composer-card]` aus – derselbe Weg, den ein echtes Drag-and-Drop nimmt. Eine Markierung `__dshPasteImageRerouted` verhindert, dass das Plugin sein eigenes Ereignis abfängt.

All das läuft clientseitig. Es gibt keinen Host-Prozess, kein Polling der Zwischenablage und keine Netzwerkanfrage.

## Unterstützte Formate

Diese Tabelle ist die Kurzfassung. Die [Format-Referenz](docs/en/formats.md) erklärt die Entscheidungskette, die vollständige BMP-Variantenmatrix und was bewusst nicht abgedeckt ist.

| Format                          | Üblicher deklarierter Typ | Was passiert                                                                                                                                       |
| ------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                             | `image/png`               | Unverändert durchgereicht                                                                                                                          |
| JPEG / JFIF                     | `image/jpeg`              | Unverändert durchgereicht                                                                                                                          |
| WebP                            | `image/webp`              | Unverändert durchgereicht                                                                                                                          |
| GIF                             | `image/gif`               | Unverändert durchgereicht                                                                                                                          |
| XPM (XPM3-Text)                 | `image/xpm`               | Wird von `decodeXpm()` decodiert, als PNG neu codiert                                                                                              |
| BMP / DIB                       | `image/bmp`               | Zuerst Browser-Decoder, `decodeBmp()` als Fallback: 1/4/8/16/24/32-Bit, RLE4/RLE8, BITFIELDS, OS/2-Header und headerlose DIBs                      |
| SVG                             | `image/svg+xml`           | Über ein `<img>`-Element gerastert, als PNG neu codiert                                                                                            |
| ICO / CUR                       | `image/x-icon`            | Zuerst Browser-Decoder, dann Fallback auf den größten PNG-komprimierten Eintrag                                                                    |
| TIFF                            | `image/tiff`              | Anhand der Magic Bytes erkannt; nur decodiert, wenn der Browser einen TIFF-Codec mitbringt (Chromium nicht), sonst wird das Original durchgereicht |
| AVIF                            | `image/avif`              | Von Chromium decodiert, als PNG neu codiert                                                                                                        |
| HEIC / HEIF, sonstige `image/*` | `image/...`               | Anhand der Magic Bytes erkannt; nur decodiert, wenn der Browser den Codec hat (Chromium decodiert kein HEIC), sonst durchgereicht                  |

Ein Durchreichen erfolgt nur, wenn die Magic Bytes zu einem der vier nativen Typen passen **und** der deklarierte Typ damit übereinstimmt. Eine Datei, deren Bytes JPEG sind, die aber `image/png` behauptet, wird als echtes PNG neu codiert – der deklarierte Typ kann also nicht mehr lügen. Eine native Datei ganz ohne deklarierten Typ wird mit dem erkannten Typ neu verpackt, statt neu codiert zu werden; gängige Alias-Schreibweisen (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) gelten als Übereinstimmung.

Eine Datei wird überhaupt erst berücksichtigt, wenn ihr MIME-Typ mit `image/` beginnt oder ihr Name auf `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` oder `.heif` endet. Nicht-Bilddateien in derselben Einfügeaktion werden unverändert weitergeleitet.

## Installation

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

Das Paket wird vorgebaut ausgeliefert – Renderer-Bundle, Host-Eintrag, Loader-Patch, Anzeige-Metadaten und Dokumentation –, sodass die Installation es direkt aus der npm-Registry zieht.

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

Für die lokale Entwicklung können Sie das Profil auf Ihren Checkout zeigen lassen:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Ersetzen Sie `<profile>` durch das Profil, in dem Ihre App läuft. **Laden Sie die Seite nach der Installation neu** (`Ctrl+R` oder `Cmd+R` unter macOS). Das Client-Modul wird nur beim Laden des Renderers eingeschleust; ein frisch installiertes Plugin fängt daher nichts ab, bis Sie neu laden.

## Prüfen, ob es funktioniert

Führen Sie die Prüfungen des Repositorys aus:

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` führt die Node-Testsuite aus: Magic-Byte-Erkennung, Kandidatenerkennung, jede BMP-Variante, die Konvertierung von als PNG deklarierten BMPs, headerlose DIBs, natives Durchreichen und die für jede Sprache ausgelieferten Anzeige-Metadaten. `npm run check` prüft die Syntax von `client.js` und `lib/index.js`.

Prüfen Sie dann den echten Ablauf:

1. Laden Sie das DSH-Fenster neu.
2. Machen Sie mit Ihrem gewohnten Werkzeug einen Screenshot und fügen Sie ihn in den Composer ein, oder ziehen Sie eine Bilddatei darauf ab.
3. Der Anhang erscheint. Öffnen Sie die DevTools (`Ctrl+Shift+I`) → Console, stellen Sie die Stufe auf **Verbose** und suchen Sie eine Zeile wie:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

Schlägt die Konvertierung fehl, behält das Plugin die Originaldatei und protokolliert stattdessen `keep original (...)`.

## Einschränkungen

- **XPM:** nur das XPM3-Textformat. Der Parser liest den Farbschlüssel `c`; andere Schlüssel wie `m`, `g` und `s` werden ignoriert. Farben werden vom CSS-Parser des Browsers aufgelöst; Palettennamen, die keine gültigen CSS-Farben sind – etwa das mehrteilige `light gray` –, fallen daher auf opakes Schwarz zurück.
- **BMP:** 1/4/8/16/24/32-Bit, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` und `BI_ALPHABITFIELDS`, mit Core-, Extended-, V4/V5- oder OS/2-Headern – dazu headerlose DIBs. 2-Bit- und 64-Bit-pro-Pixel-Varianten werden nicht unterstützt. Bei 32-Bit-Dateien ohne deklarierte Alpha-Maske wird ein durchgehend Null-Alphakanal als opak behandelt, statt ein vollständig transparentes PNG zu erzeugen.
- **Andere Codecs:** SVG wird im Plugin selbst gerastert; ICO/CUR fallen auf PNG-komprimierte Einträge zurück; AVIF setzt auf den Browser-Decoder. TIFF und HEIC werden erkannt, aber Chromium liefert keinen Codec dafür mit, sodass das Original durchgereicht wird und der Host es wie zuvor ablehnt. Es wird kein Decoder von Drittanbietern mitgeliefert.
- **Größe:** konvertierte Bilder werden auf höchstens 4096 px auf der längsten Seite herunterskaliert. Nativ unverändert durchgereichte Dateien werden nicht skaliert.
- **Dateianzahl:** eine Einfüge- oder Drop-Aktion darf höchstens 8 Dateien enthalten. Größere Stapel werden vollständig dem nativen Pfad überlassen.
- **Flattening:** ein konvertiertes Bild wird zu einem einzelnen PNG-Frame. Animationen, EXIF-Metadaten und eingebettete Farbprofile bleiben nicht erhalten.
- **Umfang:** Es werden nur die Pfade `paste` und `drop` abgedeckt. Der Dateiauswahldialog und andere Einfügewege behalten ihr natives Verhalten.

## Sicherheit und Datenschutz

- Alles läuft im Renderer. Das Plugin stellt keine Netzwerkanfragen, lädt nichts hoch und speichert nichts.
- Es gibt keinen Hintergrundprozess, kein Polling der Zwischenablage und keine Änderung am DSH-Host-Code.
- Bild-Bytes werden ausschließlich aus dem Paste- oder Drop-Ereignis gelesen, lokal decodiert und an dasselbe Fenster zurückgegeben.
- Die Decoder sind klein, verarbeiten aber nicht vertrauenswürdige Eingaben. Wenn Sie einen Absturz oder einen Parsing-Fehler finden, sehen Sie in [SECURITY.md](SECURITY.en.md) nach.

## Sprachen

Das Plugin liefert Anzeige-Metadaten für jede Sprache, die die DSH-Oberfläche unterstützt – Englisch, vereinfachtes Chinesisch, Japanisch, Spanisch, Französisch, Deutsch, Russisch und Portugiesisch. Jede Datei `locale/<language>.json` enthält den lokalisierten Titel und die Beschreibung und verweist mit ihrer Detailseite auf das passende README in diesem Repository, sodass der Plugin Manager und seine Detailseite dieselbe Sprache sprechen wie die App.

Übersetzungen sind Quelldateien neben dem Code, kein generierter Text. Die Testsuite prüft, dass jede angekündigte Sprache eine Locale-Datei, ein Detaildokument und Links zu den anderen READMEs hat. Wie Sie eine Übersetzung korrigieren oder hinzufügen, steht unter [Mitwirken](CONTRIBUTING.en.md#translations).

## Dokumentation

- [So funktioniert es](docs/en/how-it-works.md) – Ereignisfluss, Decoder-Interna und eine Code-Landkarte Funktion für Funktion.
- [Formatunterstützung](docs/en/formats.md) – Entscheidungskette, Formatmatrix, BMP-Varianten und die Checkliste zum Hinzufügen eines Formats.
- [Fehlerbehebung](docs/en/troubleshooting.md) – häufige Fehler und wie man die Logs liest.
- [Veröffentlichen](docs/en/releasing.md) – Versionsrichtlinie und die Release-Checkliste für Maintainer.

## Community

- [Mitwirken](CONTRIBUTING.en.md) – Einrichtung, Tests, Stil, Übersetzungen und was ein Format-Beitrag braucht.
- [Verhaltenskodex](CODE_OF_CONDUCT.md) – Contributor Covenant 2.1.
- [Sicherheitsrichtlinie](SECURITY.en.md) – vertrauliche Meldung, Umfang und unterstützte Versionen.
- [Changelog](CHANGELOG.en.md) und [Releases](https://github.com/pengtang1024/dsh-paste-image/releases) – was sich geändert hat und warum.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) – Fehlerberichte und Formatwünsche.

## Lizenz

MIT © 2026 pengtang1024. Siehe [LICENSE](LICENSE).
