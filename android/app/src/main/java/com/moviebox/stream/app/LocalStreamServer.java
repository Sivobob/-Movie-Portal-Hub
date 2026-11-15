package com.moviebox.stream.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
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
    private static final long MAX_RANGE_CHUNK = 12L * 1024L * 1024L; // 12 MB per open-ended range
    private static final long META_CACHE_TTL_MS = 10L * 60L * 1000L;
    private static final byte[] END_SENTINEL = new byte[0];
    private static final Pattern RANGE_PATTERN = Pattern.compile("bytes=(\\d+)-(\\d*)");

    private final WebView webView;
    private final ServerSocket serverSocket;
    private final int port;
    private ServerSocket lanServerSocket;
    private int lanPort = -1;
    private final String castToken = UUID.randomUUID().toString().replace("-", "");
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean running = true;

    private static class MetaResult {
        final boolean ok;
        final long fileSize;
        final double durationSec;
        final String mimeType;
        final String error;
        final String rawJson;
        final long cachedAt;

        MetaResult(boolean ok, long fileSize, double durationSec, String mimeType, String error, String rawJson) {
            this.ok = ok;
            this.fileSize = fileSize;
            this.durationSec = durationSec;
            this.mimeType = mimeType != null && !mimeType.isEmpty() ? mimeType : "video/mp4";
            this.error = error;
            this.rawJson = rawJson != null ? rawJson : "{}";
            this.cachedAt = System.currentTimeMillis();
        }
    }

    private static class StreamSession {
        final BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>(48);
        volatile boolean aborted = false;
        volatile boolean ended = false;
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

    private synchronized boolean ensureLanServerStarted() {
        if (!running) return false;
        if (lanServerSocket != null && !lanServerSocket.isClosed() && lanPort > 0) {
            return true;
        }
        try {
            lanServerSocket = new ServerSocket(0, 32, InetAddress.getByName("0.0.0.0"));
            lanPort = lanServerSocket.getLocalPort();
            Thread lanAcceptThread = new Thread(this::lanAcceptLoop, "LanCastAccept");
            lanAcceptThread.setDaemon(true);
            lanAcceptThread.start();
            Log.i(TAG, "LAN Cast server listening on port " + lanPort);
            return true;
        } catch (IOException e) {
            Log.w(TAG, "Failed to start LAN Cast server: " + e.getMessage());
            return false;
        }
    }

    private String getWifiLanIpv4Address() {
        try {
            Context ctx = webView != null ? webView.getContext().getApplicationContext() : null;
            if (ctx != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    Network activeNet = cm.getActiveNetwork();
                    if (activeNet != null) {
                        NetworkCapabilities caps = cm.getNetworkCapabilities(activeNet);
                        if (caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) {
                            LinkProperties lp = cm.getLinkProperties(activeNet);
                            if (lp != null) {
                                for (LinkAddress la : lp.getLinkAddresses()) {
                                    InetAddress addr = la.getAddress();
                                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                        return addr.getHostAddress();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        try {
            String fallbackSiteLocal = null;
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (nif == null || !nif.isUp() || nif.isLoopback()) continue;
                String ifName = nif.getName() != null ? nif.getName().toLowerCase(Locale.US) : "";
                boolean isWifiOrEth = ifName.startsWith("wlan") || ifName.startsWith("eth") || ifName.startsWith("ap");
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip == null || ip.startsWith("127.")) continue;
                        if (isWifiOrEth) {
                            return ip;
                        }
                        if (addr.isSiteLocalAddress() && fallbackSiteLocal == null) {
                            fallbackSiteLocal = ip;
                        }
                    }
                }
            }
            if (fallbackSiteLocal != null) {
                return fallbackSiteLocal;
            }
        } catch (Exception ignored) {}
        return null;
    }

    public String resolveCastUrl(String sourceUrl) {
        if (sourceUrl == null) return "";
        String trimmed = sourceUrl.trim();
        if (trimmed.isEmpty()) return "";

        String extractedStreamUrl = trimmed;
        boolean isLocalOrRelative = trimmed.startsWith("/")
                || trimmed.contains("127.0.0.1")
                || trimmed.contains("localhost");

        if (isLocalOrRelative) {
            int qIdx = trimmed.indexOf('?');
            if (qIdx >= 0) {
                Map<String, String> q = new HashMap<>();
                parseQuery(trimmed.substring(qIdx + 1), q);
                String u = q.get("url");
                if (u != null && !u.trim().isEmpty()) {
                    extractedStreamUrl = u.trim();
                } else {
                    return "";
                }
            } else {
                return "";
            }
        }

        // Direct remote non-Telegram HTTP(S) URLs can be loaded directly by Chromecast TV
        if ((extractedStreamUrl.startsWith("https://") || extractedStreamUrl.startsWith("http://"))
                && !extractedStreamUrl.contains("t.me")
                && !extractedStreamUrl.contains("telegram.me")
                && !extractedStreamUrl.contains("127.0.0.1")
                && !extractedStreamUrl.contains("localhost")) {
            return extractedStreamUrl;
        }

        if (!ensureLanServerStarted()) return "";
        String lanIp = getWifiLanIpv4Address();
        if (lanIp == null || lanIp.isEmpty()) return "";

        try {
            return "http://" + lanIp + ":" + lanPort
                    + "/api/cast/stream?token=" + URLEncoder.encode(castToken, "UTF-8")
                    + "&url=" + URLEncoder.encode(extractedStreamUrl, "UTF-8")
                    + "&ext=.mp4";
        } catch (Exception e) {
            return "";
        }
    }

    private void completeMeta(String id, String jsonBody) {
        CompletableFuture<MetaResult> fut = id != null ? pendingMetaById.remove(id) : null;
        if (fut == null) return;
        String safeBody = jsonBody != null ? jsonBody : "{}";
        try {
            JSONObject json = new JSONObject(safeBody);
            MetaResult res = new MetaResult(
                    json.optBoolean("ok", false),
                    json.optLong("fileSize", 0L),
                    json.optDouble("durationSec", 0.0),
                    json.optString("mimeType", "video/mp4"),
                    json.optString("error", ""),
                    safeBody
            );
            fut.complete(res);
        } catch (Exception e) {
            fut.complete(new MetaResult(false, 0, 0, "video/mp4", e.getMessage(), safeBody));
        }
    }

    private int enqueueChunk(String id, byte[] data) {
        StreamSession sess = id != null ? activeStreams.get(id) : null;
        if (sess == null || sess.aborted) {
            return 499;
        }
        if (data != null && data.length > 0) {
            try {
                while (!sess.aborted && running) {
                    if (sess.queue.offer(data, 200, TimeUnit.MILLISECONDS)) {
                        break;
                    }
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        return (sess.aborted || !running) ? 499 : 200;
    }

    private void completeStreamEnd(String id, String error) {
        StreamSession sess = id != null ? activeStreams.get(id) : null;
        if (sess != null) {
            sess.error = error;
            sess.ended = true;
            try {
                while (!sess.aborted && running) {
                    if (sess.queue.offer(END_SENTINEL, 200, TimeUnit.MILLISECONDS)) {
                        break;
                    }
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public class JsBridge {
        private final String baseUrl;

        public JsBridge(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        @JavascriptInterface
        public String getLocalBaseUrl() {
            return baseUrl;
        }

        @JavascriptInterface
        public void postMeta(String id, String jsonBody) {
            completeMeta(id, jsonBody);
        }

        @JavascriptInterface
        public int postChunkBase64(String id, String base64Data) {
            if (base64Data == null || base64Data.isEmpty()) return 200;
            byte[] decoded = Base64.decode(base64Data, Base64.DEFAULT);
            return enqueueChunk(id, decoded);
        }

        @JavascriptInterface
        public void postEnd(String id, String error) {
            completeStreamEnd(id, error);
        }

        @JavascriptInterface
        public void abortAllStreams() {
            LocalStreamServer.this.abortAllStreams();
        }
    }

    public JsBridge createJsInterface() {
        return new JsBridge(getBaseUrl());
    }

    public void abortAllStreams() {
        for (Map.Entry<String, StreamSession> entry : activeStreams.entrySet()) {
            StreamSession sess = entry.getValue();
            if (sess != null) {
                sess.aborted = true;
                sess.queue.clear();
                sess.queue.offer(END_SENTINEL);
            }
        }
        activeStreams.clear();
    }

    public void stopServer() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {}
        if (lanServerSocket != null) {
            try {
                lanServerSocket.close();
            } catch (IOException ignored) {}
        }
        executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                client.setTcpNoDelay(true);
                client.setSoTimeout(60000);
                executor.execute(() -> handleClient(client, false));
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "Accept error: " + e.getMessage());
                }
            }
        }
    }

    private void lanAcceptLoop() {
        while (running && lanServerSocket != null && !lanServerSocket.isClosed()) {
            try {
                Socket client = lanServerSocket.accept();
                client.setTcpNoDelay(true);
                client.setSoTimeout(60000);
                executor.execute(() -> handleClient(client, true));
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "LAN Cast accept error: " + e.getMessage());
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
                + "Access-Control-Allow-Private-Network: true\r\n"
                + "Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type\r\n";
    }

    private void sendSimpleResponse(OutputStream out, int code, String statusText, String contentType, byte[] body, boolean keepAlive) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(" ").append(statusText).append("\r\n");
        sb.append(corsHeaders());
        sb.append("Content-Type: ").append(contentType).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Connection: ").append(keepAlive ? "keep-alive" : "close").append("\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private void handleClient(Socket client, boolean isLanClient) {
        try (Socket s = client) {
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            while (running && !s.isClosed()) {
                HttpRequestData req = readHttpRequest(in);
                if (req == null) return;

                String connHeader = req.headers.get("connection");
                boolean clientWantsClose = connHeader != null && connHeader.toLowerCase(Locale.US).contains("close");

                if ("OPTIONS".equals(req.method)) {
                    String hdr = "HTTP/1.1 204 No Content\r\n" + corsHeaders() + "Content-Length: 0\r\nConnection: keep-alive\r\n\r\n";
                    out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
                    out.flush();
                    if (clientWantsClose) return;
                    continue;
                }

                if (isLanClient) {
                    if ("/api/cast/stream".equals(req.path) && ("GET".equals(req.method) || "HEAD".equals(req.method))) {
                        String tokenParam = req.query.get("token");
                        if (tokenParam == null || !castToken.equals(tokenParam)) {
                            sendSimpleResponse(out, 403, "Forbidden", "application/json", "{\"error\":\"Invalid Cast token\"}".getBytes(StandardCharsets.UTF_8), false);
                            return;
                        }
                        handleStreamRequest(req, out, true);
                        return;
                    }
                    sendSimpleResponse(out, 403, "Forbidden", "application/json", "{\"error\":\"LAN access restricted to Cast stream\"}".getBytes(StandardCharsets.UTF_8), false);
                    return;
                }

                if ("/api/health".equals(req.path)) {
                    byte[] okJson = "{\"status\":\"ok\",\"mode\":\"android_local_bridge\",\"ffmpegAvailable\":false,\"ffprobeAvailable\":false,\"transcodeSupported\":false}".getBytes(StandardCharsets.UTF_8);
                    sendSimpleResponse(out, 200, "OK", "application/json", okJson, !clientWantsClose);
                    if (clientWantsClose) return;
                    continue;
                }

                if ("POST".equals(req.method) && "/__bridge/meta".equals(req.path)) {
                    String id = req.query.get("id");
                    completeMeta(id, new String(req.body, StandardCharsets.UTF_8));
                    sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0], !clientWantsClose);
                    if (clientWantsClose) return;
                    continue;
                }

                if ("POST".equals(req.method) && "/__bridge/chunk".equals(req.path)) {
                    String id = req.query.get("id");
                    int status = enqueueChunk(id, req.body);
                    if (status == 499) {
                        sendSimpleResponse(out, 499, "Client Closed Request", "text/plain", new byte[0], false);
                        return;
                    } else {
                        sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0], !clientWantsClose);
                        if (clientWantsClose) return;
                        continue;
                    }
                }

                if ("POST".equals(req.method) && "/__bridge/end".equals(req.path)) {
                    String id = req.query.get("id");
                    completeStreamEnd(id, req.query.get("error"));
                    sendSimpleResponse(out, 200, "OK", "text/plain", new byte[0], !clientWantsClose);
                    if (clientWantsClose) return;
                    continue;
                }

                if ("/api/telegram/stream-info".equals(req.path) && "GET".equals(req.method)) {
                    handleStreamInfoRequest(req, out);
                    return;
                }

                if (("/api/stream".equals(req.path) || "/api/telegram/stream".equals(req.path))
                        && ("GET".equals(req.method) || "HEAD".equals(req.method))) {
                    handleStreamRequest(req, out, false);
                    return;
                }

                byte[] notFound = "{\"error\":\"Not found\"}".getBytes(StandardCharsets.UTF_8);
                sendSimpleResponse(out, 404, "Not Found", "application/json", notFound, false);
                return;
            }
        } catch (Exception e) {
            Log.w(TAG, "Client handler error: " + e.getMessage());
        }
    }

    private void handleStreamInfoRequest(HttpRequestData req, OutputStream out) throws IOException {
        String telegramUrl = req.query.get("url");
        if (telegramUrl == null || telegramUrl.trim().isEmpty()) {
            sendSimpleResponse(out, 400, "Bad Request", "application/json", "{\"error\":\"URL required\"}".getBytes(StandardCharsets.UTF_8), false);
            return;
        }
        String trimmedUrl = telegramUrl.trim();
        String reqId = UUID.randomUUID().toString();
        CompletableFuture<MetaResult> fut = new CompletableFuture<>();
        pendingMetaById.put(reqId, fut);
        try {
            String js = "window.__tgStreamBridge && window.__tgStreamBridge.resolveStreamInfo("
                    + JSONObject.quote(reqId) + "," + JSONObject.quote(trimmedUrl) + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));
            MetaResult res = fut.get(35, TimeUnit.SECONDS);
            if (res.ok && res.rawJson != null) {
                if (res.fileSize > 0) {
                    metaCache.put(trimmedUrl, res);
                }
                sendSimpleResponse(out, 200, "OK", "application/json", res.rawJson.getBytes(StandardCharsets.UTF_8), false);
            } else {
                String msg = "{\"error\":" + JSONObject.quote(res.error != null ? res.error : "Stream info failed") + "}";
                sendSimpleResponse(out, 502, "Bad Gateway", "application/json", msg.getBytes(StandardCharsets.UTF_8), false);
            }
        } catch (Exception e) {
            sendSimpleResponse(out, 504, "Gateway Timeout", "application/json", "{\"error\":\"Stream info timeout\"}".getBytes(StandardCharsets.UTF_8), false);
        } finally {
            pendingMetaById.remove(reqId);
        }
    }

    private MetaResult resolveMetadata(String telegramUrl) throws Exception {
        MetaResult cached = metaCache.get(telegramUrl);
        if (cached != null && (System.currentTimeMillis() - cached.cachedAt) < META_CACHE_TTL_MS) {
            return cached;
        }

        CompletableFuture<MetaResult> existingInflight = inflightMetaByUrl.get(telegramUrl);
        if (existingInflight != null) {
            return existingInflight.get(60, TimeUnit.SECONDS);
        }

        CompletableFuture<MetaResult> urlFuture = new CompletableFuture<>();
        CompletableFuture<MetaResult> prev = inflightMetaByUrl.putIfAbsent(telegramUrl, urlFuture);
        if (prev != null) {
            return prev.get(60, TimeUnit.SECONDS);
        }

        String reqId = UUID.randomUUID().toString();
        pendingMetaById.put(reqId, urlFuture);

        try {
            String js = "window.__tgStreamBridge && window.__tgStreamBridge.resolveMeta("
                    + JSONObject.quote(reqId) + "," + JSONObject.quote(telegramUrl) + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));

            MetaResult res = urlFuture.get(60, TimeUnit.SECONDS);
            if (res.ok && res.fileSize > 0) {
                metaCache.put(telegramUrl, res);
            }
            return res;
        } finally {
            pendingMetaById.remove(reqId);
            inflightMetaByUrl.remove(telegramUrl);
        }
    }

    private void handleStreamRequest(HttpRequestData req, OutputStream out, boolean isCastRequest) throws IOException {
        String telegramUrl = req.query.get("url");
        if (telegramUrl == null || telegramUrl.trim().isEmpty()) {
            sendSimpleResponse(out, 400, "Bad Request", "application/json", "{\"error\":\"URL required\"}".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        MetaResult meta;
        try {
            meta = resolveMetadata(telegramUrl.trim());
        } catch (Exception e) {
            sendSimpleResponse(out, 502, "Bad Gateway", "application/json", "{\"error\":\"Stream metadata timeout\"}".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        if (!meta.ok || meta.fileSize <= 0) {
            String msg = "{\"error\":" + JSONObject.quote(meta.error != null ? meta.error : "Stream unavailable") + "}";
            sendSimpleResponse(out, 404, "Not Found", "application/json", msg.getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        String responseMimeType = meta.mimeType;
        if (isCastRequest) {
            if (responseMimeType == null || responseMimeType.isEmpty() || "application/octet-stream".equalsIgnoreCase(responseMimeType)) {
                responseMimeType = "video/mp4";
            }
        }

        String durationHeader = String.valueOf((long) Math.floor(meta.durationSec));
        if ("HEAD".equals(req.method)) {
            String hdr = "HTTP/1.1 200 OK\r\n"
                    + corsHeaders()
                    + "Content-Type: " + responseMimeType + "\r\n"
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
        hdr.append("Content-Type: ").append(responseMimeType).append("\r\n");
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

            long idleElapsedMs = 0;
            while (!session.aborted && running) {
                byte[] chunk = session.queue.poll(5, TimeUnit.SECONDS);
                if (chunk == null) {
                    idleElapsedMs += 5000;
                    if (session.ended || idleElapsedMs >= 60000) {
                        break;
                    }
                    continue;
                }
                idleElapsedMs = 0;
                if (chunk == END_SENTINEL) {
                    if (session.error != null && !session.error.isEmpty()) {
                        Log.w(TAG, "Stream ended with error: " + session.error);
                    }
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
