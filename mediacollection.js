// @flow
// The names from before 1.0. Each warns once and forwards to media.*, keeping
// exactly what it resolved before (writeToMediaFile resolved native's "Success").
import media from './media';
import {deprecatedAlias} from './utils/deprecate';
import {requireNativeModule} from './utils/nativeModule';
import {platformOnly} from './utils/platform';

const alias = (name, target, fn) => deprecatedAlias(`MediaCollection.${name}`, `media.${target}`, fn);
const writeRaw = (name, transform) => platformOnly('android', `ReactNativeBlobUtil.MediaCollection.${name}`,
    (uri: string, path: string) => requireNativeModule().writeToMediaFile(uri, path, transform));

export default {
    createMediaFile: alias('createMediaFile', 'createFile', media.createFile),
    createMediafile: alias('createMediafile', 'createFile', media.createFile),
    writeToMediaFile: alias('writeToMediaFile', 'write', writeRaw('writeToMediaFile', false)),
    writeToMediafile: alias('writeToMediafile', 'write', writeRaw('writeToMediafile', false)),
    writeToMediaFileWithTransform: alias('writeToMediaFileWithTransform', 'write(uri, path, {transform: true})', writeRaw('writeToMediaFileWithTransform', true)),
    writeToMediafileWithTransform: alias('writeToMediafileWithTransform', 'write(uri, path, {transform: true})', writeRaw('writeToMediafileWithTransform', true)),
    // Keeps resolving what native resolves, as it did; media.copyToInternal resolves undefined.
    copyToInternal: alias('copyToInternal', 'copyToInternal', platformOnly('android', 'ReactNativeBlobUtil.MediaCollection.copyToInternal',
        (uri: string, dest: string) => requireNativeModule().copyToInternal(uri, dest))),
    getBlob: alias('getBlob', 'read', media.read),
    copyToMediaStore: alias('copyToMediaStore', 'copyToMediaStore', media.copyToMediaStore),
};
