package __PACKAGE__;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.List;

/**
 * Starts the app again from scratch when the web page asks for it (the page opens
 * intent://relaunch?mode=...#Intent;scheme=immersa;package=<this app>;end). The page cannot do it itself: an
 * intent to an app that is already open is only delivered to it, and the system then does not treat the start as a launch
 * from the Library (the Guardian comes back). This activity is in the APK, so no browser rewrites its intent.
 *
 * Modes (chosen on the page, so that they can be tried without rebuilding the APK):
 *   clear  - start the launcher activity in a new task and clear the old one (NEW_TASK | CLEAR_TASK)
 *   remove - close every other task of this app first, then start the launcher activity after a moment
 *   vr     - like clear, but with the category the Quest home uses to start VR apps, when the app declares it
 * Everything is written to logcat with the tag "immersa-relaunch":  adb logcat -s immersa-relaunch
 */
public class RelaunchActivity extends Activity {
    private static final String TAG = "immersa-relaunch";
    private static final String VR_CATEGORY = "com.oculus.intent.category.VR";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent() != null ? getIntent().getData() : null;
        String mode = data != null ? data.getQueryParameter("mode") : null;
        if (mode == null) mode = "clear";
        Log.i(TAG, "asked to relaunch, mode=" + mode + ", uri=" + data + ", task=" + getTaskId());

        final Intent launch = launchIntent("vr".equals(mode));
        if (launch == null) {
            Log.e(TAG, "no launcher activity found for " + getPackageName());
            finish();
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        Log.i(TAG, "launcher: " + launch.getComponent() + ", flags=0x" + Integer.toHexString(launch.getFlags()));

        if ("remove".equals(mode)) {
            removeOtherTasks();
            // Give the system a moment to take the old tasks down before the new start.
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    start(launch);
                }
            }, 500);
        } else {
            start(launch);
        }
    }

    private void start(Intent launch) {
        try {
            startActivity(launch);
            Log.i(TAG, "started");
        } catch (Exception e) {
            Log.e(TAG, "start failed: " + e);
        }
        finish();
    }

    // Closes the tasks of this app other than the one this activity is in.
    private void removeOtherTasks() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            List<ActivityManager.AppTask> tasks = am.getAppTasks();
            for (ActivityManager.AppTask t : tasks) {
                int id = t.getTaskInfo().id;
                if (id == getTaskId()) continue;
                Log.i(TAG, "removing task " + id);
                t.finishAndRemoveTask();
            }
        } catch (Exception e) {
            Log.e(TAG, "removing tasks failed: " + e);
        }
    }

    // The intent that starts the app: the one for the VR category when asked and declared, else the normal launcher one.
    private Intent launchIntent(boolean vr) {
        PackageManager pm = getPackageManager();
        if (vr) {
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(VR_CATEGORY).setPackage(getPackageName());
            ResolveInfo ri = pm.resolveActivity(q, 0);
            if (ri != null && ri.activityInfo != null) {
                Intent i = new Intent(Intent.ACTION_MAIN).addCategory(VR_CATEGORY);
                i.setClassName(ri.activityInfo.packageName, ri.activityInfo.name);
                return i;
            }
            Log.w(TAG, "no activity with category " + VR_CATEGORY + ", using the normal launcher intent");
        }
        return pm.getLaunchIntentForPackage(getPackageName());
    }
}
