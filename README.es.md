# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](docs/DETAIL.zh.md) · [English](docs/DETAIL.en.md) · [Español](docs/DETAIL.es.md) · [Français](docs/DETAIL.fr.md) · [Deutsch](docs/DETAIL.de.md) · [Русский](docs/DETAIL.ru.md) · [Português](docs/DETAIL.pt.md)

Pega o arrastra casi cualquier imagen en DeepSeek Harness, incluso cuando el portapapeles dice `image/xpm` o miente sobre el tipo MIME.

## Por qué existe

El cliente de escritorio de DSH (Electron/Chromium) acepta exactamente cuatro tipos de adjunto: `image/png`, `image/jpeg`, `image/webp` e `image/gif`. Cualquier otro se rechaza con un error en rojo que solo enumera PNG, JPG, WebP y GIF.

Esa lista blanca rompe dos situaciones que ocurren todo el tiempo en Linux:

- **Capturas declaradas como XPM.** Algunas herramientas de captura, sobre todo en Ubuntu/Wayland, dejan la imagen en el portapapeles con el tipo `image/xpm`. Los píxeles están bien; la etiqueta no está en la lista blanca, así que el pegado se rechaza.
- **Bytes BMP con etiqueta PNG.** Algunas aplicaciones entregan un BMP (o TIFF) mientras declaran `image/png`. El tipo declarado pasa la lista blanca, el decodificador falla más adelante y aparece el mismo error en rojo.

`dsh-paste-image` resuelve ambos casos dentro del renderer: mira los bytes reales, decodifica lo que el portapapeles contiene de verdad, lo recodifica como PNG y devuelve el resultado al canal de adjuntos normal.

## Cómo funciona

1. **Captura.** `install()` registra los listeners `paste` y `drop` sobre `document` en la fase de captura, así el plugin ve el evento antes que el cuadro de entrada.
2. **Detección.** `handle()` lee los objetos `File` de `clipboardData` o `dataTransfer`, y `sniff()` identifica el formato real a partir de los bytes mágicos, no del tipo MIME declarado.
3. **Recodificación.** `normalize()` deja pasar intactos los archivos nativos. Todo lo demás se decodifica (rutas dedicadas para XPM, BMP/DIB y SVG; el códec propio del navegador para el resto), se dibuja en un canvas limitado a 4096 px en el lado más largo y se exporta como `image/png` con un nombre de archivo `.png`.
4. **Redirección.** `handle()` despacha un evento `drop` sintético que lleva el nuevo `File` a `[data-composer-card]`, que es el mismo camino que toma un arrastrar y soltar real. Un marcador `__dshPasteImageRerouted` impide que el plugin intercepte su propio evento.

Todo esto ocurre en el cliente. No hay proceso anfitrión, ni sondeo del portapapeles, ni peticiones de red.

## Formatos compatibles

Esta tabla es la versión corta. La [referencia de soporte de formatos](docs/en/formats.md) explica el flujo de decisión, la grilla completa de variantes de BMP y lo que queda intencionalmente fuera de alcance.

| Formato                      | Tipo declarado habitual | Qué ocurre                                                                                                                                                     |
| ---------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                          | `image/png`             | Se deja pasar sin cambios                                                                                                                                      |
| JPEG / JFIF                  | `image/jpeg`            | Se deja pasar sin cambios                                                                                                                                      |
| WebP                         | `image/webp`            | Se deja pasar sin cambios                                                                                                                                      |
| GIF                          | `image/gif`             | Se deja pasar sin cambios                                                                                                                                      |
| XPM (texto XPM3)             | `image/xpm`             | Se decodifica con `decodeXpm()` y se recodifica como PNG                                                                                                       |
| BMP / DIB                    | `image/bmp`             | Primero decodifica el navegador; si falla, `decodeBmp()`: 1/4/8/16/24/32 bits, RLE4/RLE8, BITFIELDS, cabeceras OS/2 y DIB sin cabecera                         |
| SVG                          | `image/svg+xml`         | Se rasteriza mediante un elemento `<img>` y se recodifica como PNG                                                                                             |
| ICO / CUR                    | `image/x-icon`          | Primero decodifica el navegador; si falla, se usa la entrada PNG comprimida más grande                                                                         |
| TIFF                         | `image/tiff`            | Se detecta por los bytes mágicos; se decodifica solo si el navegador incluye un códec TIFF (Chromium no lo incluye); de lo contrario se deja pasar el original |
| AVIF                         | `image/avif`            | Lo decodifica Chromium y se recodifica como PNG                                                                                                                |
| HEIC / HEIF, otros `image/*` | `image/...`             | Se detecta por los bytes mágicos; se decodifica solo cuando el navegador tiene el códec (Chromium no decodifica HEIC); de lo contrario se deja pasar           |

