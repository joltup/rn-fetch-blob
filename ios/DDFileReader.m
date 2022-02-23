//
//  DDFileReader.m
//  RNFetchBlob
//
//  Created by Olivier MATROT on 29/11/2019.
//  Copyright © 2019 wkh237.github.io. All rights reserved.
//

// Borrowed from https://stackoverflow.com/a/3711079/15186

#import <Foundation/Foundation.h>

#import "DDFileReader.h"

@interface NSData (DDAdditions)

- (NSRange) rangeOfData_dd:(NSData *)dataToFind;

@end

@implementation NSData (DDAdditions)

- (NSRange) rangeOfData_dd:(NSData *)dataToFind {

    const void * bytes = [self bytes];
    NSUInteger length = [self length];

    const void * searchBytes = [dataToFind bytes];
    NSUInteger searchLength = [dataToFind length];
    NSUInteger searchIndex = 0;

    NSRange foundRange = {NSNotFound, searchLength};
    for (NSUInteger index = 0; index < length; index++) {
        if (((char *)bytes)[index] == ((char *)searchBytes)[searchIndex]) {
            //the current character matches
            if (foundRange.location == NSNotFound) {
                foundRange.location = index;
            }
            searchIndex++;
            if (searchIndex >= searchLength) { return foundRange; }
        } else {
            searchIndex = 0;
            foundRange.location = NSNotFound;
        }
    }
    return foundRange;
}

@end

@implementation DDFileReader
@synthesize lineDelimiter, chunkSize;

- (id) initWithFilePath:(NSString *)aPath {
    if (self = [super init]) {
        fileHandle = [NSFileHandle fileHandleForReadingAtPath:aPath];
        if (fileHandle == nil) {
            [self release];
            return nil;
        }

        lineDelimiter = [[NSString alloc] initWithString:@"\n"];
        [fileHandle retain];
        filePath = [aPath retain];
        currentOffset = 0ULL;
        chunkSize = 10;
        [fileHandle seekToEndOfFile];
        totalFileLength = [fileHandle offsetInFile];
        //we don't need to seek back, since readLine will do that.
    }
    return self;
}

- (void) dealloc {
    [fileHandle closeFile];
    [fileHandle release], fileHandle = nil;
    [filePath release], filePath = nil;
    [lineDelimiter release], lineDelimiter = nil;
    currentOffset = 0ULL;
    [super dealloc];
}

- (NSString *) readLine {
    if (currentOffset >= totalFileLength) { return nil; }

    NSData * newLineData = [lineDelimiter dataUsingEncoding:NSUTF8StringEncoding];
    [fileHandle seekToFileOffset:currentOffset];
    NSMutableData * currentData = [[NSMutableData alloc] init];
    BOOL shouldReadMore = YES;

    NSAutoreleasePool * readPool = [[NSAutoreleasePool alloc] init];
    while (shouldReadMore) {
        if (currentOffset >= totalFileLength) { break; }
        NSData * chunk = [fileHandle readDataOfLength:chunkSize];
        NSRange newLineRange = [chunk rangeOfData_dd:newLineData];
        if (newLineRange.location != NSNotFound) {

            //include the length so we can include the delimiter in the string
            chunk = [chunk subdataWithRange:NSMakeRange(0, newLineRange.location+[newLineData length])];
            shouldReadMore = NO;
        }
        [currentData appendData:chunk];
        currentOffset += [chunk length];
    }
    [readPool release];

    NSString * line = [[NSString alloc] initWithData:currentData encoding:NSUTF8StringEncoding];
    [currentData release];
    return [line autorelease];
}

- (NSString *) readTrimmedLine {
    return [[self readLine] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

#if NS_BLOCKS_AVAILABLE
- (void) enumerateLinesUsingBlock:(void(^)(NSString*, BOOL*))block {
  NSString * line = nil;
  BOOL stop = NO;
  while (stop == NO && (line = [self readTrimmedLine])) {
    block(line, &stop);
  }
}
#endif

@end
