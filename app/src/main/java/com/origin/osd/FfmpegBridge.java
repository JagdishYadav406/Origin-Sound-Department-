package com.origin.osd;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFprobeKit;
import com.arthenica.ffmpegkit.ReturnCode;

public final class FfmpegBridge {
    private FfmpegBridge() {}

    private static String quote(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    private static String command(String[] args) {
        StringBuilder b = new StringBuilder();
        for (String a : args) {
            if (b.length() > 0) b.append(' ');
            b.append(quote(a));
        }
        return b.toString();
    }

    public static String execute(String[] args) {
        var session = FFmpegKit.execute(command(args));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFmpeg execution failed" : fail);
    }

    public static String execute_stderr(String[] args) {
        var session = FFmpegKit.execute(command(args));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput() + "\n" + session.getLogsAsString();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFmpeg execution failed" : fail);
    }

    public static String probe(String[] args) {
        var session = FFprobeKit.execute(command(args));
        if (ReturnCode.isSuccess(session.getReturnCode())) return session.getOutput();
        String fail = session.getFailStackTrace();
        throw new RuntimeException(fail == null ? "FFprobe execution failed" : fail);
    }
}
