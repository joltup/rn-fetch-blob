//
//  RNFetchBlobFS.h
//  RNFetchBlob
//
//  Created by Ben Hsieh on 2016/6/6.
//  Copyright © 2016年 suzuri04x2. All rights reserved.
//

#ifndef RNFetchBlobFS_h
#define RNFetchBlobFS_h

#import "RNFetchBlob.h"
#import <Foundation/Foundation.h>

#if __has_include(<React/RCTAssert.h>)
#import <React/RCTBridgeModule.h>
#else
#import "RCTBridgeModule.h"
#endif

@import AssetsLibrary;

@interface RNFetchBlobFS : NSObject <NSStreamDelegate>  {
    NSOutputStream * outStream;
    NSInputStream * inStream;
    RCTResponseSenderBlock callback;
    RCTBridge * bridge;
    Boolean isOpen;
    NSString * encoding;
    int bufferSize;
    BOOL appendData;
    NSString * taskId;
    NSString * path;
    NSString * streamId;
}

@property (nonatomic) NSOutputStream * _Nullable outStream;
@property (nonatomic) NSInputStream * _Nullable inStream;
@property (strong, nonatomic) RCTResponseSenderBlock callback;
@property (nonatomic) RCTBridge * bridge;
@property (nonatomic) NSString * encoding;
@property (nonatomic) NSString * taskId;
@property (nonatomic) NSString * path;
@property (nonatomic) int bufferSize;
@property (nonatomic) NSString * streamId;
@property (nonatomic) BOOL appendData;

// get dirs
+ (NSString *) getCacheDir;
+ (NSString *) getDocumentDir;
+ (NSString *) getDownloadDir;
+ (NSString *) getLibraryDir;
+ (NSString *) getMainBundleDir;
+ (NSString *) getMovieDir;
+ (NSString *) getMusicDir;
+ (NSString *) getPictureDir;
+ (NSString *) getTempPath;
+ (NSString *) getTempPath:(NSString*)taskId withExtension:(NSString *)ext;
+ (NSString *) getPathOfAsset:(NSString *)assetURI;
+ (NSString *) getPathForAppGroup:(NSString *)groupName;
+ (void) getPathFromUri:(NSString *)uri completionHandler:(void(^)(NSString * path, ALAssetRepresentation *asset)) onComplete;

// fs methods
+ (RNFetchBlobFS *) getFileStreams;
+ (BOOL) mkdir:(NSString *) path;
+ (void) mkdir:(NSString *) path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
+ (void) hash:(NSString *)path
    algorithm:(NSString *)algorithm
     resolver:(RCTPromiseResolveBlock)resolve
     rejecter:(RCTPromiseRejectBlock)reject;
+ (NSDictionary *) stat:(NSString *) path error:(NSError **) error;
+ (void) exists:(NSString *) path callback:(RCTResponseSenderBlock)callback;
+ (void) writeFileArray:(NSString *)path data:(NSArray *)data append:(BOOL)append resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
+ (void) writeFile:(NSString *)path encoding:(NSString *)encoding data:(NSString *)data append:(BOOL)append resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
+ (void) readFile:(NSString *)path encoding:(NSString *)encoding onComplete:(void (^)(NSData * content, NSString* code, NSString * errMsg))onComplete;
+ (void) readAssetFile:(NSData *)assetUrl completionBlock:(void(^)(NSData * content))completionBlock failBlock:(void(^)(NSError * err))failBlock;
+ (void) slice:(NSString *)path
         dest:(NSString *)dest
        start:(nonnull NSNumber *)start
          end:(nonnull NSNumber *)end
        encode:(NSString *)encode
     resolver:(RCTPromiseResolveBlock)resolve
     rejecter:(RCTPromiseRejectBlock)reject;
//+ (void) writeFileFromFile:(NSString *)src toFile:(NSString *)dest append:(BOOL)append;
+ (void) writeAssetToPath:(ALAssetRepresentation * )rep dest:(NSString *)dest;
+ (void) readStream:(NSString *)uri encoding:(NSString * )encoding bufferSize:(int)bufferSize tick:(int)tick streamId:(NSString *)streamId bridgeRef:(RCTBridge *)bridgeRef;
+ (void) df:(RCTResponseSenderBlock)callback;

// constructor
- (id) init;
- (id)initWithCallback:(RCTResponseSenderBlock)callback;
- (id)initWithBridgeRef:(RCTBridge *)bridgeRef;

// file stream
- (void) openWithDestination;
- (NSString *)openWithPath:(NSString *)destPath encode:(nullable NSString *)encode appendData:(BOOL)append;

// file stream write data
- (void)write:(NSData *) chunk;
- (void)writeEncodeChunk:(NSString *) chunk;

- (void) closeInStream;
- (void) closeOutStream;

- (void) openFile:( NSString * _Nonnull ) uri;

@end

#endif /* RNFetchBlobFS_h */
