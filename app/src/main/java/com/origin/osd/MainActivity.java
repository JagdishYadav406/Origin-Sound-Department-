package com.origin.osd;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_MEDIA = 7;
    private TextView status;
    private TextView detail;
    private Button pick;
    private ProgressBar progress;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(28));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("OSD");
        title.setTextSize(32);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView version = new TextView(this);
        version.setText("Origin Sound Department  •  v1.20.0");
        version.setTextSize(14);
        root.addView(version);

        TextView intro = new TextView(this);
        intro.setText("Audio and video processing with output checks and delivery evidence.");
        intro.setTextSize(16);
        intro.setPadding(0, dp(18), 0, dp(18));
        root.addView(intro);

        pick = new Button(this);
        pick.setText("Choose audio or video");
        pick.setAllCaps(false);
        pick.setOnClickListener(v -> chooseMedia());
        root.addView(pick, new LinearLayout.LayoutParams(-1, -2));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-1, dp(6));
        pp.topMargin = dp(16);
        root.addView(progress, pp);

        status = new TextView(this);
        status.setText("READY — Select a media file to begin.");
        status.setTextSize(17);
        status.setTypeface(null, android.graphics.Typeface.BOLD);
        status.setPadding(0, dp(18), 0, dp(8));
        root.addView(status);

        detail = new TextView(this);
        detail.setText("OSD runs on this device. Keep the app open while processing. The result and evidence are stored in the app's private files.");
        detail.setTextSize(14);
        root.addView(detail);

        TextView steps = new TextView(this);
        steps.setText("\nHOW TO USE\n1. Tap Choose audio or video.\n2. Select a supported media file.\n3. Wait for processing and quality checks.\n4. Read the result path and evidence status.");
        steps.setTextSize(15);
        root.addView(steps);

        TextView outputs = new TextView(this);
        outputs.setText("\nOUTPUT LOCATION\nAndroid/data/com.origin.osd/files/Music/OSD-output");
        outputs.setTextSize(13);
        root.addView(outputs);

        setContentView(scroll);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void chooseMedia() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "video/*"});
        i.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(i, PICK_MEDIA);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_MEDIA) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            status.setText("READY — No media selected.");
            return;
        }
        Uri uri = data.getData();
        status.setText("PREPARING — Copying selected media…");
        detail.setText("Please keep OSD open. Processing and verification will run in the background.");
        pick.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            try {
                File input = copyUriToInput(uri);
                File base = getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                if (base == null) throw new IllegalStateException("Android did not provide app storage");
                File output = new File(base, "OSD-output");
                if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Unable to create OSD output directory");
                // Remove previous success markers so a previous run cannot be mistaken for this run.
                deleteIfExists(new File(output, "evidence.json"));
                deleteIfExists(new File(output, "OSD-final.wav"));
                deleteIfExists(new File(output, "OSD-final.webm"));
                runOnUiThread(() -> status.setText("PROCESSING — OSD engine is running…"));
                runOsd(input, output);
                File report = new File(output, "evidence.json");
                File wav = new File(output, "OSD-final.wav");
                File webm = new File(output, "OSD-final.webm");
                File finalArtifact = wav.isFile() && wav.length() > 0 ? wav : (webm.isFile() && webm.length() > 0 ? webm : null);
                if (!report.isFile() || report.length() == 0 || finalArtifact == null)
                    throw new IllegalStateException("OSD returned without a final artifact and evidence report");
                String result = "COMPLETE — Output and evidence found.";
                String path = finalArtifact.getAbsolutePath();
                String evidence = report.getAbsolutePath();
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    status.setText(result);
                    detail.setText("Final file:\n" + path + "\n\nEvidence report:\n" + evidence);
                });
            } catch (Exception e) {
                String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    status.setText("FAILED — Output was not verified.");
                    detail.setText(message);
                });
            }
        });
    }

    private void deleteIfExists(File file) throws Exception {
        if (file.exists() && !file.delete()) throw new IllegalStateException("Unable to clear previous output marker: " + file.getName());
    }

    private File copyUriToInput(Uri uri) throws Exception {
        String name = displayName(uri);
        if (name == null || name.trim().isEmpty()) name = "input-media";
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        File base = getExternalFilesDir(Environment.DIRECTORY_MUSIC);
        if (base == null) throw new IllegalStateException("Android did not provide app storage");
        File inputDir = new File(base, "OSD-input");
        if (!inputDir.exists() && !inputDir.mkdirs()) throw new IllegalStateException("Unable to create OSD input directory");
        File input = new File(inputDir, name);
        try (InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(input, false)) {
            if (in == null) throw new IllegalStateException("Android could not open the selected media");
            byte[] buffer = new byte[256 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        }
        if (!input.isFile() || input.length() == 0) throw new IllegalStateException("Selected media could not be copied into OSD");
        return input;
    }

    private String displayName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) return c.getString(0);
        } finally { if (c != null) c.close(); }
        return null;
    }

    private void runOsd(File input, File output) {
        if (!Python.isStarted()) Python.start(new AndroidPlatform(this));
        Python.getInstance().getModule("osd.core").callAttr(
            "run_pipeline", input.getAbsolutePath(), output.getAbsolutePath(),
            -16.0, null, null, null, 0.0, true, false
        );
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
