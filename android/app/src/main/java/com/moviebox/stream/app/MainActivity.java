package com.moviebox.stream.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
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
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
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
    private volatile File downloadedApkFile = null;
    private volatile boolean isDownloadingApk = false;
    private long activeDownloadId = -1;
    private DownloadManager downloadManager;

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
        enableImmersiveStickyMode(isPlaybackFullscreen || customView != null);
    }

    @Override
    public void onDestroy() {
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
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
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
                if (!webViewConfigured) {
                    webView.addJavascriptInterface(new PlayerBridge(), "AndroidPlayerBridge");
                    webViewConfigured = true;
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void showCustomFullscreenView(View view, WebChromeClient.CustomViewCallback callback) {
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
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
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

    private void launchApkPackageInstaller(File apkFile) {
        if (apkFile == null || !apkFile.exists() || apkFile.length() < 1024L) {
            apkUpdateState = "error";
            apkUpdateMessage = "Downloaded update file was not found or is incomplete. Please tap Retry.";
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getPackageManager().canRequestPackageInstalls();
            if (!canInstall) {
                apkUpdateState = "permission_required";
                apkUpdateMessage = "Allow Movie Portal to install app updates in Android Settings, then tap Install Update.";
                return;
            }
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
            apkUpdateState = "error";
            apkUpdateMessage = "Could not open Android Package Installer: " + (e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
    }

    private void startApkDownloadManager(final String apkUrl) {
        if (isDownloadingApk) return;
        isDownloadingApk = true;
        apkUpdateState = "downloading";
        apkUpdateProgress = 0;
        apkUpdateMessage = "Preparing download via Android DownloadManager...";

        try {
            Uri uri = Uri.parse(apkUrl);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("Movie Portal Update");
            request.setDescription("Downloading Movie Portal v3.5.192 APK...");
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
            apkUpdateState = "error";
            apkUpdateProgress = 0;
            apkUpdateMessage = "Download failed: " + (e.getMessage() != null ? e.getMessage() : "Unknown error");
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
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
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
                json.put("versionName", pInfo.versionName != null ? pInfo.versionName : "3.5.192");
                json.put("versionCode", vCode);
                return json.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"com.moviebox.stream.app\",\"versionName\":\"3.5.192\",\"versionCode\":3412}";
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
            startApkDownloadManager(apkUrl.trim());
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
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveStickyMode(isPlaybackFullscreen || customView != null);
        }
    }

    private void enableImmersiveStickyMode(boolean hideAllSystemBars) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        if (hideAllSystemBars) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.hide(WindowInsetsCompat.Type.statusBars());
            controller.show(WindowInsetsCompat.Type.navigationBars());
        }
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
