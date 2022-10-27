//
//  RNFetchBlob.m
//
//  Created by wkh237 on 2016/4/28.
//

#import "RNFetchBlob.h"
#import "RNFetchBlobFS.h"
#import "RNFetchBlobNetwork.h"
#import "RNFetchBlobConst.h"
#import "RNFetchBlobReqBuilder.h"
#import "RNFetchBlobProgress.h"


__strong RCTBridge * bridgeRef;
dispatch_queue_t commonTaskQueue;
dispatch_queue_t fsQueue;

////////////////////////////////////////
//
//  Exported native methods
//
////////////////////////////////////////

#pragma mark RNFetchBlob exported methods

@implementation RNFetchBlob

@synthesize filePathPrefix;
@synthesize documentController;
@synthesize bridge = _bridge;

- (dispatch_queue_t) methodQueue {
    if(commonTaskQueue == nil)
        commonTaskQueue = dispatch_queue_create("RNFetchBlob.queue", DISPATCH_QUEUE_SERIAL);
    return commonTaskQueue;
}

+ (RCTBridge *)getRCTBridge
{
    RCTRootView * rootView = (RCTRootView*) [[UIApplication sharedApplication] keyWindow].rootViewController.view;
    return rootView.bridge;
}

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

RCT_EXPORT_MODULE();

- (id) init {
    self = [super init];
    self.filePathPrefix = FILE_PREFIX;
    if(commonTaskQueue == nil)
        commonTaskQueue = dispatch_queue_create("RNFetchBlob.queue", DISPATCH_QUEUE_SERIAL);
    if(fsQueue == nil)
        fsQueue = dispatch_queue_create("RNFetchBlob.fs.queue", DISPATCH_QUEUE_SERIAL);
    BOOL isDir;
    // if temp folder not exists, create one
    if(![[NSFileManager defaultManager] fileExistsAtPath: [RNFetchBlobFS getTempPath] isDirectory:&isDir]) {
        [[NSFileManager defaultManager] createDirectoryAtPath:[RNFetchBlobFS getTempPath] withIntermediateDirectories:YES attributes:nil error:NULL];
    }
    bridgeRef = _bridge;
    [RNFetchBlobNetwork emitExpiredTasks];
    return self;
}

- (NSDictionary *)constantsToExport
{
    return @{
             @"CacheDir" : [RNFetchBlobFS getCacheDir],
             @"DocumentDir": [RNFetchBlobFS getDocumentDir],
             @"DownloadDir" : [RNFetchBlobFS getDownloadDir],
             @"LibraryDir" : [RNFetchBlobFS getLibraryDir],
             @"MainBundleDir" : [RNFetchBlobFS getMainBundleDir],
             @"MovieDir" : [RNFetchBlobFS getMovieDir],
             @"MusicDir" : [RNFetchBlobFS getMusicDir],
             @"PictureDir" : [RNFetchBlobFS getPictureDir],
             };
}

// Fetch blob data request
RCT_EXPORT_METHOD(fetchBlobForm:(NSDictionary *)options
                  taskId:(NSString *)taskId
                  method:(NSString *)method
                  url:(NSString *)url
                  headers:(NSDictionary *)headers
                  form:(NSArray *)form
                  callback:(RCTResponseSenderBlock)callback)
{

    [RNFetchBlobReqBuilder buildMultipartRequest:options
                                          taskId:taskId
                                          method:method
                                             url:url
                                         headers:headers
                                            form:form
                                      onComplete:^(__weak NSURLRequest *req, long bodyLength)
    {
        // something went wrong when building the request body
        if(req == nil)
        {
            callback(@[@"RNFetchBlob.fetchBlobForm failed to create request body"]);
        }
        // send HTTP request
        else
        {
            [[RNFetchBlobNetwork sharedInstance] sendRequest:options
                                               contentLength:bodyLength
                                                      bridge:self.bridge
                                                      taskId:taskId
                                                 withRequest:req
                                                    callback:callback];
        }
    }];

}


