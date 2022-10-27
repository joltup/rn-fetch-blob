//
//  RNFetchBlobReqBuilder.m
//  RNFetchBlob
//
//  Created by Ben Hsieh on 2016/7/9.
//  Copyright © 2016年 wkh237. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "RNFetchBlobReqBuilder.h"
#import "RNFetchBlobNetwork.h"
#import "RNFetchBlobConst.h"
#import "RNFetchBlobFS.h"

#if __has_include(<React/RCTAssert.h>)
#import <React/RCTLog.h>
#else
#import "RCTLog.h"
#endif

@interface RNFetchBlobReqBuilder()
{

}
@end

@implementation RNFetchBlobReqBuilder


// Fetch blob data request
+(void) buildMultipartRequest:(NSDictionary *)options
                       taskId:(NSString *)taskId
                       method:(NSString *)method
                          url:(NSString *)url
                      headers:(NSDictionary *)headers
                         form:(NSArray *)form
                   onComplete:(void(^)(NSURLRequest * req, long bodyLength))onComplete
{
    //    NSString * encodedUrl = [url stringByAddingPercentEscapesUsingEncoding:NSUTF8StringEncoding];
    NSString * encodedUrl = url;

    // send request
    __block NSMutableURLRequest *request = [[NSMutableURLRequest alloc] initWithURL:[NSURL URLWithString: encodedUrl]];
    __block NSMutableDictionary *mheaders = [[NSMutableDictionary alloc] initWithDictionary:[RNFetchBlobNetwork normalizeHeaders:headers]];
    NSTimeInterval timeStamp = [[NSDate date] timeIntervalSince1970];
    NSNumber * timeStampObj = [NSNumber numberWithDouble: timeStamp];

    // generate boundary
    __block NSString * boundary = [NSString stringWithFormat:@"RNFetchBlob%d", timeStampObj];
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        __block NSMutableData * postData = [[NSMutableData alloc] init];
        // combine multipart/form-data body
        [[self class] buildFormBody:form boundary:boundary onComplete:^(NSData *formData, BOOL hasError) {
            if(hasError)
            {
                onComplete(nil, nil);
            }
            else
            {
                if(formData != nil)
                {
                    [postData appendData:formData];
                    // close form data
                    [postData appendData: [[NSString stringWithFormat:@"--%@--\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
                    [request setHTTPBody:postData];
                }
                // set content-length
                [mheaders setValue:[NSString stringWithFormat:@"%lu",[postData length]] forKey:@"Content-Length"];
                [mheaders setValue:@"100-continue" forKey:@"Expect"];
                // appaned boundary to content-type
                [mheaders setValue:[NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary] forKey:@"content-type"];
                [request setHTTPMethod: method];
                [request setAllHTTPHeaderFields:mheaders];
                onComplete(request, [formData length]);
            }
        }];

    });
}

// Fetch blob data request
+(void) buildOctetRequest:(NSDictionary *)options
                   taskId:(NSString *)taskId
                   method:(NSString *)method
                      url:(NSString *)url
                  headers:(NSDictionary *)headers
                     body:(NSString *)body
               onComplete:(void(^)(__weak NSURLRequest * req, long bodyLength))onComplete
{
//    NSString * encodedUrl = [url stringByAddingPercentEscapesUsingEncoding:NSUTF8StringEncoding];
    NSString * encodedUrl = url;
    // send request
    __block NSMutableURLRequest *request = [[NSMutableURLRequest alloc]
                                    initWithURL:[NSURL URLWithString: encodedUrl]];

    __block NSMutableDictionary *mheaders = [[NSMutableDictionary alloc] initWithDictionary:[RNFetchBlobNetwork normalizeHeaders:headers]];
    // move heavy task to another thread
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        NSMutableData * blobData;
        long size = -1;
        // if method is POST, PUT or PATCH, convert data string format
        if([[method lowercaseString] isEqualToString:@"post"] || [[method lowercaseString] isEqualToString:@"put"] || [[method lowercaseString] isEqualToString:@"patch"]) {
            // generate octet-stream body
            if(body != nil) {
                __block NSString * cType = [[self class] getHeaderIgnoreCases:@"content-type" fromHeaders:mheaders];
                __block NSString * transferEncoding = [[self class] getHeaderIgnoreCases:@"transfer-encoding" fromHeaders:mheaders];
                // when headers does not contain a key named "content-type" (case ignored), use default content type
                if(cType == nil)
                {
                    [mheaders setValue:@"application/octet-stream" forKey:@"Content-Type"];
                }

                // when body is a string contains file path prefix, try load file from the path
                if([body hasPrefix:FILE_PREFIX]) {
                    __block NSString * orgPath = [body substringFromIndex:[FILE_PREFIX length]];
                    orgPath = [RNFetchBlobFS getPathOfAsset:orgPath];
                    if([orgPath hasPrefix:AL_PREFIX])
                    {

                        [RNFetchBlobFS readFile:orgPath encoding:nil onComplete:^(id content, NSString* code, NSString * err) {
                            if(err != nil)
                            {
                                onComplete(nil, nil);
                            }
                            else
                            {
                                [request setHTTPBody:((NSData *)content)];
                                [request setHTTPMethod: method];
                                [request setAllHTTPHeaderFields:mheaders];
                                onComplete(request, [((NSData *)content) length]);
                            }
                        }];

                        return;
                    }
                    size = [[[NSFileManager defaultManager] attributesOfItemAtPath:orgPath error:nil] fileSize];
                    if(transferEncoding != nil && [[transferEncoding lowercaseString] isEqualToString:@"chunked"])
                    {
                        [request setHTTPBodyStream: [NSInputStream inputStreamWithFileAtPath:orgPath ]];
                    }
                    else
                    {
                        __block NSData * bodyBytes = [NSData dataWithContentsOfFile:orgPath ];
                        [request setHTTPBody:bodyBytes];
                    }
                }
                // otherwise convert it as BASE64 data string
                else {

                    __block NSString * cType = [[self class]getHeaderIgnoreCases:@"content-type" fromHeaders:mheaders];
                    // when content-type is application/octet* decode body string using BASE64 decoder
                    if([[cType lowercaseString] hasPrefix:@"application/octet"] || [[cType lowercaseString] containsString:@";base64"])
                    {
                        __block NSString * ncType = [[cType stringByReplacingOccurrencesOfString:@";base64" withString:@""]stringByReplacingOccurrencesOfString:@";BASE64" withString:@""];
                        if([mheaders valueForKey:@"content-type"] != nil)
                            [mheaders setValue:ncType forKey:@"content-type"];
                        if([mheaders valueForKey:@"Content-Type"] != nil)
                            [mheaders setValue:ncType forKey:@"Content-Type"];
                        blobData = [[NSData alloc] initWithBase64EncodedString:body options:0];
                        [request setHTTPBody:blobData];
                        size = [blobData length];
                    }
                    // otherwise use the body as-is
                    else
                    {
                        size = [body length];
                        [request setHTTPBody: [body dataUsingEncoding:NSUTF8StringEncoding]];
                    }
                }
            }
        }

        [request setHTTPMethod: method];
        [request setAllHTTPHeaderFields:mheaders];

        onComplete(request, size);
    });
}

