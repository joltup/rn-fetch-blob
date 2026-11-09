// @flow
/**
 * An Error with a `code` property, the shape every rejection of this
 * library carries: POSIX-style codes such as EINVAL, ENOENT, ENOTSUP.
 * @param  {string} code
 * @param  {Error} error
 * @return {Error} The same error, with `code` set.
 */
export function addCode(code: string, error: Error): Error {
    error.code = code;
    return error;
}
