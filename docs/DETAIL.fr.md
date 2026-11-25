# Fonctionnement

Cette page explique comment dsh-paste-image insère dans le compositeur de DeepSeek Harness presque n'importe quelle image — même une image dont le type est mal déclaré — lorsque vous la collez ou la déposez. Elle suit [`how-it-works.md`](how-it-works.md) et reflète l'implémentation actuelle : sortie PNG / JPEG / WebP, interrupteurs de conversion par format et réglages stockés dans le `localStorage` du navigateur.

## Vue d'ensemble du flux

```text
coller / déposer (phase de capture)
        |
        v
  handle(event, data)
        |  aucun fichier, plus de maxFiles ou aucun candidat image -> retour, voie native
        |  preventDefault() + stopPropagation()
        v
  pour chaque fichier candidat -> normalize(file)
        | sniff(bytes) -> format réel
        | format natif et déclaration concordante -> null (fichier intact)
        | type déclaré vide -> retyper le File, sans réencodage
        v
  toCanvas()
        | XPM       -> decodeXpm()
        | SVG       -> loadSvg() + rastérisation via <img>
        | BMP / DIB -> createImageBitmap(), repli decodeBmp()
        |              (les données JPEG/PNG intégrées sont d'abord extraites)
        | ICO / CUR -> createImageBitmap(), repli sur l'entrée PNG la plus grande
        | autres    -> createImageBitmap()
        v
  canvasOf()  grand côté limité à maxSide (4096 par défaut)
        v
  encodeCanvas()  canvas.toBlob(profile.mime[, quality])
        v
  new File(name.<ext>, type pris du blob.type réel)
        v
  reroute(files) -> DragEvent('drop') synthétique sur [data-composer-card]
```

## 1. Phase de capture

Le plugin écoute `paste` et `drop` sur `document` en mode capture (`addEventListener(..., true)`). La capture descend de `document` vers la cible : le plugin voit l'événement avant le gestionnaire propre au compositeur et, si une conversion a lieu, peut appeler `preventDefault()` avant que le compositeur ne lise `clipboardData`.

## 2. Vérifications préalables et conditions d'ignorance

`handle()` retourne immédiatement, sans prendre en charge l'événement, lorsque :

- L'interrupteur général est désactivé (`enabled === false`) : les écouteurs restent installés et redeviennent actifs dès la réactivation.
- L'événement porte déjà le marqueur `REROUTED` : évite la récursion causée par le plugin qui reverrait son propre événement synthétique.
- Il n'y a aucun fichier ou plus de `maxFiles` (8 par défaut, configurable de 1 à 8) : tout le lot suit la voie native, sans conversion partielle.
- Aucun fichier n'est un candidat image : le type déclaré doit commencer par `image/` ou le nom doit finir par une extension d'image ; un collage de texte brut ne correspond jamais.
- Les constructeurs `DataTransfer` / `DragEvent` manquent, ou la carte du compositeur (`[data-composer-card]`) est introuvable : le plugin se désiste et la voie native du navigateur continue.

Chaque fichier candidat est converti dans son propre `try/catch` ; en cas d'échec, le fichier original est conservé.

## 3. Détection par octets magiques

`sniff()` lit les premiers octets et détermine le format réel selon la signature : PNG, JPEG, GIF, WebP (RIFF + WEBP), BMP (`BM` ou un DIB sans en-tête de fichier `BITMAPINFOHEADER`), TIFF (II/MM), XPM (`/* XPM */`), AVIF / HEIC (brand `ftyp`), ICO/CUR (`00 00 01 00` / `00 00 02 00`), SVG (commence par `<` et contient `<svg` dans le premier Kio). Il renvoie `null` si rien ne correspond. Un DIB sans en-tête de fichier est d'abord vérifié pour la longueur d'en-tête, les signes de largeur/hauteur et la profondeur de couleur, afin que des données binaires aléatoires ne soient pas prises pour une image.

## 4. Passage sans modification

`normalize()` ne lit que les 1024 premiers octets de l'en-tête pour décider s'il faut toucher au fichier entier :

- L'interrupteur de conversion de ce format est désactivé : le fichier original passe sans même lire les octets complets.
- Un type natif (PNG/JPEG/WebP/GIF) dont la déclaration concorde avec les octets réels : passe après lecture de l'en-tête de 1 Kio. Les vraies captures conservent donc intégralement leurs octets, métadonnées et animation.
- Le type déclaré est vide : les octets sont réemballés dans un `File` avec le type détecté (sans réencodage), afin de passer la liste blanche de l'hôte.
- Le type déclaré ne concorde pas avec les octets réels (par exemple un BMP qui se dit PNG) : il est converti et réencodé au format de sortie choisi.

Lors d'une conversion, l'extension est remplacée par l'encodage réel (`shot.xpm` -> `shot.png`) ; les fichiers natifs retypés gardent leur extension. Une table d'alias MIME (`image/jpg`, `image/x-png`, `image/svg+xml`, etc.) normalise d'abord les graphies, pour éviter de réencoder inutilement des fichiers valides.

## 5. Décodage et encodage

