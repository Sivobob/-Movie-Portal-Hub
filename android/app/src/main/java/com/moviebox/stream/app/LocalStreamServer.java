package com.moviebox.stream.app;

import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Localhost-only (127.0.0.1) HTTP/1.1 Range streaming proxy for Android WebView & MediaPlayer.
 * Serves identical /api/stream?url=... endpoints as the Node.js backend, handling HEAD,
 * 200 OK full Content-Length, and 206 Partial Content Range chunks directly inside the app.
 */
public class LocalStreamServer {
    private static final String TAG = "LocalStreamServer";
    private static final long MAX_RANGE_CHUNK = 8L * 1024L * 1024L; // 8 MB per open-ended range
    private static final long META_CACHE_TTL_MS = 5L * 60L * 1000L;
    private static final byte[] END_SENTINEL = new byte[0];
    private static final Pattern RANGE_PATTERN = Pattern.compile("bytes=(\\d+)-(\\d*)");

    private final WebView webView;
    private final ServerSocket serverSocket;
    private final int port;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean running = true;

    private static class MetaResult {
        final boolean ok;
        final long fileSize;
        final double durationSec;
        final String mimeType;
        final String error;
        final long cachedAt;

        MetaResult(boolean ok, long fileSize, double durationSec, String mimeType, String error) {
            this.ok = ok;
            this.fileSize = fileSize;
            this.durationSec = durationSec;
            this.mimeType = mimeType != null && !mimeType.isEmpty() ? mimeType : "video/mp4";
            this.error = error;
            this.cachedAt = System.currentTimeMillis();
        }
    }

    private static class StreamSession {
        final BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>(24);
        volatile boolean aborted = false;
        volatile String error = null;
    }

    private final ConcurrentHashMap<String, MetaResult> metaCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<MetaResult>> inflightMetaByUrl = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<MetaResult>> pendingMetaById = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, StreamSession> activeStreams = new ConcurrentHashMap<>();

