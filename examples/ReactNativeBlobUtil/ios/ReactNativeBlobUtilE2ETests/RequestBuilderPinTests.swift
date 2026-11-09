//
//  Pins ReactNativeBlobUtilReqBuilder and the bookkeeping half of
//  ReactNativeBlobUtilNetwork before they are ported to Swift, the same way
//  54b449c pinned the file system layer.
//
//  Only what runs without a live session is covered here. Everything in
//  ReactNativeBlobUtilRequest needs a real NSURLSession and is covered by the
//  network, tls and parity e2e scenarios instead.
//
//  These assert what the Objective-C does today, including the parts that are
//  odd. Where a value is odd rather than wrong, the assertion says so.
//

import XCTest
@testable import react_native_blob_util

final class RequestBuilderPinTests: XCTestCase {

    private var dir = ""

    override func setUpWithError() throws {
        dir = NSTemporaryDirectory().appending("rnbu-req-pin-\(UUID().uuidString)")
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: dir)
    }

    /// Both builders finish on a background queue, so every case waits.
    private func buildOctet(method: String,
                            url: String = "http://127.0.0.1:19076/echo",
                            headers: [String: Any] = [:],
                            body: String?,
                            options: [String: Any] = [:]) throws -> (URLRequest?, Int) {
        let done = expectation(description: "octet")
        var out: (URLRequest?, Int)?
        var fired = false
        ReactNativeBlobUtilReqBuilder.buildOctetRequest(options, taskId: "t", method: method,
                                                        url: url, headers: headers, body: body) { req, length in
            if !fired { fired = true; out = (req as URLRequest?, length); done.fulfill() }
        }
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(out)
    }

    private func buildMultipart(form: [[String: Any]],
                                headers: [String: Any] = [:]) throws -> (URLRequest?, Int) {
        let done = expectation(description: "multipart")
        var out: (URLRequest?, Int)?
        var fired = false
        ReactNativeBlobUtilReqBuilder.buildMultipartRequest([:], taskId: "t", method: "POST",
                                                            url: "http://127.0.0.1:19076/echo",
                                                            headers: headers, form: form) { req, length in
            if !fired { fired = true; out = (req as URLRequest?, length); done.fulfill() }
        }
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(out)
    }

    // MARK: - header helpers

    func testNormalizeHeadersLowercasesEveryKey() throws {
        let normalized = try XCTUnwrap(
            ReactNativeBlobUtilNetwork.normalizeHeaders(["Content-Type": "text/plain", "X-Mixed-Case": "1"])
        )
        XCTAssertEqual(normalized["content-type"] as? String, "text/plain")
        XCTAssertEqual(normalized["x-mixed-case"] as? String, "1")
        XCTAssertNil(normalized["Content-Type"], "the original casing is not kept")
    }

    func testGetHeaderIgnoreCasesPrefersTheExactKey() {
        let headers = ["Content-Type": "exact", "content-type": "lowered"]
        XCTAssertEqual(ReactNativeBlobUtilReqBuilder.getHeaderIgnoreCases("Content-Type", fromHeaders: headers), "exact")
    }

    func testGetHeaderIgnoreCasesFallsBackToLowercase() {
        XCTAssertEqual(ReactNativeBlobUtilReqBuilder.getHeaderIgnoreCases("Content-Type",
                                                                          fromHeaders: ["content-type": "lowered"]),
                       "lowered")
    }

    func testGetHeaderIgnoreCasesReturnsNilWhenAbsent() {
        XCTAssertNil(ReactNativeBlobUtilReqBuilder.getHeaderIgnoreCases("X-Nope", fromHeaders: [:]))
    }

    // MARK: - octet requests

    func testGetRequestCarriesNoBodyAndReportsMinusOne() throws {
        let (request, length) = try buildOctet(method: "GET", body: "ignored")
        let req = try XCTUnwrap(request)
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertNil(req.httpBody, "only POST, PUT and PATCH build a body")
        XCTAssertEqual(length, -1, "the untouched size is -1, not 0")
    }

    func testPostWithoutAContentTypeDefaultsToOctetStream() throws {
        let (request, _) = try buildOctet(method: "POST", body: "YWJj")
        let req = try XCTUnwrap(request)
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
    }

    /// An octet content type means the body is base64.
    func testPostWithOctetContentTypeDecodesBase64() throws {
        let (request, length) = try buildOctet(method: "POST",
                                               headers: ["content-type": "application/octet-stream"],
                                               body: "YWJj")
        let req = try XCTUnwrap(request)
        XCTAssertEqual(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8), "abc")
        XCTAssertEqual(length, 3)
    }

    /// Column-wrapped base64 still decodes: options are
    /// NSDataBase64DecodingIgnoreUnknownCharacters, so the newlines are skipped.
    func testPostDecodesBase64ThatIsWrappedAcrossLines() throws {
        let wrapped = "YWJj\nZGVm\n"
        let (request, _) = try buildOctet(method: "POST",
                                          headers: ["content-type": "application/octet-stream"],
                                          body: wrapped)
        let req = try XCTUnwrap(request)
        XCTAssertEqual(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8), "abcdef")
    }

    /// A ";base64" suffix marks the body as base64 and is stripped from the
    /// header that goes out.
    func testPostStripsTheBase64SuffixFromTheContentType() throws {
        let (request, _) = try buildOctet(method: "POST",
                                          headers: ["content-type": "text/plain;base64"],
                                          body: "YWJj")
        let req = try XCTUnwrap(request)
        XCTAssertEqual(req.value(forHTTPHeaderField: "content-type"), "text/plain")
        XCTAssertEqual(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8), "abc")
    }

    /// Any other content type sends the body as-is.
    func testPostWithATextContentTypeSendsTheBodyVerbatim() throws {
        let (request, length) = try buildOctet(method: "POST",
                                               headers: ["content-type": "text/plain"],
                                               body: "hello")
        let req = try XCTUnwrap(request)
        XCTAssertEqual(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8), "hello")
        XCTAssertEqual(length, 5, "the length is the string's length, not its byte count")
    }

    func testPutAndPatchBuildABodyToo() throws {
        for method in ["PUT", "PATCH"] {
            let (request, _) = try buildOctet(method: method,
                                              headers: ["content-type": "text/plain"],
                                              body: "x")
            XCTAssertNotNil(try XCTUnwrap(request).httpBody, "\(method) builds a body")
        }
    }

    func testPostReadsABodyGivenAsAFilePath() throws {
        let path = "\(dir)/payload.txt"
        try "from disk".write(toFile: path, atomically: true, encoding: .utf8)
        let (request, length) = try buildOctet(method: "POST",
                                               headers: ["content-type": "text/plain"],
                                               body: ReactNativeBlobUtilConst.filePrefix + path)
        let req = try XCTUnwrap(request)
        XCTAssertEqual(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8), "from disk")
        XCTAssertEqual(length, 9, "the length comes from the file's size")
    }

    /// transfer-encoding: chunked streams the file rather than loading it.
    func testChunkedTransferEncodingUsesABodyStream() throws {
        let path = "\(dir)/streamed.txt"
        try "streamed".write(toFile: path, atomically: true, encoding: .utf8)
        let (request, _) = try buildOctet(method: "POST",
                                          headers: ["content-type": "text/plain",
                                                    "transfer-encoding": "chunked"],
                                          body: ReactNativeBlobUtilConst.filePrefix + path)
        let req = try XCTUnwrap(request)
        XCTAssertNotNil(req.httpBodyStream, "a chunked body is streamed")
        XCTAssertNil(req.httpBody, "and not loaded into memory")
    }

    // MARK: - multipart requests

    func testMultipartSetsTheBoundaryContentLengthAndExpectHeaders() throws {
        let (request, _) = try buildMultipart(form: [["name": "field", "data": "value"]])
        let req = try XCTUnwrap(request)
        let contentType = try XCTUnwrap(req.value(forHTTPHeaderField: "content-type"))
        XCTAssertTrue(contentType.hasPrefix("multipart/form-data; boundary=ReactNativeBlobUtil"), contentType)
        XCTAssertEqual(req.value(forHTTPHeaderField: "Expect"), "100-continue")
        XCTAssertNotNil(req.value(forHTTPHeaderField: "Content-Length"))
        XCTAssertEqual(req.httpMethod, "POST")
    }

    func testMultipartWritesATextFieldWithItsDefaultContentType() throws {
        let (request, _) = try buildMultipart(form: [["name": "field", "data": "value"]])
        let body = try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
        XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"field\""), body)
        XCTAssertTrue(body.contains("Content-Type: text/plain"), "a text field defaults to text/plain")
        XCTAssertTrue(body.contains("\r\nvalue\r\n"), body)
    }

    /// A field with a filename is a file part, and its data is base64.
    func testMultipartDecodesABase64FilePart() throws {
        let (request, _) = try buildMultipart(form: [
            ["name": "upload", "filename": "bytes.bin", "data": "YWJj"],
        ])
        let body = try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
        XCTAssertTrue(body.contains("filename=\"bytes.bin\""), body)
        XCTAssertTrue(body.contains("Content-Type: application/octet-stream"), "a file part defaults to octet-stream")
        XCTAssertTrue(body.contains("abc"), "the base64 is decoded into the part")
    }

    /// Undecodable base64 leaves the part empty rather than dropping it, and
    /// warns. ceb4247 fixed the Android side of the same case.
    func testMultipartKeepsAPartWhoseBase64IsInvalid() throws {
        let (request, _) = try buildMultipart(form: [
            ["name": "bad", "filename": "bad.bin", "data": "@@@@"],
            ["name": "good", "data": "kept"],
        ])
        let body = try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
        XCTAssertTrue(body.contains("name=\"bad\""), "the part still goes out, with an empty body")
        XCTAssertTrue(body.contains("name=\"good\""), "and the fields after it survive")
    }

    func testMultipartReadsAFilePartFromDisk() throws {
        let path = "\(dir)/part.txt"
        try "on disk".write(toFile: path, atomically: true, encoding: .utf8)
        let (request, _) = try buildMultipart(form: [
            ["name": "upload", "filename": "part.txt", "data": ReactNativeBlobUtilConst.filePrefix + path],
        ])
        let body = try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
        XCTAssertTrue(body.contains("on disk"), body)
    }

    // MARK: - bodyType and kind (1.0): JS says what a body is, the builder obeys

    private func bodyText(_ request: URLRequest?) throws -> String {
        try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
    }

    /// Without a Content-Type the old rule added application/octet-stream and
    /// then decoded the string as base64. With bodyType text it is sent as it
    /// is, and no Content-Type is invented (JS always sends one now).
    func testBodyTypeTextIsSentAsItIsWithoutAnInventedContentType() throws {
        let (request, _) = try buildOctet(method: "POST", body: "plain body", options: ["bodyType": "text"])
        XCTAssertEqual(try bodyText(request), "plain body")
        XCTAssertNil(try XCTUnwrap(request).value(forHTTPHeaderField: "Content-Type"))
    }

    func testBodyTypeTextIsNeverReadAsAFileOrAsBase64() throws {
        let looksLikeAFile = ReactNativeBlobUtilConst.filePrefix + "/etc/hosts"
        let (fileLike, _) = try buildOctet(method: "POST", headers: ["content-type": "application/octet-stream"],
                                           body: looksLikeAFile, options: ["bodyType": "text"])
        XCTAssertEqual(try bodyText(fileLike), looksLikeAFile)
    }

    func testBodyTypeBase64IsDecodedWhateverTheContentType() throws {
        let (request, length) = try buildOctet(method: "POST", headers: ["content-type": "text/plain"],
                                               body: "YWJj", options: ["bodyType": "base64"])
        XCTAssertEqual(try bodyText(request), "abc")
        XCTAssertEqual(length, 3)
    }

    func testBodyTypeFileReadsTheFile() throws {
        let path = "\(dir)/explicit.txt"
        try "explicit".write(toFile: path, atomically: true, encoding: .utf8)
        let (request, _) = try buildOctet(method: "PUT", headers: ["content-type": "text/plain"],
                                          body: ReactNativeBlobUtilConst.filePrefix + path, options: ["bodyType": "file"])
        XCTAssertEqual(try bodyText(request), "explicit")
    }

    /// DELETE and OPTIONS dropped their body; with bodyType any method but GET/HEAD sends it.
    func testDeleteSendsItsBodyWhenJSSaysWhatItIs() throws {
        let (request, _) = try buildOctet(method: "DELETE", headers: ["content-type": "text/plain"],
                                          body: "delete body", options: ["bodyType": "text"])
        XCTAssertEqual(try bodyText(request), "delete body")
    }

    /// A missing file used to go out as an empty body.
    func testAMissingFileBodyIsReported() {
        let missing = "\(dir)/missing.txt"
        XCTAssertEqual(ReactNativeBlobUtilReqBuilder.missingFileBody(["bodyType": "file"],
                                                                   body: ReactNativeBlobUtilConst.filePrefix + missing), missing)
        XCTAssertNil(ReactNativeBlobUtilReqBuilder.missingFileBody(["bodyType": "text"],
                                                                 body: ReactNativeBlobUtilConst.filePrefix + missing))
    }

    func testMultipartKindDecidesTheContentNotTheFilename() throws {
        let (request, _) = try buildMultipart(form: [
            ["name": "base64NoName", "data": "YWJj", "kind": "base64"],
            ["name": "textWithName", "filename": "t.txt", "type": "text/plain", "data": "YWJj", "kind": "text"],
        ])
        let body = try bodyText(request)
        XCTAssertTrue(body.contains("name=\"base64NoName\"\r\nContent-Type: text/plain\r\n\r\nabc\r\n"), body)
        XCTAssertTrue(body.contains("filename=\"t.txt\"\r\nContent-Type: text/plain\r\n\r\nYWJj\r\n"), body)
    }

    func testMultipartHonoursAnExplicitPartContentType() throws {
        let (request, _) = try buildMultipart(form: [
            ["name": "json", "data": "{}", "type": "application/json"],
        ])
        let body = try XCTUnwrap(String(data: try XCTUnwrap(try XCTUnwrap(request).httpBody), encoding: .utf8))
        XCTAssertTrue(body.contains("Content-Type: application/json"), body)
    }

    // MARK: - the warnings a JS developer has to see

    /// 63bd089 made the multipart builder say something when a field's base64
    /// could not be decoded, and the older case says something when a field has
    /// no name or data. Both went through RCTLogWarn, so they reach the JS
    /// console and LogBox. Reaching only the device log would lose the point of
    /// that commit, so these assert the exact text arrives at the handler the
    /// adapter installs.
    private func captureWarnings(_ run: () throws -> Void) rethrows -> [String] {
        var captured: [String] = []
        let previous = ReactNativeBlobUtilLog.warningHandler
        ReactNativeBlobUtilLog.warningHandler = { captured.append($0) }
        defer { ReactNativeBlobUtilLog.warningHandler = previous }
        try run()
        return captured
    }

    /// "A" rather than "@@@@": with .ignoreUnknownCharacters, a string of
    /// characters that are all ignored decodes to *empty* data, not nil, so it
    /// never reaches the warning. A lone valid character cannot form a group and
    /// does fail. Measured, after "@@@@" produced no warning at all.
    func testUndecodableBase64WarnsWithTheFieldName() throws {
        let warnings = try captureWarnings {
            _ = try buildMultipart(form: [
                ["name": "bad", "filename": "bad.bin", "data": "A"],
            ])
        }
        XCTAssertEqual(warnings, [
            "ReactNativeBlobUtil multipart request builder could not decode the `data` of field `bad` as base64, the field will be sent with an empty body.",
        ])
    }

    func testAFieldWithoutNameOrDataWarnsOnce() throws {
        let warnings = try captureWarnings {
            _ = try buildMultipart(form: [
                ["filename": "nameless.bin", "data": "YWJj"],
                ["name": "good", "data": "kept"],
            ])
        }
        XCTAssertEqual(warnings, [
            "ReactNativeBlobUtil multipart request builder has found a field without `data` or `name` property, the field will be removed implicitly.",
        ])
    }

    // MARK: - network bookkeeping

    func testSharedInstanceIsASingleton() {
        XCTAssertTrue(ReactNativeBlobUtilNetwork.sharedInstance() === ReactNativeBlobUtilNetwork.sharedInstance())
    }

    func testTaskQueueKeepsItsConfiguredLimits() throws {
        let queue = try XCTUnwrap(ReactNativeBlobUtilNetwork.sharedInstance()).taskQueue
        // This queue is the NSURLSession delegate queue, so these values decide
        // how delegate callbacks interleave. Changing them changes observable
        // ordering.
        XCTAssertEqual(queue.maxConcurrentOperationCount, 10)
        XCTAssertEqual(queue.qualityOfService, .utility)
    }

    /// Progress config that arrives before the task exists is parked and applied
    /// when the task registers, so JS can call enableProgressReport first.
    func testProgressConfigForAnUnknownTaskIsParkedForLater() throws {
        let network = try XCTUnwrap(ReactNativeBlobUtilNetwork.sharedInstance())
        let taskId = "pin-\(UUID().uuidString)"
        let config = ReactNativeBlobUtilProgress(type: .download, interval: 100, count: 0)

        network.enableProgressReport(taskId, config: config)
        XCTAssertNotNil(network.rebindProgressDict[taskId], "parked until the task appears")

        network.removeRequest(forTaskId: taskId)
        XCTAssertNil(network.rebindProgressDict[taskId], "and cleared when the task is removed")
    }

    func testUploadProgressConfigIsParkedSeparately() throws {
        let network = try XCTUnwrap(ReactNativeBlobUtilNetwork.sharedInstance())
        let taskId = "pin-upload-\(UUID().uuidString)"
        let config = ReactNativeBlobUtilProgress(type: .upload, interval: 100, count: 0)

        network.enableUploadProgress(taskId, config: config)
        XCTAssertNotNil(network.rebindUploadProgressDict[taskId])
        XCTAssertNil(network.rebindProgressDict[taskId], "the two tables are independent")

        network.removeRequest(forTaskId: taskId)
        XCTAssertNil(network.rebindUploadProgressDict[taskId])
    }

    func testCancellingAnUnknownTaskIsHarmless() throws {
        let network = try XCTUnwrap(ReactNativeBlobUtilNetwork.sharedInstance())
        network.cancelRequest("no-such-task-\(UUID().uuidString)")
    }

    // MARK: - the exact multipart body

    /// The whole body for a one-field form, byte for byte. Everything except the
    /// boundary is fixed, and the boundary is masked in the parity signatures
    /// because it is derived from a timestamp.
    func testMultipartBodyForASingleTextFieldIsExact() throws {
        let (request, _) = try buildMultipart(form: [["name": "field", "data": "value"]])
        let req = try XCTUnwrap(request)
        let body = try XCTUnwrap(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8))
        let contentType = try XCTUnwrap(req.value(forHTTPHeaderField: "content-type"))
        let boundary = String(contentType.dropFirst("multipart/form-data; boundary=".count))

        XCTAssertEqual(body, [
            "--\(boundary)\r\n",
            "Content-Disposition: form-data; name=\"field\"\r\n",
            "Content-Type: text/plain\r\n\r\n",
            "value\r\n",
            "--\(boundary)--\r\n",
        ].joined())

        // Content-Length is set after the closing delimiter is appended, so it
        // covers the whole body.
        let declared = Int(try XCTUnwrap(req.value(forHTTPHeaderField: "Content-Length")))
        XCTAssertEqual(declared, body.utf8.count)

        // Deliberately not asserting an absolute number: it would encode the
        // digit count of the boundary, which is derived from a timestamp and is
        // masked in the parity signatures. The structure above is the contract.
    }

    private func multipartBody(form: [[String: Any]]) throws -> (body: String, boundary: String) {
        let (request, _) = try buildMultipart(form: form)
        let req = try XCTUnwrap(request)
        let body = try XCTUnwrap(String(data: try XCTUnwrap(req.httpBody), encoding: .utf8))
        let contentType = try XCTUnwrap(req.value(forHTTPHeaderField: "content-type"))
        return (body, String(contentType.dropFirst("multipart/form-data; boundary=".count)))
    }

    /// An empty form read form[0] and trapped, which ends the app in a release
    /// build too (#197). It sends the closing delimiter alone, as Android does.
    func testMultipartWithAnEmptyFormSendsOnlyTheClosingDelimiter() throws {
        let (body, boundary) = try multipartBody(form: [])
        XCTAssertEqual(body, "--\(boundary)--\r\n")
    }

    /// A field without `name` or `data` is skipped. Skipping the last field
    /// stepped past the end of the form without a bounds check and trapped.
    func testMultipartSkipsALastFieldWithoutANameOrData() throws {
        for orphan: [String: Any] in [["data": "no name"], ["name": "no data"]] {
            let (body, boundary) = try multipartBody(form: [["name": "field", "data": "value"], orphan])
            XCTAssertEqual(body, [
                "--\(boundary)\r\n",
                "Content-Disposition: form-data; name=\"field\"\r\n",
                "Content-Type: text/plain\r\n\r\n",
                "value\r\n",
                "--\(boundary)--\r\n",
            ].joined(), "\(orphan)")
        }
    }

    // MARK: - the TLS trust decision

    /// The trust decision is an instance method on the request, driven by its
    /// `options`. A synthesized challenge reaches every branch that does not
    /// need a real SecTrust.
    private func challenge(host: String,
                           method: String = NSURLAuthenticationMethodServerTrust) -> URLAuthenticationChallenge {
        let space = URLProtectionSpace(host: host, port: 443, protocol: "https",
                                       realm: nil, authenticationMethod: method)
        return URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil,
                                          previousFailureCount: 0, failureResponse: nil,
                                          error: nil, sender: RecordingChallengeSender())
    }

    private func decide(options: [String: Any],
                        host: String = "localhost",
                        method: String = NSURLAuthenticationMethodServerTrust)
        throws -> URLSession.AuthChallengeDisposition {
        let request = ReactNativeBlobUtilRequest()
        request.options = options
        let done = expectation(description: "challenge")
        var disposition: URLSession.AuthChallengeDisposition?
        var fired = false
        request.urlSession(URLSession.shared,
                           didReceive: challenge(host: host, method: method)) { result, _ in
            if !fired { fired = true; disposition = result; done.fulfill() }
        }
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(disposition)
    }

    /// trusty used to answer every server-trust challenge with .useCredential
    /// without evaluating anything. It now accepts a certificate whatever issued
    /// it, but only for its own host and only while it is valid.
    func testTrustyAcceptsASelfSignedCertificateForItsHost() throws {
        let disposition = try decideWithRealTrust(options: ["trusty": true], host: "localhost",
                                                  pem: Self.trustyLeafPEM, at: Self.insideValidity)
        XCTAssertEqual(disposition, .useCredential)
    }

    func testTrustyRefusesACertificateForAnotherHost() throws {
        let disposition = try decideWithRealTrust(options: ["trusty": true], host: "example.com",
                                                  pem: Self.trustyLeafPEM, at: Self.insideValidity)
        XCTAssertEqual(disposition, .cancelAuthenticationChallenge)
    }

    func testTrustyRefusesAnExpiredCertificate() throws {
        let disposition = try decideWithRealTrust(options: ["trusty": true], host: "localhost",
                                                  pem: Self.trustyLeafPEM, at: Self.afterValidity)
        XCTAssertEqual(disposition, .cancelAuthenticationChallenge)
    }

    func testTrustyLeavesANonServerTrustChallengeAlone() throws {
        XCTAssertEqual(try decide(options: ["trusty": true], method: NSURLAuthenticationMethodHTTPBasic),
                       .performDefaultHandling)
    }

    /// A pinned host written with capitals never matched the lower-case host,
    /// which quietly meant system trust instead of the custom CA.
    func testPinnedHostsMatchCaseInsensitively() throws {
        let disposition = try decideWithRealTrust(options: [
            "customCACerts": ["missing_name"],
            "pinnedHosts": ["LOCALHOST"],
        ], host: "localhost")
        XCTAssertEqual(disposition, .cancelAuthenticationChallenge,
                       "localhost is pinned, so the unloadable cert must refuse")
    }

    /// A self-signed certificate for localhost, valid 2026-09-23 to 2028-08-23.
    /// The trust is evaluated at a fixed date, so the test never goes stale.
    private static let trustyLeafPEM = """
        -----BEGIN CERTIFICATE-----
        MIIDMTCCAhmgAwIBAgIUNgVSzyX+mXD1oI5Xf2H8s7y7aHQwDQYJKoZIhvcNAQEL
        BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDkyMzAwNTEyOVoXDTI4MDgy
        MzAwNTEyOVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
        AAOCAQ8AMIIBCgKCAQEAnJOiNWWML0pzCKqeuThwiUYn28bAzRk/xIF5gE0BdXCa
        WwIbVyfYroFT3pjnLzeemkJuUCoZ06bo8oVLOuNPGwRNxddRyJvQX3enjupyjG3u
        f8QECRl6s8DprAuDP7SYVrvWmYyIlHZAC65bJOIWyL40lqBPFpdELisze0SLoTXd
        JSO2Yb7FIZqE1mqfveUxw/lSZlLQJf/s3sdnxniqAWF6uA/n/nB06ZDCO4sEWROZ
        mdbC66f1WIPwAv7wJ+OU0SpGAO7NsInO7xtjthTYl2evbcHWl9eOTMzZrwQJV67i
        d6xqEwmIt31Y7wg9ZUlvN8qwnVL/Kzn/P+2g3+mv1wIDAQABo3sweTAdBgNVHQ4E
        FgQUk3NSf5lRFNzxDPWEdAtc/RtB61cwHwYDVR0jBBgwFoAUk3NSf5lRFNzxDPWE
        dAtc/RtB61cwFAYDVR0RBA0wC4IJbG9jYWxob3N0MBMGA1UdJQQMMAoGCCsGAQUF
        BwMBMAwGA1UdEwEB/wQCMAAwDQYJKoZIhvcNAQELBQADggEBAEac2yS5xIRb2sg/
        Ol9B6ZuqSGZ9Fv3PKEarvBS77+LU5SHgWXeLWo4aKTnIZx/zz4U1D7sEOD1SavPW
        dV7tjxF6GB5y67zE1fqiDTMROssBBNYXUdXvP3owAk3rZ39KsPTzXu/DbjSB9hs8
        WJdFYEMIUll8UD9mv7C/Vu88sEQ0g5WJUEWThDtuHOv6m6MRaHds+QnQLYjCP5wf
        ktolqy+ThtM5UhXusKP9Syu/V7sC74b60h3gjhSCkIyr9NtIwLopU9ERZtd5gpVS
        kRmdh7ziZhW3D9nXxpBRXNa2FRnkcGv3B4MVxahRK5I+0FsCHn/jRlSWmWoguKys
        4rAh8q4=
        -----END CERTIFICATE-----
        """
    private static let insideValidity = Date(timeIntervalSince1970: 1_800_000_000) // 2027-01-15
    private static let afterValidity = Date(timeIntervalSince1970: 1_900_000_000)  // 2030-03-17

    /// pinnedHosts scopes customCACerts to the hosts it names.
    ///
    /// This asserts the disposition, but it cannot tell the two routes to it
    /// apart: without a real handshake there is no SecTrust, and the guard for
    /// that returns performDefaultHandling too. Measured - making the scoping
    /// ignore the host entirely still passes this test. **tls-wrong-pin in the
    /// e2e suite is what actually pins the scoping rule**; this only catches a
    /// change that reaches a different disposition.
    func testCustomCertsAreIgnoredForAHostThatIsNotPinned() throws {
        let disposition = try decide(options: [
            "customCACerts": ["test_ca"],
            "pinnedHosts": ["example.com"],
        ], host: "localhost")
        XCTAssertEqual(disposition, .performDefaultHandling)
    }

    func testCustomCertsApplyToAPinnedHost() throws {
        // The host matches, so the pinned-host gate opens and evaluation is
        // attempted. Without a real handshake there is no SecTrust, and the
        // guard for that returns default handling - which is as far as a unit
        // test reaches. The refusal path itself is covered by the tls scenario.
        let disposition = try decide(options: [
            "customCACerts": ["test_ca"],
            "pinnedHosts": ["localhost"],
        ], host: "localhost")
        XCTAssertEqual(disposition, .performDefaultHandling)
    }

    /// customCACerts only applies to a server-trust challenge. Anything else -
    /// basic auth, a client certificate request - is left alone.
    func testCustomCertsAreIgnoredForANonServerTrustChallenge() throws {
        let disposition = try decide(options: ["customCACerts": ["test_ca"]],
                                     method: NSURLAuthenticationMethodHTTPBasic)
        XCTAssertEqual(disposition, .performDefaultHandling)
    }

    // MARK: - malformed trust options must still fail closed

    /// A protection space carrying a real SecTrust, which is what the custom-CA
    /// branch needs before it will do anything. Built from the CA the e2e suite
    /// bundles, so no network handshake is involved.
    private final class TrustingProtectionSpace: URLProtectionSpace {
        private let trust: SecTrust
        /// `pem` defaults to the bundled test CA; `date` fixes when the trust is evaluated.
        init?(host: String, pem givenPEM: String? = nil, at date: Date? = nil) {
            let pem: String
            if let givenPEM = givenPEM {
                pem = givenPEM
            } else {
                guard let path = Bundle.main.path(forResource: "test_ca", ofType: "pem"),
                      let bundled = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
                pem = bundled
            }
            let base64 = pem
                .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
                .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
                .replacingOccurrences(of: "\n", with: "")
                .replacingOccurrences(of: "\r", with: "")
            guard let der = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
                  let cert = SecCertificateCreateWithData(nil, der as CFData) else { return nil }
            var created: SecTrust?
            let status = SecTrustCreateWithCertificates([cert] as CFArray,
                                                        SecPolicyCreateSSL(true, host as CFString),
                                                        &created)
            guard status == errSecSuccess, let trust = created else { return nil }
            if let date = date {
                SecTrustSetVerifyDate(trust, date as CFDate)
            }
            self.trust = trust
            super.init(host: host, port: 443, protocol: "https", realm: nil,
                       authenticationMethod: NSURLAuthenticationMethodServerTrust)
        }
        required init?(coder: NSCoder) { fatalError("unused") }
        override var serverTrust: SecTrust? { trust }
    }

    private func decideWithRealTrust(options: [String: Any], host: String = "localhost",
                                     pem: String? = nil, at date: Date? = nil)
        throws -> URLSession.AuthChallengeDisposition {
        let space = try XCTUnwrap(TrustingProtectionSpace(host: host, pem: pem, at: date),
                                  "could not build a SecTrust from the test certificate")
        let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil,
                                                  previousFailureCount: 0, failureResponse: nil,
                                                  error: nil, sender: RecordingChallengeSender())
        let request = ReactNativeBlobUtilRequest()
        request.options = options
        let done = expectation(description: "challenge")
        var disposition: URLSession.AuthChallengeDisposition?
        var fired = false
        request.urlSession(URLSession.shared, didReceive: challenge) { result, _ in
            if !fired { fired = true; disposition = result; done.fulfill() }
        }
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(disposition)
    }

    /// The heart of it. A customCACerts array holding a non-string is still an
    /// array the caller meant as pinning. Reading it as [String] fails the cast,
    /// skips the whole block and hands the connection to the system trust store -
    /// **failing open** for a caller who explicitly asked not to trust it.
    /// Nothing loads here, so the only correct answer is to refuse.
    func testMalformedCustomCertsArrayStillFailsClosed() throws {
        let disposition = try decideWithRealTrust(options: [
            "customCACerts": [NSNull(), "missing_name"],
        ])
        XCTAssertEqual(disposition, .cancelAuthenticationChallenge,
                       "a malformed customCACerts array must refuse, not fall back to system trust")
    }

    func testCustomCertsArrayOfOnlyUnloadableNamesFailsClosed() throws {
        let disposition = try decideWithRealTrust(options: ["customCACerts": ["no_such_cert"]])
        XCTAssertEqual(disposition, .cancelAuthenticationChallenge)
    }

    /// A pinnedHosts array holding a non-string used to read as unset, which
    /// applied the pinning to every host instead of the named one.
    func testMixedPinnedHostsStillScopesToItsStringEntries() throws {
        let other = try decideWithRealTrust(options: [
            "customCACerts": ["missing_name"],
            "pinnedHosts": [NSNull(), "example.com"],
        ], host: "localhost")
        XCTAssertEqual(other, .performDefaultHandling, "localhost is not pinned, so it is out of scope")

        let pinned = try decideWithRealTrust(options: [
            "customCACerts": ["missing_name"],
            "pinnedHosts": [NSNull(), "localhost"],
        ], host: "localhost")
        XCTAssertEqual(pinned, .cancelAuthenticationChallenge,
                       "localhost is pinned, so the unloadable cert must refuse")
    }

    /// Objective-C's -boolValue accepts NSString, so "true" meant trusty.
    func testTrustyAcceptsAStringBoolTheWayObjectiveCDid() throws {
        for value in ["true", "YES"] {
            XCTAssertEqual(try decideWithRealTrust(options: ["trusty": value], pem: Self.trustyLeafPEM,
                                                   at: Self.insideValidity), .useCredential, value)
        }
        XCTAssertEqual(try decideWithRealTrust(options: ["trusty": "false"], pem: Self.trustyLeafPEM,
                                               at: Self.insideValidity), .performDefaultHandling)
    }

    func testNoTlsOptionsFallsThroughToDefaultHandling() throws {
        XCTAssertEqual(try decide(options: [:]), .performDefaultHandling)
    }

    func testAnEmptyCustomCertsArrayIsTreatedAsUnset() throws {
        XCTAssertEqual(try decide(options: ["customCACerts": []]), .performDefaultHandling)
    }
}

/// URLAuthenticationChallenge needs a sender; nothing here calls back into it.
private final class RecordingChallengeSender: NSObject, URLAuthenticationChallengeSender {
    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
    func cancel(_ challenge: URLAuthenticationChallenge) {}
}
