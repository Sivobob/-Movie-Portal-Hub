package com.moviebox.stream.app;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
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
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private LocalStreamServer localStreamServer;
    private boolean webViewConfigured = false;

    private FrameLayout customViewContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean isHidingCustomView = false;

    private boolean isPlaybackActive = false;
    private boolean isPlaybackFullscreen = false;
    private OnBackPressedCallback fullscreenBackCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        fullscreenBackCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
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