+(void) buildFormBody:(NSArray *)form boundary:(NSString *)boundary onComplete:(void(^)(NSData * formData, BOOL hasError))onComplete
{
    __block NSMutableData * formData = [[NSMutableData alloc] init];
    if(form == nil)
        onComplete(nil, NO);
    else
    {
        __block int i = 0;
        __block int count = [form count];
        // a recursive block that builds multipart body asynchornously
        void __block (^getFieldData)(id field) = ^(id field)
        {
            NSString * name = [field valueForKey:@"name"];
            __block NSString * content = [field valueForKey:@"data"];
            NSString * contentType = [field valueForKey:@"type"];
            // skip when the form field `name` or `data` is empty
            if(content == nil || name == nil)
            {
                i++;
                getFieldData([form objectAtIndex:i]);
                RCTLogWarn(@"RNFetchBlob multipart request builder has found a field without `data` or `name` property, the field will be removed implicitly.");
                return;
            }

            // field is a text field
            if([field valueForKey:@"filename"] == nil || content == nil) {
                contentType = contentType == nil ? @"text/plain" : contentType;
                [formData appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"%@\"\r\n", name] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:[[NSString stringWithFormat:@"Content-Type: %@\r\n\r\n", contentType] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:[[NSString stringWithFormat:@"%@\r\n", content] dataUsingEncoding:NSUTF8StringEncoding]];
            }
            // field contains a file
            else {
                contentType = contentType == nil ? @"application/octet-stream" : contentType;
                NSMutableData * blobData;
                if(content != nil)
                {
                    // append data from file asynchronously
                    if([content hasPrefix:FILE_PREFIX])
                    {
                        NSString * orgPath = [content substringFromIndex:[FILE_PREFIX length]];
                        orgPath = [RNFetchBlobFS getPathOfAsset:orgPath];

                        [RNFetchBlobFS readFile:orgPath encoding:nil onComplete:^(NSData *content, NSString* code, NSString * err) {
                            if(err != nil)
                            {
                                onComplete(formData, YES);
                                return;
                            }
                            NSString * filename = [field valueForKey:@"filename"];
                            [formData appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
                            [formData appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"%@\"; filename=\"%@\"\r\n", name, filename] dataUsingEncoding:NSUTF8StringEncoding]];
                            [formData appendData:[[NSString stringWithFormat:@"Content-Type: %@\r\n\r\n", contentType] dataUsingEncoding:NSUTF8StringEncoding]];
                            [formData appendData:content];
                            [formData appendData:[[NSString stringWithFormat:@"\r\n"] dataUsingEncoding:NSUTF8StringEncoding]];
                            i++;
                            if(i < count)
                            {
                                __block NSDictionary * nextField = [form objectAtIndex:i];
                                getFieldData(nextField);
                            }
                            else
                            {
                                onComplete(formData, NO);
                                getFieldData = nil;
                            }
                        }];
                        return ;
                    }
                    else
                        blobData = [[NSData alloc] initWithBase64EncodedString:content options:0];
                }
                NSString * filename = [field valueForKey:@"filename"];
                [formData appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"%@\"; filename=\"%@\"\r\n", name, filename] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:[[NSString stringWithFormat:@"Content-Type: %@\r\n\r\n", contentType] dataUsingEncoding:NSUTF8StringEncoding]];
                [formData appendData:blobData];
                [formData appendData:[[NSString stringWithFormat:@"\r\n"] dataUsingEncoding:NSUTF8StringEncoding]];
                blobData = nil;
            }
            i++;
            if(i < count)
            {
                __block NSDictionary * nextField = [form objectAtIndex:i];
                getFieldData(nextField);
            }
            else
            {
                onComplete(formData, NO);
                getFieldData = nil;
            }

        };
        __block NSDictionary * nextField = [form objectAtIndex:i];
        getFieldData(nextField);
    }
}

+(NSString *) getHeaderIgnoreCases:(NSString *)field fromHeaders:(NSDictionary *) headers {

    NSString * normalCase = [headers valueForKey:field];
    NSString * ignoredCase = [headers valueForKey:[field lowercaseString]];
    if( normalCase != nil)
        return normalCase;
    else
        return ignoredCase;

}


@end
