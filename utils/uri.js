// @flow
// The prefixes wrap() produces: one for a file path, one for a content URI.
const WRAPPED = /^ReactNativeBlobUtil-(file|content):\/\//;

export default {

    isFileURI: (uri: string): boolean => {
        if (typeof uri !== 'string')
            return false;
        return WRAPPED.test(uri);
    },

    removeURIScheme: (uri: string, iterations: number): string => {
        iterations = iterations || 1;
        let result = uri;
        for (let i = 0; i < iterations; i++) {
            result = String(result).replace(/^[^:]+:\/\//, '');
        }
        return String(result);
    },

    unwrapFileURI: (uri: string): string => {
        return String(uri).replace(WRAPPED, '');
    },

    wrap: (path: string): string => {
        const prefix = path.startsWith('content://') ? 'ReactNativeBlobUtil-content://' : 'ReactNativeBlobUtil-file://';
        return prefix + path;
    }

};
