// @flow
/**
 * Checks and rewrites a request needs before it reaches native, done here so
 * that Android, iOS and Windows behave the same.
 */
import base64 from 'base-64';
import {binaryStringOfBytes} from './bytes';

const FILE_PREFIX = 'ReactNativeBlobUtil-file://';
const CONTENT_PREFIX = 'ReactNativeBlobUtil-content://';

export type BodyKind = 'text' | 'base64' | 'file';

const CONTROL = /[\r\n\0]/;

/**
 * Why a set of headers cannot be sent, or null. A CR, LF or NUL in a name or
 * value would start another header on the wire (Windows adds headers without
 * validating them), so it is refused rather than passed on.
 * @param  {?Object} headers
 * @return {?string}
 */
export function invalidHeader(headers: ?Object): ?string {
    for (const key of Object.keys(headers || {})) {
        if (CONTROL.test(key) || CONTROL.test(String(headers[key]))) {
            return `Header "${key.replace(/[\r\n\0]/g, ' ')}" contains a line break or NUL`;
        }
    }
    return null;
}

/**
 * A multipart field name or filename escaped the way browsers do (WHATWG
 * multipart/form-data): `"` becomes %22, CR %0D and LF %0A. Native puts both
 * between quotes in Content-Disposition, so an unescaped quote or line break,
 * say in the display name of a shared file, rewrote the part's headers.
 * @param  {any} value
 * @return {any} Strings escaped, anything else as it was.
 */
export function escapeFormValue(value: any): any {
    return typeof value === 'string'
        ? value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
        : value;
}

/**
 * Why a multipart form cannot be sent, or null: a field type with a line break
 * would add headers to its part.
 * @param  {Array<Object>} fields
 * @return {?string}
 */
export function invalidFormField(fields: Array<Object>): ?string {
    for (const field of fields) {
        if (field && typeof field.type === 'string' && CONTROL.test(field.type)) {
            return `The type of form field "${String(field.name)}" contains a line break or NUL`;
        }
    }
    return null;
}

/**
 * The form with every name and filename escaped. The caller's objects are
 * left alone.
 * @param  {Array<Object>} fields
 * @return {Array<Object>}
 */
export function escapeForm(fields: Array<Object>): Array<Object> {
    return fields.map((field) => field && typeof field === 'object'
        ? {...field, name: escapeFormValue(field.name), filename: escapeFormValue(field.filename)}
        : field);
}

/**
 * Why appendExt cannot be used, or null. It is appended to a file name the
 * library generates in its cache (GHSA-5xf6-f6v8-jc8c): a separator in it,
 * "/../../shared_prefs/x.xml", took the download out of the cache onto any
 * file the app can write. A dot, "tar.gz" or ".jpg", is fine; "/", "\\", ":"
 * and control characters are not. Native checks again.
 * @param  {Object} options
 * @return {?string}
 */
export function invalidAppendExt(options: Object): ?string {
    const ext = options.appendExt;
    if (ext === undefined || ext === null || ext === '') {
        return null;
    }
    // eslint-disable-next-line no-control-regex
    if (typeof ext !== 'string' || /[/\\:\u0000-\u001f]/.test(ext)) {
        return 'appendExt must be a file extension, without path separators';
    }
    return null;
}

/**
 * The options as native needs them: pinnedHosts in lower case, because every
 * platform compares them with the host as its HTTP stack reports it, which is
 * lower case. The caller's object is left alone.
 * @param  {Object} options
 * @return {Object}
 */
export function nativeOptions(options: Object): Object {
    if (!Array.isArray(options.pinnedHosts)) {
        return options;
    }
    return {
        ...options,
        pinnedHosts: options.pinnedHosts.map((host) => typeof host === 'string' ? host.toLowerCase() : host),
    };
}

/**
 * A file reference as native reads it: the path behind the file prefix, or a
 * content:// URI behind the content prefix, the way wrap() writes them.
 * @param  {string} path
 * @return {string}
 */
function fileReference(path: string): string {
    if (path.startsWith(FILE_PREFIX) || path.startsWith(CONTENT_PREFIX)) {
        return path;
    }
    return (path.startsWith('content://') ? CONTENT_PREFIX : FILE_PREFIX) + path;
}

/**
 * The kind and data of an explicit body: {text}, {base64}, {file} or bytes
 * (an ArrayBuffer or a typed array, sent as base64). Null for anything else.
 * @param  {any} value
 * @return {?{kind: BodyKind, data: string}}
 */
