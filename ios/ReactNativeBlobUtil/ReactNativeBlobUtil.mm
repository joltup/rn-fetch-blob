//
//  ReactNativeBlobUtil.mm
//
//  Created by wkh237 on 2016/4/28.
//
//  The adapter. The logic moved to ReactNativeBlobUtilModuleCore in Swift; what
//  is left is what needs React or C++: the module macro, the RCTEventEmitter
//  subclass, getTurboModule, and one forwarding method per spec method.
//
//  Every method here converts argument types and calls straight through. If a
//  forwarding method grows a branch, it belongs in the Swift instead.
//

#import "ReactNativeBlobUtil.h"
#import <React/RCTUtils.h>

// The seam, not the Swift module. Under SwiftPM this file compiles in its own
// target and cannot see the Swift core's generated -Swift.h, so it names a
// protocol that originates in the Objective-C leaf and resolves the
// implementation at runtime. The angle-bracket spelling is SwiftPM's (the leaf
// is a module there); the quoted one is CocoaPods' header map.
#if __has_include(<ReactNativeBlobUtilObjC/ReactNativeBlobUtilModuleCoreBridge.h>)
#import <ReactNativeBlobUtilObjC/ReactNativeBlobUtilModuleCoreBridge.h>
#else
#import "ReactNativeBlobUtilModuleCoreBridge.h"
#endif

dispatch_queue_t commonTaskQueue;

@interface ReactNativeBlobUtil () <ReactNativeBlobUtilEventSink>
@property (nonatomic, strong) id<ReactNativeBlobUtilModuleCoreBridge> core;
@end

@implementation ReactNativeBlobUtil

static bool hasListeners = NO;

RCT_EXPORT_MODULE();

- (id) init {
    self = [super init];
    if (self) {
        // Resolved by name: naming the class would need the Swift header.
        // A nil here means the Swift half did not link, which is worth saying
        // out loud rather than failing later as an unexplained no-op.
        Class coreClass = NSClassFromString(@"ReactNativeBlobUtilModuleCore");
        NSAssert(coreClass != nil,
                 @"ReactNativeBlobUtilModuleCore is missing from the binary - the Swift half did not link.");
        _core = [[coreClass alloc] init];
        _core.eventSink = self;
        // Plain UIKit rather than a React helper, but only the adapter is in a
        // position to reach for it, so the Swift takes it as a provider.
        // Native warnings belong in the JS console, where the developer who
        // caused them is looking. Swift cannot import React, so the handler is
        // injected here once.
        [_core setWarningHandler:^(NSString *message) {
            RCTLogWarn(@"%@", message);
        }];
        // RCTPresentedViewController() finds the key window through the connected scenes, so it
        // works with the UIScene life cycle (React Native 0.88's template, required to launch when
        // built with the iOS 27 SDK). That template's AppDelegate has no `window`, and sending it
        // one threw "-[AppDelegate window]: unrecognized selector".
        _core.presentingViewController = ^UIViewController * _Nullable {
            return RCTPresentedViewController();
        };
        if (commonTaskQueue == nil)
            commonTaskQueue = dispatch_queue_create("ReactNativeBlobUtil.queue", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

#pragma mark - module plumbing

/// Only names something actually emits. The list also carried "log", "warn",
/// "error", "data" and "end", which are values of the `event` field inside a
/// filesystem payload rather than event names, and "reportProgress" and
/// "reportUploadProgress", which nothing has ever sent - subscribing to any of
/// them got a listener that could never fire.
- (NSArray<NSString*> *)supportedEvents {
    return @[@"ReactNativeBlobUtilState", @"ReactNativeBlobUtilServerPush", @"ReactNativeBlobUtilProgress", @"ReactNativeBlobUtilProgress-upload", @"ReactNativeBlobUtilMessage", @"ReactNativeBlobUtilFilesystem"];
}

- (void)startObserving { hasListeners = YES; }
- (void)stopObserving { hasListeners = NO; }

- (dispatch_queue_t) methodQueue {
    if (commonTaskQueue == nil)
        commonTaskQueue = dispatch_queue_create("ReactNativeBlobUtil.queue", DISPATCH_QUEUE_SERIAL);
    return commonTaskQueue;
}

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSDictionary *)getConstants { return [self.core constantsToExport]; }
- (NSDictionary *)constantsToExport { return [self.core constantsToExport]; }

#pragma mark - events

/// The payload, as an object. It used to be serialised to a JSON *string* that
/// every listener had to parse before reading a field, and a body that failed to
/// serialise was logged and dropped - the event simply never arrived.
- (void)emitEventDict:(NSString *)name body:(NSDictionary *)body {
    if (hasListeners) {
        [self sendEventWithName:name body:body];
    }
}

#pragma mark - fetch

RCT_EXPORT_METHOD(fetchBlobForm:(NSDictionary *)options taskId:(NSString *)taskId method:(NSString *)method url:(NSString *)url headers:(NSDictionary *)headers form:(NSArray *)form callback:(RCTResponseSenderBlock)callback) {
    [self.core fetchBlobForm:options taskId:taskId method:method url:url headers:headers form:form callback:callback];
}

RCT_EXPORT_METHOD(fetchBlob:(NSDictionary *)options taskId:(NSString *)taskId method:(NSString *)method url:(NSString *)url headers:(NSDictionary *)headers body:(NSString *)body callback:(RCTResponseSenderBlock)callback) {
    [self.core fetchBlob:options taskId:taskId method:method url:url headers:headers body:body callback:callback];
}

#pragma mark - file system

- (void)createFile:(NSString *)path data:(NSString *)data encoding:(NSString *)encoding resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core createFile:path data:data encoding:encoding resolve:resolve reject:reject];
}