// Fetch blob data request
RCT_EXPORT_METHOD(fetchBlob:(NSDictionary *)options
                  taskId:(NSString *)taskId
                  method:(NSString *)method
                  url:(NSString *)url
                  headers:(NSDictionary *)headers
                  body:(NSString *)body callback:(RCTResponseSenderBlock)callback)
{
    [RNFetchBlobReqBuilder buildOctetRequest:options
                                      taskId:taskId
                                      method:method
                                         url:url
                                     headers:headers
                                        body:body
                                  onComplete:^(NSURLRequest *req, long bodyLength)
    {
        // something went wrong when building the request body
        if(req == nil)
        {
            callback(@[@"RNFetchBlob.fetchBlob failed to create request body"]);
        }
        // send HTTP request
        else
        {
            [[RNFetchBlobNetwork sharedInstance] sendRequest:options
                                               contentLength:bodyLength
                                                      bridge:self.bridge
                                                      taskId:taskId
                                                 withRequest:req
                                                    callback:callback];
        }
    }];
}

#pragma mark - fs.createFile
RCT_EXPORT_METHOD(createFile:(NSString *)path
                  data:(NSString *)data
                  encoding:(NSString *)encoding
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSFileManager * fm = [NSFileManager defaultManager];
    NSData * fileContent = nil;

    if([[encoding lowercaseString] isEqualToString:@"utf8"]) {
        fileContent = [[NSData alloc] initWithData:[data dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES]];
    }
    else if([[encoding lowercaseString] isEqualToString:@"base64"]) {
        fileContent = [[NSData alloc] initWithBase64EncodedData:data options:NSDataBase64DecodingIgnoreUnknownCharacters];
    }
    else if([[encoding lowercaseString] isEqualToString:@"uri"]) {
        NSString * orgPath = [data stringByReplacingOccurrencesOfString:FILE_PREFIX withString:@""];
        fileContent = [[NSData alloc] initWithContentsOfFile:orgPath];
    }
    else {
        fileContent = [[NSData alloc] initWithData:[data dataUsingEncoding:NSASCIIStringEncoding allowLossyConversion:YES]];
    }

    if ([fm fileExistsAtPath:path]) {
        reject(@"EEXIST", [NSString stringWithFormat:@"File '%@' already exists", path], nil);
    }
    else {
        BOOL success = [fm createFileAtPath:path contents:fileContent attributes:NULL];
        if(success == YES)
            resolve(@[[NSNull null]]);
        else
            reject(@"EUNSPECIFIED", [NSString stringWithFormat:@"Failed to create new file at path '%@', please ensure the folder exists", path], nil);
    }
}

#pragma mark - fs.createFileASCII
// method for create file with ASCII content
RCT_EXPORT_METHOD(createFileASCII:(NSString *)path
                  data:(NSArray *)dataArray
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSFileManager * fm = [NSFileManager defaultManager];
    NSMutableData * fileContent = [NSMutableData alloc];
    // prevent stack overflow, alloc on heap
    char * bytes = (char*) malloc([dataArray count]);

    for(int i = 0; i < dataArray.count; i++) {
        bytes[i] = [[dataArray objectAtIndex:i] charValue];
    }

    [fileContent appendBytes:bytes length:dataArray.count];

    if ([fm fileExistsAtPath:path]) {
        reject(@"EEXIST", [NSString stringWithFormat:@"File '%@' already exists", path], nil);
    }
    else {
        BOOL success = [fm createFileAtPath:path contents:fileContent attributes:NULL];
        if(success == YES)
            resolve(@[[NSNull null]]);
        else
            reject(@"EUNSPECIFIED", [NSString stringWithFormat:@"failed to create new file at path '%@', please ensure the folder exists", path], nil);
    }

    free(bytes);
}

#pragma mark - fs.pathForAppGroup
RCT_EXPORT_METHOD(pathForAppGroup:(NSString *)groupName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString * path = [RNFetchBlobFS getPathForAppGroup:groupName];

    if(path) {
        resolve(path);
    } else {
        reject(@"EUNSPECIFIED", @"could not find path for app group", nil);
    }
}

#pragma mark - fs.syncPathAppGroup
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(syncPathAppGroup:(NSString *)groupName) {
    NSURL *pathUrl = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:groupName];
    NSString *path = [pathUrl path];

    if(path) {
        return path;
    } else {
        return @"";
    }
}

