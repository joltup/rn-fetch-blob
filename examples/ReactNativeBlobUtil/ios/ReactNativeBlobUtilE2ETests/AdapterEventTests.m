//
//  The adapter's event plumbing: what it says it sends, and in what shape.
//  And the view controller it hands the core to present the document menus from.
//
//  ReactNativeBlobUtil.h imports React, so it is private to the pod and cannot
//  be reached through the umbrella module the Swift tests import. The class is
//  linked into this bundle all the same, so the runtime finds it by name, and
//  the event protocol - which is Swift, and React-free - comes from the module.
//

#import <XCTest/XCTest.h>
#import <objc/runtime.h>

@import react_native_blob_util;

/// The parts of the adapter this file drives. Declaring them keeps the
/// selectors known to the compiler without importing the React-facing header.
@protocol RNBUAdapterProbe <NSObject>
- (NSArray<NSString *> *)supportedEvents;
- (void)startObserving;
- (void)sendEventWithName:(NSString *)name body:(id)body;
@end

static NSMutableArray *RecordedBodies = nil;

@interface AdapterEventTests : XCTestCase
@end

@implementation AdapterEventTests

- (id<RNBUAdapterProbe>)adapter {
    Class cls = NSClassFromString(@"ReactNativeBlobUtil");
    XCTAssertNotNil(cls, @"the module class is not linked into the test bundle");
    return (id<RNBUAdapterProbe>)[[cls alloc] init];
}

- (void)testSupportedEventsListsOnlyWhatIsSent {
    id<RNBUAdapterProbe> adapter = [self adapter];
    NSArray<NSString *> *events = [adapter supportedEvents];

    // Every name here is a name something actually emits. The list used to
    // carry "log", "warn", "error", "data" and "end", which are values of the
    // `event` field inside a filesystem payload rather than event names, and
    // "reportProgress"/"reportUploadProgress", which nothing has ever sent.
    NSArray<NSString *> *expected = @[
        @"ReactNativeBlobUtilState",
        @"ReactNativeBlobUtilServerPush",
        @"ReactNativeBlobUtilProgress",
        @"ReactNativeBlobUtilProgress-upload",
        @"ReactNativeBlobUtilMessage",
        @"ReactNativeBlobUtilFilesystem",
    ];
    XCTAssertEqualObjects([NSSet setWithArray:events], [NSSet setWithArray:expected]);
    XCTAssertEqual(events.count, expected.count, @"no duplicates");
}

/// The payload used to be serialised to a JSON *string*, so every listener had
/// to parse it before reading a field. It is sent as the dictionary now.
- (void)testEventsReachJSAsObjects {
    id<RNBUAdapterProbe> adapter = [self adapter];

    RecordedBodies = [NSMutableArray array];
    Method method = class_getInstanceMethod([adapter class], @selector(sendEventWithName:body:));
    XCTAssertTrue(method != NULL, @"the emitter method moved");
    IMP original = method_getImplementation(method);
    IMP replacement = imp_implementationWithBlock(^(id self_, NSString *name, id body) {
        [RecordedBodies addObject:@{@"name": name, @"body": body ?: [NSNull null]}];
    });
    method_setImplementation(method, replacement);

    @try {
        [adapter startObserving];
        NSDictionary *payload = @{@"streamId": @"s1", @"event": @"data", @"detail": @"chunk ✓"};
        [(id<ReactNativeBlobUtilEventSink>)adapter emitEventDict:@"ReactNativeBlobUtilFilesystem"
                                                           body:payload];

        XCTAssertEqual(RecordedBodies.count, 1UL);
        id sent = RecordedBodies.firstObject[@"body"];
        XCTAssertFalse([sent isKindOfClass:NSString.class], @"not a JSON string any more");
        XCTAssertTrue([sent isKindOfClass:NSDictionary.class]);
        XCTAssertEqualObjects(sent, payload, @"and the keys arrive untouched");
        XCTAssertEqualObjects(RecordedBodies.firstObject[@"name"], @"ReactNativeBlobUtilFilesystem");
    }
    @finally {
        method_setImplementation(method, original);
        RecordedBodies = nil;
    }
}

@end

#pragma mark - The controller the document menus present from

/// An app delegate without a `window`, as in React Native 0.88's template, which
/// keeps the window on a scene delegate.
@interface RNBUWindowlessAppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation RNBUWindowlessAppDelegate
@end

@interface AdapterPresentingTests : XCTestCase
@property (nonatomic, strong) id adapter;
@end

@implementation AdapterPresentingTests

- (UIViewController * _Nullable (^)(void))provider {
    Class cls = NSClassFromString(@"ReactNativeBlobUtil");
    XCTAssertNotNil(cls, @"the module class is not linked into the test bundle");
    self.adapter = [[cls alloc] init];
    id<ReactNativeBlobUtilModuleCoreBridge> core = [self.adapter valueForKey:@"core"];
    XCTAssertNotNil(core.presentingViewController, @"the adapter gives the core no provider");
    return core.presentingViewController;
}

/// The provider sent `window` to the app delegate, so with the UIScene life
/// cycle the first menu ended the app: "-[AppDelegate window]: unrecognized
/// selector sent to instance" (#498).
- (void)testTheProviderDoesNotAskTheAppDelegateForAWindow {
    UIViewController * _Nullable (^provider)(void) = [self provider];
    UIApplication *app = UIApplication.sharedApplication;
    id<UIApplicationDelegate> original = app.delegate;
    RNBUWindowlessAppDelegate *windowless = [RNBUWindowlessAppDelegate new];
    app.delegate = windowless;
    @try {
        XCTAssertNoThrow(provider());
    }
    @finally {
        app.delegate = original;
    }
}

/// The menus present from the controller on top. The provider returned the
/// window's root view controller, and UIKit does not present from a controller
/// that is already presenting one, so a menu opened over a modal screen did
/// nothing (#311).
- (void)testTheProviderReturnsTheControllerOnTop {
    UIWindow *key = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class]) {
            continue;
        }
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (window.isKeyWindow) {
                key = window;
            }
        }
    }
    if (key.rootViewController == nil) {
        XCTSkip(@"the test host has no key window with a root view controller");
    }
    UIViewController *top = key.rootViewController;
    while (top.presentedViewController != nil) {
        top = top.presentedViewController;
    }

    UIViewController *modal = [UIViewController new];
    XCTestExpectation *shown = [self expectationWithDescription:@"modal presented"];
    [top presentViewController:modal animated:NO completion:^{
        [shown fulfill];
    }];
    [self waitForExpectations:@[shown] timeout:5];
    @try {
        XCTAssertEqual([self provider](), modal);
    }
    @finally {
        XCTestExpectation *gone = [self expectationWithDescription:@"modal dismissed"];
        [modal dismissViewControllerAnimated:NO completion:^{
            [gone fulfill];
        }];
        [self waitForExpectations:@[gone] timeout:5];
    }
}

@end
