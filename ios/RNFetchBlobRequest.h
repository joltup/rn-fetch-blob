//
//  RNFetchBlobRequest.h
//  RNFetchBlob
//
//  Created by Artur Chrusciel on 15.01.18.
//  Copyright © 2018 wkh237.github.io. All rights reserved.
//

#ifndef RNFetchBlobRequest_h
#define RNFetchBlobRequest_h

#import <Foundation/Foundation.h>

#import "RNFetchBlobProgress.h"

#if __has_include(<React/RCTAssert.h>)
#import <React/RCTBridgeModule.h>
#else
#import "RCTBridgeModule.h"
#endif

@interface RNFetchBlobRequest : NSObject <NSURLSessionDelegate, NSURLSessionTaskDelegate, NSURLSessionDataDelegate>

@property (nullable, nonatomic) NSString * taskId;
@property (nonatomic) long long expectedBytes;
@property (nonatomic) long long receivedBytes;
@property (nonatomic) BOOL isServerPush;
@property (nullable, nonatomic) NSMutableData * respData;
@property (nullable, strong, nonatomic) RCTResponseSenderBlock callback;
@property (nullable, nonatomic) RCTBridge * bridge;
@property (nullable, nonatomic) NSDictionary * options;
@property (nullable, nonatomic) NSError * error;
@property (nullable, nonatomic) RNFetchBlobProgress *progressConfig;
@property (nullable, nonatomic) RNFetchBlobProgress *uploadProgressConfig;
@property (nullable, nonatomic, weak) NSURLSessionDataTask *task;

- (void) sendRequest:(NSDictionary  * _Nullable )options
       contentLength:(long)contentLength
              bridge:(RCTBridge * _Nullable)bridgeRef
              taskId:(NSString * _Nullable)taskId
         withRequest:(NSURLRequest * _Nullable)req
  taskOperationQueue:(NSOperationQueue * _Nonnull)operationQueue
            callback:(_Nullable RCTResponseSenderBlock) callback;

@end

#endif /* RNFetchBlobRequest_h */