#pragma mark - fs.exists
RCT_EXPORT_METHOD(exists:(NSString *)path callback:(RCTResponseSenderBlock)callback) {
    [RNFetchBlobFS exists:path callback:callback];
}

#pragma mark - fs.writeFile
RCT_EXPORT_METHOD(writeFile:(NSString *)path encoding:(NSString *)encoding data:(NSString *)data append:(BOOL)append resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    [RNFetchBlobFS writeFile:path encoding:[NSString stringWithString:encoding] data:data append:append resolver:resolve rejecter:reject];
}

#pragma mark - fs.writeArray
RCT_EXPORT_METHOD(writeFileArray:(NSString *)path data:(NSArray *)data append:(BOOL)append resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    [RNFetchBlobFS writeFileArray:path data:data append:append resolver:resolve rejecter:reject];
}

#pragma mark - fs.writeStream
RCT_EXPORT_METHOD(writeStream:(NSString *)path withEncoding:(NSString *)encoding appendData:(BOOL)append callback:(RCTResponseSenderBlock)callback)
{
    RNFetchBlobFS * fileStream = [[RNFetchBlobFS alloc] initWithBridgeRef:self.bridge];
    NSFileManager * fm = [NSFileManager defaultManager];
    NSString * folder = [path stringByDeletingLastPathComponent];
    NSError* err = nil;
    BOOL isDir = NO;
    BOOL exists = [fm fileExistsAtPath:path isDirectory: &isDir];

    if(!exists) {
        [fm createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:NULL error:&err];
        if(err != nil) {
            callback(@[@"ENOTDIR", [NSString stringWithFormat:@"Failed to create parent directory of '%@'; error: %@", path, [err description]]]);
        }
        if(![fm createFileAtPath:path contents:nil attributes:nil]) {
            callback(@[@"ENOENT", [NSString stringWithFormat:@"File '%@' does not exist and could not be created", path]]);
        }
    }
    else if(isDir) {
        callback(@[@"EISDIR", [NSString stringWithFormat:@"Expecting a file but '%@' is a directory", path]]);
    }

    NSString * streamId = [fileStream openWithPath:path encode:encoding appendData:append];
    callback(@[[NSNull null], [NSNull null], streamId]);
}

#pragma mark - fs.writeArrayChunk
RCT_EXPORT_METHOD(writeArrayChunk:(NSString *)streamId withArray:(NSArray *)dataArray callback:(RCTResponseSenderBlock) callback)
{
    RNFetchBlobFS *fs = [[RNFetchBlobFS getFileStreams] valueForKey:streamId];
    char * bytes = (char *) malloc([dataArray count]);
    for(int i = 0; i < dataArray.count; i++) {
        bytes[i] = [[dataArray objectAtIndex:i] charValue];
    }
    NSMutableData * data = [NSMutableData alloc];
    [data appendBytes:bytes length:dataArray.count];
    [fs write:data];
    free(bytes);
    callback(@[[NSNull null]]);
}

#pragma mark - fs.writeChunk
RCT_EXPORT_METHOD(writeChunk:(NSString *)streamId withData:(NSString *)data callback:(RCTResponseSenderBlock) callback)
{
    RNFetchBlobFS *fs = [[RNFetchBlobFS getFileStreams] valueForKey:streamId];
    [fs writeEncodeChunk:data];
    callback(@[[NSNull null]]);
}

#pragma mark - fs.closeStream
RCT_EXPORT_METHOD(closeStream:(NSString *)streamId callback:(RCTResponseSenderBlock) callback)
{
    RNFetchBlobFS *fs = [[RNFetchBlobFS getFileStreams] valueForKey:streamId];
    [fs closeOutStream];
    callback(@[[NSNull null], @YES]);
}

#pragma mark - unlink
RCT_EXPORT_METHOD(unlink:(NSString *)path callback:(RCTResponseSenderBlock) callback)
{
    NSError * error = nil;
    NSString * tmpPath = nil;
    [[NSFileManager defaultManager] removeItemAtPath:path error:&error];
    if(error == nil || [[NSFileManager defaultManager] fileExistsAtPath:path] == NO)
        callback(@[[NSNull null]]);
    else
        callback(@[[NSString stringWithFormat:@"failed to unlink file or path at %@", path]]);
}

