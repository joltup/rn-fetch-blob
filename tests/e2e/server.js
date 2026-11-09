const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = process.env.E2E_SERVER_HOST || "0.0.0.0";
const PORT = Number(process.env.E2E_SERVER_PORT || 19076);
const HTTPS_PORT = Number(process.env.E2E_HTTPS_PORT || 19077);

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOZ+9rEAAAAASUVORK5CYII=";
const PNG_BUFFER = Buffer.from(PNG_BASE64, "base64");

// A case that must be refused only means something if it performs a handshake,
// so a success must never be answered from a cache.
const sendJson = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
    });
    res.end(payload);
};

const sendText = (res, status, text) => {
    res.writeHead(status, {
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
};

const readBody = (req) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });

const handleUpload = async (req, res, label) => {
    try {
        const body = await readBody(req);
        const hash = crypto.createHash("sha256").update(body).digest("hex");
        sendJson(res, 200, {
            ok: true,
            label,
            contentType: req.headers["content-type"] || "",
            bytes: body.length,
            sha256: hash,
        });
    } catch (err) {
        // The message only: a thrown value that is not an Error could carry a stack.
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "upload could not be read" });
    }
};

const handleProgress = (res) => {
    const size = 512 * 1024;
    const payload = Buffer.alloc(size, "a");
    res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": payload.length,
    });
    res.end(payload);
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * Splits a multipart/form-data body into its parts. Deliberately small - it only
 * has to read what the library's own multipart builders produce - but it reports
 * every part byte-exactly, so the parity cases can pin how Android and iOS build
 * the body rather than only whether the upload returned 200.
 */
const parseMultipart = (body, contentType) => {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
    if (!match) {
        return null;
    }
    const delimiter = Buffer.from(`--${match[1] || match[2]}`);
    const parts = [];

    let cursor = body.indexOf(delimiter);
    while (cursor !== -1) {
        cursor += delimiter.length;
        if (body.slice(cursor, cursor + 2).toString() === "--") {
            break;
        }
        const next = body.indexOf(delimiter, cursor);
        if (next === -1) {
            break;
        }

        // Each part is CRLF, headers, CRLF CRLF, content, CRLF, next delimiter.
        const raw = body.slice(cursor + 2, next - 2);
        const headerEnd = raw.indexOf("\r\n\r\n");
        const headerText = headerEnd === -1 ? raw.toString() : raw.slice(0, headerEnd).toString();
        const content = headerEnd === -1 ? Buffer.alloc(0) : raw.slice(headerEnd + 4);

        const headers = {};
        for (const line of headerText.split("\r\n")) {
            const colon = line.indexOf(":");
            if (colon > 0) {
                headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
            }
        }
        const disposition = headers["content-disposition"] || "";
        const name = /\bname="([^"]*)"/.exec(disposition);
        const filename = /\bfilename="([^"]*)"/.exec(disposition);

        parts.push({
            name: name ? name[1] : null,
            filename: filename ? filename[1] : null,
            contentType: headers["content-type"] || null,
            bytes: content.length,
            sha256: sha256(content),
            text: content.length <= 256 ? content.toString("utf8") : null,
        });
        cursor = next;
    }

    return parts;
};

/**
 * Describes the request exactly as it arrived. Used by the parity cases to pin
 * how each platform encodes a body - octet-stream from base64, a wrapped file, a
 * plain string, or a multipart form - and which transfer headers it sends.
 */
const handleEcho = async (req, res) => {
    const body = await readBody(req);
    const contentType = req.headers["content-type"] || "";
    sendJson(res, 200, {
        ok: true,
        method: req.method,
        contentType,
        contentLength: req.headers["content-length"] ?? null,
        transferEncoding: req.headers["transfer-encoding"] ?? null,
        custom: req.headers["x-rnbu-e2e"] ?? null,
        bytes: body.length,
        sha256: sha256(body),
        text: body.length <= 256 ? body.toString("utf8") : null,
        parts: /^multipart\//i.test(contentType) ? parseMultipart(body, contentType) : null,
    });
};

// Bytes 0..255, so a case can check that binary survives base64 and file
// responses unchanged, including the NUL and high bytes.
const BINARY_BUFFER = Buffer.from(Array.from({length: 256}, (_, i) => i));

const handler = async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = req.method || "GET";

    if (method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/echo") {
        return handleEcho(req, res);
    }

    if (method === "GET" && url.pathname === "/binary") {
        res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": BINARY_BUFFER.length,
        });
        res.end(BINARY_BUFFER);
        return;
    }

    if (method === "GET" && url.pathname === "/text") {
        return sendText(res, 200, "héllo wörld ✓");
    }

    if (method === "GET" && url.pathname === "/redirect") {
        res.writeHead(302, { Location: "/health", "Content-Length": 0 });
        res.end();
        return;
    }

    if (method === "GET" && url.pathname === "/redirect-twice") {
        res.writeHead(301, { Location: "/redirect", "Content-Length": 0 });
        res.end();
        return;
    }

    // Answers after `ms` milliseconds, for the timeout and cancel cases.
    if (method === "GET" && url.pathname === "/slow") {
        const ms = Math.min(Number(url.searchParams.get("ms") || 3000), 30000);
        setTimeout(() => sendJson(res, 200, { ok: true, waited: ms }), ms);
        return;
    }

    // No Content-Length, so the client sees a chunked response of unknown length.
    if (method === "GET" && url.pathname === "/chunked") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("chunk-1\n");
        setTimeout(() => {
            res.write("chunk-2\n");
            setTimeout(() => res.end("chunk-3\n"), 50);
        }, 50);
        return;
    }

    const status = /^\/status\/(\d{3})$/.exec(url.pathname);
    if (method === "GET" && status) {
        return sendJson(res, Number(status[1]), { status: Number(status[1]) });
    }

    if (method === "GET" && url.pathname === "/cookie/set") {
        const payload = JSON.stringify({ ok: true });
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "Set-Cookie": "rnbu_e2e=cookie-value; Path=/",
        });
        res.end(payload);
        return;
    }

    if (method === "GET" && url.pathname === "/cookie/echo") {
        return sendJson(res, 200, { cookie: req.headers.cookie || "" });
    }

    if (method === "GET" && url.pathname === "/image.png") {
        res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": PNG_BUFFER.length,
        });
        res.end(PNG_BUFFER);
        return;
    }

    if (method === "POST" && url.pathname === "/upload-file") {
        return handleUpload(req, res, "upload-file");
    }

    if (method === "POST" && url.pathname === "/upload-text") {
        return handleUpload(req, res, "upload-text");
    }

    if (method === "POST" && url.pathname === "/multipart") {
        return handleUpload(req, res, "multipart");
    }

    if (method === "POST" && url.pathname === "/progress") {
        return handleProgress(res);
    }

    return sendText(res, 404, "Not Found");
};

const server = http.createServer(handler);

server.listen(PORT, HOST, () => {
    console.log(`E2E server listening on http://${HOST}:${PORT}`);
});

const certsDir = path.join(__dirname, "certs");
const keyPath = path.join(certsDir, "server.key");
const certPath = path.join(certsDir, "server.crt");

// Certificates are generated rather than committed - see certs/generate.js.
require("./certs/generate").ensureCerts({quiet: true});

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
    };
    const httpsServer = https.createServer(httpsOptions, handler);
    httpsServer.listen(HTTPS_PORT, HOST, () => {
        console.log(`E2E HTTPS server listening on https://${HOST}:${HTTPS_PORT}`);
    });
}

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
