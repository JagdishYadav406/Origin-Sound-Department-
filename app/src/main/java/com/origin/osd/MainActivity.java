package com.origin.osd;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.database.Cursor;
import android.net.Uri;
import android.media.MediaPlayer;
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
    private static final int SAVE_OUTPUT = 8;
    private LinearLayout root;
    private TextView status;
    private Button pick;
    private Button saveOutput;
    private Button playbackButton;
    private MediaPlayer player;
    private File lastFinalArtifact;
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
        status.setText("READY — choose media to initialize OSD");
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

        saveOutput = new Button(this);
        saveOutput.setText("Save final output to device");
        saveOutput.setEnabled(false);
        saveOutput.setOnClickListener(v -> chooseOutputDestination());
        root.addView(saveOutput);

        playbackButton = new Button(this);
        playbackButton.setText("Play final output");
        playbackButton.setEnabled(false);
        playbackButton.setOnClickListener(v -> playOrStopOutput());
        root.addView(playbackButton);
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
        if (requestCode == SAVE_OUTPUT) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                status.setText("Export cancelled; the output remains in OSD storage.");
                return;
            }
            Uri destination = data.getData();
            File source = lastFinalArtifact;
            if (source == null || !source.isFile() || source.length() == 0) {
                status.setText("Export failed — no final output is available.");
                return;
            }
            saveOutput.setEnabled(false);
            progress.setVisibility(View.VISIBLE);
            executor.execute(() -> {
                try (InputStream in = new java.io.FileInputStream(source);
                     java.io.OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
                    if (out == null) throw new IllegalStateException("Android could not open the selected save location");
                    byte[] buffer = new byte[262144];
                    int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                    out.flush();
                    runOnUiThread(() -> {
                        progress.setVisibility(View.GONE);
                        saveOutput.setEnabled(true);
                        status.setText("OUTPUT EXPORTED — saved copy created.");
                        detail.setText("Saved output: " + destination);
                    });
                } catch (Exception e) {
                    runOnUiThread(() -> {
                        progress.setVisibility(View.GONE);
                        saveOutput.setEnabled(true);
                        status.setText("EXPORT FAILED.");
                        detail.setText(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                    });
                }
            });
            return;
        }
        if (requestCode != PICK_MEDIA) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            status.setText("No media selected.");
            return;
        }
        Uri uri = data.getData();
        stopPlayback();
        lastFinalArtifact = null;
        saveOutput.setEnabled(false);
        playbackButton.setEnabled(false);
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
                    lastFinalArtifact = finalArtifact;
                    saveOutput.setEnabled(true);
                    playbackButton.setEnabled(true);
                    playbackButton.setText("Play final output");
                    status.setText("PROCESSING COMPLETE — output and evidence found.");
                    detail.setText("Final file:\n" + finalPath + "\n\nEvidence report:\n" + evidencePath + "\n\nPlay the result here or save a copy to your device.");
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

    private void playOrStopOutput() {
        File source = lastFinalArtifact;
        if (source == null || !source.isFile() || source.length() == 0) {
            status.setText("Playback unavailable — no final output exists.");
            playbackButton.setEnabled(false);
            return;
        }
        if (player != null) {
            stopPlayback();
            status.setText("PLAYBACK STOPPED.");
            return;
        }
        MediaPlayer next = new MediaPlayer();
        player = next;
        playbackButton.setEnabled(false);
        playbackButton.setText("Preparing playback…");
        status.setText("PREPARING FINAL OUTPUT PLAYBACK…");
        try {
            next.setDataSource(source.getAbsolutePath());
            next.setOnPreparedListener(mp -> {
                if (player != mp) { mp.release(); return; }
                mp.start();
                playbackButton.setText("Stop playback");
                playbackButton.setEnabled(true);
                status.setText("PLAYING FINAL OUTPUT.");
            });
            next.setOnCompletionListener(mp -> {
                stopPlayback();
                status.setText("PLAYBACK FINISHED.");
            });
            next.setOnErrorListener((mp, what, extra) -> {
                stopPlayback();
                status.setText("PLAYBACK FAILED.");
                detail.setText("Android could not play this output (" + what + ", " + extra + "). You can still try saving it to the device.");
                return true;
            });
            next.prepareAsync();
        } catch (Exception e) {
            stopPlayback();
            status.setText("PLAYBACK FAILED.");
            detail.setText(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    private void stopPlayback() {
        MediaPlayer current = player;
        player = null;
        if (current != null) {
            try { if (current.isPlaying()) current.stop(); } catch (IllegalStateException ignored) { }
            try { current.release(); } catch (Exception ignored) { }
        }
        if (playbackButton != null) {
            playbackButton.setText("Play final output");
            playbackButton.setEnabled(lastFinalArtifact != null && lastFinalArtifact.isFile() && lastFinalArtifact.length() > 0);
        }
    }

    private void chooseOutputDestination() {
        File source = lastFinalArtifact;
        if (source == null || !source.isFile() || source.length() == 0) {
            status.setText("No final output is available to export.");
            return;
        }
        boolean video = source.getName().toLowerCase().endsWith(".webm");
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(video ? "video/webm" : "audio/wav");
        i.putExtra(Intent.EXTRA_TITLE, source.getName());
        startActivityForResult(i, SAVE_OUTPUT);
    }
    @Override protected void onDestroy() {
        stopPlayback();
        executor.shutdownNow();
        super.onDestroy();
    }
}
