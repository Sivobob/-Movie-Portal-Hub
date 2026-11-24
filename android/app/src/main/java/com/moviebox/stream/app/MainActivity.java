package com.moviebox.stream.app;

import android.app.ActivityManager;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.TextureView;
import android.graphics.SurfaceTexture;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.net.wifi.WifiManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.Manifest;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.mediarouter.media.MediaRouter;
import androidx.mediarouter.media.MediaRouteSelector;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private LocalStreamServer localStreamServer;
    private boolean webViewConfigured = false;

    private FrameLayout customViewContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean isHidingCustomView = false;

    private boolean isPlaybackActive = false;
    private boolean isPlaybackFullscreen = false;
    private boolean isMandatoryUpdateActive = false;
    private OnBackPressedCallback fullscreenBackCallback;
    private OnBackPressedCallback mandatoryUpdateBackCallback;
    private volatile String pendingOpenMovieId = null;
    private final ExecutorService notificationExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService liveSyncExecutor = Executors.newSingleThreadExecutor();
    private volatile long lastLiveSyncCheckMs = 0L;
    private volatile String activeLiveOrigin = "";
    private volatile String activeLiveFingerprint = "";
    private volatile boolean liveSyncInFlight = false;

    private static final String FIRESTORE_BACKEND_DOC_URL =
        "https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/admins/backend";
    private static final String[] LIVE_WEB_CANDIDATES = new String[] {
        "https://ais-pre-jnqt2mxwwu4hovy5xbqigd-560942295760.asia-northeast1.run.app",
        "https://movie-portalhub-1012526016635.asia-southeast1.run.app"
    };

    private static final String ACTION_APK_INSTALL_RESULT = "com.moviebox.stream.app.ACTION_APK_INSTALL_RESULT";
    private static final int REQUEST_CODE_INSTALL_APK = 4205;
    private volatile String apkUpdateState = "idle";
    private volatile int apkUpdateProgress = 0;
    private volatile String apkUpdateMessage = "";
    private volatile String lastApkDownloadUrl = "";
    private volatile File downloadedApkFile = null;
    private volatile boolean isDownloadingApk = false;
    private volatile boolean pendingInstallAfterPermission = false;
    private volatile boolean legacyInstallFallbackTried = false;
    private volatile boolean preferLegacyInstallerOnRetry = false;
    private volatile long apkDownloadSessionSeq = 0L;

    // Google Cast & MediaRouter state
    private WifiManager.MulticastLock multicastLock;
    private MediaRouter mediaRouter;
    private MediaRouteSelector castRouteSelector;
    private MediaRouter.Callback mediaRouterCallback;
    private CastContext castContext;
    private SessionManager sessionManager;
    private SessionManagerListener<CastSession> castSessionListener;
    private CastSession currentCastSession;
    private RemoteMediaClient remoteMediaClient;
    private RemoteMediaClient.Callback remoteMediaCallback;

    private volatile String castSessionState = "idle";
    private volatile String castPlayerState = "idle";
    private volatile boolean castSessionConnected = false;
    private volatile String castConnectedDeviceName = "";
    private volatile int castCurrentTimeSec = 0;
    private volatile int castDurationSec = 0;
    private volatile boolean castIsPlaying = false;
    private volatile String castErrorMessage = "";
    private volatile String discoveredDevicesJson = "[]";
    private volatile String cachedCastStatusJson = "{\"state\":\"idle\",\"playerState\":\"idle\",\"connected\":false,\"deviceName\":\"\",\"isPlaying\":false,\"currentTime\":0,\"duration\":0,\"errorMessage\":\"\"}";
    private final Object castLock = new Object();

    private String pendingCastMediaUrl = null;
    private String pendingCastTitle = null;
    private String pendingCastPoster = null;
    private long pendingCastCurrentTimeSec = 0;

    private final Runnable castStatusTicker = new Runnable() {
        @Override
        public void run() {
            syncCastRemoteMediaStatus();
            if (castSessionConnected && currentCastSession != null) {
                mainHandler.postDelayed(this, 1000);
            }
        }
    };

    // Native Media3 ExoPlayer state (universal phone hardware/software codec playback)
    private FrameLayout exoContainer;
    private TextureView exoTextureView;
    private SurfaceView exoSurfaceView;
    private volatile boolean textureSurfaceAvailable = false;
    private volatile boolean surfaceHolderAvailable = false;
    private volatile String currentSurfaceMode = "texture";
    private volatile boolean currentPreferSoftware = false;
    private ExoPlayer exoPlayer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private long exoSessionId = 0L;
    private Runnable pendingStartRunnable = null;
    private Runnable pendingHideContainerRunnable = null;
    private volatile boolean exoActive = false;
    private volatile int exoVideoWidth = 0;
    private volatile int exoVideoHeight = 0;
    private volatile boolean exoFirstFrameRendered = false;
    private volatile String exoErrorMessage = "";
    private volatile String exoActiveDecoderName = "";
    private volatile boolean exoActiveDecoderIsSoftware = false;
    private volatile String exoAudioTracksJson = "[]";
    private volatile String exoSubtitleTracksJson = "[]";
    private volatile String exoActiveCueText = "";
    private volatile int exoResizeMode = 0; // 0 = fit, 4 = zoom/cover, 3 = stretch/fill
    private volatile String currentExoMediaUrl = "";
    private volatile int exoAutoReconnectAttempts = 0;
    private Runnable pendingExoReconnectRunnable = null;
    private PowerManager.WakeLock playbackWakeLock;
    private WifiManager.WifiLock playbackWifiLock;
    private volatile String cachedExoStateJson = "{\"active\":false,\"state\":1,\"isPlaying\":false,\"isBuffering\":false,\"ended\":false,\"seekable\":false,\"currentTime\":0,\"duration\":0,\"bufferedPosition\":0,\"videoWidth\":0,\"videoHeight\":0,\"firstFrameRendered\":false,\"renderedFrames\":0,\"droppedFrames\":0,\"preferSoftware\":false,\"isSoftwareDecoder\":false,\"decoderName\":\"\",\"surfaceMode\":\"texture\",\"error\":\"\",\"audioTracks\":[],\"subtitleTracks\":[],\"cueText\":\"\"}";

    private static final String VIDEO_DOWNLOAD_CHANNEL_ID = "movie_box_video_downloads";
    private static final String VIDEO_DOWNLOAD_DONE_CHANNEL_ID = "movie_box_video_downloads_done";
    private final ConcurrentHashMap<String, NativeVideoDownloadTask> nativeVideoDownloads = new ConcurrentHashMap<>();
    private final ExecutorService videoDownloadExecutor = Executors.newFixedThreadPool(2);

    private static class NativeVideoDownloadTask {
        final String id;
        final String title;
        final String primaryUrl;
        final String fallbackUrl;
        final int notifId;
        final File targetFile;
        final File partFile;
        final AtomicBoolean paused = new AtomicBoolean(false);
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final AtomicBoolean running = new AtomicBoolean(false);
        volatile int progress = 0;
        volatile long receivedBytes = 0L;
        volatile long totalBytes = 0L;
        volatile String speed = "Connecting...";
        volatile String eta = "Starting...";
        volatile String status = "downloading";
        volatile String localUri = "";
        volatile String errorMessage = "";

        NativeVideoDownloadTask(String id, String title, String primaryUrl, String fallbackUrl, File targetFile, File partFile) {
            this.id = id;
            this.title = title;
            this.primaryUrl = primaryUrl;
            this.fallbackUrl = fallbackUrl;
            this.notifId = 30000 + Math.abs(id.hashCode() % 100000);
            this.targetFile = targetFile;
            this.partFile = partFile;
        }
    }

    private final Runnable exoStateTicker = new Runnable() {
        @Override
        public void run() {
            refreshExoStateSnapshot();
            if (exoActive && exoPlayer != null) {
                mainHandler.postDelayed(this, 250);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mandatoryUpdateBackCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                // Intentionally block hardware Back dismissal while mandatory update dialog is active
            }
        };
        getOnBackPressedDispatcher().addCallback(this, mandatoryUpdateBackCallback);

        fullscreenBackCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                if (isMandatoryUpdateActive) {
                    return;
                }
                hideCustomFullscreenView();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, fullscreenBackCallback);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        enableImmersiveStickyMode(false);
        configureWebView();
        createNotificationChannel();
        if (getIntent() != null && ACTION_APK_INSTALL_RESULT.equals(getIntent().getAction())) {
            handlePackageInstallerCallback(getIntent());
        } else {
            captureLaunchMovieIntent(getIntent());
        }
        mainHandler.postDelayed(this::requestPostNotificationsPermissionIfNeeded, 1200);
        ReleaseNotificationHelper.scheduleBackgroundWorker(this);
        notificationExecutor.execute(() -> ReleaseNotificationHelper.syncAndNotifyLatestReleases(getApplicationContext()));
        syncLiveWebAppIfAvailable(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && ACTION_APK_INSTALL_RESULT.equals(intent.getAction())) {
            handlePackageInstallerCallback(intent);
            return;
        }
        captureLaunchMovieIntent(intent);
        if (pendingOpenMovieId != null && !pendingOpenMovieId.isEmpty()) {
            dispatchOpenMovieToWebView(pendingOpenMovieId);
        }
    }

    private void captureLaunchMovieIntent(Intent intent) {
        if (intent == null) return;
        try {
            String movieId = intent.getStringExtra("openMovieId");
            if (movieId != null && !movieId.trim().isEmpty()) {
                pendingOpenMovieId = movieId.trim();
            }
            String openTab = intent.getStringExtra("openTab");
            if ("downloads".equalsIgnoreCase(openTab)) {
                dispatchOpenDownloadsToWebView();
            }
        } catch (Exception ignored) {}
    }

    private void dispatchOpenDownloadsToWebView() {
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('movie_portal_open_downloads'));",
                        null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    private void dispatchOpenMovieToWebView(final String movieId) {
        if (movieId == null || movieId.trim().isEmpty()) return;
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String safeJson = JSONObject.quote(movieId.trim());
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('movie_portal_open_movie',{detail:" + safeJson + "}));",
                        null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    private void requestPostNotificationsPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(
                        this,
                        new String[] { Manifest.permission.POST_NOTIFICATIONS },
                        4102
                    );
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 4102 && grantResults != null && grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            notificationExecutor.execute(() -> ReleaseNotificationHelper.syncAndNotifyLatestReleases(getApplicationContext()));
            runOnUiThread(() -> {
                try {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('movie_portal_notif_permission_granted'));",
                            null
                        );
                    }
                } catch (Exception ignored) {}
            });
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!webViewConfigured || localStreamServer == null) {
            configureWebView();
        }
        syncLiveWebAppIfAvailable(false);
        notificationExecutor.execute(() -> ReleaseNotificationHelper.syncAndNotifyLatestReleases(getApplicationContext()));
        if (exoPlayer != null && exoActive) {
            try {
                if ("surface".equals(currentSurfaceMode) && exoSurfaceView != null && surfaceHolderAvailable) {
                    exoPlayer.setVideoSurfaceView(exoSurfaceView);
                } else if (exoTextureView != null && (textureSurfaceAvailable || exoTextureView.isAvailable())) {
                    exoPlayer.setVideoTextureView(exoTextureView);
                }
                updateExoVideoSurfaceSize();
            } catch (Exception ignored) {}
        }
        enableImmersiveStickyMode(isPlaybackFullscreen || customView != null);
        if (pendingInstallAfterPermission
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls())) {
            pendingInstallAfterPermission = false;
            final File readyApk = downloadedApkFile;
            if (readyApk != null && readyApk.exists() && readyApk.length() >= 1024L * 1024L) {
                mainHandler.postDelayed(() -> launchApkPackageInstaller(readyApk), 250);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_INSTALL_APK) {
            if (resultCode == RESULT_OK) {
                apkUpdateState = "installing";
                apkUpdateProgress = 100;
                apkUpdateMessage = "Update installed successfully! Restarting Movie Hub...";
            } else if (resultCode == RESULT_CANCELED) {
                apkUpdateState = "installing";
                apkUpdateProgress = 100;
                apkUpdateMessage = "Install prompt was closed. Tap \"Tap to Install Update\" below to install inside the app.";
            } else {
                int installResult = data != null ? data.getIntExtra("android.intent.extra.INSTALL_RESULT", -1) : -1;
                apkUpdateState = "error";
                apkUpdateProgress = 100;
                apkUpdateMessage = installResult != -1
                    ? "Android installer did not complete (code " + installResult + "). Tap Retry or check if old app signature conflicts."
                    : "Android installer did not complete. Tap Retry In-App Update.";
            }
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        enableImmersiveStickyMode(isPlaybackFullscreen || customView != null);
        if (exoActive) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.setLayerType(View.LAYER_TYPE_NONE, null);
                webView.setBackgroundColor(Color.TRANSPARENT);
            }
            if (exoContainer != null) {
                exoContainer.setVisibility(View.VISIBLE);
                exoContainer.requestLayout();
            }
            mainHandler.post(this::updateExoVideoSurfaceSize);
            mainHandler.postDelayed(this::updateExoVideoSurfaceSize, 120);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (exoPlayer != null && exoActive) {
            try {
                if (exoPlayer.isPlaying()) {
                    exoPlayer.pause();
                }
                refreshExoStateSnapshot();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onDestroy() {
        releaseExoPlayerInternal();
        releasePlaybackLocks();
        mainHandler.removeCallbacks(castStatusTicker);
        stopCastDiscoveryNative();
        disconnectCastNative();
        if (sessionManager != null && castSessionListener != null) {
            try {
                sessionManager.removeSessionManagerListener(castSessionListener, CastSession.class);
            } catch (Exception ignored) {}
        }
        hideCustomFullscreenView();
        if (localStreamServer != null) {
            localStreamServer.stopServer();
            localStreamServer = null;
        }
        try {
            liveSyncExecutor.shutdownNow();
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void createNotificationChannel() {
        ReleaseNotificationHelper.createNotificationChannel(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    NotificationChannel dlChannel = new NotificationChannel(
                        VIDEO_DOWNLOAD_CHANNEL_ID,
                        "Video Downloads Progress",
                        NotificationManager.IMPORTANCE_LOW
                    );
                    dlChannel.setDescription("Live percentage progress for offline movie and episode downloads");
                    dlChannel.setShowBadge(false);
                    manager.createNotificationChannel(dlChannel);

                    NotificationChannel doneChannel = new NotificationChannel(
                        VIDEO_DOWNLOAD_DONE_CHANNEL_ID,
                        "Completed Downloads",
                        NotificationManager.IMPORTANCE_DEFAULT
                    );
                    doneChannel.setDescription("Notifications when offline movies or episodes finish downloading");
                    manager.createNotificationChannel(doneChannel);
                }
            } catch (Exception ignored) {}
        }
    }

    private void configureWebView() {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                cookieManager.setAcceptThirdPartyCookies(webView, true);
                // Crucial for video rendering: LAYER_TYPE_NONE prevents Android GPU SurfaceTexture compositing bugs (audio with black screen)
                webView.setLayerType(View.LAYER_TYPE_NONE, null);
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setJavaScriptCanOpenWindowsAutomatically(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                settings.setAllowFileAccessFromFileURLs(true);
                settings.setAllowUniversalAccessFromFileURLs(true);
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                // Auto-fit to mobile phone display screen size and avoid distortion
                settings.setUseWideViewPort(true);
                settings.setLoadWithOverviewMode(true);
                settings.setSupportZoom(false);
                settings.setBuiltInZoomControls(false);
                settings.setDisplayZoomControls(false);
                settings.setTextZoom(100);

                webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                        if (message != null && message.contains("Missing MTProto Entity")) {
                            if (result != null) result.confirm();
                            return true;
                        }
                        return super.onJsAlert(view, url, message, result);
                    }

                    @Override
                    public void onShowCustomView(View view, CustomViewCallback callback) {
                        runOnUiThread(() -> showCustomFullscreenView(view, callback));
                    }

                    @Override
                    public void onHideCustomView() {
                        runOnUiThread(() -> hideCustomFullscreenView());
                    }
                });

                if (getBridge() != null) {
                    webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
                        private boolean isRemoteLiveUrl(String url) {
                            if (url == null || url.trim().isEmpty()) return false;
                            return !url.startsWith("https://localhost")
                                && !url.startsWith("http://localhost")
                                && !url.startsWith("http://127.0.0.1")
                                && !url.startsWith("about:");
                        }

                        @Override
                        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                            if (request != null && request.isForMainFrame() && request.getUrl() != null && isRemoteLiveUrl(request.getUrl().toString())) {
                                activeLiveOrigin = "";
                                activeLiveFingerprint = "";
                                view.loadUrl("https://localhost/");
                                return;
                            }
                            super.onReceivedError(view, request, error);
                        }

                        @Override
                        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                            if (request != null && request.isForMainFrame() && request.getUrl() != null && errorResponse != null && errorResponse.getStatusCode() >= 400 && isRemoteLiveUrl(request.getUrl().toString())) {
                                activeLiveOrigin = "";
                                activeLiveFingerprint = "";
                                view.loadUrl("https://localhost/");
                                return;
                            }
                            super.onReceivedHttpError(view, request, errorResponse);
                        }
                    });
                }

                if (localStreamServer == null) {
                    localStreamServer = new LocalStreamServer(webView);
                    webView.addJavascriptInterface(localStreamServer.createJsInterface(), "AndroidStreamBridge");
                }
                setupExoSurfaceContainer(webView);
                if (!webViewConfigured) {
                    webView.addJavascriptInterface(new PlayerBridge(), "AndroidPlayerBridge");
                    webViewConfigured = true;
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private String getInstalledAppVersionNameSafe() {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (pInfo != null && pInfo.versionName != null && !pInfo.versionName.trim().isEmpty()) {
                return pInfo.versionName.trim();
            }
        } catch (Exception ignored) {}
        return "3.5.267";
    }

    private int compareVersionStrings(String verA, String verB) {
        String[] partsA = (verA == null ? "" : verA).replaceAll("^[^0-9]*", "").split("[^0-9]+");
        String[] partsB = (verB == null ? "" : verB).replaceAll("^[^0-9]*", "").split("[^0-9]+");
        int max = Math.max(partsA.length, partsB.length);
        for (int i = 0; i < max; i++) {
            int a = 0;
            int b = 0;
            try {
                if (i < partsA.length && !partsA[i].isEmpty()) a = Integer.parseInt(partsA[i]);
            } catch (Exception ignored) {}
            try {
                if (i < partsB.length && !partsB[i].isEmpty()) b = Integer.parseInt(partsB[i]);
            } catch (Exception ignored) {}
            if (a < b) return -1;
            if (a > b) return 1;
        }
        return 0;
    }

    private String fetchLiveSyncText(String urlStr, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("Cache-Control", "no-store, no-cache");
            conn.setRequestProperty("Pragma", "no-cache");
            conn.setRequestProperty("User-Agent", "MovieHub-Android-LiveSync/3.5.267");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream is = conn.getInputStream();
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                int total = 0;
                while ((n = is.read(buf)) != -1) {
                    total += n;
                    if (total > 512 * 1024) break;
                    baos.write(buf, 0, n);
                }
                return baos.toString("UTF-8");
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String extractHtmlAssetFingerprint(String html, String serverVersion) {
        if (html == null) return serverVersion != null ? serverVersion : "";
        StringBuilder sb = new StringBuilder();
        if (serverVersion != null) sb.append(serverVersion).append("|");
        try {
            Matcher m = Pattern.compile("(assets/[A-Za-z0-9._-]+\\.(?:js|css)|/src/main\\.tsx)").matcher(html);
            while (m.find()) {
                sb.append(m.group(1)).append(";");
            }
        } catch (Exception ignored) {}
        if (sb.length() == 0) {
            sb.append(html.hashCode());
        }
        return sb.toString();
    }

    private void syncLiveWebAppIfAvailable(boolean force) {
        if (liveSyncInFlight || isPlaybackActive || exoActive) return;
        long now = System.currentTimeMillis();
        if (!force && lastLiveSyncCheckMs > 0 && (now - lastLiveSyncCheckMs) < 15000L) {
            return;
        }
        lastLiveSyncCheckMs = now;
        liveSyncInFlight = true;

        liveSyncExecutor.execute(() -> {
            try {
                String installedVersion = getInstalledAppVersionNameSafe();
                Set<String> candidates = new LinkedHashSet<>();

                // 1. Check Firestore admins/backend for dynamic liveAppUrl / webAppUrl
                try {
                    String fsRaw = fetchLiveSyncText(FIRESTORE_BACKEND_DOC_URL + "?t=" + System.currentTimeMillis(), 3500);
                    if (fsRaw != null && fsRaw.contains("fields")) {
                        JSONObject doc = new JSONObject(fsRaw);
                        JSONObject fields = doc.optJSONObject("fields");
                        if (fields != null) {
                            String[] keys = new String[] { "liveAppUrl", "webAppUrl", "frontendUrl", "url", "backendUrl" };
                            for (String key : keys) {
                                JSONObject fieldObj = fields.optJSONObject(key);
                                if (fieldObj != null && fieldObj.has("stringValue")) {
                                    String val = fieldObj.optString("stringValue", "").trim().replaceAll("/+$", "");
                                    if (val.startsWith("https://") && !val.contains("localhost") && !val.contains("127.0.0.1")) {
                                        candidates.add(val);
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}

                // 2. Fallback to known live deployed origins
                for (String c : LIVE_WEB_CANDIDATES) {
                    candidates.add(c);
                }

                for (String baseUrl : candidates) {
                    String healthRaw = fetchLiveSyncText(baseUrl + "/api/health?t=" + System.currentTimeMillis(), 3500);
                    if (healthRaw == null || !healthRaw.trim().startsWith("{")) continue;
                    JSONObject healthJson;
                    try {
                        healthJson = new JSONObject(healthRaw);
                    } catch (Exception e) {
                        continue;
                    }
                    if (!"ok".equalsIgnoreCase(healthJson.optString("status", ""))) continue;

                    String serverVersion = healthJson.optString("version", "").trim();
                    // Never switch WebView to an older deployment than the installed APK
                    if (!serverVersion.isEmpty() && compareVersionStrings(serverVersion, installedVersion) < 0) {
                        continue;
                    }

                    String html = fetchLiveSyncText(baseUrl + "/?_sync=" + System.currentTimeMillis(), 4000);
                    if (html == null || !html.toLowerCase(Locale.US).contains("<div id=\"root\"")) continue;
                    if (html.contains("accounts.google.com") || html.contains("__cookie_check")) continue;

                    final String fingerprint = extractHtmlAssetFingerprint(html, serverVersion);
                    final String targetOrigin = baseUrl;
                    ReleaseNotificationHelper.saveBackendBaseUrl(getApplicationContext(), targetOrigin);

                    runOnUiThread(() -> {
                        try {
                            if (isPlaybackActive || exoActive || isFinishing() || isDestroyed()) return;
                            if (getBridge() == null || getBridge().getWebView() == null) return;
                            WebView wv = getBridge().getWebView();
                            String currentUrl = wv.getUrl() != null ? wv.getUrl() : "";
                            boolean onLocalhost = currentUrl.isEmpty()
                                || currentUrl.startsWith("https://localhost")
                                || currentUrl.startsWith("http://localhost");
                            boolean originChanged = !targetOrigin.equals(activeLiveOrigin);
                            boolean buildChanged = !fingerprint.equals(activeLiveFingerprint);
                            if (onLocalhost || originChanged || buildChanged) {
                                activeLiveOrigin = targetOrigin;
                                activeLiveFingerprint = fingerprint;
                                wv.clearCache(false);
                                wv.loadUrl(targetOrigin + "/");
                            }
                        } catch (Exception ignored) {}
                    });
                    break;
                }
            } catch (Exception ignored) {
            } finally {
                liveSyncInFlight = false;
            }
        });
    }

    private long getTotalRamMb() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(memInfo);
                return memInfo.totalMem / (1024L * 1024L);
            }
        } catch (Exception ignored) {}
        return 4096L;
    }

    private boolean isLowRamDeviceCompat() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null && am.isLowRamDevice()) {
                return true;
            }
        } catch (Exception ignored) {}
        return getTotalRamMb() <= 3072L;
    }

    private void setupExoSurfaceContainer(WebView webView) {
        if (exoContainer != null || webView == null) return;
        try {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent == null) return;

            exoContainer = new FrameLayout(this);
            exoContainer.setBackgroundColor(Color.BLACK);
            exoContainer.setVisibility(View.GONE);

            exoTextureView = new TextureView(this);
            exoTextureView.setOpaque(true);
            exoTextureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override
                public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                    textureSurfaceAvailable = true;
                    if (exoActive && "texture".equals(currentSurfaceMode)) {
                        if (exoPlayer != null) {
                            exoPlayer.setVideoTextureView(exoTextureView);
                        }
                        if (pendingStartRunnable != null) {
                            Runnable r = pendingStartRunnable;
                            pendingStartRunnable = null;
                            r.run();
                        }
                    }
                }

                @Override
                public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
                    updateExoVideoSurfaceSize();
                }

                @Override
                public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
                    textureSurfaceAvailable = false;
                    if (exoPlayer != null && "texture".equals(currentSurfaceMode)) {
                        exoPlayer.setVideoTextureView(null);
                    }
                    return true;
                }

                @Override
                public void onSurfaceTextureUpdated(SurfaceTexture surface) {
                    exoFirstFrameRendered = true;
                }
            });

            exoSurfaceView = new SurfaceView(this);
            exoSurfaceView.setZOrderMediaOverlay(false);
            exoSurfaceView.setVisibility(View.GONE);
            exoSurfaceView.getHolder().addCallback(new SurfaceHolder.Callback() {
                @Override
                public void surfaceCreated(SurfaceHolder holder) {
                    surfaceHolderAvailable = true;
                    if (exoActive && "surface".equals(currentSurfaceMode)) {
                        if (exoPlayer != null) {
                            exoPlayer.setVideoSurfaceView(exoSurfaceView);
                        }
                        if (pendingStartRunnable != null) {
                            Runnable r = pendingStartRunnable;
                            pendingStartRunnable = null;
                            r.run();
                        }
                    }
                }

                @Override
                public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
                    updateExoVideoSurfaceSize();
                }

                @Override
                public void surfaceDestroyed(SurfaceHolder holder) {
                    surfaceHolderAvailable = false;
                    if (exoPlayer != null && "surface".equals(currentSurfaceMode)) {
                        exoPlayer.setVideoSurfaceView(null);
                    }
                }
            });

            FrameLayout.LayoutParams tvParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            );
            exoContainer.addView(exoTextureView, tvParams);
            exoContainer.addView(exoSurfaceView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            ));
            exoContainer.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                if ((r - l) != (or - ol) || (b - t) != (ob - ot)) {
                    v.post(this::updateExoVideoSurfaceSize);
                }
            });

            parent.addView(
                exoContainer,
                0,
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void updateExoVideoSurfaceSize() {
        if (exoContainer == null) return;
        View targetView = "surface".equals(currentSurfaceMode) ? exoSurfaceView : exoTextureView;
        if (targetView == null) return;
        int cw = exoContainer.getWidth();
        int ch = exoContainer.getHeight();
        if (cw <= 0 || ch <= 0) return;

        int vw = exoVideoWidth;
        int vh = exoVideoHeight;
        int targetW = cw;
        int targetH = ch;

        if (exoResizeMode == 3) {
            // Stretch / Fill exact container dimensions
            targetW = cw;
            targetH = ch;
        } else if (vw > 0 && vh > 0) {
            float videoRatio = (float) vw / (float) vh;
            float containerRatio = (float) cw / (float) ch;
            if (exoResizeMode == 4) {
                // Zoom / Cover (crop edges to fill screen without black bars)
                if (videoRatio > containerRatio) {
                    targetH = ch;
                    targetW = Math.max(1, Math.round(ch * videoRatio));
                } else {
                    targetW = cw;
                    targetH = Math.max(1, Math.round(cw / videoRatio));
                }
            } else {
                // Fit (original aspect ratio)
                if (videoRatio > containerRatio) {
                    targetW = cw;
                    targetH = Math.max(1, Math.round(cw / videoRatio));
                } else {
                    targetH = ch;
                    targetW = Math.max(1, Math.round(ch * videoRatio));
                }
            }
        }

        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) targetView.getLayoutParams();
        boolean changed = false;
        if (lp == null) {
            lp = new FrameLayout.LayoutParams(targetW, targetH, Gravity.CENTER);
            changed = true;
        } else if (lp.width != targetW || lp.height != targetH || lp.gravity != Gravity.CENTER) {
            lp.width = targetW;
            lp.height = targetH;
            lp.gravity = Gravity.CENTER;
            changed = true;
        }
        if (changed) {
            targetView.setLayoutParams(lp);
            targetView.requestLayout();
        }
        targetView.invalidate();
    }

    private void refreshExoStateSnapshot() {
        try {
            JSONObject obj = new JSONObject();
            obj.put("active", exoActive);
            String decoderName = exoActiveDecoderName != null ? exoActiveDecoderName : "";
            int errorCode = 0;
            int renderedFrames = 0;
            int droppedFrames = 0;
            boolean isSeekable = false;

            if (exoPlayer != null) {
                int state = exoPlayer.getPlaybackState();
                long posMs = Math.max(0L, exoPlayer.getCurrentPosition());
                long durMs = exoPlayer.getDuration();
                long bufMs = Math.max(0L, exoPlayer.getBufferedPosition());
                isSeekable = exoPlayer.isCurrentMediaItemSeekable();

                obj.put("state", state);
                obj.put("isPlaying", exoPlayer.isPlaying());
                obj.put("isBuffering", state == Player.STATE_BUFFERING);
                obj.put("ended", state == Player.STATE_ENDED);
                obj.put("seekable", isSeekable);
                obj.put("currentTime", posMs / 1000.0);
                obj.put("duration", (durMs > 0 && durMs != C.TIME_UNSET) ? (durMs / 1000.0) : 0.0);
                obj.put("bufferedPosition", bufMs / 1000.0);

                try {
                    DecoderCounters counters = exoPlayer.getVideoDecoderCounters();
                    if (counters != null) {
                        renderedFrames = Math.max(0, counters.renderedOutputBufferCount);
                        droppedFrames = Math.max(0, counters.droppedBufferCount);
                        if (renderedFrames > 0) {
                            exoFirstFrameRendered = true;
                        }
                    }
                } catch (Exception ignored) {}

                PlaybackException err = exoPlayer.getPlayerError();
                if (err != null) {
                    errorCode = err.errorCode;
                    if (exoErrorMessage == null || exoErrorMessage.isEmpty()) {
                        exoErrorMessage = err.getMessage() != null ? err.getMessage() : err.getErrorCodeName();
                    }
                }

                if (decoderName.isEmpty()) {
                    try {
                        for (int i = 0; i < exoPlayer.getCurrentTracks().getGroups().size(); i++) {
                            Tracks.Group g = exoPlayer.getCurrentTracks().getGroups().get(i);
                            if (g.getType() == C.TRACK_TYPE_VIDEO && g.isSelected()) {
                                Format fmt = g.getTrackFormat(0);
                                if (fmt.sampleMimeType != null) {
                                    decoderName = fmt.sampleMimeType;
                                }
                                break;
                            }
                        }
                    } catch (Exception ignored) {}
                }
            } else {
                obj.put("state", Player.STATE_IDLE);
                obj.put("isPlaying", false);
                obj.put("isBuffering", false);
                obj.put("ended", false);
                obj.put("seekable", false);
                obj.put("currentTime", 0.0);
                obj.put("duration", 0.0);
                obj.put("bufferedPosition", 0.0);
            }
            obj.put("videoWidth", exoVideoWidth);
            obj.put("videoHeight", exoVideoHeight);
            obj.put("firstFrameRendered", exoFirstFrameRendered);
            obj.put("renderedFrames", renderedFrames);
            obj.put("droppedFrames", droppedFrames);
            obj.put("preferSoftware", currentPreferSoftware);
            obj.put("isSoftwareDecoder", exoActiveDecoderIsSoftware);
            obj.put("surfaceMode", currentSurfaceMode);
            obj.put("surfaceType", "surface".equals(currentSurfaceMode) ? "SurfaceView" : "TextureView");
            obj.put("error", exoErrorMessage != null ? exoErrorMessage : "");
            obj.put("errorCode", errorCode);
            obj.put("decoderName", decoderName);
            obj.put("surfaceVisible", exoContainer != null && exoContainer.getVisibility() == View.VISIBLE);
            obj.put("audioTracks", new JSONArray(exoAudioTracksJson != null ? exoAudioTracksJson : "[]"));
            obj.put("subtitleTracks", new JSONArray(exoSubtitleTracksJson != null ? exoSubtitleTracksJson : "[]"));
            obj.put("cueText", exoActiveCueText != null ? exoActiveCueText : "");
            cachedExoStateJson = obj.toString();
        } catch (Exception ignored) {}
    }

    private String mapCleanLanguageCode(final String rawLang) {
        if (rawLang == null) return "";
        String code = rawLang.trim().toLowerCase(Locale.US).replaceAll("[-_].*$", "");
        switch (code) {
            case "hi": case "hin": case "hindi": return "Hindi";
            case "en": case "eng": case "english": return "English";
            case "ta": case "tam": case "tamil": return "Tamil";
            case "te": case "tel": case "telugu": return "Telugu";
            case "ml": case "mal": case "malayalam": return "Malayalam";
            case "kn": case "kan": case "kannada": return "Kannada";
            case "bn": case "ben": case "bengali": return "Bengali";
            case "mr": case "mar": case "marathi": return "Marathi";
            case "pa": case "pan": case "pun": case "punjabi": return "Punjabi";
            case "gu": case "guj": case "gujarati": return "Gujarati";
            case "ur": case "urd": case "urdu": return "Urdu";
            case "ja": case "jpn": case "japanese": return "Japanese";
            case "ko": case "kor": case "korean": return "Korean";
            case "zh": case "chi": case "zho": case "chinese": return "Chinese";
            case "es": case "spa": case "spanish": return "Spanish";
            case "fr": case "fre": case "fra": case "french": return "French";
            case "de": case "ger": case "deu": case "german": return "German";
            case "ar": case "ara": case "arabic": return "Arabic";
            case "ru": case "rus": case "russian": return "Russian";
            case "pt": case "por": case "portuguese": return "Portuguese";
            case "it": case "ita": case "italian": return "Italian";
            case "tr": case "tur": case "turkish": return "Turkish";
            case "th": case "tha": case "thai": return "Thai";
            case "id": case "ind": case "indonesian": return "Indonesian";
            case "und": case "unknown": return "";
            default: return "";
        }
    }

    private String sanitizeTrackDisplayName(final String langCode, final String rawTitle, final int trackType, final int countIdx) {
        String mappedLang = mapCleanLanguageCode(langCode);
        String cleaned = rawTitle != null ? rawTitle : "";
        cleaned = cleaned
            .replaceAll("(?i)https?://\\S+", " ")
            .replaceAll("(?i)www\\.\\S+", " ")
            .replaceAll("@[a-zA-Z0-9_]+", " ")
            .replaceAll("(?i)\\b(skymovieshd|filmyzilla|vegamovies|hdhub4u|mkvcinemas|katmoviehd|bolly4u|worldfree4u|moviesmod|uhdmovies|9xmovies|extramovies|olamovies|pagalworld|filmywap|mp4moviez|jalshamoviez|mlsbd|cinevez|tamilrockers|isaimini|movierulz)\\b", " ")
            .replaceAll("(?i)\\b[a-z0-9-]+\\.(com|net|org|in|me|cc|lol|fun|pw|club|site|pro|xyz|top|live|info|to)\\b", " ")
            .replaceAll("[:._]{2,}", " ")
            .replaceAll("(?i)\\[[^\\]]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\\d\\.\\d|ch)[^\\]]*\\]", " ")
            .replaceAll("(?i)\\([^)]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\\d\\.\\d|ch)[^)]*\\)", " ")
            .replaceAll("(?i)\\b(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|5\\.1|7\\.1|2\\.0|6ch|2ch|\\d+\\s*kbps|full|forced|sdh)\\b", " ")
            .replaceAll("[()\\[\\]{}•|:/\\\\-]+", " ")
            .replaceAll("\\s+", " ")
            .trim();

        String[] known = {
            "Hindi", "English", "Tamil", "Telugu", "Malayalam", "Kannada",
            "Bengali", "Marathi", "Punjabi", "Gujarati", "Urdu", "Japanese",
            "Korean", "Chinese", "Spanish", "French", "German", "Arabic",
            "Russian", "Portuguese", "Italian", "Turkish", "Thai", "Indonesian"
        };
        String detectedFromTitle = "";
        for (String name : known) {
            if (cleaned.toLowerCase(Locale.US).matches(".*\\b" + name.toLowerCase(Locale.US) + "\\b.*")) {
                detectedFromTitle = name;
                break;
            }
        }

        if (!mappedLang.isEmpty()) return mappedLang;
        if (!detectedFromTitle.isEmpty()) return detectedFromTitle;
        if (cleaned.length() >= 2 && !cleaned.toLowerCase(Locale.US).matches("^(track|audio|subtitle)\\s*\\d*$")) {
            return cleaned;
        }
        if (langCode != null && !langCode.trim().isEmpty() && !"und".equalsIgnoreCase(langCode.trim()) && langCode.trim().length() <= 3) {
            return langCode.trim().toUpperCase(Locale.US);
        }
        return trackType == C.TRACK_TYPE_AUDIO ? ("Audio " + (countIdx + 1)) : ("Subtitle " + (countIdx + 1));
    }

    private void acquirePlaybackLocks() {
        try {
            if (playbackWakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    playbackWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MovieHub:PlaybackWakeLock");
                    playbackWakeLock.setReferenceCounted(false);
                }
            }
            if (playbackWakeLock != null && !playbackWakeLock.isHeld()) {
                playbackWakeLock.acquire(4L * 60L * 60L * 1000L);
            }
        } catch (Exception ignored) {}
        try {
            if (playbackWifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    playbackWifiLock = wm.createWifiLock(mode, "MovieHub:PlaybackWifiLock");
                    playbackWifiLock.setReferenceCounted(false);
                }
            }
            if (playbackWifiLock != null && !playbackWifiLock.isHeld()) {
                playbackWifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releasePlaybackLocks() {
        try {
            if (playbackWakeLock != null && playbackWakeLock.isHeld()) {
                playbackWakeLock.release();
            }
        } catch (Exception ignored) {}
        try {
            if (playbackWifiLock != null && playbackWifiLock.isHeld()) {
                playbackWifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    private boolean isTransientIoPlaybackException(PlaybackException error) {
        if (error == null) return false;
        int code = error.errorCode;
        if (code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
            || code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
            || code == PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE
            || code == PlaybackException.ERROR_CODE_TIMEOUT) {
            return true;
        }
        Throwable cause = error;
        int depth = 0;
        while (cause != null && depth < 8) {
            String cls = cause.getClass().getName().toLowerCase(Locale.US);
            if (cls.contains("httpdatasource")
                || cls.contains("sockettimeoutexception")
                || cls.contains("eofexception")
                || cls.contains("connectexception")
                || cls.contains("unknownhostexception")) {
                return true;
            }
            String msg = cause.getMessage() != null ? cause.getMessage().toLowerCase(Locale.US) : "";
            if (msg.contains("timeout")
                || msg.contains("socket")
                || msg.contains("connection")
                || msg.contains("eof")
                || msg.contains("reset")
                || msg.contains("http")
                || msg.contains("unexpected")
                || msg.contains("source")
                || msg.contains("chunk")
                || msg.contains("broken pipe")) {
                return true;
            }
            cause = cause.getCause();
            depth++;
        }
        return false;
    }

    private void ensureExoPlayer(final boolean preferSoftware) {
        if (exoPlayer != null && currentPreferSoftware != preferSoftware) {
            try {
                exoPlayer.setVideoTextureView(null);
                exoPlayer.setVideoSurfaceView(null);
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
        currentPreferSoftware = preferSoftware;
        if (exoPlayer != null) return;

        boolean lowRam = isLowRamDeviceCompat();
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(30000)
            .setReadTimeoutMs(60000)
            .setAllowCrossProtocolRedirects(true)
            .setKeepPostFor302Redirects(true)
            .setUserAgent("MoviePortal/3.5.251 AndroidExoPlayer");

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                lowRam ? 20000 : 45000,
                lowRam ? 90000 : 180000,
                1500,
                lowRam ? 3500 : 5000
            )
            .build();

        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
            .setEnableDecoderFallback(true);

        if (preferSoftware) {
            MediaCodecSelector swFirstSelector = (mimeType, requiresSecureDecoder, requiresTunnelingDecoder) -> {
                List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> base =
                    MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, requiresSecureDecoder, requiresTunnelingDecoder);
                if (base == null || base.size() <= 1) return base;
                List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> sw = new ArrayList<>();
                List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> hw = new ArrayList<>();
                for (androidx.media3.exoplayer.mediacodec.MediaCodecInfo codec : base) {
                    String n = codec.name != null ? codec.name.toLowerCase(Locale.US) : "";
                    boolean isSw = n.startsWith("c2.android.") || n.startsWith("omx.google.") || !codec.hardwareAccelerated;
                    if (isSw) {
                        sw.add(codec);
                    } else {
                        hw.add(codec);
                    }
                }
                sw.addAll(hw);
                return sw;
            };
            renderersFactory.setMediaCodecSelector(swFirstSelector);
        }

        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);

        exoPlayer = new ExoPlayer.Builder(this, renderersFactory)
            .setMediaSourceFactory(
                new DefaultMediaSourceFactory(this)
                    .setDataSourceFactory(dataSourceFactory)
                    .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(4))
            )
            .setLoadControl(loadControl)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();

        exoPlayer.addAnalyticsListener(new AnalyticsListener() {
            @Override
            public void onVideoDecoderInitialized(EventTime eventTime, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                exoActiveDecoderName = decoderName != null ? decoderName : "";
                String lower = exoActiveDecoderName.toLowerCase(Locale.US);
                exoActiveDecoderIsSoftware = lower.startsWith("c2.android.") || lower.startsWith("omx.google.") || lower.contains(".sw.");
                refreshExoStateSnapshot();
            }

            @Override
            public void onRenderedFirstFrame(EventTime eventTime, Object output, long renderTimeMs) {
                exoFirstFrameRendered = true;
                refreshExoStateSnapshot();
            }
        });

        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onVideoSizeChanged(VideoSize videoSize) {
                exoVideoWidth = videoSize.width;
                exoVideoHeight = videoSize.height;
                updateExoVideoSurfaceSize();
                refreshExoStateSnapshot();
            }

            @Override
            public void onRenderedFirstFrame() {
                exoFirstFrameRendered = true;
                refreshExoStateSnapshot();
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                try {
                    List<JSONObject> audioList = new ArrayList<>();
                    List<JSONObject> textList = new ArrayList<>();
                    java.util.HashMap<String, Integer> audioLabelCounts = new java.util.HashMap<>();
                    java.util.HashMap<String, Integer> subLabelToListIdx = new java.util.HashMap<>();
                    java.util.HashMap<String, Integer> subLabelBestScore = new java.util.HashMap<>();
                    for (int g = 0; g < tracks.getGroups().size(); g++) {
                        Tracks.Group group = tracks.getGroups().get(g);
                        int type = group.getType();
                        if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
                        for (int t = 0; t < group.length; t++) {
                            if (!group.isTrackSupported(t)) continue;
                            Format fmt = group.getTrackFormat(t);
                            String lang = fmt.language != null ? fmt.language : "";
                            String rawLabel = fmt.label != null ? fmt.label : "";
                            String mime = fmt.sampleMimeType != null ? fmt.sampleMimeType.toLowerCase(Locale.US) : "";
                            int curIdx = type == C.TRACK_TYPE_AUDIO ? audioList.size() : textList.size();
                            String label = sanitizeTrackDisplayName(lang, fmt.label, type, curIdx);
                            boolean isForced = (fmt.selectionFlags & C.SELECTION_FLAG_FORCED) != 0
                                || rawLabel.toLowerCase(Locale.US).contains("forced");
                            boolean isBitmap = mime.contains("pgs") || mime.contains("vobsub") || mime.contains("dvbsubs");
                            if (type == C.TRACK_TYPE_TEXT) {
                                String key = label.toLowerCase(Locale.US);
                                int score = (isBitmap ? 0 : 100) + (isForced ? 0 : 50)
                                    + ((fmt.selectionFlags & C.SELECTION_FLAG_DEFAULT) != 0 ? 10 : 0);
                                JSONObject item = new JSONObject();
                                item.put("id", g + ":" + t);
                                item.put("label", label);
                                item.put("lang", lang);
                                item.put("selected", group.isTrackSelected(t));
                                item.put("forced", isForced);
                                item.put("codec", mime);
                                if (subLabelToListIdx.containsKey(key)) {
                                    int prevScore = subLabelBestScore.containsKey(key) ? subLabelBestScore.get(key) : -999;
                                    if (score > prevScore) {
                                        subLabelBestScore.put(key, score);
                                        textList.set(subLabelToListIdx.get(key), item);
                                    }
                                    continue;
                                }
                                subLabelToListIdx.put(key, textList.size());
                                subLabelBestScore.put(key, score);
                                textList.add(item);
                                continue;
                            }
                            String key = label.toLowerCase(Locale.US);
                            int prev = audioLabelCounts.containsKey(key) ? audioLabelCounts.get(key) : 0;
                            audioLabelCounts.put(key, prev + 1);
                            if (prev > 0) {
                                label = label + " (" + (prev + 1) + ")";
                            }
                            JSONObject item = new JSONObject();
                            item.put("id", g + ":" + t);
                            item.put("label", label);
                            item.put("lang", lang);
                            item.put("selected", group.isTrackSelected(t));
                            audioList.add(item);
                        }
                    }
                    exoAudioTracksJson = new JSONArray(audioList).toString();
                    exoSubtitleTracksJson = new JSONArray(textList).toString();
                    refreshExoStateSnapshot();
                } catch (Exception ignored) {}
            }

            @Override
            public void onCues(CueGroup cueGroup) {
                try {
                    if (cueGroup == null || cueGroup.cues == null || cueGroup.cues.isEmpty()) {
                        exoActiveCueText = "";
                    } else {
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i < cueGroup.cues.size(); i++) {
                            Cue cue = cueGroup.cues.get(i);
                            if (cue != null && cue.text != null) {
                                String raw = cue.text.toString()
                                    .replaceAll("\\{\\\\[^}]*\\}", "")
                                    .replaceAll("<[^>]+>", "")
                                    .trim();
                                if (!raw.isEmpty()) {
                                    if (sb.length() > 0) sb.append("\n");
                                    sb.append(raw);
                                }
                            }
                        }
                        exoActiveCueText = sb.toString();
                    }
                    refreshExoStateSnapshot();
                } catch (Exception ignored) {}
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_READY) {
                    exoAutoReconnectAttempts = 0;
                    exoErrorMessage = "";
                }
                refreshExoStateSnapshot();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    exoAutoReconnectAttempts = 0;
                    exoErrorMessage = "";
                }
                refreshExoStateSnapshot();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (exoActive && exoPlayer != null && currentExoMediaUrl != null && !currentExoMediaUrl.isEmpty()
                    && exoAutoReconnectAttempts < 8
                    && (isTransientIoPlaybackException(error) || exoPlayer.getCurrentPosition() > 15000L)) {
                    exoAutoReconnectAttempts++;
                    final long sessionSnapshot = exoSessionId;
                    final long resumePosMs = Math.max(0L, exoPlayer.getCurrentPosition());
                    final boolean isHlsPlaylist = currentExoMediaUrl.contains(".m3u8");
                    final boolean wasServerPiped = !isHlsPlaylist && (currentExoMediaUrl.contains("transcode=1") || currentExoMediaUrl.contains("remux=1"));
                    final String targetUrl = currentExoMediaUrl;
                    exoErrorMessage = "";
                    refreshExoStateSnapshot();

                    if (pendingExoReconnectRunnable != null) {
                        mainHandler.removeCallbacks(pendingExoReconnectRunnable);
                    }
                    pendingExoReconnectRunnable = () -> {
                        pendingExoReconnectRunnable = null;
                        if (!exoActive || exoSessionId != sessionSnapshot || exoPlayer == null) return;
                        try {
                            exoPlayer.stop();
                            MediaItem mediaItem = MediaItem.fromUri(Uri.parse(targetUrl));
                            if (!wasServerPiped && resumePosMs > 250L) {
                                exoPlayer.setMediaItem(mediaItem, resumePosMs);
                            } else {
                                exoPlayer.setMediaItem(mediaItem);
                            }
                            exoPlayer.prepare();
                            exoPlayer.setPlayWhenReady(true);
                            refreshExoStateSnapshot();
                        } catch (Throwable t) {
                            exoErrorMessage = t.getMessage() != null ? t.getMessage() : "Reconnect failed";
                            refreshExoStateSnapshot();
                        }
                    };
                    mainHandler.postDelayed(pendingExoReconnectRunnable, 900L * exoAutoReconnectAttempts);
                    return;
                }
                exoErrorMessage = error.getMessage() != null ? error.getMessage() : ("ExoPlayer error: " + error.getErrorCodeName());
                refreshExoStateSnapshot();
            }
        });
        // Keep subtitles disabled by default until user picks a subtitle language
        try {
            exoPlayer.setTrackSelectionParameters(
                exoPlayer.getTrackSelectionParameters()
                    .buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                    .build()
            );
        } catch (Exception ignored) {}
    }

    private void startExoPlaybackNative(final String url, final double startSec, final double speed) {
        startExoPlaybackNative(url, startSec, speed, false, "texture");
    }

    private void startExoPlaybackNative(final String url, final double startSec, final double speed, final boolean preferSoftware, final String surfaceMode) {
        try {
            if (pendingHideContainerRunnable != null) {
                mainHandler.removeCallbacks(pendingHideContainerRunnable);
                pendingHideContainerRunnable = null;
            }
            final long sessionId = ++this.exoSessionId;
            final String targetSurface = "surface".equalsIgnoreCase(surfaceMode) ? "surface" : "texture";
            currentSurfaceMode = targetSurface;

            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                setupExoSurfaceContainer(webView);
                webView.setLayerType(View.LAYER_TYPE_NONE, null);
                webView.setBackgroundColor(Color.TRANSPARENT);
            }
            if (exoContainer != null) {
                exoContainer.setVisibility(View.VISIBLE);
            }
            if (exoTextureView != null) {
                exoTextureView.setVisibility("texture".equals(targetSurface) ? View.VISIBLE : View.GONE);
            }
            if (exoSurfaceView != null) {
                exoSurfaceView.setVisibility("surface".equals(targetSurface) ? View.VISIBLE : View.GONE);
            }

            exoActive = true;
            currentExoMediaUrl = url != null ? url.trim() : "";
            exoAutoReconnectAttempts = 0;
            if (pendingExoReconnectRunnable != null) {
                mainHandler.removeCallbacks(pendingExoReconnectRunnable);
                pendingExoReconnectRunnable = null;
            }
            acquirePlaybackLocks();
            exoVideoWidth = 0;
            exoVideoHeight = 0;
            exoFirstFrameRendered = false;
            exoErrorMessage = "";
            exoActiveDecoderName = "";
            exoActiveDecoderIsSoftware = false;
            exoAudioTracksJson = "[]";
            exoSubtitleTracksJson = "[]";
            exoActiveCueText = "";

            ensureExoPlayer(preferSoftware);
            if (exoPlayer != null) {
                try {
                    exoPlayer.setTrackSelectionParameters(
                        exoPlayer.getTrackSelectionParameters()
                            .buildUpon()
                            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
                    );
                } catch (Exception ignored) {}
            }

            Runnable prepareRunnable = () -> {
                if (!exoActive || exoSessionId != sessionId || exoPlayer == null) return;
                try {
                    if ("surface".equals(targetSurface)) {
                        if (exoTextureView != null) exoPlayer.setVideoTextureView(null);
                        if (exoSurfaceView != null) exoPlayer.setVideoSurfaceView(exoSurfaceView);
                    } else {
                        if (exoSurfaceView != null) exoPlayer.setVideoSurfaceView(null);
                        if (exoTextureView != null) exoPlayer.setVideoTextureView(exoTextureView);
                    }

                    // Disable text subtitles by default until user selects one
                    exoPlayer.setTrackSelectionParameters(
                        exoPlayer.getTrackSelectionParameters()
                            .buildUpon()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
                    );

                    MediaItem mediaItem = MediaItem.fromUri(Uri.parse(url));
                    if (startSec > 0.25) {
                        exoPlayer.setMediaItem(mediaItem, (long) (startSec * 1000.0));
                    } else {
                        exoPlayer.setMediaItem(mediaItem);
                    }
                    exoPlayer.setPlaybackSpeed(speed > 0 ? (float) speed : 1.0f);
                    exoPlayer.prepare();
                    exoPlayer.setPlayWhenReady(true);

                    mainHandler.removeCallbacks(exoStateTicker);
                    mainHandler.post(exoStateTicker);
                    refreshExoStateSnapshot();
                } catch (Throwable t) {
                    exoErrorMessage = t.getMessage() != null ? t.getMessage() : "Native player init failed";
                    refreshExoStateSnapshot();
                }
            };

            boolean surfaceReady = ("surface".equals(targetSurface) && surfaceHolderAvailable)
                || ("texture".equals(targetSurface) && exoTextureView != null && (textureSurfaceAvailable || exoTextureView.isAvailable()));

            if (surfaceReady) {
                pendingStartRunnable = null;
                prepareRunnable.run();
            } else {
                pendingStartRunnable = prepareRunnable;
                if (exoContainer != null) {
                    exoContainer.requestLayout();
                }
                refreshExoStateSnapshot();
                // Safety fallback if OEM delays SurfaceTextureListener callback
                mainHandler.postDelayed(() -> {
                    if (exoActive && exoSessionId == sessionId && pendingStartRunnable != null) {
                        Runnable r = pendingStartRunnable;
                        pendingStartRunnable = null;
                        r.run();
                    }
                }, 1200);
            }
        } catch (Throwable t) {
            exoErrorMessage = t.getMessage() != null ? t.getMessage() : "Native player init failed";
            refreshExoStateSnapshot();
        }
    }

    private void stopExoPlaybackNative() {
        exoActive = false;
        exoSessionId++;
        currentExoMediaUrl = "";
        exoAutoReconnectAttempts = 0;
        pendingStartRunnable = null;
        if (pendingExoReconnectRunnable != null) {
            mainHandler.removeCallbacks(pendingExoReconnectRunnable);
            pendingExoReconnectRunnable = null;
        }
        mainHandler.removeCallbacks(exoStateTicker);
        if (!isPlaybackActive) {
            releasePlaybackLocks();
        }
        if (exoPlayer != null) {
            try {
                exoPlayer.stop();
                exoPlayer.clearMediaItems();
            } catch (Exception ignored) {}
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.BLACK);
        }
        // Delay hiding container briefly so consecutive episode switches or fallback retries keep SurfaceTexture alive
        if (pendingHideContainerRunnable != null) {
            mainHandler.removeCallbacks(pendingHideContainerRunnable);
        }
        pendingHideContainerRunnable = () -> {
            pendingHideContainerRunnable = null;
            if (!exoActive) {
                if (exoPlayer != null) {
                    try {
                        exoPlayer.setVideoTextureView(null);
                        exoPlayer.setVideoSurfaceView(null);
                    } catch (Exception ignored) {}
                }
                if (exoContainer != null) {
                    exoContainer.setVisibility(View.GONE);
                }
            }
        };
        mainHandler.postDelayed(pendingHideContainerRunnable, 140);

        exoVideoWidth = 0;
        exoVideoHeight = 0;
        exoFirstFrameRendered = false;
        exoErrorMessage = "";
        exoActiveDecoderName = "";
        exoActiveDecoderIsSoftware = false;
        exoAudioTracksJson = "[]";
        exoSubtitleTracksJson = "[]";
        exoActiveCueText = "";
        refreshExoStateSnapshot();
    }

    private void releaseExoPlayerInternal() {
        exoActive = false;
        exoSessionId++;
        currentExoMediaUrl = "";
        exoAutoReconnectAttempts = 0;
        pendingStartRunnable = null;
        if (pendingExoReconnectRunnable != null) {
            mainHandler.removeCallbacks(pendingExoReconnectRunnable);
            pendingExoReconnectRunnable = null;
        }
        if (pendingHideContainerRunnable != null) {
            mainHandler.removeCallbacks(pendingHideContainerRunnable);
            pendingHideContainerRunnable = null;
        }
        mainHandler.removeCallbacks(exoStateTicker);
        releasePlaybackLocks();
        if (exoPlayer != null) {
            try {
                exoPlayer.setVideoTextureView(null);
                exoPlayer.setVideoSurfaceView(null);
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
    }

    private void selectExoTrackNative(final int trackType, final String trackId) {
        if (exoPlayer == null) return;
        try {
            TrackSelectionParameters.Builder builder = exoPlayer.getTrackSelectionParameters().buildUpon();
            builder.clearOverridesOfType(trackType);

            if (trackId == null || trackId.trim().isEmpty() || "off".equalsIgnoreCase(trackId.trim())) {
                if (trackType == C.TRACK_TYPE_TEXT) {
                    builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
                    exoActiveCueText = "";
                    refreshExoStateSnapshot();
                }
                exoPlayer.setTrackSelectionParameters(builder.build());
                return;
            }

            builder.setTrackTypeDisabled(trackType, false);
            String[] parts = trackId.trim().split(":");
            if (parts.length == 2) {
                int groupIdx = Integer.parseInt(parts[0]);
                int trackIdx = Integer.parseInt(parts[1]);
                Tracks currentTracks = exoPlayer.getCurrentTracks();
                if (groupIdx >= 0 && groupIdx < currentTracks.getGroups().size()) {
                    Tracks.Group group = currentTracks.getGroups().get(groupIdx);
                    if (group.getType() == trackType && trackIdx >= 0 && trackIdx < group.length) {
                        builder.addOverride(new TrackSelectionOverride(group.getMediaTrackGroup(), trackIdx));
                    }
                }
            }
            exoPlayer.setTrackSelectionParameters(builder.build());
        } catch (Exception ignored) {}
    }

    private void showCustomFullscreenView(View view, WebChromeClient.CustomViewCallback callback) {
        // When native Media3 ExoPlayer is active, never place Chromium's opaque CustomView overlay above exoContainer
        if (exoActive) {
            isPlaybackFullscreen = true;
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            enableImmersiveStickyMode(true);
            if (callback != null) {
                mainHandler.post(() -> {
                    try { callback.onCustomViewHidden(); } catch (Exception ignored) {}
                });
            }
            mainHandler.post(this::updateExoVideoSurfaceSize);
            mainHandler.postDelayed(this::updateExoVideoSurfaceSize, 120);
            return;
        }
        if (view == null) {
            if (callback != null) {
                try { callback.onCustomViewHidden(); } catch (Exception ignored) {}
            }
            return;
        }
        if (customView != null) {
            if (callback != null) {
                try { callback.onCustomViewHidden(); } catch (Exception ignored) {}
            }
            return;
        }

        try {
            FrameLayout decorView = (FrameLayout) getWindow().getDecorView();
            customViewContainer = new FrameLayout(this);
            customViewContainer.setBackgroundColor(Color.BLACK);
            customViewContainer.setClickable(true);
            customViewContainer.setFocusable(true);

            customView = view;
            customViewCallback = callback;

            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            );
            customViewContainer.addView(customView, params);
            decorView.addView(customViewContainer, params);

            isPlaybackFullscreen = true;
            if (fullscreenBackCallback != null) {
                fullscreenBackCallback.setEnabled(true);
            }
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            enableImmersiveStickyMode(true);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void hideCustomFullscreenView() {
        if (isHidingCustomView) return;
        isHidingCustomView = true;
        try {
            if (customViewContainer != null) {
                try {
                    FrameLayout decorView = (FrameLayout) getWindow().getDecorView();
                    decorView.removeView(customViewContainer);
                } catch (Exception ignored) {}
                try {
                    customViewContainer.removeAllViews();
                } catch (Exception ignored) {}
                customViewContainer = null;
            }
            customView = null;

            WebChromeClient.CustomViewCallback cb = customViewCallback;
            customViewCallback = null;
            if (cb != null) {
                try { cb.onCustomViewHidden(); } catch (Exception ignored) {}
            }

            isPlaybackFullscreen = false;
            if (fullscreenBackCallback != null) {
                fullscreenBackCallback.setEnabled(false);
            }

            if (isPlaybackActive) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
            enableImmersiveStickyMode(false);
        } finally {
            isHidingCustomView = false;
        }
    }

    private boolean isValidApkZipHeader(File file) {
        if (file == null || !file.exists() || file.length() < 1024L * 1024L) {
            return false;
        }
        try (InputStream is = new java.io.FileInputStream(file)) {
            int b0 = is.read();
            int b1 = is.read();
            return b0 == 0x50 && b1 == 0x4B; // 'P', 'K'
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isValidParsedApkPackage(File apkFile) {
        if (!isValidApkZipHeader(apkFile)) {
            return false;
        }
        try {
            PackageInfo archiveInfo = getPackageManager().getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
            if (archiveInfo == null || archiveInfo.packageName == null) {
                return false;
            }
            return getPackageName().equals(archiveInfo.packageName);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isDeviceInSecureFrpOrUnprovisioned() {
        try {
            int provisioned = Settings.Global.getInt(getContentResolver(), Settings.Global.DEVICE_PROVISIONED, 1);
            if (provisioned == 0) {
                return true;
            }
        } catch (Exception ignored) {}
        try {
            int setupComplete = Settings.Secure.getInt(getContentResolver(), "user_setup_complete", 1);
            if (setupComplete == 0) {
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private String getApkArchiveVersionLabel(File apkFile) {
        try {
            if (apkFile != null && apkFile.exists()) {
                PackageInfo archiveInfo = getPackageManager().getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
                if (archiveInfo != null && archiveInfo.versionName != null && !archiveInfo.versionName.trim().isEmpty()) {
                    return "v" + archiveInfo.versionName.trim();
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private void handlePackageInstallerCallback(Intent intent) {
        if (intent == null) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmIntent = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmIntent != null) {
                try {
                    apkUpdateState = "installing";
                    apkUpdateProgress = 100;
                    String verLabel = getApkArchiveVersionLabel(downloadedApkFile);
                    apkUpdateMessage = "Update " + (verLabel.isEmpty() ? "" : verLabel + " ") + "ready! Tap Update / Install on the Android prompt.";
                    try {
                        startActivity(confirmIntent);
                    } catch (Exception firstConfirmEx) {
                        confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(confirmIntent);
                    }
                    return;
                } catch (Exception e) {
                    if (!legacyInstallFallbackTried && downloadedApkFile != null) {
                        legacyInstallFallbackTried = true;
                        launchLegacyFileProviderInstaller(downloadedApkFile);
                        return;
                    }
                    apkUpdateState = "error";
                    apkUpdateProgress = 100;
                    apkUpdateMessage = "Could not open system update prompt (" + (e.getMessage() != null ? e.getMessage() : "Error") + "). Tap Retry In-App Update.";
                }
            } else if (!legacyInstallFallbackTried && downloadedApkFile != null) {
                legacyInstallFallbackTried = true;
                launchLegacyFileProviderInstaller(downloadedApkFile);
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            apkUpdateState = "installing";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Update installed successfully! Restarting Movie Hub...";
            return;
        }

        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            apkUpdateState = "installing";
            apkUpdateProgress = 100;
            legacyInstallFallbackTried = false;
            preferLegacyInstallerOnRetry = true;
            apkUpdateMessage = "Update prompt closed. Tap \"Tap to Install Update\" below (ya \"Download & Install via Chrome\" try karein).";
            return;
        }

        if (status == PackageInstaller.STATUS_FAILURE_CONFLICT) {
            apkUpdateState = "error";
            apkUpdateProgress = 100;
            apkUpdateMessage = "APK signature conflict with the currently installed version. Please uninstall the old app once, or install via Browser.";
            return;
        }

        if (!legacyInstallFallbackTried && downloadedApkFile != null) {
            legacyInstallFallbackTried = true;
            launchLegacyFileProviderInstaller(downloadedApkFile);
            return;
        }

        apkUpdateState = "error";
        apkUpdateProgress = 100;
        apkUpdateMessage = "In-app installation failed" + (message != null && !message.trim().isEmpty() ? " (" + message.trim() + ")" : "") + ". Tap Retry In-App Update.";
    }

    private void installApkViaPackageInstallerSession(final File apkFile) {
        apkUpdateState = "installing";
        apkUpdateProgress = 100;
        String verLabel = getApkArchiveVersionLabel(apkFile);
        apkUpdateMessage = "Preparing in-app installer" + (verLabel.isEmpty() ? "" : " (" + verLabel + ")") + "...";

        new Thread(() -> {
            PackageInstaller.Session session = null;
            try {
                PackageInstaller packageInstaller = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL
                );
                params.setAppPackageName(getPackageName());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    params.setInstallReason(PackageManager.INSTALL_REASON_USER);
                }

                int sessionId = packageInstaller.createSession(params);
                session = packageInstaller.openSession(sessionId);

                try (InputStream in = new BufferedInputStream(new java.io.FileInputStream(apkFile), 65536);
                     OutputStream out = session.openWrite("movie_portal_update", 0, apkFile.length())) {
                    byte[] buffer = new byte[65536];
                    int bytesRead;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                    }
                    session.fsync(out);
                }

                Intent callbackIntent = new Intent(this, MainActivity.class);
                callbackIntent.setAction(ACTION_APK_INSTALL_RESULT);
                callbackIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pendingIntent = PendingIntent.getActivity(this, 4201, callbackIntent, piFlags);

                session.commit(pendingIntent.getIntentSender());
                session.close();
                session = null;
            } catch (Exception e) {
                if (session != null) {
                    try { session.abandon(); } catch (Exception ignored) {}
                }
                if (!legacyInstallFallbackTried) {
                    legacyInstallFallbackTried = true;
                    runOnUiThread(() -> launchLegacyFileProviderInstaller(apkFile));
                } else {
                    apkUpdateState = "error";
                    apkUpdateProgress = 100;
                    apkUpdateMessage = "Could not start in-app installer (" + (e.getMessage() != null ? e.getMessage() : "Error") + "). Tap Retry In-App Update.";
                }
            }
        }, "MoviePortalPackageInstaller").start();
    }

    private List<String> extractSigningCertDigests(PackageInfo pkgInfo) {
        List<String> digests = new ArrayList<>();
        if (pkgInfo == null) return digests;
        try {
            Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && pkgInfo.signingInfo != null) {
                SigningInfo si = pkgInfo.signingInfo;
                sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            }
            if (sigs == null || sigs.length == 0) {
                sigs = pkgInfo.signatures;
            }
            if (sigs != null) {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                for (Signature sig : sigs) {
                    if (sig == null) continue;
                    byte[] hash = md.digest(sig.toByteArray());
                    StringBuilder sb = new StringBuilder();
                    for (byte b : hash) {
                        sb.append(String.format(Locale.US, "%02x", b));
                    }
                    digests.add(sb.toString());
                }
            }
        } catch (Exception ignored) {}
        return digests;
    }

    private String checkApkCompatibilityBeforeInstall(File apkFile) {
        try {
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
            PackageInfo archiveInfo = getPackageManager().getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
            if (archiveInfo == null || archiveInfo.packageName == null) {
                return "Downloaded APK failed package verification. Tap Retry In-App Update.";
            }
            if (!getPackageName().equals(archiveInfo.packageName)) {
                return "Downloaded APK package mismatch (" + archiveInfo.packageName + ").";
            }

            PackageInfo installedInfo = getPackageManager().getPackageInfo(getPackageName(), flags);
            long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? installedInfo.getLongVersionCode()
                : installedInfo.versionCode;
            long archiveCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? archiveInfo.getLongVersionCode()
                : archiveInfo.versionCode;

            String installedLabel = installedInfo.versionName != null ? "v" + installedInfo.versionName : ("#" + installedCode);
            String archiveLabel = archiveInfo.versionName != null ? "v" + archiveInfo.versionName : ("#" + archiveCode);

            if (archiveCode > 0 && installedCode > 0 && archiveCode < installedCode) {
                return "Server par abhi purana APK (" + archiveLabel + ") hai aur aapke phone me " + installedLabel + " installed hai. Pehle naya release publish karein.";
            }

            List<String> installedSigs = extractSigningCertDigests(installedInfo);
            List<String> archiveSigs = extractSigningCertDigests(archiveInfo);
            if (!installedSigs.isEmpty() && !archiveSigs.isEmpty()) {
                boolean anyMatch = false;
                for (String aSig : archiveSigs) {
                    if (installedSigs.contains(aSig)) {
                        anyMatch = true;
                        break;
                    }
                }
                if (!anyMatch) {
                    return "App signature mismatch (" + installedLabel + " vs " + archiveLabel + "). Purana app ek baar uninstall karke niche \"Download & Install via Chrome\" se naya APK install karein.";
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private void launchLegacyFileProviderInstaller(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".fileprovider",
                apkFile
            );
            String verLabel = getApkArchiveVersionLabel(apkFile);
            apkUpdateState = "installing";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Update " + (verLabel.isEmpty() ? "" : verLabel + " ") + "ready! Tap Update / Install on the Android popup.";

            // Prefer direct ACTION_VIEW with FLAG_ACTIVITY_NEW_TASK (do NOT pass EXTRA_RETURN_RESULT or rely on singleTask startActivityForResult)
            Intent newTaskViewIntent = new Intent(Intent.ACTION_VIEW);
            newTaskViewIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            newTaskViewIntent.setClipData(android.content.ClipData.newRawUri("", apkUri));
            newTaskViewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            newTaskViewIntent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);

            try {
                startActivity(newTaskViewIntent);
                return;
            } catch (Exception primaryEx) {
                Intent installPkgIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                installPkgIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installPkgIntent.setClipData(android.content.ClipData.newRawUri("", apkUri));
                installPkgIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installPkgIntent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
                installPkgIntent.putExtra(Intent.EXTRA_RETURN_RESULT, true);

                try {
                    startActivityForResult(installPkgIntent, REQUEST_CODE_INSTALL_APK);
                    return;
                } catch (Exception secondaryEx) {
                    if (!legacyInstallFallbackTried && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        legacyInstallFallbackTried = true;
                        installApkViaPackageInstallerSession(apkFile);
                        return;
                    }
                    if (secondaryEx instanceof android.content.ActivityNotFoundException) {
                        apkUpdateState = "error";
                        apkUpdateProgress = 100;
                        apkUpdateMessage = "No Android Package Installer found on this device. Tap Download & Install via Chrome below.";
                        return;
                    }
                    throw secondaryEx;
                }
            }
        } catch (SecurityException secEx) {
            apkUpdateState = "error";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Android system security blocked in-app installation ("
                + (secEx.getMessage() != null ? secEx.getMessage() : "SecurityException")
                + "). Tap Download & Install via Chrome below.";
        } catch (Exception e) {
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Could not start Android installer ("
                + (e.getMessage() != null ? e.getMessage() : "Unknown error")
                + "). Tap Download & Install via Chrome below.";
        }
    }

    private void launchApkPackageInstaller(File apkFile) {
        if (!isValidApkZipHeader(apkFile)) {
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Downloaded update file is missing or incomplete. Please tap Retry In-App Update.";
            return;
        }

        if (!isValidParsedApkPackage(apkFile)) {
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Downloaded APK failed package verification. Tap Retry In-App Update.";
            return;
        }

        String compatIssue = checkApkCompatibilityBeforeInstall(apkFile);
        if (compatIssue != null) {
            apkUpdateState = "error";
            apkUpdateProgress = 100;
            apkUpdateMessage = compatIssue;
            return;
        }

        if (isDeviceInSecureFrpOrUnprovisioned()) {
            apkUpdateState = "error";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Android security lock (FRP / incomplete phone setup) is blocking APK installs on this device.";
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            pendingInstallAfterPermission = true;
            apkUpdateState = "permission_required";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Download complete! Tap \"Allow Install Permission\" below, enable \"Allow from this source\", then come back to install.";
            return;
        }

        pendingInstallAfterPermission = false;
        legacyInstallFallbackTried = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            installApkViaPackageInstallerSession(apkFile);
        } else {
            launchLegacyFileProviderInstaller(apkFile);
        }
    }

    private File resolveApkDownloadDir() {
        long minRecommendedBytes = 60L * 1024L * 1024L;
        File externalDir = null;
        try {
            externalDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        } catch (Exception ignored) {}
        if (externalDir != null) {
            if (!externalDir.exists()) {
                externalDir.mkdirs();
            }
            if (externalDir.exists() && externalDir.canWrite()
                && (externalDir.getUsableSpace() == 0 || externalDir.getUsableSpace() >= minRecommendedBytes)) {
                return externalDir;
            }
        }

        File internalUpdatesDir = new File(getFilesDir(), "apk_updates");
        if (!internalUpdatesDir.exists()) {
            internalUpdatesDir.mkdirs();
        }
        if (internalUpdatesDir.exists() && internalUpdatesDir.canWrite()) {
            return internalUpdatesDir;
        }
        return getFilesDir() != null ? getFilesDir() : getCacheDir();
    }

    private HttpURLConnection openApkHttpConnectionWithRedirects(String rawUrl) throws IOException {
        String currentUrl = rawUrl;
        for (int hops = 0; hops < 12; hops++) {
            URL urlObj = new URL(currentUrl);
            HttpURLConnection conn = (HttpURLConnection) urlObj.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(60000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "MoviePortal-AndroidUpdater/3.5.251");
            conn.setRequestProperty("Accept", "application/vnd.android.package-archive,application/octet-stream,*/*");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.connect();

            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("Redirect without Location header (HTTP " + code + ")");
                }
                currentUrl = new URL(urlObj, location.trim()).toString();
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("Server returned HTTP " + code);
            }
            return conn;
        }
        throw new IOException("Too many redirects while fetching APK");
    }

    private void startApkDownloadManager(final String apkUrl) {
        final String cleanUrl = apkUrl != null ? apkUrl.trim() : "";
        if (cleanUrl.isEmpty()) {
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Official APK download URL is missing.";
            return;
        }

        lastApkDownloadUrl = cleanUrl;
        if (isDownloadingApk && "downloading".equals(apkUpdateState)) return;
        isDownloadingApk = true;
        preferLegacyInstallerOnRetry = false;
        final long sessionSeq = ++apkDownloadSessionSeq;
        apkUpdateState = "downloading";
        apkUpdateProgress = 1;
        apkUpdateMessage = "Connecting to update server inside app...";

        new Thread(() -> {
            try {
                File targetDir = resolveApkDownloadDir();
                if (targetDir == null) {
                    apkUpdateState = "error";
                    apkUpdateProgress = 0;
                    apkUpdateMessage = "Storage directory unavailable. Please check device storage and tap Retry.";
                    return;
                }
                if (targetDir.getUsableSpace() > 0 && targetDir.getUsableSpace() < 60L * 1024L * 1024L) {
                    apkUpdateState = "error";
                    apkUpdateProgress = 0;
                    apkUpdateMessage = "Not enough free storage space (~60 MB required). Free up space and tap Retry.";
                    return;
                }

                File finalApkFile = new File(targetDir, "Movie-Portal-update.apk");
                File tempPartFile = new File(targetDir, "Movie-Portal-update.apk.part");
                String lastError = "Network error";

                for (int attempt = 1; attempt <= 2; attempt++) {
                    if (sessionSeq != apkDownloadSessionSeq) {
                        return;
                    }
                    HttpURLConnection conn = null;
                    try {
                        String attemptUrl = cleanUrl;
                        if (attempt > 1) {
                            apkUpdateProgress = 1;
                            apkUpdateMessage = "Retrying in-app download (attempt 2/2)...";
                            String officialUrl = "https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk";
                            if (!officialUrl.equals(cleanUrl)) {
                                attemptUrl = officialUrl;
                            }
                        }
                        if (tempPartFile.exists()) {
                            tempPartFile.delete();
                        }

                        conn = openApkHttpConnectionWithRedirects(attemptUrl);
                        String contentType = conn.getContentType();
                        if (contentType != null && contentType.toLowerCase(Locale.US).contains("text/html")) {
                            throw new IOException("Server returned HTML page instead of APK file");
                        }

                        long totalBytes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                            ? conn.getContentLengthLong()
                            : (long) conn.getContentLength();

                        long downloaded = 0L;
                        long lastUiUpdateMs = 0L;
                        byte[] buffer = new byte[65536];

                        try (InputStream in = new BufferedInputStream(conn.getInputStream(), 65536);
                             FileOutputStream out = new FileOutputStream(tempPartFile)) {
                            int bytesRead;
                            while ((bytesRead = in.read(buffer)) != -1) {
                                if (sessionSeq != apkDownloadSessionSeq) {
                                    return;
                                }
                                out.write(buffer, 0, bytesRead);
                                downloaded += bytesRead;

                                long now = System.currentTimeMillis();
                                if (now - lastUiUpdateMs >= 200L) {
                                    lastUiUpdateMs = now;
                                    long mbDone = downloaded / (1024L * 1024L);
                                    if (totalBytes > 0) {
                                        int pct = (int) Math.max(1, Math.min(99, (downloaded * 100L) / totalBytes));
                                        long mbTotal = Math.max(1L, totalBytes / (1024L * 1024L));
                                        apkUpdateProgress = pct;
                                        apkUpdateMessage = "Downloading update: " + mbDone + " MB / " + mbTotal + " MB (" + pct + "%)";
                                    } else {
                                        apkUpdateProgress = (int) Math.min(95, Math.max(2, downloaded / (2L * 1024L * 1024L)));
                                        apkUpdateMessage = "Downloading update: " + mbDone + " MB...";
                                    }
                                }
                            }
                            out.flush();
                        }

                        if (totalBytes > 0 && downloaded < totalBytes) {
                            throw new IOException("Incomplete download (" + downloaded + " / " + totalBytes + " bytes)");
                        }
                        if (!isValidParsedApkPackage(tempPartFile)) {
                            throw new IOException("Downloaded file is corrupted or not a valid Movie Hub APK");
                        }

                        if (finalApkFile.exists()) {
                            finalApkFile.delete();
                        }
                        if (!tempPartFile.renameTo(finalApkFile)) {
                            throw new IOException("Could not finalize downloaded APK file");
                        }

                        downloadedApkFile = finalApkFile;
                        apkUpdateProgress = 100;
                        String verLabel = getApkArchiveVersionLabel(finalApkFile);
                        apkUpdateMessage = "Download complete" + (verLabel.isEmpty() ? "" : " (" + verLabel + ")") + "! Launching installer inside app...";
                        final File readyFile = finalApkFile;
                        runOnUiThread(() -> launchApkPackageInstaller(readyFile));
                        return;
                    } catch (Exception ex) {
                        lastError = ex.getMessage() != null ? ex.getMessage() : "Connection interrupted";
                        if (tempPartFile.exists()) {
                            tempPartFile.delete();
                        }
                    } finally {
                        if (conn != null) {
                            try { conn.disconnect(); } catch (Exception ignored) {}
                        }
                    }
                }

                apkUpdateState = "error";
                apkUpdateProgress = 0;
                apkUpdateMessage = "In-app download failed (" + lastError + "). Check internet and tap Retry In-App Update.";
            } finally {
                if (sessionSeq == apkDownloadSessionSeq) {
                    isDownloadingApk = false;
                }
            }
        }, "MoviePortalApkUpdater").start();
    }

    // --- OFFLINE VIDEO DOWNLOAD MANAGER WITH NOTIFICATION BAR PROGRESS ---
    private File resolveOfflineMoviesDir() {
        File dir = new File(getFilesDir(), "offline_movies");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private boolean canPostVideoNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private PendingIntent buildOpenDownloadsPendingIntent(int requestCode) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("openTab", "downloads");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(this, requestCode, intent, flags);
    }

    private String formatBytesReadable(long bytes) {
        if (bytes <= 0L) return "0 MB";
        double mb = bytes / (1024.0 * 1024.0);
        if (mb >= 1024.0) {
            return String.format(Locale.US, "%.2f GB", mb / 1024.0);
        }
        return String.format(Locale.US, "%.1f MB", mb);
    }

    private String formatSpeedReadable(double bytesPerSec) {
        if (bytesPerSec <= 0) return "0 KB/s";
        double mb = bytesPerSec / (1024.0 * 1024.0);
        if (mb >= 1.0) {
            return String.format(Locale.US, "%.1f MB/s", mb);
        }
        return String.format(Locale.US, "%.0f KB/s", Math.max(1.0, bytesPerSec / 1024.0));
    }

    private String formatEtaReadable(long remainingBytes, double bytesPerSec) {
        if (bytesPerSec <= 1024.0 || remainingBytes <= 0L) return "Calculating...";
        long secs = Math.max(1L, Math.round(remainingBytes / bytesPerSec));
        long mins = secs / 60L;
        long remSecs = secs % 60L;
        if (mins > 0) return mins + "m " + remSecs + "s";
        return remSecs + "s";
    }

    private void updateVideoDownloadNotification(NativeVideoDownloadTask task, boolean isDone, boolean isError) {
        if (!canPostVideoNotifications()) return;
        try {
            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            if (task.cancelled.get()) {
                nm.cancel(task.notifId);
                return;
            }
            PendingIntent pi = buildOpenDownloadsPendingIntent(task.notifId);
            if (isDone) {
                NotificationCompat.Builder b = new NotificationCompat.Builder(this, VIDEO_DOWNLOAD_DONE_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_movie_portal)
                    .setColor(Color.parseColor("#00D664"))
                    .setContentTitle("Downloaded: " + task.title)
                    .setContentText(formatBytesReadable(task.totalBytes > 0 ? task.totalBytes : task.receivedBytes) + " • Tap to watch offline")
                    .setAutoCancel(true)
                    .setOngoing(false)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pi);
                nm.notify(task.notifId, b.build());
            } else if (isError) {
                NotificationCompat.Builder b = new NotificationCompat.Builder(this, VIDEO_DOWNLOAD_DONE_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_movie_portal)
                    .setColor(Color.parseColor("#EF4444"))
                    .setContentTitle("Download failed: " + task.title)
                    .setContentText(task.errorMessage != null && !task.errorMessage.isEmpty() ? task.errorMessage : "Tap to retry")
                    .setAutoCancel(true)
                    .setOngoing(false)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pi);
                nm.notify(task.notifId, b.build());
            } else {
                boolean indet = task.totalBytes <= 0L;
                String sub = task.paused.get()
                    ? ("Paused at " + task.progress + "%")
                    : (task.progress + "% • " + formatBytesReadable(task.receivedBytes)
                        + (task.totalBytes > 0 ? (" / " + formatBytesReadable(task.totalBytes)) : "")
                        + " • " + task.speed);
                NotificationCompat.Builder b = new NotificationCompat.Builder(this, VIDEO_DOWNLOAD_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_movie_portal)
                    .setColor(Color.parseColor("#00D664"))
                    .setContentTitle(task.paused.get() ? ("Paused: " + task.title) : ("Downloading " + task.progress + "% • " + task.title))
                    .setContentText(sub)
                    .setProgress(100, task.progress, indet)
                    .setOngoing(!task.paused.get())
                    .setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setContentIntent(pi);
                nm.notify(task.notifId, b.build());
            }
        } catch (Exception ignored) {}
    }

    private void executeNativeVideoDownloadTask(final NativeVideoDownloadTask task) {
        if (!task.running.compareAndSet(false, true)) return;
        videoDownloadExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                task.status = "downloading";
                task.errorMessage = "";
                updateVideoDownloadNotification(task, false, false);

                String activeUrl = task.primaryUrl;
                long existingOffset = task.partFile.exists() ? task.partFile.length() : 0L;

                for (int attempt = 0; attempt < 2; attempt++) {
                    if (task.cancelled.get() || task.paused.get()) return;
                    if (attempt == 1) {
                        if (task.fallbackUrl == null || task.fallbackUrl.trim().isEmpty() || task.fallbackUrl.equals(activeUrl)) {
                            throw new IOException("Stream source failed");
                        }
                        activeUrl = task.fallbackUrl;
                        existingOffset = task.partFile.exists() ? task.partFile.length() : 0L;
                    }

                    try {
                        String currentUrl = activeUrl;
                        for (int hops = 0; hops < 8; hops++) {
                            URL urlObj = new URL(currentUrl);
                            conn = (HttpURLConnection) urlObj.openConnection();
                            conn.setInstanceFollowRedirects(false);
                            conn.setConnectTimeout(25000);
                            conn.setReadTimeout(60000);
                            conn.setRequestMethod("GET");
                            conn.setRequestProperty("User-Agent", "MovieHub/3.5.237 AndroidDownloader");
                            conn.setRequestProperty("Accept-Encoding", "identity");
                            if (existingOffset > 0L && task.totalBytes > existingOffset) {
                                conn.setRequestProperty("Range", "bytes=" + existingOffset + "-" + (task.totalBytes - 1L));
                            }
                            conn.connect();

                            int code = conn.getResponseCode();
                            if (code == HttpURLConnection.HTTP_MOVED_PERM
                                || code == HttpURLConnection.HTTP_MOVED_TEMP
                                || code == HttpURLConnection.HTTP_SEE_OTHER
                                || code == 307 || code == 308) {
                                String loc = conn.getHeaderField("Location");
                                conn.disconnect();
                                conn = null;
                                if (loc == null || loc.trim().isEmpty()) {
                                    throw new IOException("Redirect without Location");
                                }
                                currentUrl = new URL(urlObj, loc.trim()).toString();
                                continue;
                            }
                            if (code < 200 || code >= 300) {
                                conn.disconnect();
                                conn = null;
                                throw new IOException("HTTP " + code);
                            }
                            break;
                        }

                        if (conn == null) throw new IOException("Connection failed");

                        int respCode = conn.getResponseCode();
                        boolean appendMode = (respCode == 206 && existingOffset > 0L);
                        if (!appendMode) {
                            existingOffset = 0L;
                        }

                        long contentLength = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                            ? conn.getContentLengthLong()
                            : (long) conn.getContentLength();
                        if (contentLength > 0L) {
                            task.totalBytes = existingOffset + contentLength;
                        }
                        task.receivedBytes = existingOffset;

                        long speedStartMs = System.currentTimeMillis();
                        long speedBytes = 0L;
                        long lastNotifMs = 0L;
                        double curBps = 0.0;
                        byte[] buf = new byte[65536];

                        try (InputStream in = new BufferedInputStream(conn.getInputStream(), 65536);
                             FileOutputStream out = new FileOutputStream(task.partFile, appendMode)) {
                            int n;
                            while ((n = in.read(buf)) != -1) {
                                if (task.cancelled.get()) {
                                    out.flush();
                                    return;
                                }
                                if (task.paused.get()) {
                                    out.flush();
                                    task.status = "paused";
                                    task.speed = "Paused";
                                    task.eta = "Paused";
                                    updateVideoDownloadNotification(task, false, false);
                                    return;
                                }
                                out.write(buf, 0, n);
                                task.receivedBytes += n;
                                speedBytes += n;

                                long now = System.currentTimeMillis();
                                long elapsed = now - speedStartMs;
                                if (elapsed >= 500L) {
                                    curBps = (speedBytes * 1000.0) / elapsed;
                                    speedStartMs = now;
                                    speedBytes = 0L;
                                }
                                if (now - lastNotifMs >= 450L) {
                                    lastNotifMs = now;
                                    int pct = task.totalBytes > 0L
                                        ? (int) Math.max(1, Math.min(99, (task.receivedBytes * 100L) / task.totalBytes))
                                        : (int) Math.min(95, Math.max(2, task.receivedBytes / (5L * 1024L * 1024L)));
                                    task.progress = pct;
                                    task.speed = formatSpeedReadable(curBps);
                                    task.eta = task.totalBytes > 0L
                                        ? formatEtaReadable(Math.max(0L, task.totalBytes - task.receivedBytes), curBps)
                                        : "Downloading...";
                                    updateVideoDownloadNotification(task, false, false);
                                }
                            }
                            out.flush();
                        }

                        if (task.cancelled.get() || task.paused.get()) return;
                        if (task.partFile.length() <= 0L) {
                            throw new IOException("Downloaded file was empty");
                        }
                        if (task.targetFile.exists()) {
                            task.targetFile.delete();
                        }
                        if (!task.partFile.renameTo(task.targetFile)) {
                            throw new IOException("Could not save final offline file");
                        }

                        task.progress = 100;
                        task.receivedBytes = task.targetFile.length();
                        task.totalBytes = task.targetFile.length();
                        task.speed = "Saved Offline";
                        task.eta = "0s";
                        task.localUri = Uri.fromFile(task.targetFile).toString();
                        task.status = "completed";
                        updateVideoDownloadNotification(task, true, false);
                        return;
                    } catch (IOException attemptErr) {
                        if (conn != null) {
                            try { conn.disconnect(); } catch (Exception ignored) {}
                            conn = null;
                        }
                        if (attempt == 1 || task.fallbackUrl == null || task.fallbackUrl.trim().isEmpty()) {
                            throw attemptErr;
                        }
                    }
                }
            } catch (Exception ex) {
                if (task.cancelled.get() || task.paused.get()) return;
                task.status = "error";
                task.speed = "0 KB/s";
                task.eta = "Failed";
                task.errorMessage = ex.getMessage() != null ? ex.getMessage() : "Download failed";
                updateVideoDownloadNotification(task, false, true);
            } finally {
                task.running.set(false);
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        });
    }

    private void refreshCastStatusSnapshot() {
        try {
            JSONObject json = new JSONObject();
            json.put("state", castSessionState);
            json.put("playerState", castPlayerState);
            json.put("connected", castSessionConnected && ("connected".equals(castSessionState) || "error".equals(castSessionState)));
            json.put("deviceName", castConnectedDeviceName != null ? castConnectedDeviceName : "");
            json.put("isPlaying", castIsPlaying);
            json.put("currentTime", castCurrentTimeSec);
            json.put("duration", castDurationSec);
            json.put("errorMessage", castErrorMessage != null ? castErrorMessage : "");
            cachedCastStatusJson = json.toString();
        } catch (Exception ignored) {}
    }

    private void syncCastRemoteMediaStatus() {
        if (currentCastSession != null) {
            try {
                castSessionConnected = currentCastSession.isConnected();
            } catch (Exception ignored) {}
        } else {
            castSessionConnected = false;
        }

        if (remoteMediaClient == null) {
            refreshCastStatusSnapshot();
            return;
        }
        MediaStatus ms = remoteMediaClient.getMediaStatus();
        long streamPos = remoteMediaClient.getApproximateStreamPosition();
        long streamDur = remoteMediaClient.getStreamDuration();
        if (streamPos >= 0) castCurrentTimeSec = (int) (streamPos / 1000L);
        if (streamDur >= 0) castDurationSec = (int) (streamDur / 1000L);

        if (ms == null) {
            refreshCastStatusSnapshot();
            return;
        }

        int playerState = ms.getPlayerState();
        int idleReason = ms.getIdleReason();

        if (playerState == MediaStatus.PLAYER_STATE_PLAYING) {
            castPlayerState = "playing";
            castIsPlaying = true;
            castErrorMessage = "";
            castSessionState = "connected";
        } else if (playerState == MediaStatus.PLAYER_STATE_PAUSED) {
            castPlayerState = "paused";
            castIsPlaying = false;
            castSessionState = "connected";
        } else if (playerState == MediaStatus.PLAYER_STATE_BUFFERING) {
            castPlayerState = "buffering";
            castIsPlaying = false;
            castSessionState = "connected";
        } else if (playerState == MediaStatus.PLAYER_STATE_LOADING) {
            castPlayerState = "loading";
            castIsPlaying = false;
            castSessionState = "connected";
        } else if (playerState == MediaStatus.PLAYER_STATE_IDLE) {
            castIsPlaying = false;
            if (idleReason == MediaStatus.IDLE_REASON_ERROR) {
                castPlayerState = "error";
                castSessionState = "error";
                if (castErrorMessage == null || castErrorMessage.isEmpty()) {
                    castErrorMessage = "TV receiver failed to decode or reach the video stream. Check Wi-Fi and video format.";
                }
            } else if (idleReason == MediaStatus.IDLE_REASON_FINISHED) {
                castPlayerState = "ended";
                castSessionState = "connected";
            } else if (idleReason == MediaStatus.IDLE_REASON_CANCELED) {
                castPlayerState = "idle";
            }
        }
        refreshCastStatusSnapshot();
    }

    private void initCastFramework() {
        try {
            if (castContext == null) {
                castContext = CastContext.getSharedInstance(this);
            }
            if (castContext != null && sessionManager == null) {
                sessionManager = castContext.getSessionManager();
                if (castSessionListener == null) {
                    castSessionListener = new SessionManagerListener<CastSession>() {
                        @Override
                        public void onSessionStarting(CastSession session) {
                            castSessionState = "connecting";
                            castPlayerState = "connecting";
                            castSessionConnected = false;
                            castIsPlaying = false;
                            castErrorMessage = "";
                            refreshCastStatusSnapshot();
                        }

                        @Override
                        public void onSessionStarted(CastSession session, String sessionId) {
                            currentCastSession = session;
                            remoteMediaClient = session.getRemoteMediaClient();
                            castSessionConnected = session.isConnected();
                            castSessionState = "connected";
                            if ((castConnectedDeviceName == null || castConnectedDeviceName.isEmpty())
                                    && session.getCastDevice() != null
                                    && session.getCastDevice().getFriendlyName() != null) {
                                castConnectedDeviceName = session.getCastDevice().getFriendlyName();
                            }
                            setupRemoteMediaClientCallbacks();
                            mainHandler.removeCallbacks(castStatusTicker);
                            mainHandler.post(castStatusTicker);
                            if (pendingCastMediaUrl != null && !pendingCastMediaUrl.isEmpty()) {
                                String urlToLoad = pendingCastMediaUrl;
                                pendingCastMediaUrl = null;
                                executeLoadMedia(urlToLoad, pendingCastTitle, pendingCastPoster, pendingCastCurrentTimeSec);
                            } else {
                                syncCastRemoteMediaStatus();
                            }
                        }

                        @Override
                        public void onSessionStartFailed(CastSession session, int error) {
                            castSessionState = "error";
                            castPlayerState = "error";
                            castSessionConnected = false;
                            castIsPlaying = false;
                            castErrorMessage = "Failed to start Cast session (Error " + error + ")";
                            currentCastSession = null;
                            remoteMediaClient = null;
                            mainHandler.removeCallbacks(castStatusTicker);
                            refreshCastStatusSnapshot();
                        }

                        @Override
                        public void onSessionEnding(CastSession session) {}

                        @Override
                        public void onSessionEnded(CastSession session, int error) {
                            castSessionState = "idle";
                            castPlayerState = "idle";
                            castSessionConnected = false;
                            castIsPlaying = false;
                            castCurrentTimeSec = 0;
                            castDurationSec = 0;
                            currentCastSession = null;
                            remoteMediaClient = null;
                            castConnectedDeviceName = "";
                            mainHandler.removeCallbacks(castStatusTicker);
                            refreshCastStatusSnapshot();
                        }

                        @Override
                        public void onSessionResuming(CastSession session, String sessionId) {
                            castSessionState = "connecting";
                            castPlayerState = "connecting";
                            castSessionConnected = false;
                            refreshCastStatusSnapshot();
                        }

                        @Override
                        public void onSessionResumed(CastSession session, boolean wasSuspended) {
                            currentCastSession = session;
                            remoteMediaClient = session.getRemoteMediaClient();
                            castSessionConnected = session.isConnected();
                            castSessionState = "connected";
                            if (session.getCastDevice() != null && session.getCastDevice().getFriendlyName() != null) {
                                castConnectedDeviceName = session.getCastDevice().getFriendlyName();
                            }
                            setupRemoteMediaClientCallbacks();
                            mainHandler.removeCallbacks(castStatusTicker);
                            mainHandler.post(castStatusTicker);
                            if (pendingCastMediaUrl != null && !pendingCastMediaUrl.isEmpty()) {
                                String urlToLoad = pendingCastMediaUrl;
                                pendingCastMediaUrl = null;
                                executeLoadMedia(urlToLoad, pendingCastTitle, pendingCastPoster, pendingCastCurrentTimeSec);
                            } else {
                                syncCastRemoteMediaStatus();
                            }
                        }

                        @Override
                        public void onSessionResumeFailed(CastSession session, int error) {
                            castSessionState = "error";
                            castPlayerState = "error";
                            castSessionConnected = false;
                            castIsPlaying = false;
                            castErrorMessage = "Failed to resume Cast session (Error " + error + ")";
                            currentCastSession = null;
                            remoteMediaClient = null;
                            mainHandler.removeCallbacks(castStatusTicker);
                            refreshCastStatusSnapshot();
                        }

                        @Override
                        public void onSessionSuspended(CastSession session, int reason) {}
                    };
                    sessionManager.addSessionManagerListener(castSessionListener, CastSession.class);
                }
            }

            if (sessionManager != null) {
                CastSession existing = sessionManager.getCurrentCastSession();
                if (existing != null && existing.isConnected()) {
                    currentCastSession = existing;
                    remoteMediaClient = existing.getRemoteMediaClient();
                    castSessionConnected = true;
                    castSessionState = "connected";
                    if (existing.getCastDevice() != null && existing.getCastDevice().getFriendlyName() != null) {
                        castConnectedDeviceName = existing.getCastDevice().getFriendlyName();
                    }
                    setupRemoteMediaClientCallbacks();
                    mainHandler.removeCallbacks(castStatusTicker);
                    mainHandler.post(castStatusTicker);
                    syncCastRemoteMediaStatus();
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    private void setupRemoteMediaClientCallbacks() {
        if (remoteMediaClient == null) return;
        if (remoteMediaCallback != null) {
            remoteMediaClient.unregisterCallback(remoteMediaCallback);
        }
        remoteMediaCallback = new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                syncCastRemoteMediaStatus();
            }

            @Override
            public void onMetadataUpdated() {
                syncCastRemoteMediaStatus();
            }
        };
        remoteMediaClient.registerCallback(remoteMediaCallback);
    }

    private String resolveCastMediaUrlNative(String rawUrl) {
        if (rawUrl == null) return "";
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return "";
        if (trimmed.contains("127.0.0.1") || trimmed.contains("localhost") || trimmed.startsWith("/")) {
            if (localStreamServer != null) {
                return localStreamServer.resolveCastUrl(trimmed);
            }
            return "";
        }
        if (trimmed.contains("t.me") || trimmed.contains("telegram.me")) {
            if (localStreamServer != null) {
                return localStreamServer.resolveCastUrl(trimmed);
            }
            return "";
        }
        return trimmed;
    }

    private void executeLoadMedia(String mediaUrl, String title, String posterUrl, long currentTimeSec) {
        if (remoteMediaClient == null) {
            castSessionState = "error";
            castPlayerState = "error";
            castIsPlaying = false;
            castErrorMessage = "Cast media client is not ready yet. Please reconnect to your TV.";
            refreshCastStatusSnapshot();
            return;
        }
        try {
            String resolvedUrl = resolveCastMediaUrlNative(mediaUrl);
            if (resolvedUrl == null || resolvedUrl.isEmpty() || resolvedUrl.contains("127.0.0.1") || resolvedUrl.contains("localhost")) {
                castSessionState = "error";
                castPlayerState = "error";
                castIsPlaying = false;
                castErrorMessage = "Cannot send a phone-local URL to TV. Connect phone and TV to the same Wi-Fi network.";
                refreshCastStatusSnapshot();
                return;
            }

            MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
            metadata.putString(MediaMetadata.KEY_TITLE, (title != null && !title.isEmpty()) ? title : "Movie Portal");
            if (posterUrl != null) {
                String cleanPoster = posterUrl.trim();
                if (cleanPoster.startsWith("https://") || cleanPoster.startsWith("http://")) {
                    try {
                        metadata.addImage(new WebImage(Uri.parse(cleanPoster)));
                    } catch (Exception ignored) {}
                }
            }

            String lowerUrl = resolvedUrl.toLowerCase(Locale.US);
            String mime = "video/mp4";
            if (lowerUrl.contains(".m3u8")) {
                mime = "application/x-mpegurl";
            } else if (lowerUrl.contains(".mpd")) {
                mime = "application/dash+xml";
            } else if (lowerUrl.contains(".webm")) {
                mime = "video/webm";
            } else if (lowerUrl.contains(".mkv") && !lowerUrl.contains("remux=1") && !lowerUrl.contains("transcode=1") && !lowerUrl.contains("cast=1")) {
                mime = "video/x-matroska";
            }

            MediaInfo mediaInfo = new MediaInfo.Builder(resolvedUrl)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                .setContentType(mime)
                .setMetadata(metadata)
                .build();

            MediaLoadRequestData loadData = new MediaLoadRequestData.Builder()
                .setMediaInfo(mediaInfo)
                .setAutoplay(true)
                .setCurrentTime(Math.max(0L, currentTimeSec * 1000L))
                .build();

            castPlayerState = "loading";
            castIsPlaying = false;
            castErrorMessage = "";
            refreshCastStatusSnapshot();

            remoteMediaClient.load(loadData).setResultCallback(result -> {
                if (result == null || !result.getStatus().isSuccess()) {
                    int code = result != null ? result.getStatus().getStatusCode() : -1;
                    String msg = (result != null && result.getStatus().getStatusMessage() != null)
                        ? result.getStatus().getStatusMessage()
                        : ("Load rejected (code " + code + ")");
                    castPlayerState = "error";
                    castSessionState = "error";
                    castIsPlaying = false;
                    castErrorMessage = "TV could not play this stream: " + msg;
                    refreshCastStatusSnapshot();
                } else {
                    syncCastRemoteMediaStatus();
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
            castPlayerState = "error";
            castSessionState = "error";
            castIsPlaying = false;
            castErrorMessage = "Error loading media on Cast receiver: " + e.getMessage();
            refreshCastStatusSnapshot();
        }
    }

    private void startCastDiscoveryNative() {
        initCastFramework();
        try {
            if (multicastLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    multicastLock = wm.createMulticastLock("movie_portal_cast_multicast");
                    multicastLock.setReferenceCounted(true);
                    multicastLock.acquire();
                }
            }
        } catch (Exception ignored) {}

        try {
            if (mediaRouter == null) {
                mediaRouter = MediaRouter.getInstance(this);
            }
            if (castRouteSelector == null) {
                castRouteSelector = new MediaRouteSelector.Builder()
                    .addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
                    .build();
            }
            if (mediaRouterCallback == null) {
                mediaRouterCallback = new MediaRouter.Callback() {
                    @Override
                    public void onRouteAdded(MediaRouter router, MediaRouter.RouteInfo route) {
                        refreshDiscoveredCastRoutes(router);
                    }

                    @Override
                    public void onRouteRemoved(MediaRouter router, MediaRouter.RouteInfo route) {
                        refreshDiscoveredCastRoutes(router);
                    }

                    @Override
                    public void onRouteChanged(MediaRouter router, MediaRouter.RouteInfo route) {
                        refreshDiscoveredCastRoutes(router);
                    }

                    @Override
                    public void onRouteSelected(MediaRouter router, MediaRouter.RouteInfo route) {
                        castConnectedDeviceName = route.getName();
                    }
                };
            }
            mediaRouter.removeCallback(mediaRouterCallback);
            mediaRouter.addCallback(
                castRouteSelector,
                mediaRouterCallback,
                MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY | MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN
            );
            refreshDiscoveredCastRoutes(mediaRouter);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void refreshDiscoveredCastRoutes(MediaRouter router) {
        if (router == null || castRouteSelector == null) return;
        try {
            List<JSONObject> list = new ArrayList<>();
            for (MediaRouter.RouteInfo route : router.getRoutes()) {
                if (route != null && !route.isDefault() && route.matchesSelector(castRouteSelector)) {
                    JSONObject item = new JSONObject();
                    item.put("id", route.getId());
                    item.put("name", route.getName());
                    String desc = route.getDescription();
                    item.put("type", (desc != null && !desc.isEmpty()) ? desc : "Google Cast");
                    list.add(item);
                }
            }
            synchronized (castLock) {
                discoveredDevicesJson = new JSONArray(list).toString();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void connectToCastRouteNative(final String routeId, final String videoUrl, final String title, final String posterUrl, final long currentTimeSec) {
        initCastFramework();
        if (mediaRouter == null) return;
        MediaRouter.RouteInfo targetRoute = null;
        for (MediaRouter.RouteInfo r : mediaRouter.getRoutes()) {
            if (r.getId().equals(routeId)) {
                targetRoute = r;
                break;
            }
        }
        if (targetRoute != null) {
            String resolved = resolveCastMediaUrlNative(videoUrl);
            if (resolved == null || resolved.isEmpty() || resolved.contains("127.0.0.1") || resolved.contains("localhost")) {
                castSessionState = "error";
                castPlayerState = "error";
                castSessionConnected = false;
                castIsPlaying = false;
                castErrorMessage = "Phone must be on the same Wi-Fi network as your TV (or have a public streaming backend) to cast.";
                refreshCastStatusSnapshot();
                return;
            }

            boolean sameSelectedRoute = targetRoute.isSelected()
                    && currentCastSession != null
                    && currentCastSession.isConnected();

            castConnectedDeviceName = targetRoute.getName();
            castErrorMessage = "";
            pendingCastMediaUrl = resolved;
            pendingCastTitle = title;
            pendingCastPoster = posterUrl;
            pendingCastCurrentTimeSec = currentTimeSec;

            if (sameSelectedRoute) {
                castSessionConnected = true;
                castSessionState = "connected";
                remoteMediaClient = currentCastSession.getRemoteMediaClient();
                setupRemoteMediaClientCallbacks();
                mainHandler.removeCallbacks(castStatusTicker);
                mainHandler.post(castStatusTicker);
                pendingCastMediaUrl = null;
                executeLoadMedia(resolved, title, posterUrl, currentTimeSec);
            } else {
                castSessionConnected = false;
                castSessionState = "connecting";
                castPlayerState = "connecting";
                castIsPlaying = false;
                refreshCastStatusSnapshot();
                mediaRouter.selectRoute(targetRoute);
            }
        } else {
            castSessionState = "error";
            castPlayerState = "error";
            castSessionConnected = false;
            castIsPlaying = false;
            castErrorMessage = "Target Cast device not found or went offline.";
            refreshCastStatusSnapshot();
        }
    }

    private void disconnectCastNative() {
        mainHandler.removeCallbacks(castStatusTicker);
        try {
            if (sessionManager != null) {
                sessionManager.endCurrentSession(true);
            }
            if (mediaRouter != null) {
                mediaRouter.selectRoute(mediaRouter.getDefaultRoute());
            }
        } catch (Exception ignored) {}
        castSessionState = "idle";
        castPlayerState = "idle";
        castSessionConnected = false;
        castIsPlaying = false;
        castCurrentTimeSec = 0;
        castDurationSec = 0;
        castErrorMessage = "";
        castConnectedDeviceName = "";
        pendingCastMediaUrl = null;
        currentCastSession = null;
        remoteMediaClient = null;
        refreshCastStatusSnapshot();
    }

    private void stopCastDiscoveryNative() {
        try {
            if (mediaRouter != null && mediaRouterCallback != null) {
                mediaRouter.removeCallback(mediaRouterCallback);
            }
        } catch (Exception ignored) {}
        try {
            if (multicastLock != null && multicastLock.isHeld()) {
                multicastLock.release();
            }
        } catch (Exception ignored) {}
    }

    public class PlayerBridge {
        @JavascriptInterface
        public void setPlaybackActive(final boolean active) {
            runOnUiThread(() -> {
                isPlaybackActive = active;
                if (active) {
                    acquirePlaybackLocks();
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    if (!isPlaybackFullscreen && customView == null) {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    }
                } else {
                    if (!exoActive) {
                        releasePlaybackLocks();
                    }
                    if (customView != null) {
                        hideCustomFullscreenView();
                    }
                    isPlaybackFullscreen = false;
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    enableImmersiveStickyMode(false);
                }
            });
        }

        @JavascriptInterface
        public void setPlaybackFullscreen(final boolean fullscreen) {
            runOnUiThread(() -> {
                isPlaybackFullscreen = fullscreen;
                if (fullscreen) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    enableImmersiveStickyMode(true);
                } else {
                    if (customView != null) {
                        hideCustomFullscreenView();
                    }
                    setRequestedOrientation(
                        isPlaybackActive
                            ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    );
                    enableImmersiveStickyMode(false);
                }
                if (exoActive) {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        WebView webView = getBridge().getWebView();
                        webView.setLayerType(View.LAYER_TYPE_NONE, null);
                        webView.setBackgroundColor(Color.TRANSPARENT);
                    }
                    if (exoContainer != null) {
                        exoContainer.setVisibility(View.VISIBLE);
                        exoContainer.requestLayout();
                    }
                    mainHandler.post(MainActivity.this::updateExoVideoSurfaceSize);
                    mainHandler.postDelayed(MainActivity.this::updateExoVideoSurfaceSize, 140);
                }
            });
        }

        @JavascriptInterface
        public String getAppVersionInfo() {
            try {
                PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                long vCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? pInfo.getLongVersionCode()
                    : pInfo.versionCode;
                JSONObject json = new JSONObject();
                json.put("packageName", getPackageName());
                json.put("versionName", pInfo.versionName != null ? pInfo.versionName : "3.5.267");
                json.put("versionCode", vCode);
                return json.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"com.moviebox.stream.app\",\"versionName\":\"3.5.267\",\"versionCode\":35267}";
            }
        }

        @JavascriptInterface
        public void setMandatoryUpdateRequired(final boolean required) {
            runOnUiThread(() -> {
                isMandatoryUpdateActive = required;
                if (mandatoryUpdateBackCallback != null) {
                    mandatoryUpdateBackCallback.setEnabled(required);
                }
            });
        }

        @JavascriptInterface
        public void downloadAndInstallApk(final String apkUrl) {
            if (apkUrl == null || apkUrl.trim().isEmpty()) {
                apkUpdateState = "error";
                apkUpdateMessage = "Official APK download URL is missing.";
                return;
            }
            final String targetUrl = apkUrl.trim();
            runOnUiThread(() -> {
                startApkDownloadManager(targetUrl);
            });
        }

        @JavascriptInterface
        public String getApkUpdateStatus() {
            try {
                JSONObject json = new JSONObject();
                json.put("state", apkUpdateState);
                json.put("progress", apkUpdateProgress);
                json.put("message", apkUpdateMessage);
                return json.toString();
            } catch (Exception e) {
                return "{\"state\":\"idle\",\"progress\":0,\"message\":\"\"}";
            }
        }

        @JavascriptInterface
        public void openUnknownSourcesSettings() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    pendingInstallAfterPermission = true;
                    try {
                        Intent intent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())
                        );
                        startActivity(intent);
                    } catch (Exception e) {
                        try {
                            Intent fallback = new Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + getPackageName())
                            );
                            startActivity(fallback);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void retryInstallDownloadedApk() {
            runOnUiThread(() -> {
                if (isValidParsedApkPackage(downloadedApkFile)) {
                    if (preferLegacyInstallerOnRetry) {
                        preferLegacyInstallerOnRetry = false;
                        String compatIssue = checkApkCompatibilityBeforeInstall(downloadedApkFile);
                        if (compatIssue != null) {
                            apkUpdateState = "error";
                            apkUpdateProgress = 100;
                            apkUpdateMessage = compatIssue;
                            return;
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                            launchApkPackageInstaller(downloadedApkFile);
                            return;
                        }
                        launchLegacyFileProviderInstaller(downloadedApkFile);
                    } else {
                        launchApkPackageInstaller(downloadedApkFile);
                    }
                } else if (lastApkDownloadUrl != null && !lastApkDownloadUrl.isEmpty()) {
                    startApkDownloadManager(lastApkDownloadUrl);
                } else {
                    launchApkPackageInstaller(downloadedApkFile);
                }
            });
        }

        @JavascriptInterface
        public void openApkDownloadInBrowser(final String apkUrl) {
            final String targetUrl = (apkUrl != null && !apkUrl.trim().isEmpty())
                ? apkUrl.trim()
                : (lastApkDownloadUrl != null && !lastApkDownloadUrl.isEmpty()
                    ? lastApkDownloadUrl
                    : "https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk");
            runOnUiThread(() -> {
                try {
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl));
                    browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(browserIntent);
                } catch (Exception e) {
                    apkUpdateState = "error";
                    apkUpdateMessage = "Could not open browser (" + (e.getMessage() != null ? e.getMessage() : "Error") + ").";
                }
            });
        }

        // --- GOOGLE CAST BRIDGE METHODS ---
        @JavascriptInterface
        public void startCastDiscovery() {
            runOnUiThread(MainActivity.this::startCastDiscoveryNative);
        }

        @JavascriptInterface
        public void stopCastDiscovery() {
            runOnUiThread(MainActivity.this::stopCastDiscoveryNative);
        }

        @JavascriptInterface
        public String getDiscoveredCastDevices() {
            synchronized (castLock) {
                return discoveredDevicesJson != null ? discoveredDevicesJson : "[]";
            }
        }

        @JavascriptInterface
        public String getCastStreamUrl(final String sourceUrl) {
            return resolveCastMediaUrlNative(sourceUrl);
        }

        @JavascriptInterface
        public void connectToCastDevice(final String routeId, final String videoUrl, final String title, final String posterUrl, final double currentTimeSec) {
            runOnUiThread(() -> connectToCastRouteNative(routeId, videoUrl, title, posterUrl, (long) currentTimeSec));
        }

        @JavascriptInterface
        public void disconnectCast() {
            runOnUiThread(MainActivity.this::disconnectCastNative);
        }

        @JavascriptInterface
        public void castPlay() {
            runOnUiThread(() -> {
                if (remoteMediaClient != null) {
                    remoteMediaClient.play().setResultCallback(res -> syncCastRemoteMediaStatus());
                }
            });
        }

        @JavascriptInterface
        public void castPause() {
            runOnUiThread(() -> {
                if (remoteMediaClient != null) {
                    remoteMediaClient.pause().setResultCallback(res -> syncCastRemoteMediaStatus());
                }
            });
        }

        @JavascriptInterface
        public void castSeek(final double seconds) {
            runOnUiThread(() -> {
                if (remoteMediaClient != null) {
                    try {
                        remoteMediaClient.seek(new MediaSeekOptions.Builder().setPosition((long)(seconds * 1000.0)).build())
                            .setResultCallback(res -> syncCastRemoteMediaStatus());
                    } catch (Exception ignored) {}
                }
            });
        }

        // --- NATIVE MEDIA3 EXOPLAYER BRIDGE METHODS ---
        @JavascriptInterface
        public boolean isExoSupported() {
            return true;
        }

        @JavascriptInterface
        public String getDeviceCapabilities() {
            try {
                JSONObject json = new JSONObject();
                json.put("sdkInt", Build.VERSION.SDK_INT);
                json.put("manufacturer", Build.MANUFACTURER);
                json.put("model", Build.MODEL);
                json.put("hardware", Build.HARDWARE);
                json.put("totalRamMb", getTotalRamMb());
                json.put("isLowRamDevice", isLowRamDeviceCompat());

                String webViewVer = "";
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        PackageInfo wvPkg = WebView.getCurrentWebViewPackage();
                        if (wvPkg != null && wvPkg.versionName != null) {
                            webViewVer = wvPkg.versionName;
                        }
                    }
                } catch (Exception ignored) {}
                json.put("webViewVersion", webViewVer);

                boolean supportsAvc = false;
                boolean hasHardwareAvc = false;
                boolean supportsHevc = false;
                boolean supportsHevc10Bit = false;
                boolean supportsHevc10BitHw = false;
                boolean supportsVp9 = false;
                boolean hasHardwareVp9 = false;
                boolean supportsAv1 = false;
                boolean hasHardwareAv1 = false;
                boolean hasHardwareHevc = false;
                boolean hasSoftwareHevc = false;
                int maxAvcWidth = 0;
                int maxAvcHeight = 0;
                int maxHevcWidth = 0;
                int maxHevcHeight = 0;

                boolean supportsAac = false;
                boolean supportsMp3 = false;
                boolean supportsAc3 = false;
                boolean supportsEac3 = false;
                boolean supportsDts = false;
                boolean supportsOpus = false;
                boolean supportsVorbis = false;
                boolean supportsFlac = false;

                JSONArray hardwareDecoders = new JSONArray();
                JSONArray softwareDecoders = new JSONArray();

                MediaCodecList codecList = new MediaCodecList(MediaCodecList.ALL_CODECS);
                MediaCodecInfo[] codecInfos = codecList.getCodecInfos();

                for (MediaCodecInfo info : codecInfos) {
                    if (info.isEncoder()) continue;
                    String name = info.getName().toLowerCase(Locale.US);
                    boolean isHardware;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        isHardware = info.isHardwareAccelerated();
                    } else {
                        isHardware = !name.startsWith("omx.google.") && !name.startsWith("c2.android.");
                    }

                    String[] types = info.getSupportedTypes();
                    for (String type : types) {
                        String lowerType = type.toLowerCase(Locale.US);
                        if (lowerType.equals("video/avc")) {
                            supportsAvc = true;
                            if (isHardware) hasHardwareAvc = true;
                            try {
                                MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(type);
                                if (caps != null && caps.getVideoCapabilities() != null) {
                                    MediaCodecInfo.VideoCapabilities vc = caps.getVideoCapabilities();
                                    if (vc.getSupportedWidths() != null && vc.getSupportedHeights() != null) {
                                        int w = vc.getSupportedWidths().getUpper();
                                        int h = vc.getSupportedHeights().getUpper();
                                        if (w > maxAvcWidth) maxAvcWidth = w;
                                        if (h > maxAvcHeight) maxAvcHeight = h;
                                    }
                                }
                            } catch (Exception ignored) {}
                        } else if (lowerType.equals("video/hevc")) {
                            supportsHevc = true;
                            if (isHardware) {
                                hasHardwareHevc = true;
                                hardwareDecoders.put(info.getName());
                            } else {
                                hasSoftwareHevc = true;
                                softwareDecoders.put(info.getName());
                            }
                            try {
                                MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(type);
                                if (caps != null && caps.profileLevels != null) {
                                    for (MediaCodecInfo.CodecProfileLevel pl : caps.profileLevels) {
                                        if (pl.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 ||
                                            pl.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10 ||
                                            pl.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus) {
                                            supportsHevc10Bit = true;
                                            if (isHardware) {
                                                supportsHevc10BitHw = true;
                                            }
                                        }
                                    }
                                }
                                if (caps != null && caps.getVideoCapabilities() != null) {
                                    MediaCodecInfo.VideoCapabilities vc = caps.getVideoCapabilities();
                                    if (vc.getSupportedWidths() != null && vc.getSupportedHeights() != null) {
                                        int w = vc.getSupportedWidths().getUpper();
                                        int h = vc.getSupportedHeights().getUpper();
                                        if (w > maxHevcWidth) maxHevcWidth = w;
                                        if (h > maxHevcHeight) maxHevcHeight = h;
                                    }
                                }
                            } catch (Exception ignored) {}
                        } else if (lowerType.equals("video/x-vnd.on2.vp9")) {
                            supportsVp9 = true;
                            if (isHardware) hasHardwareVp9 = true;
                        } else if (lowerType.equals("video/av01")) {
                            supportsAv1 = true;
                            if (isHardware) hasHardwareAv1 = true;
                        } else if (lowerType.equals("audio/mp4a-latm")) {
                            supportsAac = true;
                        } else if (lowerType.equals("audio/mpeg")) {
                            supportsMp3 = true;
                        } else if (lowerType.equals("audio/ac3")) {
                            supportsAc3 = true;
                        } else if (lowerType.equals("audio/eac3") || lowerType.equals("audio/eac3-joc")) {
                            supportsEac3 = true;
                        } else if (lowerType.equals("audio/vnd.dts") || lowerType.equals("audio/vnd.dts.hd")) {
                            supportsDts = true;
                        } else if (lowerType.equals("audio/opus")) {
                            supportsOpus = true;
                        } else if (lowerType.equals("audio/vorbis")) {
                            supportsVorbis = true;
                        } else if (lowerType.equals("audio/flac")) {
                            supportsFlac = true;
                        }
                    }
                }

                json.put("supportsAvc", supportsAvc);
                json.put("hasHardwareAvc", hasHardwareAvc);
                json.put("maxAvcWidth", maxAvcWidth);
                json.put("maxAvcHeight", maxAvcHeight);
                json.put("supportsHevc", supportsHevc);
                json.put("supportsHevc10Bit", supportsHevc10Bit);
                json.put("supportsHevc10BitHw", supportsHevc10BitHw);
                json.put("supportsVp9", supportsVp9);
                json.put("hasHardwareVp9", hasHardwareVp9);
                json.put("supportsAv1", supportsAv1);
                json.put("hasHardwareAv1", hasHardwareAv1);
                json.put("hasHardwareHevc", hasHardwareHevc);
                json.put("hasSoftwareHevc", hasSoftwareHevc);
                json.put("maxHevcWidth", maxHevcWidth);
                json.put("maxHevcHeight", maxHevcHeight);
                json.put("supportsAac", supportsAac);
                json.put("supportsMp3", supportsMp3);
                json.put("supportsAc3", supportsAc3);
                json.put("supportsEac3", supportsEac3);
                json.put("supportsDts", supportsDts);
                json.put("supportsOpus", supportsOpus);
                json.put("supportsVorbis", supportsVorbis);
                json.put("supportsFlac", supportsFlac);
                json.put("hardwareHevcDecoders", hardwareDecoders);
                json.put("softwareHevcDecoders", softwareDecoders);
                return json.toString();
            } catch (Exception e) {
                return "{\"sdkInt\":" + Build.VERSION.SDK_INT + ",\"supportsAvc\":true,\"hasHardwareAvc\":true,\"supportsHevc\":false,\"supportsHevc10Bit\":false,\"supportsAac\":true}";
            }
        }

        @JavascriptInterface
        public void playExoMedia(final String url, final double startSec, final double speed) {
            if (url == null || url.trim().isEmpty()) return;
            runOnUiThread(() -> startExoPlaybackNative(url.trim(), startSec, speed, false, "texture"));
        }

        @JavascriptInterface
        public void playExoMediaWithOptions(final String url, final double startSec, final double speed, final boolean preferSoftware, final String surfaceMode) {
            if (url == null || url.trim().isEmpty()) return;
            runOnUiThread(() -> startExoPlaybackNative(url.trim(), startSec, speed, preferSoftware, surfaceMode));
        }

        @JavascriptInterface
        public void stopExoMedia() {
            runOnUiThread(MainActivity.this::stopExoPlaybackNative);
        }

        @JavascriptInterface
        public void exoPlay() {
            runOnUiThread(() -> {
                if (exoPlayer != null) {
                    exoPlayer.setPlayWhenReady(true);
                    exoPlayer.play();
                    refreshExoStateSnapshot();
                }
            });
        }

        @JavascriptInterface
        public void exoPause() {
            runOnUiThread(() -> {
                if (exoPlayer != null) {
                    exoPlayer.pause();
                    refreshExoStateSnapshot();
                }
            });
        }

        @JavascriptInterface
        public void exoSeek(final double seconds) {
            runOnUiThread(() -> {
                if (exoPlayer != null) {
                    long targetMs = Math.max(0L, (long) (seconds * 1000.0));
                    exoPlayer.seekTo(targetMs);
                    refreshExoStateSnapshot();
                }
            });
        }

        @JavascriptInterface
        public void exoSetSpeed(final double speed) {
            runOnUiThread(() -> {
                if (exoPlayer != null && speed > 0) {
                    exoPlayer.setPlaybackSpeed((float) speed);
                    refreshExoStateSnapshot();
                }
            });
        }

        @JavascriptInterface
        public void exoSelectAudioTrack(final String trackId) {
            runOnUiThread(() -> selectExoTrackNative(C.TRACK_TYPE_AUDIO, trackId));
        }

        @JavascriptInterface
        public void exoSelectSubtitleTrack(final String trackId) {
            runOnUiThread(() -> selectExoTrackNative(C.TRACK_TYPE_TEXT, trackId));
        }

        @JavascriptInterface
        public void exoSetResizeMode(final int mode) {
            runOnUiThread(() -> {
                exoResizeMode = mode;
                updateExoVideoSurfaceSize();
            });
        }

        @JavascriptInterface
        public String getExoState() {
            return cachedExoStateJson != null ? cachedExoStateJson : "{}";
        }

        // --- OFFLINE VIDEO DOWNLOADER BRIDGE METHODS ---
        @JavascriptInterface
        public void startOfflineVideoDownload(final String id, final String title, final String primaryUrl, final String fallbackUrl) {
            if (id == null || id.trim().isEmpty() || primaryUrl == null || primaryUrl.trim().isEmpty()) return;
            String cleanId = id.replaceAll("[^a-zA-Z0-9._-]", "_");
            File dir = resolveOfflineMoviesDir();
            File targetFile = new File(dir, cleanId + ".mp4");
            File partFile = new File(dir, cleanId + ".mp4.part");
            NativeVideoDownloadTask task = new NativeVideoDownloadTask(
                id.trim(),
                (title != null && !title.trim().isEmpty()) ? title.trim() : "Movie Portal Video",
                primaryUrl.trim(),
                fallbackUrl != null ? fallbackUrl.trim() : "",
                targetFile,
                partFile
            );
            nativeVideoDownloads.put(task.id, task);
            executeNativeVideoDownloadTask(task);
        }

        @JavascriptInterface
        public void pauseOfflineVideoDownload(final String id) {
            if (id == null) return;
            NativeVideoDownloadTask task = nativeVideoDownloads.get(id.trim());
            if (task != null) {
                task.paused.set(true);
                task.status = "paused";
                task.speed = "Paused";
                task.eta = "Paused";
                updateVideoDownloadNotification(task, false, false);
            }
        }

        @JavascriptInterface
        public void resumeOfflineVideoDownload(final String id) {
            if (id == null) return;
            NativeVideoDownloadTask task = nativeVideoDownloads.get(id.trim());
            if (task != null && !"completed".equals(task.status)) {
                task.paused.set(false);
                task.cancelled.set(false);
                executeNativeVideoDownloadTask(task);
            }
        }

        @JavascriptInterface
        public void cancelOfflineVideoDownload(final String id) {
            if (id == null) return;
            NativeVideoDownloadTask task = nativeVideoDownloads.remove(id.trim());
            if (task != null) {
                task.cancelled.set(true);
                updateVideoDownloadNotification(task, false, false);
                try {
                    if (task.partFile.exists()) task.partFile.delete();
                    if (task.targetFile.exists()) task.targetFile.delete();
                } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public String getOfflineDownloadsStatus() {
            try {
                JSONArray arr = new JSONArray();
                for (NativeVideoDownloadTask task : nativeVideoDownloads.values()) {
                    JSONObject obj = new JSONObject();
                    obj.put("id", task.id);
                    obj.put("title", task.title);
                    obj.put("progress", task.progress);
                    obj.put("receivedBytes", task.receivedBytes);
                    obj.put("totalBytes", task.totalBytes);
                    obj.put("speed", task.speed);
                    obj.put("eta", task.eta);
                    obj.put("status", task.status);
                    obj.put("localUri", task.localUri);
                    obj.put("errorMessage", task.errorMessage);
                    arr.put(obj);
                }
                return arr.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public boolean offlineFileExists(final String localUriOrPath) {
            if (localUriOrPath == null || localUriOrPath.trim().isEmpty()) return false;
            try {
                String path = localUriOrPath.trim();
                if (path.startsWith("file://")) {
                    path = Uri.parse(path).getPath();
                }
                if (path == null || path.isEmpty()) return false;
                File f = new File(path);
                return f.exists() && f.length() > 0L;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean deleteOfflineVideoFile(final String localUriOrId) {
            if (localUriOrId == null || localUriOrId.trim().isEmpty()) return false;
            try {
                String val = localUriOrId.trim();
                File f;
                if (val.startsWith("file://") || val.startsWith("/")) {
                    String path = val.startsWith("file://") ? Uri.parse(val).getPath() : val;
                    f = path != null ? new File(path) : null;
                } else {
                    String cleanId = val.replaceAll("[^a-zA-Z0-9._-]", "_");
                    f = new File(resolveOfflineMoviesDir(), cleanId + ".mp4");
                }
                if (f != null && f.exists()) {
                    return f.delete();
                }
            } catch (Exception ignored) {}
            return false;
        }

        @JavascriptInterface
        public String getCastSessionStatus() {
            return cachedCastStatusJson != null
                ? cachedCastStatusJson
                : "{\"state\":\"idle\",\"playerState\":\"idle\",\"connected\":false,\"deviceName\":\"\",\"isPlaying\":false,\"currentTime\":0,\"duration\":0,\"errorMessage\":\"\"}";
        }

        // --- RICH RELEASE NOTIFICATION BRIDGE METHODS ---
        @JavascriptInterface
        public void showReleaseNotification(final String jsonPayload) {
            if (jsonPayload == null || jsonPayload.trim().isEmpty()) return;
            notificationExecutor.execute(() -> {
                ReleaseNotificationHelper.showRichReleaseNotificationFromJson(
                    getApplicationContext(),
                    jsonPayload,
                    false
                );
            });
        }

        @JavascriptInterface
        public void setBackendBaseUrl(final String baseUrl) {
            ReleaseNotificationHelper.saveBackendBaseUrl(getApplicationContext(), baseUrl);
        }

        @JavascriptInterface
        public void markAnnouncementNotified(final String announcementId) {
            ReleaseNotificationHelper.markAnnouncementNotified(getApplicationContext(), announcementId);
        }

        @JavascriptInterface
        public String consumePendingOpenMovieId() {
            String val = pendingOpenMovieId;
            pendingOpenMovieId = null;
            return val != null ? val : "";
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(MainActivity.this::requestPostNotificationsPermissionIfNeeded);
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveStickyMode(isPlaybackFullscreen || customView != null);
        }
    }

    private void enableImmersiveStickyMode(boolean hideAllSystemBars) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !hideAllSystemBars);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        if (hideAllSystemBars) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            controller.hide(WindowInsetsCompat.Type.statusBars());
            controller.show(WindowInsetsCompat.Type.navigationBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                getWindow().setNavigationBarColor(Color.BLACK);
                getWindow().setStatusBarColor(Color.BLACK);
            }
        }
    }
}
