package com.moviebox.stream.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class ReleaseNotificationWorker extends Worker {
    public ReleaseNotificationWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        ReleaseNotificationHelper.syncAndNotifyLatestReleases(getApplicationContext());
        return Result.success();
    }
}
