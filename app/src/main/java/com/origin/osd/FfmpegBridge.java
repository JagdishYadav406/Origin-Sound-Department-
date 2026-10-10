package com.origin.osd;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFprobeKit;
import com.arthenica.ffmpegkit.ReturnCode;
import com.arthenica.ffmpegkit.Session;

public final class FfmpegBridge {
    private FfmpegBridge() {}

    private static String quote(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    /*
     * FFmpegKit.execute expects FFmpeg command arguments, not the executable
     * name. The desktop Python pipeline uses commands beginning with "ffmpeg",
     * so strip that token at the Android bridge boundary only.
     */
    private static String command(String[] args, boolean stripExecutable) {
        if (args == null || args.length == 0) {
            throw new IllegalArgumentException("Empty media command");
        }
        int start = stripExecutable && "ffmpeg".equals(args[0]) ? 1 : 0;
        if (start >= args.length) {
            throw new IllegalArgumentException("FFmpeg command has no arguments");
        }
        StringBuilder b = new StringBuilder();
        for (int i = start; i < args.length; i++) {
            if (b.length() > 0) b.append(' ');
            b.append(quote(args[i]));
        }
        return b.toString();
    }

    public static String execute(String[] args) {
        Session session = FFmpegKit.execute(command(args, true));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFmpeg execution failed" : fail);
    }

    public static String execute_stderr(String[] args) {
        Session session = FFmpegKit.execute(command(args, true));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput() + "\n" + session.getLogsAsString();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFmpeg execution failed" : fail);
    }

    public static String probe(String[] args) {
        Session session = FFprobeKit.execute(command(args, false));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFprobe execution failed" : fail);
    }
}