- (void)createFileASCII:(NSString *)path data:(NSArray *)data resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core createFileASCII:path data:data resolve:resolve reject:reject];
}

- (void)pathForAppGroup:(NSString *)groupName resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core pathForAppGroup:groupName resolve:resolve reject:reject];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(syncPathAppGroup:(NSString *)groupName) {
    return [self.core syncPathAppGroup:groupName];
}

- (void)exists:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core exists:path resolve:resolve reject:reject];
}

- (void)writeFile:(NSString *)path encoding:(NSString *)encoding data:(NSString *)data transformFile:(BOOL)transformFile append:(BOOL)append resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeFile:path encoding:encoding data:data transformFile:transformFile append:append resolve:resolve reject:reject];
}

- (void)writeFileArray:(NSString *)path data:(NSArray *)data append:(BOOL)append resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeFileArray:path data:data append:append resolve:resolve reject:reject];
}

- (void)writeStream:(NSString *)path withEncoding:(NSString *)encoding appendData:(BOOL)append resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeStream:path withEncoding:encoding appendData:append resolve:resolve reject:reject];
}

- (void)writeArrayChunk:(NSString *)streamId withArray:(NSArray *)dataArray resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeArrayChunk:streamId withArray:dataArray resolve:resolve reject:reject];
}

- (void)writeChunk:(NSString *)streamId withData:(NSString *)data resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeChunk:streamId withData:data resolve:resolve reject:reject];
}

- (void)closeStream:(NSString *)streamId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core closeStream:streamId resolve:resolve reject:reject];
}

- (void)unlink:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core unlink:path resolve:resolve reject:reject];
}

- (void)removeSession:(NSArray *)paths resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core removeSession:paths resolve:resolve reject:reject];
}

- (void)ls:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core ls:path resolve:resolve reject:reject];
}

- (void)stat:(NSString *)target resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core stat:target resolve:resolve reject:reject];
}

- (void)lstat:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core lstat:path resolve:resolve reject:reject];
}

- (void)cp:(NSString *)src dest:(NSString *)dest resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core cp:src dest:dest resolve:resolve reject:reject];
}

- (void)mv:(NSString *)path dest:(NSString *)dest resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core mv:path dest:dest resolve:resolve reject:reject];
}

