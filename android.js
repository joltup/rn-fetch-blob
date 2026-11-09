// @flow
// The names from before 1.0. Each warns once and forwards to open.* or media.*.
// They keep their old scope: Android only, ENOTSUP elsewhere.
import fs from './fs';
import media from './media';
import open from './open';
import {deprecatedAlias} from './utils/deprecate';
import {platformOnly} from './utils/platform';

const old = (name, target, fn) => platformOnly('android', `ReactNativeBlobUtil.android.${name}`, deprecatedAlias(`android.${name}`, target, fn));

export default {
    actionViewIntent: old('actionViewIntent', 'open.file / open.chooser',
        (path: string, mime: string, chooserTitle: ?string) =>
            chooserTitle === undefined || chooserTitle === null
                ? open.file(path, {mime})
                : open.chooser(path, {mime, title: chooserTitle})),
    getContentIntent: old('getContentIntent', 'open.pick', open.pick),
    addCompleteDownload: old('addCompleteDownload', 'media.addDownload', media.addDownload),
    getSDCardDir: old('getSDCardDir', 'fs.sdCardDir', fs.sdCardDir),
    getSDCardApplicationDir: old('getSDCardApplicationDir', 'fs.sdCardApplicationDir', fs.sdCardApplicationDir),
    scanFile: old('scanFile', 'media.scan', media.scan),
};
