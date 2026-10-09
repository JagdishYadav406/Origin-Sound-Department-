package com.origin.osd;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.widget.Button;
import android.widget.ProgressBar;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;
import android.graphics.Typeface;
import android.view.ViewGroup;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_MEDIA = 7;
    private LinearLayout root;
    private TextView status;
    private Button pick;
    private TextView detail;
    private ProgressBar progress;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        root = new LinearLayout(this);
        root.setBackgroundColor(0xFF0B0F14);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 40, 32, 32);

        TextView title = new TextView(this);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setText("OSD 1.20.0");
        title.setTextSize(28);
        root.addView(title);

        TextView access = new TextView(this);
        access.setText("EASY ACCESS");
        access.setTextSize(12);
        access.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        access.setPadding(0, 24, 0, 8);
        root.addView(access);

        status = new TextView(this);
        status.setText("READY — OSD engine connected");
        root.addView(status);
        detail = new TextView(this);
        detail.setText("Choose a local audio or video file. OSD will process it and verify the output.");
        detail.setTextSize(14);
        root.addView(detail);

        TextView help = new TextView(this);
        help.setText("Select local audio/video → OSD processes it → QC verifies loudness, true peak and delivery evidence.");
        help.setTextSize(14);
        help.setPadding(0, 8, 0, 16);
        root.addView(help);

        pick = new Button(this);
        pick.setText("Choose audio or video");
        pick.setOnClickListener(v -> chooseMedia());
        root.addView(pick);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(-1, 12));

        Button output = new Button(this);
        output.setText("Open OSD output folder");
        output.setOnClickListener(v -> openOutputFolder());
        root.addView(output);
        setContentView(root);
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
            status.setText("No media selected.");
            return;
        }
        Uri uri = data.getData();
        status.setText("MEDIA SELECTED — preparing OSD…");
        detail.setText("Keep OSD open while processing runs.");
        pick.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            try {
                File input = copyUriToInput(uri);
                File output = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-output");
                if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Unable to create OSD output directory");
                deleteIfExists(new File(output, "evidence.json"));
                deleteIfExists(new File(output, "OSD-final.wav"));
                deleteIfExists(new File(output, "OSD-final.webm"));
                runOnUiThread(() -> status.setText("PROCESSING — OSD engine is running…"));
                runOsd(input, output);
                File report = new File(output, "evidence.json");
                File wav = new File(output, "OSD-final.wav");
                File webm = new File(output, "OSD-final.webm");
                File finalArtifact = wav.isFile() && wav.length() > 0 ? wav : (webm.isFile() && webm.length() > 0 ? webm : null);
                if (!report.isFile() || report.length() == 0 || finalArtifact == null) throw new IllegalStateException("OSD returned without a final artifact and evidence report");
                String finalPath = finalArtifact.getAbsolutePath();
                String evidencePath = report.getAbsolutePath();
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    status.setText("PROCESSING COMPLETE — output and evidence found.");
                    detail.setText("Final file:\n" + finalPath + "\n\nEvidence report:\n" + evidencePath);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    status.setText("PROCESSING FAILED — output was not verified.");
                    detail.setText(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
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
        File inputDir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-input");
        if (!inputDir.exists() && !inputDir.mkdirs()) throw new IllegalStateException("Unable to create OSD input directory");
        File input = new File(inputDir, name);
        try (InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(input, false)) {
            if (in == null) throw new IllegalStateException("Android could not open the selected media");
            byte[] buffer = new byte[1024 * 1024];
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

    private void openOutputFolder() {
        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-output");
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(Uri.fromFile(dir), "*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivity(i); } catch (ActivityNotFoundException e) {
            status.setText("OSD output folder: " + dir.getAbsolutePath());
        } catch (Exception e) {
            status.setText("OSD output folder: " + dir.getAbsolutePath());
        }
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