- (void)mkdir:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core mkdir:path resolve:resolve reject:reject];
}

- (void)readFile:(NSString *)path encoding:(NSString *)encoding transformFile:(BOOL)transformFile resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core readFile:path encoding:encoding transformFile:transformFile resolve:resolve reject:reject];
}

- (void)hash:(NSString *)path algorithm:(NSString *)algorithm resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core hash:path algorithm:algorithm resolve:resolve reject:reject];
}

- (void)slice:(NSString *)src dest:(NSString *)dest start:(double)start end:(double)end resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core slice:src dest:dest start:start end:end resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(readStream:(NSString *)path encoding:(NSString *)encoding bufferSize:(double)bufferSize tick:(double)tick streamId:(NSString *)streamId) {
    [self.core readStream:path encoding:encoding bufferSize:bufferSize tick:tick streamId:streamId];
}

- (void)df:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core df:resolve reject:reject];
}

- (void)excludeFromBackupKey:(NSString *)url resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core excludeFromBackupKey:url resolve:resolve reject:reject];
}

#pragma mark - network

- (void)cancelRequest:(NSString *)taskId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core cancelRequest:taskId resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(enableProgressReport:(NSString *)taskId interval:(double)interval count:(double)count) {
    [self.core enableProgressReport:taskId interval:interval count:count];
}

RCT_EXPORT_METHOD(enableUploadProgressReport:(NSString *)taskId interval:(double)interval count:(double)count) {
    [self.core enableUploadProgressReport:taskId interval:interval count:count];
}

#pragma mark - document menus

- (void)presentOptionsMenu:(NSString *)uri scheme:(NSString *)scheme resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core presentOptionsMenu:uri scheme:scheme resolve:resolve reject:reject];
}

- (void)presentOpenInMenu:(NSString *)uri scheme:(NSString *)scheme resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core presentOpenInMenu:uri scheme:scheme resolve:resolve reject:reject];
}

- (void)presentPreview:(NSString *)uri scheme:(NSString *)scheme resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core presentPreview:uri scheme:scheme resolve:resolve reject:reject];
}

#pragma mark - Android only

- (void)actionViewIntent:(NSString *)path mime:(NSString *)mime chooserTitle:(NSString *)chooserTitle resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core actionViewIntent:path mime:mime chooserTitle:chooserTitle resolve:resolve reject:reject];
}

- (void)addCompleteDownload:(NSDictionary *)config resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core addCompleteDownload:config resolve:resolve reject:reject];
}

- (void)copyToInternal:(NSString *)contentUri destpath:(NSString *)destpath resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core copyToInternal:contentUri destpath:destpath resolve:resolve reject:reject];
}

- (void)copyToMediaStore:(NSDictionary *)filedata mt:(NSString *)mt path:(NSString *)path resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core copyToMediaStore:filedata mt:mt path:path resolve:resolve reject:reject];
}

- (void)createMediaFile:(NSDictionary *)filedata mt:(NSString *)mt resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core createMediaFile:filedata mt:mt resolve:resolve reject:reject];
}

- (void)getBlob:(NSString *)contentUri encoding:(NSString *)encoding resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core getBlob:contentUri encoding:encoding resolve:resolve reject:reject];
}

- (void)getContentIntent:(NSString *)mime resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core getContentIntent:mime resolve:resolve reject:reject];
}

- (void)getSDCardDir:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core getSDCardDir:resolve reject:reject];
}

- (void)getSDCardApplicationDir:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core getSDCardApplicationDir:resolve reject:reject];
}

- (void)scanFile:(NSArray *)pairs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core scanFile:pairs resolve:resolve reject:reject];
}

- (void)writeToMediaFile:(NSString *)fileUri path:(NSString *)path transformFile:(BOOL)transformFile resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [self.core writeToMediaFile:fileUri path:path transformFile:transformFile resolve:resolve reject:reject];
}

#pragma mark - New Architecture

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeBlobUtilsSpecJSI>(params);
}

@end
