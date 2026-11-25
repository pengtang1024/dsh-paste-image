# Política de Seguridad

## Versiones compatibles

| Versión | ¿Es compatible?                                      |
| ------- | ---------------------------------------------------- |
| 0.2.x   | Sí: línea de lanzamiento actual                      |
| 0.1.x   | No: actualice a 0.2.x, que ha sustituido a esta       |

El complemento aún no ha publicado la versión 1.0, por lo que las correcciones de seguridad se publicarán en una nueva versión de parche de la versión menor actual, y no se trasladarán (backport) a líneas de versión anteriores.

## Informar de vulnerabilidades

Informe de forma privada. Use el informe privado de vulnerabilidades de GitHub: abra la pestaña **Security** del repositorio y seleccione **Report a vulnerability**. Si este proceso no está disponible, contacte en GitHub al mantenedor [@pengtang1024](https://github.com/pengtang1024) para solicitar un canal privado; no divulgue los detalles del exploit en un issue público.

Un buen informe debe incluir:

- La versión de DSH y cómo se instaló el complemento.
- El sistema operativo y la sesión de escritorio.
- El formato o decodificador afectado (XPM, BMP, detección de tipo, ruta de reenvío).
- Un material de reproducción mínimo: el archivo o los bytes exactos, y los pasos para reproducirlo.
- La salida de la consola en nivel Verbose, incluyendo todas las líneas `[dsh-paste-image]`.

Confirmaremos la recepción del informe en la medida de lo posible; una vez confirmado, la corrección se publicará en alguna versión de parche; salvo que prefiera lo contrario, le agradeceremos en las notas de lanzamiento.

## Alcance

`dsh-paste-image` se ejecuta completamente en el proceso de renderizado de DSH. No accede a la red, no tiene procesos en segundo plano, no sondea el portapapeles ni modifica el código del host de DSH. Todo su trabajo consiste en: leer archivos de los eventos `paste` o `drop`, decodificarlos localmente, recodificarlos a PNG y despachar un evento `drop` sintético en la misma ventana.

Dentro del alcance:

- Bloqueos, cuelgues o agotamiento de memoria causados por archivos XPM o BMP manipulados especialmente.
- Errores de píxeles causados por defectos del analizador (parser) que puedan inducir a error al usuario.
- Evasión de los límites documentados (8 archivos por evento, 4096 px en el lado más largo de la imagen convertida).
- Métodos que hagan que el complemento lea o transmita datos fuera del ámbito de los archivos pegados o arrastrados.

Fuera del alcance:

- Vulnerabilidades en el propio DSH, en Electron/Chromium o en el sistema operativo.
- Ataques que ya requieren controlar el proceso de renderizado o contar con la capacidad de instalar complementos; este tipo de código ya dispone de permisos completos en la página.
- Informes de ingeniería social y denegación de servicio causada por archivos ordinarios de tamaño excesivo que el propio navegador ya no puede manejar.

## Notas de diseño

- El complemento solo lee bytes de `clipboardData.files` o `dataTransfer.files` del evento.
- La decodificación usa los códecs integrados del navegador, además de dos pequeños analizadores locales; no se envía ningún dato.
- Los archivos convertidos son nuevos objetos `File` en memoria. No se escriben en disco y no queda nada tras descargar la página.
- No hay dependencias de ejecución de terceros.
