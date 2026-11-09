//
//  ReactNativeBlobUtilModuleCore, the logic that used to be in
//  ReactNativeBlobUtil.mm. Covers what runs without React or UI: the constants,
//  the plain forwards, and the two event payloads that previously had nowhere
//  to be observed, because `baseModule` was the concrete module class and there
//  was no way to hand it a recorder. It is a protocol now.
//

import XCTest
@testable import react_native_blob_util

/// Records what the layer emits, in order.
final class RecordingEventSink: NSObject, ReactNativeBlobUtilEventSink {
    private(set) var events: [(name: String, body: [AnyHashable: Any])] = []

    func emitEventDict(_ name: String, body: [AnyHashable: Any]) {
        events.append((name, body))
    }

    func bodies(for name: String) -> [[AnyHashable: Any]] {
        events.filter { $0.name == name }.map { $0.body }
    }
}

final class ModuleCoreTests: XCTestCase {

    private var core: ReactNativeBlobUtilModuleCore!
    private var sink: RecordingEventSink!
    private var dir = ""

    override func setUpWithError() throws {
        core = ReactNativeBlobUtilModuleCore()
        sink = RecordingEventSink()
        core.eventSink = sink
        dir = NSTemporaryDirectory().appending("rnbu-core-\(UUID().uuidString)")
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: dir)
    }

    private enum Settled {
        case resolved(Any?)
        case rejected(code: String?, message: String?)
    }

    /// Drives a resolve/reject pair and returns whichever fired.
    private func settle(_ run: (@escaping (Any?) -> Void, @escaping (String?, String?, Error?) -> Void) -> Void) throws -> Settled {
        let done = expectation(description: "settled")
        var outcome: Settled?
        run({ value in
            if outcome == nil { outcome = .resolved(value); done.fulfill() }
        }, { code, message, _ in
            if outcome == nil { outcome = .rejected(code: code, message: message); done.fulfill() }
        })
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(outcome)
    }

    private func rejection(_ s: Settled) -> (code: String?, message: String?)? {
        if case .rejected(let code, let message) = s { return (code, message) }
        return nil
    }

    private func callback(_ run: (@escaping ([Any]) -> Void) -> Void) throws -> [Any] {
        let done = expectation(description: "callback")
        var args: [Any]?
        var fired = false
        run({ values in
            if !fired { fired = true; args = values; done.fulfill() }
        })
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(args)
    }

    // MARK: - constants

    func testConstantsCarryEveryDirectoryKey() {
        let constants = ReactNativeBlobUtilModuleCore.constantsToExport()
        for key in ["CacheDir", "DocumentDir", "DownloadDir", "LibraryDir", "MainBundleDir",
                    "MovieDir", "MusicDir", "PictureDir", "ApplicationSupportDir"] {
            let value = try? XCTUnwrap(constants[key] as? String)
            XCTAssertFalse(value?.isEmpty ?? true, "\(key) must resolve to a path")
        }
    }

    /// Android-only keys are present and empty rather than absent: the New
    /// Architecture uses one spec for both platforms, so a missing key is a
    /// type error on the JS side.
    func testAndroidOnlyConstantsArePresentButEmpty() {
        let constants = ReactNativeBlobUtilModuleCore.constantsToExport()
        for key in ["RingtoneDir", "SDCardDir", "SDCardApplicationDir", "DCIMDir",
                    "LegacyDCIMDir", "LegacyPictureDir", "LegacyMusicDir",
                    "LegacyDownloadDir", "LegacyMovieDir", "LegacyRingtoneDir",
                    "LegacySDCardDir"] {
            XCTAssertEqual(constants[key] as? String, "", key)
        }
    }

    // MARK: - forwards


    func testExistsResolvesAnObject() throws {
        let path = "\(dir)/a.txt"
        try "x".write(toFile: path, atomically: true, encoding: .utf8)
        let result = try settle { resolve, reject in
            self.core.exists(path, resolve: resolve, reject: reject)
        }
        guard case .resolved(let value) = result else { return XCTFail("expected resolve") }
        let dict = try XCTUnwrap(value as? [String: Any])
        XCTAssertEqual(dict["exists"] as? Bool, true)
        XCTAssertEqual(dict["isDirectory"] as? Bool, false)
    }

    func testUnlinkResolvesAndIsIdempotent() throws {
        let path = "\(dir)/gone.txt"
        try "x".write(toFile: path, atomically: true, encoding: .utf8)
        _ = try settle { r, j in self.core.unlink(path, resolve: r, reject: j) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: path))
        // Removing a path that is already gone is still a success.
        let second = try settle { r, j in self.core.unlink(path, resolve: r, reject: j) }
        guard case .resolved = second else { return XCTFail("unlink of a missing path must resolve") }
    }

    func testRemoveSessionDeletesEveryPath() throws {
        let a = "\(dir)/a.txt", b = "\(dir)/b.txt"
        try "a".write(toFile: a, atomically: true, encoding: .utf8)
        try "b".write(toFile: b, atomically: true, encoding: .utf8)
        _ = try settle { r, j in self.core.removeSession([a, b], resolve: r, reject: j) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: a))
        XCTAssertFalse(FileManager.default.fileExists(atPath: b))
    }

    // Disposing a session over a path that is already gone used to reject
    // EUNSPECIFIED here. 1.0 skips it; BehaviourAlignmentTests pins both halves
    // of that - the skip, and the rejection that a real removal failure still
    // produces.

    func testCancelRequestForAnUnknownTaskResolves() throws {
        let result = try settle { r, j in
            self.core.cancelRequest("unknown-\(UUID().uuidString)", resolve: r, reject: j)
        }
        guard case .resolved = result else { return XCTFail("cancelling an unknown task must resolve") }
    }

    /// enableProgressReport for a task that does not exist parks the config
    /// rather than dropping it, so JS can register before the request starts.
    /// There is no route to this from the public API after a task settles, so
    /// it is covered here rather than by a parity case.
    func testEnableProgressReportForAnUnknownTaskParksTheConfig() {
        let taskId = "parked-\(UUID().uuidString)"
        let network = ReactNativeBlobUtilNetwork.sharedInstance()
        core.enableProgressReport(taskId, interval: 250, count: 10)
        XCTAssertNotNil(network.rebindProgressDict[taskId])
        XCTAssertNil(network.rebindUploadProgressDict[taskId], "the download table only")
        network.removeRequest(forTaskId: taskId)
    }

    func testEnableUploadProgressReportParksSeparately() {
        let taskId = "parked-upload-\(UUID().uuidString)"
        let network = ReactNativeBlobUtilNetwork.sharedInstance()
        core.enableUploadProgressReport(taskId, interval: 250, count: 10)
        XCTAssertNotNil(network.rebindUploadProgressDict[taskId])
        XCTAssertNil(network.rebindProgressDict[taskId])
        network.removeRequest(forTaskId: taskId)
    }


    // MARK: - the codes the 1.0 spec promises

    /// Writing to a stream id the registry does not know used to succeed
    /// silently, so a caller writing to a closed or mistyped stream got no
    /// signal at all. It rejects EBADF now.
    func testWritingToAnUnknownStreamRejectsEBADF() throws {
        let id = "no-such-stream-\(UUID().uuidString)"
        for (label, run) in [
            ("writeChunk", { (r: @escaping (Any?) -> Void, j: @escaping (String?, String?, Error?) -> Void) in
                self.core.writeChunk(id, withData: "x", resolve: r, reject: j) }),
            ("writeArrayChunk", { r, j in
                self.core.writeArrayChunk(id, withArray: [1], resolve: r, reject: j) }),
            ("closeStream", { r, j in
                self.core.closeStream(id, resolve: r, reject: j) }),
        ] {
            let error = try XCTUnwrap(rejection(try settle(run)), "\(label) should reject")
            XCTAssertEqual(error.code, "EBADF", label)
            XCTAssertEqual(error.message, "No such write stream '\(id)'", label)
        }
    }

    func testAKnownStreamStillResolves() throws {
        let path = "\(dir)/stream.txt"
        let opened = try settle { r, j in
            self.core.writeStream(path, withEncoding: "utf8", appendData: false, resolve: r, reject: j)
        }
        guard case .resolved(let value) = opened else { return XCTFail("expected a stream id") }
        let streamId = try XCTUnwrap(value as? String)
        XCTAssertFalse(streamId.isEmpty, "writeStream resolves the id itself now, not [null, null, id]")

        guard case .resolved = try settle({ r, j in
            self.core.writeChunk(streamId, withData: "hello", resolve: r, reject: j)
        }) else { return XCTFail("writeChunk should resolve") }
        guard case .resolved = try settle({ r, j in
            self.core.closeStream(streamId, resolve: r, reject: j)
        }) else { return XCTFail("closeStream should resolve") }
        XCTAssertEqual(try String(contentsOfFile: path, encoding: .utf8), "hello")
    }

    func testWriteStreamOntoADirectoryRejectsEISDIR() throws {
        let result = try settle { r, j in
            self.core.writeStream(self.dir, withEncoding: "utf8", appendData: false, resolve: r, reject: j)
        }
        let error = try XCTUnwrap(rejection(result))
        XCTAssertEqual(error.code, "EISDIR")
        XCTAssertEqual(error.message, "Expecting a file but '\(dir)' is a directory")
    }

    func testStatOnAMissingPathRejectsENOENT() throws {
        let missing = "\(dir)/missing.txt"
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.stat(missing, resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "ENOENT")
        XCTAssertEqual(error.message,
                       "failed to stat path `\(missing)` because it does not exist or it is not a folder")
    }

    func testLstatOnAMissingPathRejectsENOENT() throws {
        let missing = "\(dir)/missing.txt"
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.lstat(missing, resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "ENOENT")
    }

    /// A missing source is ENOENT rather than the catch-all, so a caller can
    /// tell "no such file" from a real copy failure.
    func testCopyingAMissingSourceRejectsENOENT() throws {
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.cp("\(self.dir)/missing.txt", dest: "\(self.dir)/out.txt", resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "ENOENT")
    }

    func testMovingAMissingSourceRejectsENOENT() throws {
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.mv("\(self.dir)/missing.txt", dest: "\(self.dir)/out.txt", resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "ENOENT")
    }

    /// Data that does not decode was a nil body, and creating a file with a nil
    /// body makes an empty one: the call resolved, and the file held none of
    /// what was asked for. writeFile rejects the same data with EINVAL.
    func testCreateFileFromInvalidBase64RejectsEINVAL() throws {
        for (name, data) in [("symbols.bin", "@@@@"), ("data-url.png", "data:image/png;base64,iVBORw0KGgo=")] {
            let path = "\(dir)/\(name)"
            let error = try XCTUnwrap(rejection(try settle { r, j in
                self.core.createFile(path, data: data, encoding: "base64", resolve: r, reject: j)
            }), "createFile from \(data) should reject")
            XCTAssertEqual(error.code, "EINVAL", data)
            XCTAssertEqual(error.message, "Data for '\(path)' is not valid base64", data)
            XCTAssertFalse(FileManager.default.fileExists(atPath: path), "and no empty file is left behind")
        }
    }

    /// An existing file still reports EEXIST first, as it did before the data
    /// was checked, and keeps its contents.
    func testCreateFileOntoAnExistingFileWithInvalidBase64RejectsEEXIST() throws {
        let path = "\(dir)/existing.bin"
        try "kept".write(toFile: path, atomically: true, encoding: .utf8)
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.createFile(path, data: "@@@@", encoding: "base64", resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "EEXIST")
        XCTAssertEqual(try String(contentsOfFile: path, encoding: .utf8), "kept")
    }

    func testCreateFileFromBase64WritesTheDecodedBytes() throws {
        let path = "\(dir)/bytes.bin"
        guard case .resolved = try settle({ r, j in
            self.core.createFile(path, data: "AAEC/w==", encoding: "base64", resolve: r, reject: j)
        }) else { return XCTFail("createFile from valid base64 should resolve") }
        XCTAssertEqual(FileManager.default.contents(atPath: path), Data([0x00, 0x01, 0x02, 0xff]))
    }

    // Copying onto an existing destination used to reject EUNSPECIFIED. 1.0
    // overwrites instead, so the pin moved to BehaviourAlignmentTests with the
    // rest of the aligned behaviour; the two rejections above still hold,
    // because a missing source is a different failure from a busy destination.

    func testScanFileRejectsAsAndroidOnly() throws {
        let error = try XCTUnwrap(rejection(try settle { r, j in
            self.core.scanFile([], resolve: r, reject: j)
        }))
        XCTAssertEqual(error.code, "ENOTSUP")
        XCTAssertEqual(error.message, "scanFile is only available on Android")
    }

    func testDfResolvesTheUsageDictionary() throws {
        let result = try settle { r, j in self.core.df(r, reject: j) }
        guard case .resolved(let value) = result else { return XCTFail("df should resolve") }
        let usage = try XCTUnwrap(value as? [String: Any])
        XCTAssertEqual(Set(usage.keys), ["free", "total"])
    }

    // MARK: - the event payloads

    /// The upload progress payload, which had nowhere to be observed before the
    /// sink became a protocol. tests/fixtures/native-payloads/progress-event.json
    /// records the shape: written and total arrive as numbers, not strings.
    func testUploadProgressPayloadCarriesNumbers() throws {
        let request = ReactNativeBlobUtilRequest()
        request.taskId = "upload-1"
        request.baseModule = sink
        request.uploadProgressConfig = ReactNativeBlobUtilProgress(type: .upload, interval: 0, count: 0)

        request.urlSession(URLSession.shared,
                           task: URLSession.shared.dataTask(with: URL(string: "https://example.com")!),
                           didSendBodyData: 50, totalBytesSent: 50, totalBytesExpectedToSend: 100)

        let bodies = sink.bodies(for: ReactNativeBlobUtilConst.eventProgressUpload)
        let body = try XCTUnwrap(bodies.first, "an upload progress event should have been emitted")
        XCTAssertEqual(body["taskId"] as? String, "upload-1")
        XCTAssertTrue(body["written"] is NSNumber, "written is a number, per the fixture")
        XCTAssertTrue(body["total"] is NSNumber, "total is a number, per the fixture")
        XCTAssertEqual((body["written"] as? NSNumber)?.int64Value, 50)
        XCTAssertEqual((body["total"] as? NSNumber)?.int64Value, 100)
    }

    func testUploadProgressIsSuppressedWhenTheTotalIsUnknown() {
        let request = ReactNativeBlobUtilRequest()
        request.taskId = "upload-2"
        request.baseModule = sink
        request.uploadProgressConfig = ReactNativeBlobUtilProgress(type: .upload, interval: 0, count: 0)

        request.urlSession(URLSession.shared,
                           task: URLSession.shared.dataTask(with: URL(string: "https://example.com")!),
                           didSendBodyData: 10, totalBytesSent: 10, totalBytesExpectedToSend: 0)

        XCTAssertTrue(sink.bodies(for: ReactNativeBlobUtilConst.eventProgressUpload).isEmpty,
                      "a zero total would divide by zero, so nothing is reported")
    }

    func testDownloadProgressPayloadCarriesNumbers() throws {
        let request = ReactNativeBlobUtilRequest()
        request.taskId = "download-1"
        request.baseModule = sink
        request.progressConfig = ReactNativeBlobUtilProgress(type: .download, interval: 0, count: 0)

        let session = URLSession.shared
        request.urlSession(session,
                           downloadTask: session.downloadTask(with: URL(string: "https://example.com")!),
                           didWriteData: 25, totalBytesWritten: 25, totalBytesExpectedToWrite: 100)

        let body = try XCTUnwrap(sink.bodies(for: ReactNativeBlobUtilConst.eventProgress).first)
        XCTAssertTrue(body["written"] is NSNumber)
        XCTAssertTrue(body["total"] is NSNumber)
        XCTAssertEqual((body["written"] as? NSNumber)?.int64Value, 25)
    }
}