El paso sin cambios solo ocurre cuando los bytes mágicos coinciden con uno de los cuatro tipos nativos **y** el tipo declarado concuerda. Un archivo cuyos bytes son JPEG pero que declara `image/png` se recodifica como un PNG real, de modo que el tipo declarado ya no puede mentir. Un archivo nativo sin ningún tipo declarado se vuelve a envolver con el tipo detectado en lugar de recodificarse, y las grafías alias habituales (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) cuentan como concordancia.

Un archivo se toma en cuenta cuando su tipo MIME empieza por `image/` o su nombre termina en `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` o `.heif`. Los archivos que no son imágenes en el mismo pegado se reenvían intactos.

## Instalación

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

El paquete se distribuye ya compilado —bundle del renderer, entrada del host, parche del loader, metadatos de presentación y documentación—, así que la instalación lo trae directamente del registro de npm.

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

Para desarrollo local, apunta el perfil a tu copia de trabajo:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Reemplaza `<profile>` por el perfil con el que corre tu aplicación. **Recarga la página después de instalar** (`Ctrl+R`, o `Cmd+R` en macOS). El módulo de cliente solo se inyecta cuando carga el renderer, así que un plugin recién instalado no intercepta nada hasta que recargues.

## Cómo verificar que funciona

Ejecuta las comprobaciones del repositorio:

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` ejecuta la suite de pruebas de Node: detección de bytes mágicos, detección de candidatos, cada variante de BMP, la conversión de un BMP etiquetado como PNG, DIB sin cabecera, el paso intacto de archivos nativos y los metadatos de presentación que se incluyen para cada idioma. `npm run check` verifica la sintaxis de `client.js` y `lib/index.js`.

Luego comprueba el flujo real:

1. Recarga la ventana de DSH.
2. Haz una captura con tu herramienta habitual y pégala en el cuadro de entrada, o arrastra un archivo de imagen sobre él.
3. El adjunto aparece. Abre DevTools (`Ctrl+Shift+I`) → Console, cambia el nivel a **Verbose** y busca una línea como:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

Si la conversión falla, el plugin conserva el archivo original y en su lugar registra `keep original (...)`.

## Ajustes

Los ajustes del plugin están ahora en **Ajustes → Pegar cualquier imagen**, que abre directamente el formulario completo. La entrada anterior en la fila del plugin sigue disponible: **Ajustes → Extensiones → dsh-paste-image → Configuración**; la fila del plugin muestra además un resumen de una línea (activado / desactivado) que lleva al mismo formulario. Ambas entradas comparten los mismos ajustes, así que basta con cambiar una.

## Limitaciones

- **XPM:** solo el formato de texto XPM3. El analizador lee la clave de color `c`; otras claves como `m`, `g` y `s` se ignoran. Los colores los resuelve el analizador CSS del navegador, así que los nombres de paleta que no son colores CSS válidos, como el `light gray` de dos palabras, recaen en negro opaco.
- **BMP:** 1/4/8/16/24/32 bits, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` y `BI_ALPHABITFIELDS`, con cabeceras core, extendidas, V4/V5 u OS/2, además de DIB sin cabecera. Las variantes de 2 bits y de 64 bits por píxel no son compatibles. En archivos de 32 bits sin máscara alfa declarada, un canal alfa todo en cero se trata como opaco en lugar de producir un PNG totalmente transparente.
- **Otros códecs:** SVG se rasteriza dentro del propio plugin; ICO/CUR recurren a las entradas comprimidas en PNG; AVIF depende del decodificador del navegador. TIFF y HEIC se detectan, pero Chromium no trae códec para ellos, así que el original se deja pasar y el host lo rechaza como antes. No se incluye ningún decodificador de terceros.
- **Tamaño:** las imágenes convertidas se reducen a como máximo 4096 px en el lado más largo. Los archivos nativos que se dejan pasar intactos no se redimensionan.
- **Cantidad de archivos:** un pegado o un arrastre puede contener como máximo 8 archivos. Los lotes más grandes se dejan por completo al camino nativo.
- **Aplanado:** una imagen convertida pasa a ser un solo cuadro estático en el formato de salida elegido (PNG por defecto). La animación, los metadatos EXIF y los perfiles de color incrustados no se conservan.
- **Alcance:** solo se cubren las rutas `paste` y `drop`. El selector de archivos y las demás rutas de inserción mantienen su comportamiento nativo.

