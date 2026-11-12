package com.moviebox.stream.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableImmersiveStickyMode();
        configureWebView();
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
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
            android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
            String streamUrl = "https://ais-dev-d4oy4g4wkdxchvgc5wbbty-835315626292.asia-northeast1.run.app";
            cookieManager.setCookie(streamUrl, "__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None");
            cookieManager.setCookie("https://ais-pre-d4oy4g4wkdxchvgc5wbbty-835315626292.asia-northeast1.run.app", "__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None");
            cookieManager.flush();
            if (getBridge() != null && getBridge().getWebView() != null) {
                cookieManager.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
                android.webkit.WebSettings settings = getBridge().getWebView().getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                settings.setAllowFileAccessFromFileURLs(true);
                settings.setAllowUniversalAccessFromFileURLs(true);
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveStickyMode();
        }
    }

    private void enableImmersiveStickyMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
