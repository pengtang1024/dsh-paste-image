# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

Collez ou déposez presque n'importe quelle image dans DeepSeek Harness — même quand le presse-papiers annonce `image/xpm` ou ment sur le type MIME.

## Pourquoi ce plugin existe

Le client de bureau DSH (Electron/Chromium) n'accepte que quatre types de pièces jointes : `image/png`, `image/jpeg`, `image/webp` et `image/gif`. Tout le reste est rejeté par une erreur rouge qui ne mentionne que PNG, JPG, WebP et GIF.

Cette liste blanche casse deux situations très courantes sous Linux :

- **Des captures d'écran déclarées en XPM.** Certains outils de capture, notamment sous Ubuntu/Wayland, placent l'image dans le presse-papiers avec le type `image/xpm`. Les pixels sont corrects ; c'est l'étiquette qui n'est pas dans la liste blanche, et le collage est rejeté.
- **Des octets BMP déguisés en PNG.** Certaines applications fournissent un contenu BMP (ou TIFF) tout en déclarant `image/png`. Le type déclaré passe le contrôle de la liste blanche, le décodeur échoue ensuite, et vous obtenez la même erreur rouge.

`dsh-paste-image` traite les deux cas dans le processus de rendu : il examine les octets réels, décode ce que le presse-papiers contient vraiment, le réencode en PNG, puis renvoie le résultat au canal de pièces jointes habituel.

## Fonctionnement

1. **Capture.** `install()` enregistre des écouteurs `paste` et `drop` sur `document` en phase de capture, de sorte que le plugin voie l'événement avant la zone de saisie.
2. **Identification.** `handle()` lit les objets `File` depuis `clipboardData` ou `dataTransfer`, et `sniff()` identifie le format réel à partir des octets magiques — pas à partir du type MIME déclaré.
3. **Réencodage.** `normalize()` laisse passer tels quels les fichiers natifs. Tout le reste est décodé (chemins dédiés pour XPM, BMP/DIB et SVG, codec du navigateur pour le reste), dessiné sur un canvas limité à 4096 px sur le côté le plus long, puis exporté en `image/png` avec un nom de fichier `.png`.
4. **Réaiguillage.** `handle()` émet un événement `drop` synthétique transportant le nouveau `File` sur `[data-composer-card]`, soit le même chemin qu'un véritable glisser-déposer. Un marqueur `__dshPasteImageRerouted` empêche le plugin d'intercepter son propre événement.

Tout cela se passe côté client. Il n'y a ni processus hôte, ni interrogation du presse-papiers, ni requête réseau.

## Formats pris en charge

Ce tableau est la version courte. La [référence des formats pris en charge](docs/formats.md) détaille le pipeline de décision, la grille complète des variantes BMP et ce qui est volontairement hors périmètre.