    public LocalStreamServer(WebView webView) throws IOException {
        this.webView = webView;
        this.serverSocket = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        this.port = this.serverSocket.getLocalPort();

        Thread acceptThread = new Thread(this::acceptLoop, "LocalStreamAccept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        Log.i(TAG, "LocalStreamServer listening on http://127.0.0.1:" + port);
    }

    public String getBaseUrl() {
        return "http://127.0.0.1:" + port;
    }

    public static class JsBridge {
        private final String baseUrl;

        public JsBridge(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        @JavascriptInterface
        public String getLocalBaseUrl() {
            return baseUrl;
        }
    }

    public JsBridge createJsInterface() {
        return new JsBridge(getBaseUrl());
    }

    public void stopServer() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {}
        executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                client.setTcpNoDelay(true);
                executor.execute(() -> handleClient(client));
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "Accept error: " + e.getMessage());
                }
            }
        }
    }

    private static class HttpRequestData {
        String method;
        String path;
        Map<String, String> query = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];
    }

    private HttpRequestData readHttpRequest(InputStream in) throws IOException {
        ByteArrayOutputStream headerBuf = new ByteArrayOutputStream(2048);
        byte[] buf = new byte[4096];
        int headerEndIdx = -1;

        while (headerEndIdx < 0) {
            int n = in.read(buf);
            if (n == -1) return null;
            headerBuf.write(buf, 0, n);
            byte[] arr = headerBuf.toByteArray();
            for (int i = 0; i <= arr.length - 4; i++) {
                if (arr[i] == '\r' && arr[i + 1] == '\n' && arr[i + 2] == '\r' && arr[i + 3] == '\n') {
                    headerEndIdx = i;
                    break;
                }
            }
            if (headerBuf.size() > 65536) {
                throw new IOException("HTTP header too large");
            }
        }

        byte[] allBytes = headerBuf.toByteArray();
        String headerStr = new String(allBytes, 0, headerEndIdx, StandardCharsets.ISO_8859_1);
        int bodyStart = headerEndIdx + 4;
        int leftoverLen = allBytes.length - bodyStart;

        String[] lines = headerStr.split("\r\n");
        if (lines.length == 0) return null;
        String[] reqLine = lines[0].split(" ");
        if (reqLine.length < 2) return null;

        HttpRequestData req = new HttpRequestData();
        req.method = reqLine[0].toUpperCase(Locale.US);
        String fullTarget = reqLine[1];
        int qIdx = fullTarget.indexOf('?');
        if (qIdx >= 0) {
            req.path = fullTarget.substring(0, qIdx);
            parseQuery(fullTarget.substring(qIdx + 1), req.query);
        } else {
            req.path = fullTarget;
        }

        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) {
                String k = lines[i].substring(0, colon).trim().toLowerCase(Locale.US);
                String v = lines[i].substring(colon + 1).trim();
                req.headers.put(k, v);
            }
        }

        int contentLen = 0;
        if (req.headers.containsKey("content-length")) {
            try {
                contentLen = Integer.parseInt(req.headers.get("content-length"));
            } catch (NumberFormatException ignored) {}
        }

        if (contentLen > 0) {
            byte[] body = new byte[contentLen];
            int copied = Math.min(leftoverLen, contentLen);
            if (copied > 0) {
                System.arraycopy(allBytes, bodyStart, body, 0, copied);
            }
            int pos = copied;
            while (pos < contentLen) {
                int r = in.read(body, pos, contentLen - pos);
                if (r == -1) throw new EOFException("Unexpected EOF reading body");
                pos += r;
            }
            req.body = body;
        }

        return req;
    }

    private void parseQuery(String qs, Map<String, String> out) {
        if (qs == null || qs.isEmpty()) return;
        for (String pair : qs.split("&")) {
            int eq = pair.indexOf('=');
            try {
                if (eq > 0) {
                    String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    out.put(k, v);
                } else if (!pair.isEmpty()) {
                    out.put(URLDecoder.decode(pair, "UTF-8"), "");
                }
            } catch (Exception ignored) {}
        }
    }

    private String corsHeaders() {
        return "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: *\r\n"
                + "Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, Content-Type\r\n";
    }

    private void sendSimpleResponse(OutputStream out, int code, String statusText, String contentType, byte[] body) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(" ").append(statusText).append("\r\n");
        sb.append(corsHeaders());
        sb.append("Content-Type: ").append(contentType).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private void handleClient(Socket client) {
        try (Socket s = client) {
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            HttpRequestData req = readHttpRequest(in);
            if (req == null) return;

            if ("OPTIONS".equals(req.method)) {
                String hdr = "HTTP/1.1 204 No Content\r\n" + corsHeaders() + "Connection: close\r\n\r\n";
                out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                return;
            }

            if ("/api/health".equals(req.path)) {
                byte[] okJson = "{\"status\":\"ok\",\"mode\":\"android_local_bridge\"}".getBytes(StandardCharsets.UTF_8);
                sendSimpleResponse(out, 200, "OK", "application/json", okJson);
                return;
            }

            if ("POST".equals(req.method) && "/__bridge/meta".equals(req.path)) {
                String id = req.query.get("id");
                CompletableFuture<MetaResult> fut = id != null ? pendingMetaById.remove(id) : null;
                if (fut != null) {
                    try {
                        JSONObject json = new JSONObject(new String(req.body, StandardCharsets.UTF_8));
                        MetaResult res = new MetaResult(
                                json.optBoolean("ok", false),
                                json.optLong("fileSize", 0L),
                                json.optDouble("durationSec", 0.0),
                                json.optString("mimeType", "video/mp4"),
                                json.optString("error", "")
                        );
                        fut.complete(res);
                    } catch (Exception e) {
                        fut.complete(new MetaResult(false, 0, 0, "video/mp4", e.getMessage()));
                    }
                }
                sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0]);
                return;
            }

            if ("POST".equals(req.method) && "/__bridge/chunk".equals(req.path)) {
                String id = req.query.get("id");
                StreamSession sess = id != null ? activeStreams.get(id) : null;
                if (sess == null || sess.aborted) {
                    sendSimpleResponse(out, 499, "Client Closed Request", "text/plain", new byte[0]);
                    return;
                }
                if (req.body.length > 0) {
                    try {
                        while (!sess.aborted) {
                            if (sess.queue.offer(req.body, 250, TimeUnit.MILLISECONDS)) {
                                break;
                            }
                        }
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                }
                if (sess.aborted) {
                    sendSimpleResponse(out, 499, "Client Closed Request", "text/plain", new byte[0]);
                } else {
                    sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0]);
                }
                return;
            }

            if ("POST".equals(req.method) && "/__bridge/end".equals(req.path)) {
                String id = req.query.get("id");
                StreamSession sess = id != null ? activeStreams.get(id) : null;
                if (sess != null) {
                    sess.error = req.query.get("error");
                    try {
                        sess.queue.offer(END_SENTINEL, 2, TimeUnit.SECONDS);
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                }
                sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0]);
                return;
            }

            if (("/api/stream".equals(req.path) || "/api/telegram/stream".equals(req.path))
                    && ("GET".equals(req.method) || "HEAD".equals(req.method))) {
                handleStreamRequest(req, out);
                return;
            }

            byte[] notFound = "{\"error\":\"Not found\"}".getBytes(StandardCharsets.UTF_8);
            sendSimpleResponse(out, 404, "Not Found", "application/json", notFound);
        } catch (Exception e) {
            Log.w(TAG, "Client handler error: " + e.getMessage());
        }
    }

    private MetaResult resolveMetadata(String telegramUrl) throws Exception {
        MetaResult cached = metaCache.get(telegramUrl);
        if (cached != null && (System.currentTimeMillis() - cached.cachedAt) < META_CACHE_TTL_MS) {
            return cached;
        }

        CompletableFuture<MetaResult> existingInflight = inflightMetaByUrl.get(telegramUrl);
        if (existingInflight != null) {
            return existingInflight.get(30, TimeUnit.SECONDS);
        }

        CompletableFuture<MetaResult> urlFuture = new CompletableFuture<>();
        CompletableFuture<MetaResult> prev = inflightMetaByUrl.putIfAbsent(telegramUrl, urlFuture);
        if (prev != null) {
            return prev.get(30, TimeUnit.SECONDS);
        }

        String reqId = UUID.randomUUID().toString();
        pendingMetaById.put(reqId, urlFuture);

        try {
            String js = "window.__tgStreamBridge && window.__tgStreamBridge.resolveMeta("
                    + JSONObject.quote(reqId) + "," + JSONObject.quote(telegramUrl) + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));

            MetaResult res = urlFuture.get(30, TimeUnit.SECONDS);
            if (res.ok && res.fileSize > 0) {
                metaCache.put(telegramUrl, res);
            }
            return res;
        } finally {
            pendingMetaById.remove(reqId);
            inflightMetaByUrl.remove(telegramUrl);
        }
    }

    private void handleStreamRequest(HttpRequestData req, OutputStream out) throws IOException {
        String telegramUrl = req.query.get("url");
        if (telegramUrl == null || telegramUrl.trim().isEmpty()) {
            sendSimpleResponse(out, 400, "Bad Request", "application/json", "{\"error\":\"URL required\"}".getBytes(StandardCharsets.UTF_8));
            return;
        }

        MetaResult meta;
        try {
            meta = resolveMetadata(telegramUrl.trim());
        } catch (Exception e) {
            sendSimpleResponse(out, 502, "Bad Gateway", "application/json", "{\"error\":\"Stream metadata timeout\"}".getBytes(StandardCharsets.UTF_8));
            return;
        }

        if (!meta.ok || meta.fileSize <= 0) {
            String msg = "{\"error\":" + JSONObject.quote(meta.error != null ? meta.error : "Stream unavailable") + "}";
            sendSimpleResponse(out, 404, "Not Found", "application/json", msg.getBytes(StandardCharsets.UTF_8));
            return;
        }

        String durationHeader = String.valueOf((long) Math.floor(meta.durationSec));
        if ("HEAD".equals(req.method)) {
            String hdr = "HTTP/1.1 200 OK\r\n"
                    + corsHeaders()
                    + "Content-Type: " + meta.mimeType + "\r\n"
                    + "Content-Length: " + meta.fileSize + "\r\n"
                    + "Accept-Ranges: bytes\r\n"
                    + "X-Video-Duration: " + durationHeader + "\r\n"
                    + "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            return;
        }

        String rangeHeader = req.headers.get("range");
        long start = 0;
        long end = meta.fileSize - 1;
        boolean hasRange = false;

        if (rangeHeader != null) {
            Matcher m = RANGE_PATTERN.matcher(rangeHeader);
            if (m.find()) {
                hasRange = true;
                start = Long.parseLong(m.group(1));
                String endStr = m.group(2);
                if (endStr != null && !endStr.isEmpty()) {
                    end = Long.parseLong(endStr);
                } else {
                    end = Math.min(start + MAX_RANGE_CHUNK - 1, meta.fileSize - 1);
                }
            }
        }

        if (start >= meta.fileSize) {
            String hdr = "HTTP/1.1 416 Range Not Satisfiable\r\n"
                    + corsHeaders()
                    + "Content-Range: bytes */" + meta.fileSize + "\r\n"
                    + "Content-Length: 0\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            return;
        }

        end = Math.min(end, meta.fileSize - 1);
        long contentLength = (end - start) + 1;

        StringBuilder hdr = new StringBuilder();
        hdr.append(hasRange ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        hdr.append(corsHeaders());
        hdr.append("Content-Type: ").append(meta.mimeType).append("\r\n");
        hdr.append("Content-Length: ").append(contentLength).append("\r\n");
        if (hasRange) {
            hdr.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(meta.fileSize).append("\r\n");
        }
        hdr.append("Accept-Ranges: bytes\r\n");
        hdr.append("X-Video-Duration: ").append(durationHeader).append("\r\n");
        hdr.append("Cache-Control: no-cache, no-store, must-revalidate\r\n");
        hdr.append("Connection: close\r\n\r\n");

        out.write(hdr.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.flush();

        String reqId = UUID.randomUUID().toString();
        StreamSession session = new StreamSession();
        activeStreams.put(reqId, session);

        try {
            String js = "window.__tgStreamBridge && window.__tgStreamBridge.pumpRange("
                    + JSONObject.quote(reqId) + ","
                    + JSONObject.quote(telegramUrl.trim()) + ","
                    + start + "," + end + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));

            while (!session.aborted) {
                byte[] chunk = session.queue.poll(30, TimeUnit.SECONDS);
                if (chunk == null || chunk == END_SENTINEL) {
                    break;
                }
                out.write(chunk);
                out.flush();
            }
        } catch (IOException e) {
            // Downstream video player disconnected (seek / close)
            session.aborted = true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            session.aborted = true;
        } finally {
            boolean wasAborted = session.aborted;
            session.aborted = true;
            activeStreams.remove(reqId);
            session.queue.clear();
            if (wasAborted) {
                String abortJs = "window.__tgStreamBridge && window.__tgStreamBridge.abort(" + JSONObject.quote(reqId) + ");";
                webView.post(() -> webView.evaluateJavascript(abortJs, null));
            }
        }
    }
}
