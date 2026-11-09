// @flow
/**
 * config() options as native reads them. 1.0 groups the platform-only options
 * (`android: {downloadManager, wifiOnly, targetHostIp}`, `ios: {backgroundTask}`)
 * and names the transformer flag `transform`, as readFile and writeFile do. The
 * flat names from before keep working and warn once each.
 */
import {warnOnce} from './deprecate';

const RENAMED = {
    transformFile: 'transform',
    addAndroidDownloads: 'android.downloadManager',
    wifiOnly: 'android.wifiOnly',
    targetHostIp: 'android.targetHostIp',
    IOSBackgroundTask: 'ios.backgroundTask',
};

export function normalizeConfig(options: Object): Object {
    const out = {...options};
    for (const old of Object.keys(RENAMED)) {
        if (old in options) {
            warnOnce(`config.${old}`, `ReactNativeBlobUtil config option "${old}" is deprecated and will be removed; use "${RENAMED[old]}"`);
        }
    }
    if ('transform' in options) {
        out.transformFile = options.transform;
    }
    const android = options.android || {};
    if ('downloadManager' in android) {
        out.addAndroidDownloads = android.downloadManager;
    }
    if ('wifiOnly' in android) {
        out.wifiOnly = android.wifiOnly;
    }
    if ('targetHostIp' in android) {
        out.targetHostIp = android.targetHostIp;
    }
    const ios = options.ios || {};
    if ('backgroundTask' in ios) {
        out.IOSBackgroundTask = ios.backgroundTask;
    }
    delete out.transform;
    delete out.android;
    delete out.ios;
    // iOS reads `auto` by its presence, Android by its value: only send it when set.
    if (!out.auto) {
        delete out.auto;
    }
    return out;
}