#pragma mark - fs.removeSession
RCT_EXPORT_METHOD(removeSession:(NSArray *)paths callback:(RCTResponseSenderBlock) callback)
{
    NSError * error = nil;
    NSString * tmpPath = nil;

    for(NSString * path in paths) {
        [[NSFileManager defaultManager] removeItemAtPath:path error:&error];
        if(error != nil) {
            callback(@[[NSString stringWithFormat:@"failed to remove session path at %@", path]]);
            return;
        }
    }
    callback(@[[NSNull null]]);

}

#pragma mark - fs.ls
RCT_EXPORT_METHOD(ls:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    NSFileManager* fm = [NSFileManager defaultManager];
    BOOL exist = nil;
    BOOL isDir = nil;
    exist = [fm fileExistsAtPath:path isDirectory:&isDir];
    if(exist == NO) {
        return reject(@"ENOENT", [NSString stringWithFormat:@"No such file '%@'", path], nil);
    }
    if(isDir == NO) {
        return reject(@"ENOTDIR", [NSString stringWithFormat:@"Not a directory '%@'", path], nil);
    }
    NSError * error = nil;
    NSArray * result = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:path error:&error];

    if(error == nil)
        resolve(result);
    else
        reject(@"EUNSPECIFIED", [error description], nil);
}

#pragma mark - fs.stat
RCT_EXPORT_METHOD(stat:(NSString *)target callback:(RCTResponseSenderBlock) callback)
{

    [RNFetchBlobFS getPathFromUri:target completionHandler:^(NSString *path, ALAssetRepresentation *asset) {
        __block NSMutableArray * result;
        if(path != nil)
        {
            NSFileManager* fm = [NSFileManager defaultManager];
            BOOL exist = nil;
            BOOL isDir = nil;
            NSError * error = nil;

            exist = [fm fileExistsAtPath:path isDirectory:&isDir];
            if(exist == NO) {
                callback(@[[NSString stringWithFormat:@"failed to stat path `%@` because it does not exist or it is not a folder", path]]);
                return ;
            }
            result = [RNFetchBlobFS stat:path error:&error];

            if(error == nil)
                callback(@[[NSNull null], result]);
            else
                callback(@[[error localizedDescription], [NSNull null]]);

        }
        else if(asset != nil)
        {
            __block NSNumber * size = [NSNumber numberWithLong:[asset size]];
            result = [asset metadata];
            [result setValue:size forKey:@"size"];
            callback(@[[NSNull null], result]);
        }
        else
        {
            callback(@[@"failed to stat path, could not resolve URI", [NSNull null]]);
        }
    }];
}

#pragma mark - fs.lstat
RCT_EXPORT_METHOD(lstat:(NSString *)path callback:(RCTResponseSenderBlock) callback)
{
    NSFileManager* fm = [NSFileManager defaultManager];
    BOOL exist = nil;
    BOOL isDir = nil;

    path = [RNFetchBlobFS getPathOfAsset:path];

    exist = [fm fileExistsAtPath:path isDirectory:&isDir];
    if(exist == NO) {
        callback(@[[NSString stringWithFormat:@"failed to lstat path `%@` because it does not exist or it is not a folder", path]]);
        return ;
    }
    NSError * error = nil;
    NSArray * files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:path error:&error];

    NSMutableArray * res = [[NSMutableArray alloc] init];
    if(isDir == YES) {
        for(NSString * p in files) {
            NSString * filePath = [NSString stringWithFormat:@"%@/%@", path, p];
            [res addObject:[RNFetchBlobFS stat:filePath error:&error]];
        }
    }
    else {
        [res addObject:[RNFetchBlobFS stat:path error:&error]];
    }

    if(error == nil)
        callback(@[[NSNull null], res == nil ? [NSNull null] :res ]);
    else
        callback(@[[error localizedDescription], [NSNull null]]);

}

