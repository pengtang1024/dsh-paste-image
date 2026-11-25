# Funktionsweise

Diese Seite erklärt, wie dsh-paste-image fast jedes Bild — selbst eines mit falsch deklariertem Typ — beim Einfügen oder Ziehen in den Composer von DeepSeek Harness übernimmt. Sie folgt [`how-it-works.md`](how-it-works.md) und spiegelt die aktuelle Implementierung wider: PNG / JPEG / WebP als Ausgabe, Konvertierungsschalter pro Format und Einstellungen im `localStorage` des Browsers.

## Ablauf im Überblick

```text
Einfügen / Ziehen (Capture-Phase)
        |
        v
  handle(event, data)
        |  keine Dateien, mehr als maxFiles oder kein Bildkandidat -> Rückkehr, nativer Pfad
        |  preventDefault() + stopPropagation()
        v
  für jeden Kandidaten -> normalize(file)
        | sniff(bytes) -> tatsächliches Format
        | nativ und Deklaration stimmt überein -> null (Datei bleibt unberührt)
        | Deklaration leer -> File neu typisieren, ohne Neukodierung
        v
  toCanvas()
        | XPM       -> decodeXpm()
        | SVG       -> loadSvg() + Rasterisierung über <img>
        | BMP / DIB -> createImageBitmap(), Rückfall decodeBmp()
        |              (eingebettete JPEG/PNG-Daten zuerst entpackt)
        | ICO / CUR -> createImageBitmap(), Rückfall auf größten PNG-Eintrag
        | sonst     -> createImageBitmap()
        v
  canvasOf()   längste Seite auf maxSide begrenzt (Standard 4096)
        v
  encodeCanvas()  canvas.toBlob(profile.mime[, quality])
        v
  new File(name.<ext>, Typ aus dem tatsächlichen blob.type)
        v
  reroute(files) -> synthetisches DragEvent('drop') auf [data-composer-card]
```

## 1. Capture-Phase

Das Plugin horcht im Capture-Modus (`addEventListener(..., true)`) auf `paste` und `drop` bei `document`. Die Capture-Phase verläuft von `document` abwärts zum Ziel, daher sieht das Plugin das Ereignis vor dem eigenen Handler des Composers; bei einer Konvertierung kann es `preventDefault()` aufrufen, bevor der Composer `clipboardData` liest.

## 2. Vorprüfungen und Überspringbedingungen

`handle()` kehrt frühzeitig zurück, ohne das Ereignis zu übernehmen, wenn:

- Der Hauptschalter aus ist (`enabled === false`): die Listener bleiben installiert und wirken nach dem Reaktivieren sofort.
- Das Ereignis bereits die Markierung `REROUTED` trägt: verhindert Rekursion, weil das Plugin sein eigenes synthetisches Ereignis erneut sieht.
- Keine Dateien vorhanden sind oder mehr als `maxFiles` (Standard 8, einstellbar 1–8): der gesamte Stapel geht an den nativen Pfad, ohne Teilkonvertierung.
- Keine Datei ein Bildkandidat ist: der deklarierte Typ muss mit `image/` beginnen oder der Dateiname auf eine Bildendung enden; reines Einfügen von Text trifft nie zu.
- Die Konstruktoren `DataTransfer` / `DragEvent` fehlen oder die Composer-Karte (`[data-composer-card]`) nicht gefunden wird: das Plugin gibt das Ereignis frei und der native Browserpfad läuft weiter.

Jede Kandidatendatei wird in einem eigenen `try/catch` konvertiert; bei Misserfolg bleibt die Originaldatei erhalten.

## 3. Erkennung anhand magischer Bytes