Chemins de décodage : XPM utilise le décodeur intégré ; SVG est rastérisé via `<img>` (Chromium n'a pas de `createImageBitmap()` pour les blobs SVG) ; le reste passe par `createImageBitmap()`, avec repli `decodeBmp()` ou extraction du JPEG/PNG intégré pour BMP, et repli sur l'entrée PNG la plus grande pour ICO. La taille est mise à l'échelle selon `scale = min(1, maxSide / plus grand côté)` ; les petites images passent telles quelles.

L'encodage est assuré par `encodeCanvas()` : PNG est sans perte et ne reçoit aucun paramètre de qualité ; JPEG est d'abord composé sur un fond blanc opaque (les pixels transparents ne deviennent pas noirs), WebP conserve la transparence, et les deux reçoivent `quality`. Le type final est pris du `blob.type` réel du navigateur, avec repli sur PNG s'il n'est pas reconnu.

## 6. Réacheminement

`reroute()` place les fichiers convertis dans un `DataTransfer` et dépêche un événement `drop` synthétique (avec un marqueur `REROUTED` non énumérable) sur la vraie carte du compositeur. Cela réutilise le même chemin des pièces jointes qu'un dépôt manuel, sans API privée ; si aucune carte n'est trouvée, rien n'est dépêché.

## 7. Gestion des échecs et journalisation

La conversion s'exécute par fichier dans un `try/catch`. Un succès journalise une ligne comme `image/xpm -> image/png 1440x900` ; un échec journalise `keep original (image/bmp): ...` et conserve le fichier original — un mauvais fichier ne bloque jamais les autres, le drop synthétique a toujours lieu, et le résultat est l'erreur habituelle de l'hôte plutôt qu'un silence. Les messages passent par `console.debug` : la console du navigateur doit être réglée sur Verbose pour les voir.

## 8. Réglages et page de configuration

Les réglages ne vivent que dans le `localStorage` du navigateur (clé `dsh-paste-image.settings.v1` ; en mode privé ou si le stockage est désactivé, une copie en mémoire est utilisée et le collage fonctionne toujours). L'entrée principale est **Paramètres → Coller n'importe quelle image**, qui ouvre directement le formulaire complet ci-dessous ; l'ancienne entrée via la ligne du plugin (Paramètres → Extensions → dsh-paste-image → Configuration) reste disponible et les deux partagent les mêmes réglages. Vous pouvez aussi les modifier via `api.getSettings()` / `api.applySettings(patch)` / `api.resetSettings()`.

| Réglage | Valeur par défaut | Valeur / plage | Effet |
| --- | --- | --- | --- |
| `enabled` | `true` | booléen | Interrupteur général ; désactivé, le collage utilise la voie native |
| `maxFiles` | `8` | entier 1–8 | Nombre max. de fichiers par lot ; au-delà, tout le lot passe sans changement |
| `maxSide` | `4096` | entier 512–8192 | Limite du grand côté des images converties |
| `outputFormat` | `png` | `png` / `jpeg` / `webp` | Format de sortie de la conversion (PNG si non pris en charge) |
| `quality` | `0.92` | 0.1–1 (2 décimales) | Qualité d'encodage JPEG / WebP ; désactivé dans le formulaire si PNG est choisi |
| `convertXpm` | `true` | booléen | Convertir ou non les XPM |
| `convertBmp` | `true` | booléen | Convertir ou non les BMP / DIB |
| `convertSvg` | `true` | booléen | Convertir ou non les SVG |
| `convertIco` | `true` | booléen | Convertir ou non les ICO / CUR |
| `logConversions` | `true` | booléen | Émettre ou non les journaux de débogage des conversions |

Le formulaire de configuration contient les cases ci-dessus, une liste déroulante de format de sortie et trois champs numériques ; les brouillons vivent dans l'état du composant et ne sont écrits que lors du clic sur « Enregistrer » ; « Restaurer les valeurs par défaut » revient aux valeurs du tableau.

## 9. Limites et cas non pris en charge

- **HEIC / TIFF** : les signatures sont reconnues mais pas décodées (aucun décodeur intégré), les fichiers restent donc tels quels.
- **XPM** : les en-têtes XPM1/XPM2 et les clés de couleur autres que `c` ne sont pas pris en charge ; les noms de palette qui ne sont pas des couleurs CSS valides (comme `light gray`, deux mots) s'affichent en noir opaque ; `None` est entièrement transparent.
- **BMP / DIB** : prend en charge les tailles d'en-tête 12/40/52/56/64/108/124, les profondeurs 1/4/8/16/24/32, les compressions BI_RGB / RLE8 / RLE4 / BITFIELDS / ALPHABITFIELDS, le JPEG/PNG intégré et les bitmaps de haut en bas ; les images de plus de 64 Mio de pixels sont rejetées avant allocation mémoire. Un canal alpha 32 bits entièrement à zéro est considéré comme opaque.
- **ICO / CUR** : seuls les icônes contenant une entrée PNG sont pris en charge (la plus grande en surface) ; les icônes uniquement DIB et les curseurs ne le sont pas.
- **Formats natifs** : PNG, JPEG, WebP et GIF dont la déclaration concorde avec les octets réels ne sont jamais réencodés.
- **Référence de taille** : les photos sont environ 82 % plus petites en JPEG/WebP ; les captures d'interface sont souvent plus petites en PNG. Voir [mesures des formats de sortie](output-formats.md).

## 10. Principes de conception

Les octets avant les étiquettes ; annulation synchrone en phase de capture ; PNG comme sortie par défaut (autorisé, sans perte, universel sur Chromium) ; un drop synthétique plutôt qu'une API privée ; aucun processus hôte et aucun décodeur tiers.