#pragma mark - fs.cp
RCT_EXPORT_METHOD(cp:(NSString*)src toPath:(NSString *)dest callback:(RCTResponseSenderBlock) callback)
{
//    path = [RNFetchBlobFS getPathOfAsset:path];
    [RNFetchBlobFS getPathFromUri:src completionHandler:^(NSString *path, ALAssetRepresentation *asset) {
        NSError * error = nil;
        if(path == nil)
        {
            [RNFetchBlobFS writeAssetToPath:asset dest:dest];
            callback(@[[NSNull null], @YES]);
        }
        else
        {
            // If the destination exists there will be an error
            BOOL result = [[NSFileManager defaultManager] copyItemAtURL:[NSURL fileURLWithPath:path] toURL:[NSURL fileURLWithPath:dest] error:&error];

            if(error == nil)
                callback(@[[NSNull null], @YES]);
            else
                callback(@[[error localizedDescription], @NO]);
        }
    }];
}


#pragma mark - fs.mv
RCT_EXPORT_METHOD(mv:(NSString *)path toPath:(NSString *)dest callback:(RCTResponseSenderBlock) callback)
{
    NSError * error = nil;
    BOOL result = [[NSFileManager defaultManager] moveItemAtURL:[NSURL fileURLWithPath:path] toURL:[NSURL fileURLWithPath:dest] error:&error];

    if(error == nil)
        callback(@[[NSNull null], @YES]);
    else
        callback(@[[error localizedDescription], @NO]);

}

#pragma mark - fs.mkdir
RCT_EXPORT_METHOD(mkdir:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    [RNFetchBlobFS mkdir:path resolver:resolve rejecter:reject];
}

#pragma mark - fs.readFile
RCT_EXPORT_METHOD(readFile:(NSString *)path
                  encoding:(NSString *)encoding
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    
    [RNFetchBlobFS readFile:path encoding:encoding onComplete:^(NSData * content, NSString * code, NSString * err) {
        if(err != nil) {
            reject(code, err, nil);
            return;
        }
        if(encoding == @"ascii") {
            resolve((NSMutableArray *)content);
        }
        else {
            resolve((NSString *)content);
        }
    }];
}

#pragma mark - fs.hash
RCT_EXPORT_METHOD(hash:(NSString *)path
                  algorithm:(NSString *)algorithm
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    [RNFetchBlobFS hash:path algorithm:[NSString stringWithString:algorithm] resolver:resolve rejecter:reject];
}

#pragma mark - fs.readStream
RCT_EXPORT_METHOD(readStream:(NSString *)path withEncoding:(NSString *)encoding bufferSize:(int)bufferSize tick:(int)tick streamId:(NSString *)streamId)
{
    if(bufferSize == nil) {
        if([[encoding lowercaseString] isEqualToString:@"base64"])
            bufferSize = 4095;
        else
            bufferSize = 4096;
    }

    dispatch_async(fsQueue, ^{
        [RNFetchBlobFS readStream:path encoding:encoding bufferSize:bufferSize tick:tick streamId:streamId bridgeRef:_bridge];
    });
}

#pragma mark - fs.getEnvionmentDirs
RCT_EXPORT_METHOD(getEnvironmentDirs:(RCTResponseSenderBlock) callback)
{

    callback(@[
               [RNFetchBlobFS getDocumentDir],
               [RNFetchBlobFS getCacheDir],
               ]);
}

#pragma mark - net.cancelRequest
RCT_EXPORT_METHOD(cancelRequest:(NSString *)taskId callback:(RCTResponseSenderBlock)callback) {
    [[RNFetchBlobNetwork sharedInstance] cancelRequest:taskId];
    callback(@[[NSNull null], taskId]);

}

#pragma mark - net.enableProgressReport
RCT_EXPORT_METHOD(enableProgressReport:(NSString *)taskId interval:(nonnull NSNumber*)interval count:(nonnull NSNumber*)count)
{

    RNFetchBlobProgress * cfg = [[RNFetchBlobProgress alloc] initWithType:Download interval:interval count:count];
    [[RNFetchBlobNetwork sharedInstance] enableProgressReport:taskId config:cfg];
}

