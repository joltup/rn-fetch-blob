// @flow
/* eslint-disable no-console */
const warned = new Set();

/** Prints a warning the first time `key` is seen; later calls are silent. */
export function warnOnce(key: string, message: string) {
    if (warned.has(key)) {
        return;
    }
    warned.add(key);
    console.warn(message);
}

/**
 * A function that behaves like `fn` and warns once, on first use, that the
 * caller should move to `newName`.
 */
export function deprecatedAlias(oldName: string, newName: string, fn: Function): Function {
    return (...args: any) => {
        warnOnce(oldName, `ReactNativeBlobUtil.${oldName} is deprecated and will be removed; use ReactNativeBlobUtil.${newName}`);
        return fn(...args);
    };
}