function explicitBody(value: any): ?{kind: BodyKind, data: string} {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return {kind: 'base64', data: base64.encode(binaryStringOfBytes(Array.from(bytes)))};
    }
    if (typeof value.text === 'string') {
        return {kind: 'text', data: value.text};
    }
    if (typeof value.base64 === 'string') {
        return {kind: 'base64', data: value.base64};
    }
    if (typeof value.file === 'string') {
        return {kind: 'file', data: fileReference(value.file)};
    }
    return null;
}

function headerKey(headers: Object, name: string): ?string {
    return Object.keys(headers).find((key) => key.toLowerCase() === name) || null;
}

/**
 * What a plain string body is, by the rule the library has always documented:
 * a wrapped path is a file; a Content-Type ending in ";base64", or an
 * application/octet type, makes it base64; anything else is text. Native used
 * to apply this rule itself, differently per platform (iOS decoded base64 when
 * there was no Content-Type at all, Windows never decoded it).
 * @param  {string} body
 * @param  {string} contentType
 * @return {BodyKind}
 */
function kindOfString(body: string, contentType: string): BodyKind {
    if (body.startsWith(FILE_PREFIX) || body.startsWith(CONTENT_PREFIX)) {
        return 'file';
    }
    const type = contentType.toLowerCase();
    if (type.includes(';base64') || type.startsWith('application/octet')) {
        return 'base64';
    }
    return 'text';
}

/**
 * A multipart field with its kind. Without an explicit form, a field with a
 * filename is a file when its data is wrapped and base64 otherwise, and a field
 * without one is text - which is what Android and iOS did. A file part without
 * a filename gets the file's name, as browsers send it.
 * @param  {Object} field
 * @return {Object}
 */
function formField(field: Object): Object {
    if (field == null || typeof field !== 'object') {
        return field;
    }
    const explicit = explicitBody(field.data);
    if (explicit) {
        const filename = field.filename == null && explicit.kind === 'file'
            ? explicit.data.replace(/^.*[/\\]/, '')
            : field.filename;
        return {...field, data: explicit.data, kind: explicit.kind, filename};
    }
    if (typeof field.data !== 'string') {
        return field;
    }
    const wrapped = field.data.startsWith(FILE_PREFIX) || field.data.startsWith(CONTENT_PREFIX);
    const kind = field.filename == null ? 'text' : wrapped ? 'file' : 'base64';
    return {...field, kind};
}

/**
 * The body as native takes it, with its kind; or why it cannot be sent.
 * A string body of kind base64 loses ";base64" from its Content-Type, which
 * only ever told this library how to read the body.
 * @param  {string} method
 * @param  {?Object} headers
 * @param  {any} body
 * @return {{body: any, bodyType: ?BodyKind, headers: ?Object, error: ?string}}
 */
export function prepareBody(method: string, headers: ?Object, body: any): Object {
    const none = {body, bodyType: undefined, headers, error: null};
    if (body == null || body === '') {
        return none;
    }
    if (/^(GET|HEAD)$/i.test(String(method))) {
        return {...none, error: `A ${String(method).toUpperCase()} request cannot have a body`};
    }
    if (Array.isArray(body)) {
        return {...none, body: body.map(formField)};
    }
    const explicit = explicitBody(body);
    let kind;
    let data;
    if (explicit) {
        kind = explicit.kind;
        data = explicit.data;
    }
    else if (typeof body === 'string') {
        const key = headers ? headerKey(headers, 'content-type') : null;
        kind = kindOfString(body, key ? String(headers[key]) : '');
        data = body;
    }
    else {
        return {...none, error: 'Unsupported body: pass a string, {text}, {base64}, {file}, bytes or a multipart array'};
    }
    const outHeaders = {...headers};
    const key = headerKey(outHeaders, 'content-type');
    if (!key) {
        // Without one the platforms disagreed: iOS's URLSession adds
        // application/x-www-form-urlencoded by itself, Android sent none and
        // Windows text/plain. The same header everywhere, as fetch does for a
        // string body.
        outHeaders['Content-Type'] = kind === 'text' ? 'text/plain;charset=UTF-8' : 'application/octet-stream';
    }
    else if (kind === 'base64' && /;base64/i.test(String(outHeaders[key]))) {
        outHeaders[key] = String(outHeaders[key]).replace(/;base64/ig, '');
    }
    return {body: data, bodyType: kind, headers: outHeaders, error: null};
}