#pragma mark - net.enableUploadProgressReport
RCT_EXPORT_METHOD(enableUploadProgressReport:(NSString *)taskId interval:(nonnull NSNumber*)interval count:(nonnull NSNumber*)count)
{
    RNFetchBlobProgress * cfg = [[RNFetchBlobProgress alloc] initWithType:Upload interval:interval count:count];
    [[RNFetchBlobNetwork sharedInstance] enableUploadProgress:taskId config:cfg];
}

#pragma mark - fs.slice
RCT_EXPORT_METHOD(slice:(NSString *)src dest:(NSString *)dest start:(nonnull NSNumber *)start end:(nonnull NSNumber *)end resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    [RNFetchBlobFS slice:src dest:dest start:start end:end encode:@"" resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(previewDocument:(NSString*)uri scheme:(NSString *)scheme resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString * utf8uri = [uri stringByAddingPercentEscapesUsingEncoding:NSUTF8StringEncoding];
    NSURL * url = [[NSURL alloc] initWithString:utf8uri];
    // NSURL * url = [[NSURL alloc] initWithString:uri];
    documentController = [UIDocumentInteractionController interactionControllerWithURL:url];
    UIViewController *rootCtrl = [[[[UIApplication sharedApplication] delegate] window] rootViewController];
    documentController.delegate = self;
    if(scheme == nil || [[UIApplication sharedApplication] canOpenURL:[NSURL URLWithString:scheme]]) {
      CGRect rect = CGRectMake(0.0, 0.0, 0.0, 0.0);
      dispatch_sync(dispatch_get_main_queue(), ^{
          [documentController  presentOptionsMenuFromRect:rect inView:rootCtrl.view animated:YES];
      });
        resolve(@[[NSNull null]]);
    } else {
        reject(@"EINVAL", @"scheme is not supported", nil);
    }
}

# pragma mark - open file with UIDocumentInteractionController and delegate

RCT_EXPORT_METHOD(openDocument:(NSString*)uri scheme:(NSString *)scheme resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString * utf8uri = [uri stringByAddingPercentEscapesUsingEncoding:NSUTF8StringEncoding];
    NSURL * url = [[NSURL alloc] initWithString:utf8uri];
    // NSURL * url = [[NSURL alloc] initWithString:uri];
    documentController = [UIDocumentInteractionController interactionControllerWithURL:url];
    documentController.delegate = self;

    if(scheme == nil || [[UIApplication sharedApplication] canOpenURL:[NSURL URLWithString:scheme]]) {
        dispatch_sync(dispatch_get_main_queue(), ^{
            if([documentController presentPreviewAnimated:YES]) {
                resolve(@[[NSNull null]]);
            } else {
                reject(@"EINVAL", @"document is not supported", nil);
            }
        });
    } else {
        reject(@"EINVAL", @"scheme is not supported", nil);
    }
}

# pragma mark - exclude from backup key

RCT_EXPORT_METHOD(excludeFromBackupKey:(NSString *)url resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    NSError *error = nil;
    [ [NSURL URLWithString:url] setResourceValue:[NSNumber numberWithBool:YES] forKey:NSURLIsExcludedFromBackupKey error:&error];
    if(!error)
    {
        resolve(@[[NSNull null]]);
    } else {
        reject(@"EUNSPECIFIED", [error description], nil);
    }

}


RCT_EXPORT_METHOD(df:(RCTResponseSenderBlock)callback)
{
    [RNFetchBlobFS df:callback];
}

- (UIViewController *) documentInteractionControllerViewControllerForPreview: (UIDocumentInteractionController *) controller
{
    UIWindow *window = [UIApplication sharedApplication].keyWindow;
    UIViewController *currentlyPresentedView = [window.rootViewController presentedViewController];
    if (currentlyPresentedView == nil)
    {
        return window.rootViewController;
    }
    return currentlyPresentedView;
}

# pragma mark - check expired network events

RCT_EXPORT_METHOD(emitExpiredEvent:(RCTResponseSenderBlock)callback)
{
    [RNFetchBlobNetwork emitExpiredTasks];
}




@end