| Format                        | Type déclaré courant | Ce qui se passe                                                                                                                                                       |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                           | `image/png`          | Transmis sans modification                                                                                                                                            |
| JPEG / JFIF                   | `image/jpeg`         | Transmis sans modification                                                                                                                                            |
| WebP                          | `image/webp`         | Transmis sans modification                                                                                                                                            |
| GIF                           | `image/gif`          | Transmis sans modification                                                                                                                                            |
| XPM (texte XPM3)              | `image/xpm`          | Décodé par `decodeXpm()`, réencodé en PNG                                                                                                                             |
| BMP / DIB                     | `image/bmp`          | Décodage par le navigateur d'abord, repli sur `decodeBmp()` : 1/4/8/16/24/32 bits, RLE4/RLE8, BITFIELDS, en-têtes OS/2 et DIB sans en-tête                            |
| SVG                           | `image/svg+xml`      | Rasterisé via un élément `<img>`, réencodé en PNG                                                                                                                     |
| ICO / CUR                     | `image/x-icon`       | Décodage par le navigateur d'abord, puis repli sur la plus grande entrée compressée en PNG                                                                            |
| TIFF                          | `image/tiff`         | Détecté par ses octets magiques ; décodé uniquement si le navigateur embarque un codec TIFF (ce n'est pas le cas de Chromium), sinon l'original est transmis tel quel |
| AVIF                          | `image/avif`         | Décodé par Chromium, réencodé en PNG                                                                                                                                  |
| HEIC / HEIF, autres `image/*` | `image/...`          | Détecté par ses octets magiques ; décodé uniquement si le navigateur dispose du codec (Chromium ne décode pas HEIC), sinon transmis tel quel                          |

Le passage direct n'a lieu que si les octets magiques correspondent à l'un des quatre types natifs **et** que le type déclaré concorde. Un fichier dont les octets sont du JPEG mais qui se déclare `image/png` est réencodé en véritable PNG : le type déclaré ne peut plus mentir. Un fichier natif sans aucun type déclaré est réenveloppé avec le type détecté au lieu d'être réencodé, et les graphies alias courantes (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) valent concordance.

Un fichier n'est pris en compte que si son type MIME commence par `image/` ou si son nom se termine par `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` ou `.heif`. Les fichiers non-image d'un même collage sont transmis tels quels.

## Installation

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

Le paquet est livré déjà compilé — bundle du processus de rendu, entrée hôte, patch du loader, métadonnées d'affichage et documentation — l'installation le récupère donc directement depuis le registre npm.

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

Pour le développement local, pointez le profil vers votre copie du dépôt :

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Remplacez `<profile>` par le profil utilisé par votre application. **Rechargez la page après l'installation** (`Ctrl+R`, ou `Cmd+R` sous macOS). Le module client n'est injecté qu'au chargement du processus de rendu : un plugin fraîchement installé n'intercepte rien tant que la page n'est pas rechargée.

## Vérifier que ça fonctionne

Lancez les vérifications du dépôt :

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` exécute la suite de tests Node : détection par octets magiques, détection des candidats, toutes les variantes BMP, la conversion d'un BMP étiqueté PNG, les DIB sans en-tête, le passage direct des fichiers natifs et les métadonnées d'affichage fournies pour chaque langue. `npm run check` vérifie la syntaxe de `client.js` et de `lib/index.js`.

Vérifiez ensuite le flux réel :

1. Rechargez la fenêtre DSH.
2. Faites une capture d'écran avec votre outil habituel et collez-la dans la zone de saisie, ou déposez-y un fichier image.
3. La pièce jointe apparaît. Ouvrez les DevTools (`Ctrl+Shift+I`) → Console, passez le niveau sur **Verbose**, et cherchez une ligne du type :

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

Si la conversion échoue, le plugin conserve le fichier d'origine et journalise `keep original (...)` à la place.

## Limites

- **XPM :** format texte XPM3 uniquement. Le parseur lit la clé de couleur `c` ; les autres clés comme `m`, `g` et `s` sont ignorées. Les couleurs sont résolues par le parseur CSS du navigateur : les noms de palette qui ne sont pas des couleurs CSS valides, comme le `light gray` en deux mots, retombent sur du noir opaque.
- **BMP :** 1/4/8/16/24/32 bits, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` et `BI_ALPHABITFIELDS`, avec en-têtes core, extended, V4/V5 ou OS/2 — plus les DIB sans en-tête. Les variantes 2 bits et 64 bits par pixel ne sont pas prises en charge. Pour les fichiers 32 bits sans masque alpha déclaré, un canal alpha entièrement nul est traité comme opaque au lieu de produire un PNG totalement transparent.
- **Autres codecs :** le SVG est rasterisé en interne ; ICO/CUR retombent sur les entrées compressées en PNG ; AVIF s'appuie sur le décodeur du navigateur. TIFF et HEIC sont détectés, mais Chromium n'embarque aucun codec pour eux : l'original est transmis tel quel et l'hôte le rejette comme avant. Aucun décodeur tiers n'est embarqué.
- **Taille :** les images converties sont réduites à 4096 px au maximum sur le côté le plus long. Les fichiers natifs transmis tels quels ne sont pas redimensionnés.
- **Nombre de fichiers :** un collage ou un dépôt peut contenir au plus 8 fichiers. Les lots plus importants sont entièrement laissés au chemin natif.
- **Aplatissement :** une image convertie devient une seule trame PNG. L'animation, les métadonnées EXIF et les profils de couleur intégrés ne sont pas conservés.
- **Périmètre :** seuls les chemins `paste` et `drop` sont couverts. Le sélecteur de fichiers et les autres chemins d'insertion conservent leur comportement natif.

## Sécurité et confidentialité

- Tout s'exécute dans le processus de rendu. Le plugin n'émet aucune requête réseau, ne téléverse rien et ne stocke rien.
- Aucun processus en arrière-plan, aucune interrogation du presse-papiers, aucune modification du code hôte de DSH.
- Les octets de l'image sont lus uniquement depuis l'événement de collage ou de dépôt, décodés localement, puis renvoyés à la même fenêtre.
- Les décodeurs sont compacts, mais ils traitent bel et bien des entrées non fiables. Si vous rencontrez un plantage ou un bug d'analyse, consultez [SECURITY.md](SECURITY.md).

## Langues

Le plugin fournit des métadonnées d'affichage pour chaque langue prise en charge par l'interface DSH — anglais, chinois simplifié, japonais, espagnol, français, allemand, russe et portugais. Chaque fichier `locale/<language>.json` porte le titre et la description localisés, et fait pointer sa page de détail vers le README correspondant de ce dépôt, afin que le Plugin Manager et sa page de détail parlent la même langue que l'application.

Les traductions sont des fichiers source à côté du code, pas du texte généré. La suite de tests vérifie que chaque langue annoncée dispose d'un fichier de locale, d'un document de détail et de liens vers les autres README. Pour corriger ou ajouter une traduction, voir [Contribuer](CONTRIBUTING.md#translations).

## Documentation

- [Fonctionnement](docs/how-it-works.md) — flux d'événements, internes des décodeurs et carte du code fonction par fonction.
- [Prise en charge des formats](docs/formats.md) — pipeline de décision, matrice des formats, variantes BMP et la liste de contrôle pour ajouter un format.
- [Dépannage](docs/troubleshooting.md) — échecs courants et comment lire les journaux.
- [Publication](docs/releasing.md) — politique de version et liste de contrôle de publication pour les mainteneurs.

## Communauté

- [Contribuer](CONTRIBUTING.md) — installation, tests, style, traductions et ce qu'exige une contribution de format.
- [Code de conduite](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [Politique de sécurité](SECURITY.md) — signalement privé, périmètre et versions prises en charge.
- [Changelog](CHANGELOG.md) et [releases](https://github.com/pengtang1024/dsh-paste-image/releases) — ce qui a changé et pourquoi.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — rapports de bugs et demandes de formats.

## Licence

MIT © 2026 pengtang1024. Voir [LICENSE](LICENSE).
