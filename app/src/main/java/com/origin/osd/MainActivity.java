package com.origin.osd;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.database.Cursor;
import android.net.Uri;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.widget.Button;
import android.widget.EditText;
import android.text.InputType;
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
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.BufferedReader;
import java.io.FileReader;
import java.security.MessageDigest;
import org.json.JSONObject;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_MEDIA = 7;
    private static final int SAVE_OUTPUT = 8;
    private static final int PICK_STEMS = 9;
    private LinearLayout root;
    private TextView status;
    private Button pick;
    private Button saveOutput;
    private Button playbackButton;
    private MediaPlayer player;
    private File lastFinalArtifact;
    private TextView detail;
    private ProgressBar progress;
    private Uri multiTrackSourceUri;
    private boolean selectingMultiTrack = false;
    private Button multiTrackButton;
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

        multiTrackButton = new Button(this);
        multiTrackButton.setText("Build multi-track soundtrack (video + 2+ audio tracks)");
        multiTrackButton.setOnClickListener(v -> startMultiTrackFlow());
        root.addView(multiTrackButton);

        TextView mixHelp = new TextView(this);
        mixHelp.setText("Select a video first, then choose 2 or more aligned audio tracks. Tracks are mixed at their selected gain; timeline offsets and fades are not yet available in this Android workflow.");
        mixHelp.setTextSize(13);
        mixHelp.setPadding(0, 0, 0, 12);
        root.addView(mixHelp);

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

    private void startMultiTrackFlow() {
        selectingMultiTrack = true;
        multiTrackSourceUri = null;
        status.setText("MULTI-TRACK — choose the source video first.");
        detail.setText("The selected video provides the picture. The selected audio tracks replace its soundtrack in the final render.");
        chooseMedia();
    }

    private void chooseAudioStems() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.setType("audio/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(i, PICK_STEMS);
        } catch (ActivityNotFoundException e) {
            selectingMultiTrack = false;
            multiTrackSourceUri = null;
            status.setText("No compatible file picker is available for selecting audio tracks.");
        }
    }

    private ArrayList<Uri> collectSelectedUris(Intent data) {
        ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                if (uri != null && !uris.contains(uri)) uris.add(uri);
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        return uris;
    }

    private String stemRole(int index) {
        String[] roles = new String[]{"Dialogue", "Music", "Sound Effects", "Ambience"};
        return index < roles.length ? roles[index] : "Additional track " + (index + 1);
    }

    private void promptStemGain(ArrayList<Uri> uris, int index, ArrayList<Double> gains) {
        if (index >= uris.size()) {
            Uri source = multiTrackSourceUri;
            selectingMultiTrack = false;
            multiTrackSourceUri = null;
            if (source == null) {
                status.setText("Multi-track mix cancelled — source video is missing.");
                return;
            }
            processMultiTrack(source, uris, gains);
            return;
        }
        String filename = displayName(uris.get(index));
        if (filename == null || filename.trim().isEmpty()) filename = "Audio track " + (index + 1);
        EditText gainInput = new EditText(this);
        gainInput.setSingleLine(true);
        gainInput.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_SIGNED | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        gainInput.setText("0.0");
        gainInput.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
            .setTitle(stemRole(index) + " gain (dB)")
            .setMessage(filename + "\nEnter a gain from -24 dB to +12 dB.")
            .setView(gainInput)
            .setNegativeButton("Cancel", (dialog, which) -> {
                selectingMultiTrack = false;
                multiTrackSourceUri = null;
                status.setText("Multi-track setup cancelled; no render started.");
            })
            .setPositiveButton("Next", (dialog, which) -> {
                try {
                    double gain = Double.parseDouble(gainInput.getText().toString().trim());
                    if (Double.isNaN(gain) || Double.isInfinite(gain) || gain < -24.0 || gain > 12.0) {
                        selectingMultiTrack = false;
                        multiTrackSourceUri = null;
                        status.setText("Invalid track gain. Use -24 dB to +12 dB and start the setup again.");
                        return;
                    }
                    gains.add(gain);
                    promptStemGain(uris, index + 1, gains);
                } catch (NumberFormatException e) {
                    selectingMultiTrack = false;
                    multiTrackSourceUri = null;
                    status.setText("Invalid track gain. No render started.");
                }
            }).show();
    }

    private void processMultiTrack(Uri sourceUri, ArrayList<Uri> trackUris, ArrayList<Double> gains) {
        stopPlayback();
        lastFinalArtifact = null;
        saveOutput.setEnabled(false);
        playbackButton.setEnabled(false);
        pick.setEnabled(false);
        multiTrackButton.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        status.setText("MULTI-TRACK — preparing sources…");
        detail.setText("Verifying imported files and preparing the soundtrack mix.");
        executor.execute(() -> {
            try {
                File input = copyUriToInput(sourceUri, "source-");
                File output = createRunOutputDirectory();
                if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Unable to create OSD output directory");
                ArrayList<String> stemPaths = new ArrayList<>();
                ArrayList<String> roles = new ArrayList<>();
                for (int i = 0; i < trackUris.size(); i++) {
                    File stem = copyUriToInput(trackUris.get(i), "stem-" + (i + 1) + "-");
                    stemPaths.add(stem.getAbsolutePath());
                    roles.add(stemRole(i));
                }
                runOnUiThread(() -> status.setText("MULTI-TRACK — mixing, mastering and checking delivery…"));
                runOsd(input, output, stemPaths, roles, gains);
                File report = new File(output, "evidence.json");
                File wav = new File(output, "OSD-final.wav");
                File webm = new File(output, "OSD-final.webm");
                File finalArtifact = wav.isFile() && wav.length() > 0 ? wav : (webm.isFile() && webm.length() > 0 ? webm : null);
                if (!report.isFile() || report.length() == 0 || finalArtifact == null) throw new IllegalStateException("OSD returned without a final artifact and evidence report");
                verifyDeliveryEvidence(report, finalArtifact, output);
                String finalPath = finalArtifact.getAbsolutePath();
                String evidencePath = report.getAbsolutePath();
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    multiTrackButton.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    lastFinalArtifact = finalArtifact;
                    saveOutput.setEnabled(true);
                    playbackButton.setEnabled(true);
                    playbackButton.setText("Play final output");
                    status.setText("MULTI-TRACK COMPLETE — output and evidence verified.");
                    detail.setText("Final file:\n" + finalPath + "\n\nEvidence report:\n" + evidencePath + "\n\nTrack roles: " + roles + "\nTrack gains (dB): " + gains + "\n\nPlay the result or save a copy to your device.");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    pick.setEnabled(true);
                    multiTrackButton.setEnabled(true);
                    progress.setVisibility(View.GONE);
                    status.setText("MULTI-TRACK FAILED — output was not verified.");
                    detail.setText(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                });
            }
        });
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
                try {
                    long expectedBytes = source.length();
                    String expectedHash = sha256(source);
                    long copiedBytes = 0;
                    try (InputStream in = new FileInputStream(source);
                         java.io.OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
                        if (out == null) throw new IllegalStateException("Android could not open the selected save location");
                        byte[] buffer = new byte[262144];
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            out.write(buffer, 0, n);
                            copiedBytes += n;
                        }
                        out.flush();
                    }
                    if (copiedBytes != expectedBytes) {
                        throw new IllegalStateException("Export verification failed — copied byte count does not match the final output");
                    }
                    verifyExportCopy(destination, expectedBytes, expectedHash);
                    runOnUiThread(() -> {
                        progress.setVisibility(View.GONE);
                        saveOutput.setEnabled(true);
                        status.setText("OUTPUT EXPORTED AND VERIFIED.");
                        detail.setText("Saved copy byte count and SHA-256 match the verified OSD output.\n\nSaved output: " + destination);
                    });
                } catch (Exception e) {
                    runOnUiThread(() -> {
                        progress.setVisibility(View.GONE);
                        saveOutput.setEnabled(true);
                        status.setText("EXPORT FAILED OR UNVERIFIED.");
                        detail.setText(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                    });
                }
            });
            return;
        }
        if (requestCode == PICK_STEMS) {
            if (resultCode != RESULT_OK || data == null) {
                selectingMultiTrack = false;
                multiTrackSourceUri = null;
                status.setText("Multi-track selection cancelled.");
                return;
            }
            ArrayList<Uri> selectedTracks = collectSelectedUris(data);
            if (selectedTracks.size() < 2) {
                selectingMultiTrack = false;
                multiTrackSourceUri = null;
                status.setText("Multi-track mix needs at least 2 audio files. Nothing was processed.");
                return;
            }
            promptStemGain(selectedTracks, 0, new ArrayList<Double>());
            return;
        }
        if (requestCode != PICK_MEDIA) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (selectingMultiTrack) {
                selectingMultiTrack = false;
                multiTrackSourceUri = null;
                status.setText("Multi-track setup cancelled; no render started.");
            } else {
                status.setText("No media selected.");
            }
            return;
        }
        Uri uri = data.getData();
        if (selectingMultiTrack) {
            multiTrackSourceUri = uri;
            chooseAudioStems();
            return;
        }
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
                File output = createRunOutputDirectory();
                if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Unable to create OSD output directory");
                runOnUiThread(() -> status.setText("PROCESSING — OSD engine is running…"));
                runOsd(input, output);
                File report = new File(output, "evidence.json");
                File wav = new File(output, "OSD-final.wav");
                File webm = new File(output, "OSD-final.webm");
                File finalArtifact = wav.isFile() && wav.length() > 0 ? wav : (webm.isFile() && webm.length() > 0 ? webm : null);
                if (!report.isFile() || report.length() == 0 || finalArtifact == null) throw new IllegalStateException("OSD returned without a final artifact and evidence report");
                verifyDeliveryEvidence(report, finalArtifact, output);
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

    private void verifyDeliveryEvidence(File reportFile, File artifact, File outputDir) throws Exception {
        JSONObject report = new JSONObject(new String(readFile(reportFile), "UTF-8"));
        JSONObject verification = report.optJSONObject("verification");
        JSONObject qc = report.optJSONObject("qc");
        JSONObject qcChecks = qc == null ? null : qc.optJSONObject("checks");
        JSONObject checks = report.optJSONObject("checks");
        JSONObject sourceIntegrity = report.optJSONObject("source_integrity");
        JSONObject delivery = report.optJSONObject("delivery_artifact");
        if (verification == null || !"VERIFIED".equals(verification.optString("status")))
            throw new IllegalStateException("Delivery blocked — evidence does not mark the result VERIFIED");
        if (!"DELIVERABLE".equals(report.optString("delivery_status")))
            throw new IllegalStateException("Delivery blocked — evidence delivery_status is not DELIVERABLE");
        if (qcChecks == null || !qcChecks.optBoolean("all_pass", false))
            throw new IllegalStateException("Delivery blocked — final QC is missing or did not pass");
        if (checks == null || !checks.optBoolean("source_unchanged", false) || !checks.optBoolean("artifacts_integrity_verified", false)
                || sourceIntegrity == null || !sourceIntegrity.optBoolean("unchanged", false))
            throw new IllegalStateException("Delivery blocked — source preservation or artifact integrity is unverified");
        if (delivery == null || delivery.optLong("bytes", -1) != artifact.length()
                || !sha256(artifact).equalsIgnoreCase(delivery.optString("sha256", "")))
            throw new IllegalStateException("Delivery blocked — final artifact does not match the evidence hash and size");
        File sidecar = new File(outputDir, "EVIDENCE-SHA256.txt");
        if (!sidecar.isFile()) throw new IllegalStateException("Delivery blocked — evidence checksum sidecar is missing");
        String recordedHash;
        try (BufferedReader reader = new BufferedReader(new FileReader(sidecar))) {
            String line = reader.readLine();
            if (line == null || line.trim().isEmpty()) throw new IllegalStateException("Delivery blocked — evidence checksum sidecar is empty");
            recordedHash = line.trim().split("\\s+")[0];
        }
        if (!sha256(reportFile).equalsIgnoreCase(recordedHash))
            throw new IllegalStateException("Delivery blocked — evidence report checksum does not match");
    }

    private byte[] readFile(File file) throws Exception {
        try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        return hex.toString();
    }

    private void verifyExportCopy(Uri destination, long expectedBytes, String expectedHash) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long actualBytes = 0;
        try (InputStream in = getContentResolver().openInputStream(destination)) {
            if (in == null) throw new IllegalStateException("Export verification failed — saved copy cannot be reopened");
            byte[] buffer = new byte[262144];
            int n;
            while ((n = in.read(buffer)) != -1) {
                digest.update(buffer, 0, n);
                actualBytes += n;
            }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        if (actualBytes != expectedBytes || !hex.toString().equalsIgnoreCase(expectedHash)) {
            throw new IllegalStateException("Export verification failed — saved copy size or SHA-256 does not match the verified output");
        }
    }

    private void deleteIfExists(File file) throws Exception {
        if (file.exists() && !file.delete()) throw new IllegalStateException("Unable to clear previous output marker: " + file.getName());
    }

    private File copyUriToInput(Uri uri) throws Exception { return copyUriToInput(uri, ""); }

    private File copyUriToInput(Uri uri, String prefix) throws Exception {
        long expectedSourceBytes = displaySize(uri);
        String name = displayName(uri);
        if (name == null || name.trim().isEmpty()) name = "input-media";
        name = prefix + name.replaceAll("[^A-Za-z0-9._-]", "_");
        File inputDir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-input");
        if (!inputDir.exists() && !inputDir.mkdirs()) throw new IllegalStateException("Unable to create OSD input directory");
        File input = new File(inputDir, name);
        MessageDigest importDigest = MessageDigest.getInstance("SHA-256");
        long importedBytes = 0;
        try (InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(input, false)) {
            if (in == null) throw new IllegalStateException("Android could not open the selected media");
            byte[] buffer = new byte[1024 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                importDigest.update(buffer, 0, n);
                importedBytes += n;
            }
            out.flush();
        }
        if (!input.isFile() || input.length() == 0) throw new IllegalStateException("Selected media could not be copied into OSD");
        StringBuilder importedHash = new StringBuilder();
        for (byte b : importDigest.digest()) importedHash.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        if ((expectedSourceBytes >= 0 && importedBytes != expectedSourceBytes)
                || input.length() != importedBytes
                || !sha256(input).equalsIgnoreCase(importedHash.toString())) {
            deleteIfExists(input);
            throw new IllegalStateException("Media import verification failed — copied byte count does not match source metadata or the imported copy hash");
        }
        return input;
    }

    private long displaySize(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null);
            if (c != null && c.moveToFirst()) {
                int index = c.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !c.isNull(index)) return c.getLong(index);
            }
        } catch (Exception ignored) {
            // Providers may omit or misreport size; independent copy/hash checks still apply.
        } finally {
            if (c != null) c.close();
        }
        return -1L;
    }

    private File createRunOutputDirectory() throws Exception {
        File base = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "OSD-output");
        if (!base.exists() && !base.mkdirs()) throw new IllegalStateException("Unable to create OSD output directory");
        String runId = System.currentTimeMillis() + "-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        File output = new File(base, "run-" + runId);
        if (!output.mkdirs()) throw new IllegalStateException("Unable to create a unique OSD run directory");
        return output;
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
        runOsd(input, output, null, null, null);
    }

    private void runOsd(File input, File output, List<String> stemPaths, List<String> roles, List<Double> gains) {
        if (!Python.isStarted()) Python.start(new AndroidPlatform(this));
        Python.getInstance().getModule("osd.core").callAttr(
            "run_pipeline", input.getAbsolutePath(), output.getAbsolutePath(),
            -16.0, stemPaths, roles, gains, 0.0, true, false
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
