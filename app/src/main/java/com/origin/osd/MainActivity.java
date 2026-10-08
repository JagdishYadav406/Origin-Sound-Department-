package com.origin.osd;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_MEDIA = 7;

    private LinearLayout root;
    private TextView status;
    private Button pick;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 40, 32, 32);

        TextView title = new TextView(this);
        title.setText("OSD 1.20.0");
        title.setTextSize(28);
        root.addView(title);

        status = new TextView(this);
        status.setText("READY — real OSD engine");
        root.addView(status);

        pick = new Button(this);
        pick.setText("Choose media");
        pick.setOnClickListener(v -> chooseMedia());
        root.addView(pick);

        setContentView(root);
    }

    private void chooseMedia() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "video/*"});
        i.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(i, PICK_MEDIA);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_MEDIA || resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == PICK_MEDIA) status.setText("No media selected.");
            return;
        }

        Uri uri = data.getData();
        status.setText("MEDIA SELECTED — preparing local input…");
        pick.setEnabled(false);

        executor.execute(() -> {
            try {
                File input = copyUriToInput(uri);
                File output = new File(
                        getExternalFilesDir(Environment.DIRECTORY_MUSIC),
                        "OSD-output"
                );
                if (!output.exists() && !output.mkdirs()) {
                    throw new IllegalStateException("Unable to create OSD output directory");
                }

                runOsd(input, output);

                File finalAudio = new File(new File(output, ".osd-run-placeholder"), "none");
                File[] candidates = output.listFiles((dir, name) ->
                        name.equals("DELIVERY-READY.txt") || name.equals("evidence.json"));
                final File report = new File(output, "evidence.json");

                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    if (report.isFile()) {
                        status.setText(String.format(Locale.US,
                                "PROCESSING COMPLETE — evidence: %s\nOutput folder: %s",
                                report.getAbsolutePath(), output.getAbsolutePath()));
                    } else {
                        status.setText("PROCESSING COMPLETE — output: " + output.getAbsolutePath());
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    status.setText("PROCESSING FAILED — " + e.getMessage());
                });
            }
        });
    }

    private File copyUriToInput(Uri uri) throws Exception {
        String name = displayName(uri);
        if (name == null || name.trim().isEmpty()) name = "input-media";
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");

        File inputDir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-input");
        if (!inputDir.exists() && !inputDir.mkdirs()) {
            throw new IllegalStateException("Unable to create OSD input directory");
        }

        File input = new File(inputDir, name);
        try (InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(input, false)) {
            if (in == null) throw new IllegalStateException("Android could not open the selected media");
            byte[] buffer = new byte[1024 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        }

        if (!input.isFile() || input.length() == 0) {
            throw new IllegalStateException("Selected media could not be copied into OSD");
        }
        return input;
    }

    private String displayName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) return c.getString(0);
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private void runOsd(File input, File output) {
        if (!Python.isStarted()) Python.start(new AndroidPlatform(this));
        Python py = Python.getInstance();
        PyObject core = py.getModule("osd.core");
        core.callAttr(
                "run_pipeline",
                input.getAbsolutePath(),
                output.getAbsolutePath(),
                -16.0,
                null,
                null,
                null,
                0.0,
                true,
                false
        );
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