## Seguridad y privacidad

- Todo se ejecuta en el renderer. El plugin no hace peticiones de red, no sube nada y no almacena nada.
- No hay proceso en segundo plano, ni sondeo del portapapeles, ni cambios en el código del host de DSH.
- Los bytes de imagen se leen solo del evento de pegado o de arrastre, se decodifican localmente y se devuelven a la misma ventana.
- Los decodificadores son pequeños, pero sí procesan entrada no confiable. Si encuentras un fallo o un error de análisis, consulta [SECURITY.md](SECURITY.en.md).

## Idiomas

El plugin incluye metadatos de presentación para todos los idiomas que admite la interfaz de DSH: inglés, chino simplificado, español, francés, alemán, ruso y portugués. Cada `locale/<language>.json` lleva el título y la descripción localizados, y apunta su página de detalle al README correspondiente en este repositorio, de modo que el Administrador de plugins y su página de detalle hablan el mismo idioma que la aplicación.

Las traducciones son archivos fuente junto al código, no texto generado. La suite de pruebas comprueba que cada idioma anunciado tenga un archivo de locale, un documento de detalle y enlaces a los demás README. Para corregir o añadir una traducción, consulta [Contribuir](CONTRIBUTING.en.md#translations).

## Documentación

- [Cómo funciona](docs/en/how-it-works.md) — flujo de eventos, interior de los decodificadores y un mapa del código función por función.
- [Soporte de formatos](docs/en/formats.md) — flujo de decisión, matriz de formatos, variantes de BMP y la lista de verificación para añadir un formato.
- [Solución de problemas](docs/en/troubleshooting.md) — fallos habituales y cómo leer los registros.
- [Publicación](docs/en/releasing.md) — política de versiones y la lista de verificación de publicación del mantenedor.

## Comunidad

- [Contribuir](CONTRIBUTING.en.md) — configuración del entorno, pruebas, estilo, traducciones y lo que necesita una contribución de formato.
- [Código de conducta](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [Política de seguridad](SECURITY.en.md) — reporte privado, alcance y versiones compatibles.
- [Registro de cambios](CHANGELOG.en.md) y [versiones publicadas](https://github.com/pengtang1024/dsh-paste-image/releases) — qué cambió y por qué.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — reportes de errores y solicitudes de formatos.

## Licencia

MIT © 2026 pengtang1024. Consulta [LICENSE](LICENSE).

## Apoya este proyecto

Si este plugin te resulta útil en tu día a día, échale un vistazo a [dsh-paste-image](https://github.com/pengtang1024/dsh-paste-image) y dale una estrella ⭐. Ese pequeño gesto me anima a seguir manteniéndolo.
