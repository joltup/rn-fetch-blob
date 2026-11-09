// @flow
// The names from before 1.0. Each warns once and forwards to open.* or fs.*.
// They keep their old scope: iOS only, ENOTSUP elsewhere.
import {Platform} from 'react-native';
import fs from './fs';
import open from './open';
import {deprecatedAlias} from './utils/deprecate';
import {platformOnly} from './utils/platform';

const old = (name, target, fn) => platformOnly('ios', `ReactNativeBlobUtil.ios.${name}`, deprecatedAlias(`ios.${name}`, target, fn));
const withScheme = (target) => (path: string, scheme: ?string) => target(path, {scheme});

export default {
    presentPreview: old('presentPreview', 'open.file', withScheme(open.file)),
    presentOpenInMenu: old('presentOpenInMenu', 'open.chooser', withScheme(open.chooser)),
    presentOptionsMenu: old('presentOptionsMenu', 'open.optionsMenu', withScheme(open.optionsMenu)),
    openDocument: old('openDocument', 'open.optionsMenu', withScheme(open.optionsMenu)),
    previewDocument: old('previewDocument', 'open.file', withScheme(open.file)),
    excludeFromBackupKey: old('excludeFromBackupKey', 'fs.excludeFromBackup', fs.excludeFromBackup),
    pathForAppGroup: old('pathForAppGroup', 'fs.appGroupDir', fs.appGroupDir),
    syncPathAppGroup: (groupName: string) => Platform.OS === 'ios'
        ? deprecatedAlias('ios.syncPathAppGroup', 'fs.appGroupDirSync', fs.appGroupDirSync)(groupName)
        : '',
};
