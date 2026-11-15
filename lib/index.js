/**
 * Host half of dsh-paste-image.
 *
 * The plugin works entirely inside the browser renderer: it intercepts pasted and
 * dropped images, decodes the ones the Host refuses (BMP / XPM / TIFF / lying
 * MIME types), re-encodes them as PNG and hands them back through a synthetic
 * drop event. Nothing runs on the Host, so there is no polling and no child
 * process.
 */
export function apply() {}
