//
//  RNFetchBlobConst.h
//  RNFetchBlob
//
//  Created by Ben Hsieh on 2016/6/6.
//  Copyright © 2016年 suzuri04x2. All rights reserved.
//

#ifndef RNFetchBlobConst_h
#define RNFetchBlobConst_h

#import <Foundation/Foundation.h>

// lib event
extern NSString *const MSG_EVENT;
extern NSString *const MSG_EVENT_LOG;
extern NSString *const MSG_EVENT_WARN;
extern NSString *const MSG_EVENT_ERROR;

extern NSString *const EVENT_EXPIRE;
extern NSString *const EVENT_PROGRESS;
extern NSString *const EVENT_SERVER_PUSH;
extern NSString *const EVENT_PROGRESS_UPLOAD;
extern NSString *const EVENT_STATE_CHANGE;

extern NSString *const FILE_PREFIX;
extern NSString *const ASSET_PREFIX;
extern NSString *const AL_PREFIX;

// config
extern NSString *const CONFIG_USE_TEMP;
extern NSString *const CONFIG_FILE_PATH;
extern NSString *const CONFIG_FILE_EXT;
extern NSString *const CONFIG_TRUSTY;
extern NSString *const CONFIG_WIFI_ONLY;
extern NSString *const CONFIG_INDICATOR;
extern NSString *const CONFIG_KEY;
extern NSString *const CONFIG_EXTRA_BLOB_CTYPE;

// fs events
extern NSString *const FS_EVENT_DATA;
extern NSString *const FS_EVENT_END;
extern NSString *const FS_EVENT_WARN;
extern NSString *const FS_EVENT_ERROR;

extern NSString *const KEY_REPORT_PROGRESS;
extern NSString *const KEY_REPORT_UPLOAD_PROGRESS;

// response type
extern NSString *const RESP_TYPE_BASE64;
extern NSString *const RESP_TYPE_UTF8;
extern NSString *const RESP_TYPE_PATH;



#endif /* RNFetchBlobConst_h */