`sniff()` liest die ersten Bytes und bestimmt das tatsächliche Format anhand der Signatur: PNG, JPEG, GIF, WebP (RIFF + WEBP), BMP (`BM` oder ein DIB ohne Datei-Header `BITMAPINFOHEADER`), TIFF (II/MM), XPM (`/* XPM */`), AVIF / HEIC (`ftyp`-Brand), ICO/CUR (`00 00 01 00` / `00 00 02 00`), SVG (beginnt mit `<` und enthält `<svg` innerhalb des ersten KiB). Bei keiner Übereinstimmung wird `null` zurückgegeben. Ein DIB ohne Datei-Header wird zuerst auf Headerlänge, Vorzeichen von Breite/Höhe und Bit Tiefe geprüft, damit zufällige Binärdaten nicht als Bild fehlinterpretiert werden.

## 4. Unverändertes Durchreichen

`normalize()` liest nur die ersten 1024 Bytes des Headers, um zu entscheiden, ob die gesamte Datei angefasst werden muss:

- Der Konvertierungsschalter für dieses Format ist aus: die Originaldatei passiert, ohne überhaupt die vollständigen Bytes zu lesen.
- Ein nativer Typ (PNG/JPEG/WebP/GIF), dessen Deklaration mit den echten Bytes übereinstimmt: passiert nach dem Lesen des 1-KiB-Headers. Echte Screenshots behalten dadurch Bytes, Metadaten und Animation vollständig unverändert.
- Der deklarierte Typ ist leer: die Bytes werden in ein `File` mit dem erkannten Typ neu verpackt (ohne Neukodierung), damit sie die Whitelist des Hosts passieren.
- Der deklarierte Typ widerspricht den echten Bytes (z. B. BMP behauptet PNG): er wird konvertiert und in das gewählte Ausgabeformat neu kodiert.

Bei der Konvertierung wird die Endung durch die tatsächliche Kodierung ersetzt (`shot.xpm` -> `shot.png`); neu typisierte native Dateien behalten ihre Endung. Eine MIME-Aliastabelle (`image/jpg`, `image/x-png`, `image/svg+xml`, usw.) normalisiert Schreibweisen zuerst, damit intakte Dateien nicht unnötig neu kodiert werden.

## 5. Dekodierung und Kodierung

Dekodierungspfade: XPM nutzt den integrierten Dekoder; SVG wird über `<img>` rasterisiert (Chromium bietet für SVG-Blobs kein `createImageBitmap()`); alles andere geht an `createImageBitmap()`, wobei BMP auf `decodeBmp()` zurückfällt oder eingebettetes JPEG/PNG entpackt und ICO auf den größten PNG-Eintrag zurückfällt. Die Größe wird mit `scale = min(1, maxSide / längste Seite)` skaliert; kleine Bilder bleiben unverändert.

Die Kodierung läuft über `encodeCanvas()`: PNG ist verlustfrei und erhält keinen Qualitätsparameter; JPEG wird zuerst auf undurchsichtigem Weiß komponiert (transparente Pixel werden nicht schwarz), WebP behält die Transparenz, beide erhalten `quality`. Der endgültige Typ stammt aus dem tatsächlichen `blob.type` des Browsers, mit PNG als Rückfall, wenn er nicht erkannt wird.

## 6. Weiterleitung

`reroute()` legt die konvertierten Dateien in eine `DataTransfer` und dispatcht ein synthetisches `drop`-Ereignis (mit nicht aufzählbarer `REROUTED`-Markierung) auf die echte Composer-Karte. Damit wird derselbe Anhangpfad wie bei manuellem Ziehen genutzt, ohne private Composer-APIs; wird keine Karte gefunden, wird nichts dispatched.

## 7. Fehlerbehandlung und Protokollierung

Die Konvertierung läuft pro Datei in einem `try/catch`. Erfolg protokolliert eine Zeile wie `image/xpm -> image/png 1440x900`; Misserfolg protokolliert `keep original (image/bmp): ...` und behält die Originaldatei — eine schlechte Datei blockiert nie die anderen, der synthetische Drop findet trotzdem statt, und das Ergebnis ist der übliche Host-Fehler statt Stille. Die Ausgabe läuft über `console.debug`; die Browser-Konsole muss auf Verbose stehen, um sie zu sehen.

