package com.moviebox.stream.app;

import android.app.ActivityManager;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
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
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.net.wifi.WifiManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
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
import java.io.File;
import java.util.ArrayList;
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

    private volatile String apkUpdateState = "idle";
    private volatile int apkUpdateProgress = 0;
    private volatile String apkUpdateMessage = "";
    private volatile String lastApkDownloadUrl = "";
    private volatile File downloadedApkFile = null;
    private volatile boolean isDownloadingApk = false;
    private long activeDownloadId = -1;
    private DownloadManager downloadManager;

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
    private volatile String cachedExoStateJson = "{\"active\":false,\"state\":1,\"isPlaying\":false,\"isBuffering\":false,\"ended\":false,\"seekable\":false,\"currentTime\":0,\"duration\":0,\"bufferedPosition\":0,\"videoWidth\":0,\"videoHeight\":0,\"firstFrameRendered\":false,\"renderedFrames\":0,\"droppedFrames\":0,\"preferSoftware\":false,\"isSoftwareDecoder\":false,\"decoderName\":\"\",\"surfaceMode\":\"texture\",\"error\":\"\",\"audioTracks\":[],\"subtitleTracks\":[]}";

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
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!webViewConfigured || localStreamServer == null) {
            configureWebView();
        }
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
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                String channelId = "movie_box_releases";
                CharSequence name = "Movie Box Releases";
                String description = "New movies, series episodes and updates";
                int importance = android.app.NotificationManager.IMPORTANCE_HIGH;
                android.app.NotificationChannel channel = new android.app.NotificationChannel(channelId, name, importance);
                channel.setDescription(description);
                channel.enableLights(true);
                channel.enableVibration(true);
                channel.setShowBadge(true);
                android.app.NotificationManager notificationManager = getSystemService(android.app.NotificationManager.class);
                if (notificationManager != null) {
                    notificationManager.createNotificationChannel(channel);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
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
                    public void onShowCustomView(View view, CustomViewCallback callback) {
                        runOnUiThread(() -> showCustomFullscreenView(view, callback));
                    }

                    @Override
                    public void onHideCustomView() {
                        runOnUiThread(() -> hideCustomFullscreenView());
                    }
                });

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

        if (vw > 0 && vh > 0) {
            float videoRatio = (float) vw / (float) vh;
            float containerRatio = (float) cw / (float) ch;
            if (videoRatio > containerRatio) {
                targetW = cw;
                targetH = Math.max(1, Math.round(cw / videoRatio));
            } else {
                targetH = ch;
                targetW = Math.max(1, Math.round(ch * videoRatio));
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
            cachedExoStateJson = obj.toString();
        } catch (Exception ignored) {}
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
            .setReadTimeoutMs(45000)
            .setAllowCrossProtocolRedirects(true)
            .setKeepPostFor302Redirects(true)
            .setUserAgent("MoviePortal/3.5.221 AndroidExoPlayer");

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

        exoPlayer = new ExoPlayer.Builder(this, renderersFactory)
            .setMediaSourceFactory(
                new DefaultMediaSourceFactory(this)
                    .setDataSourceFactory(httpFactory)
                    .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(4))
            )
            .setLoadControl(loadControl)
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
                    for (int g = 0; g < tracks.getGroups().size(); g++) {
                        Tracks.Group group = tracks.getGroups().get(g);
                        int type = group.getType();
                        if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
                        for (int t = 0; t < group.length; t++) {
                            if (!group.isTrackSupported(t)) continue;
                            Format fmt = group.getTrackFormat(t);
                            String lang = fmt.language != null ? fmt.language : "";
                            String label = (fmt.label != null && !fmt.label.trim().isEmpty())
                                ? fmt.label.trim()
                                : (!lang.isEmpty()
                                    ? lang.toUpperCase(java.util.Locale.US)
                                    : (type == C.TRACK_TYPE_AUDIO ? "Track " + (audioList.size() + 1) : "Subtitle " + (textList.size() + 1)));
                            JSONObject item = new JSONObject();
                            item.put("id", g + ":" + t);
                            item.put("label", label);
                            item.put("lang", lang);
                            item.put("selected", group.isTrackSelected(t));
                            if (type == C.TRACK_TYPE_AUDIO) {
                                audioList.add(item);
                            } else {
                                textList.add(item);
                            }
                        }
                    }
                    exoAudioTracksJson = new JSONArray(audioList).toString();
                    exoSubtitleTracksJson = new JSONArray(textList).toString();
                    refreshExoStateSnapshot();
                } catch (Exception ignored) {}
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                refreshExoStateSnapshot();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                refreshExoStateSnapshot();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                exoErrorMessage = error.getMessage() != null ? error.getMessage() : ("ExoPlayer error: " + error.getErrorCodeName());
                refreshExoStateSnapshot();
            }
        });
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
            exoVideoWidth = 0;
            exoVideoHeight = 0;
            exoFirstFrameRendered = false;
            exoErrorMessage = "";
            exoActiveDecoderName = "";
            exoActiveDecoderIsSoftware = false;
            exoAudioTracksJson = "[]";
            exoSubtitleTracksJson = "[]";

            ensureExoPlayer(preferSoftware);

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
                    exoPlayer.setMediaItem(mediaItem);
                    if (startSec > 0.5) {
                        exoPlayer.seekTo((long) (startSec * 1000.0));
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
        pendingStartRunnable = null;
        mainHandler.removeCallbacks(exoStateTicker);
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
        refreshExoStateSnapshot();
    }

    private void releaseExoPlayerInternal() {
        exoActive = false;
        exoSessionId++;
        pendingStartRunnable = null;
        if (pendingHideContainerRunnable != null) {
            mainHandler.removeCallbacks(pendingHideContainerRunnable);
            pendingHideContainerRunnable = null;
        }
        mainHandler.removeCallbacks(exoStateTicker);
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

    private void openApkInSystemBrowser(final String apkUrl) {
        if (apkUrl == null || apkUrl.trim().isEmpty()) {
            apkUpdateState = "error";
            apkUpdateMessage = "Official APK download URL is missing.";
            return;
        }
        try {
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl.trim()));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            apkUpdateState = "installing";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Opened official APK download in your browser. Once downloaded, tap Movie-Portal.apk to install.";
            startActivity(browserIntent);
        } catch (Exception e) {
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Could not open browser for APK download: " + (e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
    }

    private void launchApkPackageInstaller(File apkFile) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            if (lastApkDownloadUrl != null && !lastApkDownloadUrl.isEmpty()) {
                openApkInSystemBrowser(lastApkDownloadUrl);
                return;
            }
            apkUpdateState = "permission_required";
            apkUpdateMessage = "Allow browser / File Manager to install apps in Android Settings, then tap Install.";
            return;
        }

        if (apkFile == null || !apkFile.exists() || apkFile.length() < 1024L) {
            if (lastApkDownloadUrl != null && !lastApkDownloadUrl.isEmpty()) {
                openApkInSystemBrowser(lastApkDownloadUrl);
                return;
            }
            apkUpdateState = "error";
            apkUpdateMessage = "Downloaded update file was not found or is incomplete. Please tap Retry.";
            return;
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".fileprovider",
                apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            apkUpdateState = "installing";
            apkUpdateProgress = 100;
            apkUpdateMessage = "Android Package Installer opened. Tap Install / Update, then reopen Movie Box.";
            startActivity(installIntent);
        } catch (Exception e) {
            if (lastApkDownloadUrl != null && !lastApkDownloadUrl.isEmpty()) {
                openApkInSystemBrowser(lastApkDownloadUrl);
                return;
            }
            apkUpdateState = "error";
            apkUpdateMessage = "Could not open Android Package Installer: " + (e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
    }

    private void startApkDownloadManager(final String apkUrl) {
        lastApkDownloadUrl = apkUrl != null ? apkUrl.trim() : "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            openApkInSystemBrowser(lastApkDownloadUrl);
            return;
        }
        if (isDownloadingApk) return;
        isDownloadingApk = true;
        apkUpdateState = "downloading";
        apkUpdateProgress = 0;
        apkUpdateMessage = "Preparing download via Android DownloadManager...";

        try {
            Uri uri = Uri.parse(apkUrl);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("Movie Portal Update");
            request.setDescription("Downloading latest Movie Portal update APK...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            
            File targetDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (targetDir == null) {
                targetDir = getCacheDir();
            }
            File apkFile = new File(targetDir, "Movie-Portal-update.apk");
            if (apkFile.exists()) {
                apkFile.delete();
            }
            request.setDestinationUri(Uri.fromFile(apkFile));
            request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI | DownloadManager.Request.NETWORK_MOBILE);
            request.setAllowedOverRoaming(true);

            downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager != null) {
                activeDownloadId = downloadManager.enqueue(request);
                downloadedApkFile = apkFile;
                startDownloadProgressPolling();
            } else {
                throw new Exception("DownloadManager service not available.");
            }
        } catch (Exception e) {
            isDownloadingApk = false;
            openApkInSystemBrowser(lastApkDownloadUrl);
        }
    }

    private void startDownloadProgressPolling() {
        new Thread(() -> {
            while (isDownloadingApk && activeDownloadId != -1 && downloadManager != null) {
                try {
                    DownloadManager.Query query = new DownloadManager.Query();
                    query.setFilterById(activeDownloadId);
                    Cursor cursor = downloadManager.query(query);
                    if (cursor != null && cursor.moveToFirst()) {
                        int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                        int downloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                        int totalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);

                        if (statusIndex >= 0) {
                            int status = cursor.getInt(statusIndex);
                            if (downloadedIndex >= 0 && totalIndex >= 0) {
                                long downloaded = cursor.getLong(downloadedIndex);
                                long total = cursor.getLong(totalIndex);
                                if (total > 0) {
                                    int pct = (int) Math.min(99, (downloaded * 100L) / total);
                                    apkUpdateProgress = pct;
                                    long mbDone = downloaded / (1024L * 1024L);
                                    long mbTotal = total / (1024L * 1024L);
                                    apkUpdateMessage = "Downloading update (" + mbDone + " MB / " + mbTotal + " MB)...";
                                } else {
                                    long mbDone = downloaded / (1024L * 1024L);
                                    apkUpdateMessage = "Downloading update (" + mbDone + " MB)...";
                                }
                            }

                            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                isDownloadingApk = false;
                                apkUpdateState = "installing";
                                apkUpdateProgress = 100;
                                apkUpdateMessage = "Download Complete. Opening Package Installer...";
                                final File readyFile = downloadedApkFile;
                                runOnUiThread(() -> launchApkPackageInstaller(readyFile));
                                cursor.close();
                                break;
                            } else if (status == DownloadManager.STATUS_FAILED) {
                                isDownloadingApk = false;
                                int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
                                int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
                                apkUpdateState = "error";
                                apkUpdateProgress = 0;
                                apkUpdateMessage = "Download failed (reason code " + reason + "). Please tap Retry.";
                                cursor.close();
                                break;
                            }
                        }
                        cursor.close();
                    }
                } catch (Exception ignored) {}
                try {
                    Thread.sleep(600);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }).start();
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
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    if (!isPlaybackFullscreen && customView == null) {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    }
                } else {
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
                json.put("versionName", pInfo.versionName != null ? pInfo.versionName : "3.5.221");
                json.put("versionCode", vCode);
                return json.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"com.moviebox.stream.app\",\"versionName\":\"3.5.221\",\"versionCode\":3441}";
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
                    try {
                        Intent intent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())
                        );
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void retryInstallDownloadedApk() {
            runOnUiThread(() -> launchApkPackageInstaller(downloadedApkFile));
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
        public String getExoState() {
            return cachedExoStateJson != null ? cachedExoStateJson : "{}";
        }

        @JavascriptInterface
        public String getCastSessionStatus() {
            return cachedCastStatusJson != null
                ? cachedCastStatusJson
                : "{\"state\":\"idle\",\"playerState\":\"idle\",\"connected\":false,\"deviceName\":\"\",\"isPlaying\":false,\"currentTime\":0,\"duration\":0,\"errorMessage\":\"\"}";
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
