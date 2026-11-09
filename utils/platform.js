// @flow
import {Platform} from 'react-native';
import {addCode} from './errors';

const NAMES = {android: 'Android', ios: 'iOS', windows: 'Windows'};

/**
 * The rejection a platform-specific call produces elsewhere: an Error with
 * code ENOTSUP, instead of the bare string it used to reject with, or a
 * native call that never settled.
 */
export function notSupported(os: string, apiName: string): Error {
    return addCode('ENOTSUP', new Error(`${apiName} is only available on ${NAMES[os] || os}`));
}

/**
 * Wraps a function so that it only runs on `os` and rejects with ENOTSUP
 * on every other platform, without reaching native.
 */
export function platformOnly(os: string, apiName: string, fn: Function): Function {
    return (...args: any) => Platform.OS === os ? fn(...args) : Promise.reject(notSupported(os, apiName));
}