## 8. Einstellungen und Konfigurationsseite

Einstellungen liegen ausschließlich im `localStorage` des Browsers (Schlüssel `dsh-paste-image.settings.v1`; im privaten Modus oder wenn Speicherung deaktiviert ist, wird eine Kopie im Speicher verwendet und das Einfügen funktioniert weiter). Sie können auf der Konfigurationsseite des Plugins oder über `api.getSettings()` / `api.applySettings(patch)` / `api.resetSettings()` geändert werden.

| Einstellung | Standard | Wert / Bereich | Wirkung |
| --- | --- | --- | --- |
| `enabled` | `true` | Boolean | Hauptschalter; aus -> Einfügen nutzt nativen Pfad |
| `maxFiles` | `8` | Ganzzahl 1–8 | Max. Dateien pro Stapel; darüber passiert der ganze Stapel unverändert |
| `maxSide` | `4096` | Ganzzahl 512–8192 | Grenze für die längste Seite konvertierter Bilder |
| `outputFormat` | `png` | `png` / `jpeg` / `webp` | Ausgabeformat der Konvertierung (PNG bei fehlender Unterstützung) |
| `quality` | `0.92` | 0.1–1 (2 Dezimalstellen) | JPEG / WebP-Kodierqualität; im Formular bei PNG deaktiviert |
| `convertXpm` | `true` | Boolean | XPM konvertieren oder nicht |
| `convertBmp` | `true` | Boolean | BMP / DIB konvertieren oder nicht |
| `convertSvg` | `true` | Boolean | SVG konvertieren oder nicht |
| `convertIco` | `true` | Boolean | ICO / CUR konvertieren oder nicht |
| `logConversions` | `true` | Boolean | Debug-Protokolle für Konvertierungen ausgeben |

Das Konfigurationsformular enthält die obigen Kontrollkästchen, ein Dropdown für das Ausgabeformat und drei Zahlenfelder; Entwürfe liegen im Komponentenzustand und werden erst beim Klick auf „Speichern" geschrieben; „Standard wiederherstellen" setzt die Werte der Tabelle zurück.

## 9. Grenzen und nicht unterstützte Fälle

- **HEIC / TIFF**: Signaturen werden erkannt, aber nicht dekodiert (kein integrierter Dekoder), die Dateien bleiben unverändert.
- **XPM**: XPM1/XPM2-Headerlayouts und andere Farbkeys als `c` werden nicht unterstützt; Palettennamen, die keine gültigen CSS-Farben sind (etwa das zweiwörtliche `light gray`), werden opak schwarz; `None` ist vollständig transparent.
- **BMP / DIB**: unterstützt Headerlängen 12/40/52/56/64/108/124, Bittiefen 1/4/8/16/24/32, Kompression BI_RGB / RLE8 / RLE4 / BITFIELDS / ALPHABITFIELDS, eingebettetes JPEG/PNG und Bitmaps von oben nach unten; Bilder über 64 Mi Pixel werden vor der Speicherzuweisung abgelehnt. Ein 32-Bit-Alphakanal mit ausschließlich Nullen wird als opak behandelt.
- **ICO / CUR**: nur Icons mit einem PNG-Eintrag werden unterstützt (der größte nach Fläche); reine DIB-Icons und Cursor nicht.
- **Native Formate**: PNG, JPEG, WebP und GIF mit zur Realität passender Deklaration werden nie neu kodiert.
- **Größenvergleich**: Fotos sind mit JPEG/WebP etwa 82 % kleiner; UI-Screenshots sind mit PNG oft kleiner. Siehe [Messungen der Ausgabeformate](output-formats.md).

## 10. Designprinzipien

Bytes vor Labels; synchrone Abbrechen in der Capture-Phase; PNG als Standardausgabe (auf der Whitelist, verlustfrei, in Chromium universell); synthetischer Drop statt privater API; kein Host-Prozess und keine Decoder von Dritten.
