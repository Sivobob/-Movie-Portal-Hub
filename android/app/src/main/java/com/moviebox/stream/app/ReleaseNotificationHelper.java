package com.moviebox.stream.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Build;
import android.text.TextUtils;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class ReleaseNotificationHelper {
    public static final String CHANNEL_ID = "movie_box_releases";
    private static final String PREFS_NAME = "movie_portal_notifications_v1";
    private static final String KEY_NOTIFIED_IDS = "notified_ids_json";
    private static final String KEY_SEEDED_INITIAL = "seeded_initial_v2";
    private static final String KEY_BACKEND_URL = "backend_base_url";
    private static final String WORK_NAME = "movie_portal_release_sync";

    private static final String FIRESTORE_RELEASE_FEED_URL =
        "https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/admins/latest_release_notification";

    private static final String[] FALLBACK_BACKEND_URLS = new String[] {
        "https://ais-pre-jledbsv5it3bzdsqu6r7up-560942295760.asia-northeast1.run.app",
        "https://ais-dev-jledbsv5it3bzdsqu6r7up-560942295760.asia-northeast1.run.app",
        "https://ais-pre-yaniwuwl6wc7ivl5tz2bbo-755452514312.asia-northeast1.run.app",
        "https://ais-dev-yaniwuwl6wc7ivl5tz2bbo-755452514312.asia-northeast1.run.app",
        "https://movie-portalhub-1012526016635.asia-southeast1.run.app"
    };

    public static void createNotificationChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Movie Portal Releases",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("New movies, web series and anime episode alerts");
            channel.enableLights(true);
            channel.setLightColor(Color.parseColor("#E50914"));
            channel.enableVibration(true);
            channel.setShowBadge(true);
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        } catch (Exception ignored) {}
    }

    public static void scheduleBackgroundWorker(Context context) {
        if (context == null) return;
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

            PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                ReleaseNotificationWorker.class,
                15,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build();

            WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            );
        } catch (Exception ignored) {}
    }

    public static void saveBackendBaseUrl(Context context, String baseUrl) {
        if (context == null || baseUrl == null) return;
        String clean = baseUrl.trim().replaceAll("/+$", "");
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) return;
        if (clean.contains("127.0.0.1") || clean.contains("localhost")) return;
        try {
            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_BACKEND_URL, clean).apply();
        } catch (Exception ignored) {}
    }

    private static List<String> getCandidateBackendUrls(Context context) {
        Set<String> urls = new LinkedHashSet<>();
        try {
            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_BACKEND_URL, "");
            if (saved != null && !saved.trim().isEmpty()) {
                urls.add(saved.trim().replaceAll("/+$", ""));
            }
        } catch (Exception ignored) {}
        for (String fallback : FALLBACK_BACKEND_URLS) {
            urls.add(fallback);
        }
        return new ArrayList<>(urls);
    }

    private static synchronized List<String> loadNotifiedIds(Context context) {
        List<String> list = new ArrayList<>();
        try {
            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_NOTIFIED_IDS, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.optString(i, "").trim();
                if (!id.isEmpty()) list.add(id);
            }
        } catch (Exception ignored) {}
        return list;
    }

    private static synchronized boolean isAlreadyNotified(Context context, String dedupeKey) {
        if (dedupeKey == null || dedupeKey.trim().isEmpty()) return false;
        return loadNotifiedIds(context).contains(dedupeKey.trim());
    }

    public static synchronized void markAnnouncementNotified(Context context, String dedupeKey) {
        if (context == null || dedupeKey == null || dedupeKey.trim().isEmpty()) return;
        try {
            String key = dedupeKey.trim();
            List<String> list = loadNotifiedIds(context);
            if (!list.contains(key)) {
                list.add(key);
                if (list.size() > 150) {
                    list = list.subList(list.size() - 150, list.size());
                }
                JSONArray arr = new JSONArray();
                for (String s : list) arr.put(s);
                SharedPreferences prefs = context.getApplicationContext()
                    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(KEY_NOTIFIED_IDS, arr.toString()).apply();
            }
        } catch (Exception ignored) {}
    }

    private static boolean hasPostNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public static boolean showRichReleaseNotificationFromJson(Context context, String jsonStr, boolean forceNotify) {
        if (context == null || jsonStr == null || jsonStr.trim().isEmpty()) return false;
        try {
            if (!hasPostNotificationPermission(context)) {
                return false;
            }

            JSONObject obj = new JSONObject(jsonStr);
            String id = obj.optString("id", "").trim();
            String movieId = obj.optString("movieId", "").trim();
            String title = obj.optString("title", "New Release").trim();
            String releaseYear = obj.optString("releaseYear", "").trim();
            String category = obj.optString("category", "").trim();
            boolean isSeries = obj.optBoolean("isSeries", false)
                || category.toLowerCase().contains("series");
            String language = obj.optString("language", "").trim();
            String genre = obj.optString("genre", "").trim();
            String qualityBadge = obj.optString("qualityBadge", "").trim();
            String runtime = obj.optString("runtime", "").trim();
            String message = obj.optString("message", "GO STREAM or DOWNLOAD NOW").trim();
            String backdropUrl = obj.optString("backdropUrl", "").trim();
            String posterUrl = obj.optString("posterUrl", "").trim();
            String explicitImage = obj.optString("imageUrl", "").trim();
            long createdAtMs = obj.optLong("createdAtMs", 0L);

            String dedupeKey = !id.isEmpty() ? id : (!movieId.isEmpty() ? (movieId + "_" + createdAtMs) : title);
            if (!forceNotify && isAlreadyNotified(context, dedupeKey)) {
                return false;
            }

            createNotificationChannel(context);

            String customTitle = obj.optString("notificationTitle", "").trim();
            String typeLabel = isSeries ? "Full Series" : "Full Movie";
            String yearPart = (!releaseYear.isEmpty() && !"0".equals(releaseYear)) ? (" (" + releaseYear + ")") : "";
            String contentTitle = !customTitle.isEmpty()
                ? customTitle
                : ("Watch Now : " + title + yearPart + " " + typeLabel + " available now");

            String customBody = obj.optString("notificationBody", "").trim();
            String detailsLine;
            if (!customBody.isEmpty()) {
                detailsLine = customBody;
            } else {
                List<String> detailParts = new ArrayList<>();
                if (!qualityBadge.isEmpty() && !"NONE".equalsIgnoreCase(qualityBadge)) {
                    detailParts.add(qualityBadge);
                }
                if (!language.isEmpty()) {
                    detailParts.add(language);
                }
                if (!genre.isEmpty()) {
                    detailParts.add(genre);
                }
                if (!runtime.isEmpty()) {
                    detailParts.add(runtime);
                }
                String baseMsg = !message.isEmpty() ? message : "GO STREAM or DOWNLOAD NOW";
                detailsLine = detailParts.isEmpty()
                    ? baseMsg
                    : (baseMsg + " • " + TextUtils.join(" • ", detailParts));
            }

            String bigImageUrl = !explicitImage.isEmpty()
                ? explicitImage
                : (!backdropUrl.isEmpty() ? backdropUrl : posterUrl);

            Bitmap bigBitmap = downloadBitmap(bigImageUrl, 1280);
            Bitmap posterBitmap = null;
            if (!posterUrl.isEmpty() && !posterUrl.equals(bigImageUrl)) {
                posterBitmap = downloadBitmap(posterUrl, 360);
            }
            if (posterBitmap == null) {
                posterBitmap = bigBitmap;
            }

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (!movieId.isEmpty()) {
                launchIntent.putExtra("openMovieId", movieId);
            }

            int requestCode = Math.abs(dedupeKey.hashCode());
            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, requestCode, launchIntent, pendingFlags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_movie_portal)
                .setColor(Color.parseColor("#E50914"))
                .setContentTitle(contentTitle)
                .setContentText(detailsLine)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pendingIntent);

            if (posterBitmap != null) {
                builder.setLargeIcon(posterBitmap);
            }

            if (bigBitmap != null) {
                NotificationCompat.BigPictureStyle style = new NotificationCompat.BigPictureStyle()
                    .bigPicture(bigBitmap)
                    .setBigContentTitle(contentTitle)
                    .setSummaryText(detailsLine);
                style.bigLargeIcon((Bitmap) null);
                builder.setStyle(style);
            } else {
                builder.setStyle(
                    new NotificationCompat.BigTextStyle()
                        .setBigContentTitle(contentTitle)
                        .bigText(detailsLine)
                );
            }

            NotificationManagerCompat.from(context).notify(requestCode, builder.build());
            markAnnouncementNotified(context, dedupeKey);
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    private static JSONArray fetchReleaseFeedFromFirestoreRest() {
        try {
            String raw = fetchUrlString(FIRESTORE_RELEASE_FEED_URL + "?t=" + System.currentTimeMillis());
            if (raw == null || raw.trim().isEmpty()) return null;
            JSONObject doc = new JSONObject(raw);
            JSONObject fields = doc.optJSONObject("fields");
            if (fields == null) return null;

            JSONObject itemsField = fields.optJSONObject("itemsJson");
            if (itemsField != null) {
                String itemsStr = itemsField.optString("stringValue", "").trim();
                if (!itemsStr.isEmpty()) {
                    JSONArray arr = new JSONArray(itemsStr);
                    if (arr.length() > 0) return arr;
                }
            }

            String latestId = optFieldString(fields, "latestId");
            String title = optFieldString(fields, "title");
            if (!latestId.isEmpty() && !title.isEmpty()) {
                JSONObject single = new JSONObject();
                single.put("id", latestId);
                single.put("movieId", optFieldString(fields, "movieId"));
                single.put("title", title);
                single.put("releaseYear", optFieldString(fields, "releaseYear"));
                single.put("category", optFieldString(fields, "category"));
                single.put("isSeries", optFieldBoolean(fields, "isSeries"));
                single.put("language", optFieldString(fields, "language"));
                single.put("genre", optFieldString(fields, "genre"));
                single.put("qualityBadge", optFieldString(fields, "qualityBadge"));
                single.put("runtime", optFieldString(fields, "runtime"));
                single.put("posterUrl", optFieldString(fields, "posterUrl"));
                single.put("backdropUrl", optFieldString(fields, "backdropUrl"));
                single.put("imageUrl", optFieldString(fields, "imageUrl"));
                single.put("message", optFieldString(fields, "message"));
                single.put("notificationTitle", optFieldString(fields, "notificationTitle"));
                single.put("notificationBody", optFieldString(fields, "notificationBody"));
                single.put("createdAtMs", optFieldLong(fields, "createdAtMs"));
                JSONArray wrapper = new JSONArray();
                wrapper.put(single);
                return wrapper;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String optFieldString(JSONObject fields, String key) {
        JSONObject f = fields.optJSONObject(key);
        if (f == null) return "";
        if (f.has("stringValue")) return f.optString("stringValue", "").trim();
        if (f.has("integerValue")) return f.optString("integerValue", "").trim();
        return "";
    }

    private static long optFieldLong(JSONObject fields, String key) {
        JSONObject f = fields.optJSONObject(key);
        if (f == null) return 0L;
        try {
            if (f.has("integerValue")) return Long.parseLong(f.optString("integerValue", "0"));
            if (f.has("doubleValue")) return (long) f.optDouble("doubleValue", 0);
        } catch (Exception ignored) {}
        return 0L;
    }

    private static boolean optFieldBoolean(JSONObject fields, String key) {
        JSONObject f = fields.optJSONObject(key);
        return f != null && f.optBoolean("booleanValue", false);
    }

    public static void syncAndNotifyLatestReleases(Context context) {
        if (context == null) return;
        if (!hasPostNotificationPermission(context)) {
            return;
        }
        try {
            // 1. Primary: public Firestore REST document mirror (always reachable directly, no login cookies)
            JSONArray arr = fetchReleaseFeedFromFirestoreRest();

            // 2. Fallback: backend /api/announcements/latest
            if (arr == null || arr.length() == 0) {
                for (String baseUrl : getCandidateBackendUrls(context)) {
                    String jsonBody = fetchUrlString(baseUrl + "/api/announcements/latest");
                    if (jsonBody != null && jsonBody.trim().startsWith("{")) {
                        JSONObject root = new JSONObject(jsonBody);
                        JSONArray apiArr = root.optJSONArray("announcements");
                        if (apiArr != null && apiArr.length() > 0) {
                            arr = apiArr;
                            break;
                        }
                    }
                }
            }

            if (arr == null || arr.length() == 0) return;

            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean hasSeeded = prefs.getBoolean(KEY_SEEDED_INITIAL, false);
            long nowMs = System.currentTimeMillis();

            int sentCount = 0;
            // Iterate oldest-to-newest among top results so newest lands on top
            int limit = Math.min(arr.length(), 10);
            for (int i = limit - 1; i >= 0; i--) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "").trim();
                String movieId = item.optString("movieId", "").trim();
                long createdAtMs = item.optLong("createdAtMs", 0L);
                String dedupeKey = !id.isEmpty() ? id : (movieId + "_" + createdAtMs);
                if (dedupeKey.isEmpty() || isAlreadyNotified(context, dedupeKey)) {
                    continue;
                }

                // On first launch, seed older releases (>15m ago) silently without flooding user
                if (!hasSeeded && createdAtMs > 0 && (nowMs - createdAtMs) > 15L * 60L * 1000L) {
                    markAnnouncementNotified(context, dedupeKey);
                    continue;
                }

                // Only notify releases from the last 48 hours
                if (createdAtMs > 0 && (nowMs - createdAtMs) > 48L * 60L * 60L * 1000L) {
                    markAnnouncementNotified(context, dedupeKey);
                    continue;
                }

                if (sentCount < 3) {
                    if (showRichReleaseNotificationFromJson(context, item.toString(), false)) {
                        sentCount++;
                    }
                } else {
                    markAnnouncementNotified(context, dedupeKey);
                }
            }

            if (!hasSeeded) {
                prefs.edit().putBoolean(KEY_SEEDED_INITIAL, true).apply();
            }
        } catch (Exception ignored) {}
    }

    private static String fetchUrlString(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "MoviePortal/3.5 AndroidWorker");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream is = conn.getInputStream();
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = is.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                return baos.toString("UTF-8");
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static Bitmap downloadBitmap(String imageUrl, int maxDimPx) {
        if (imageUrl == null || imageUrl.trim().isEmpty()) return null;
        String currentUrl = imageUrl.trim();
        for (int hops = 0; hops < 4; hops++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(9000);
                conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
                );
                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_TEMP
                    || status == HttpURLConnection.HTTP_MOVED_PERM
                    || status == 307
                    || status == 308) {
                    String nextLoc = conn.getHeaderField("Location");
                    if (nextLoc == null || nextLoc.trim().isEmpty()) return null;
                    currentUrl = new URL(url, nextLoc.trim()).toString();
                    continue;
                }
                if (status < 200 || status >= 300) return null;

                byte[] bytes;
                try (InputStream is = conn.getInputStream();
                     ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    int total = 0;
                    while ((n = is.read(buf)) != -1) {
                        total += n;
                        if (total > 6 * 1024 * 1024) break;
                        baos.write(buf, 0, n);
                    }
                    bytes = baos.toByteArray();
                }
                if (bytes.length == 0) return null;

                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                int sampleSize = 1;
                int largest = Math.max(bounds.outWidth, bounds.outHeight);
                while (largest > maxDimPx && (largest / sampleSize) > maxDimPx) {
                    sampleSize *= 2;
                }
                BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
                decodeOpts.inSampleSize = Math.max(1, sampleSize);
                decodeOpts.inPreferredConfig = Bitmap.Config.RGB_565;
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, decodeOpts);
            } catch (Exception e) {
                return null;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        return null;
    }
}
