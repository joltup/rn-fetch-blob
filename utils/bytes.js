// @flow
/* eslint-disable no-bitwise, no-extra-parens */
/**
 * Byte-array conversions for response bodies. Pure functions, no globals:
 * TextEncoder is not in the lint environment and `unescape` is legacy.
 * The parentheses in the bit arithmetic are deliberate.
 */

/**
 * The byte values of a binary string, such as base64.decode returns: one
 * character per byte, char codes 0..255.
 * @param  {string} binary
 * @return {Array<number>}
 */
export function bytesOfBinaryString(binary: string): Array<number> {
    const bytes = new Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return bytes;
}

/**
 * Byte values 0..255 from what native returns for ascii reads: Android and
 * iOS hand back signed bytes (-128..127), Windows unsigned ones. Anything
 * that is not an array is returned as it is.
 * @param  {any} bytes
 * @return {any}
 */
export function toUnsignedBytes(bytes: any): any {
    return Array.isArray(bytes) ? bytes.map((b) => b & 0xff) : bytes;
}

/**
 * The UTF-8 encoding of a string, as byte values 0..255. Lone surrogates are
 * encoded as U+FFFD, the way TextEncoder does.
 * @param  {string} text
 * @return {Array<number>}
 */
export function bytesOfUtf8(text: string): Array<number> {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            const low = text.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                i++;
            }
        }
        if (code >= 0xd800 && code <= 0xdfff) {
            code = 0xfffd;
        }
        if (code < 0x80) {
            bytes.push(code);
        }
        else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        }
        else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
        else {
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return bytes;
}

/**
 * A binary string, one character per byte, as base64.encode takes it.
 * @param  {Array<number>} bytes
 * @return {string}
 */
export function binaryStringOfBytes(bytes: Array<number>): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        out += String.fromCharCode.apply(null, bytes.slice(i, i + 8192).map((b) => b & 0xff));
    }
    return out;
}

/**
 * Decodes UTF-8 bytes the way TextDecoder does: a leading byte order mark is
 * dropped, each invalid sequence becomes one U+FFFD, and the byte that broke it
 * is read again. A NUL stays a NUL.
 * @param  {Array<number>} bytes
 * @return {string}
 */
export function utf8OfBytes(bytes: Array<number>): string {
    const units = [];
    let out = '';
    const push = (cp) => {
        if (cp >= 0x10000) {
            cp -= 0x10000;
            units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
        else {
            units.push(cp);
        }
        if (units.length >= 8192) {
            out += String.fromCharCode.apply(null, units);
            units.length = 0;
        }
    };
    let i = bytes.length >= 3 && (bytes[0] & 0xff) === 0xef && (bytes[1] & 0xff) === 0xbb && (bytes[2] & 0xff) === 0xbf ? 3 : 0;
    while (i < bytes.length) {
        const b = bytes[i] & 0xff;
        if (b < 0x80) {
            push(b);
            i++;
            continue;
        }
        let need;
        let cp;
        let lower = 0x80;
        let upper = 0xbf;
        if (b >= 0xc2 && b <= 0xdf) {
            need = 1;
            cp = b & 0x1f;
        }
        else if (b >= 0xe0 && b <= 0xef) {
            need = 2;
            cp = b & 0x0f;
            if (b === 0xe0) lower = 0xa0;
            if (b === 0xed) upper = 0x9f;
        }
        else if (b >= 0xf0 && b <= 0xf4) {
            need = 3;
            cp = b & 0x07;
            if (b === 0xf0) lower = 0x90;
            if (b === 0xf4) upper = 0x8f;
        }
        else {
            push(0xfffd);
            i++;
            continue;
        }
        let j = i + 1;
        let complete = true;
        for (let k = 0; k < need; k++) {
            const c = j < bytes.length ? bytes[j] & 0xff : -1;
            if (c < lower || c > upper) {
                complete = false;
                break;
            }
            lower = 0x80;
            upper = 0xbf;
            cp = (cp << 6) | (c & 0x3f);
            j++;
        }
        push(complete ? cp : 0xfffd);
        i = j;
    }
    return out + String.fromCharCode.apply(null, units);
}
