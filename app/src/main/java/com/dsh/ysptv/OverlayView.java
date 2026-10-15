package com.dsh.ysptv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.View;

/**
 * Full-screen black cover shown while a channel is being tuned, plus the
 * message surface used for startup warnings and errors.
 *
 * It is deliberately opaque black: while switching, the user must never glimpse
 * the raw web page behind the player.
 */
public final class OverlayView extends View {

    public static final int MODE_HIDDEN = 0;
    public static final int MODE_SWITCHING = 1;
    public static final int MODE_MESSAGE = 2;

    private final TextPaint bigNo = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint bigName = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint subPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint progPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint hintPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF arcRect = new RectF();

    private int mode = MODE_HIDDEN;
    private String noText = "";
    private String nameText = "";
    private String subText = "";
    private String progText = "";
    private String hintText = "";
    private float phase = 0f;
    private boolean running = false;

    public OverlayView(Context context) {
        super(context);
        float d = context.getResources().getDisplayMetrics().density;

        bigNo.setTextSize(64f * d);
        bigNo.setColor(0xFF4EA1FF);
        bigNo.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        bigName.setTextSize(46f * d);
        bigName.setColor(Color.WHITE);
        bigName.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        subPaint.setTextSize(22f * d);
        subPaint.setColor(0xFF9AA4B2);

        progPaint.setTextSize(30f * d);
        progPaint.setColor(0xFFDCE9FF);

        hintPaint.setTextSize(20f * d);
        hintPaint.setColor(0xFF7C8798);

        bg.setColor(Color.BLACK);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(4f * d);
        arc.setColor(0xFF4EA1FF);
        arc.setStrokeCap(Paint.Cap.ROUND);

        setFocusable(false);
        setClickable(false);
    }

    /** Show the black tune-in screen for a channel. */
    public void showSwitching(Channel ch, String program) {
        mode = MODE_SWITCHING;
        noText = String.valueOf(ch.no);
        nameText = ch.name;
        progText = program == null ? "" : program;
        subText = "正在切换…";
        hintText = "";
        start();
    }

    /** Show a message surface (startup warning, stream error, ...). */
    public void showMessage(String title, String subtitle, String hint) {
        mode = MODE_MESSAGE;
        noText = "";
        nameText = title == null ? "" : title;
        subText = subtitle == null ? "" : subtitle;
        progText = "";
        hintText = hint == null ? "" : hint;
        stop();
    }

    public void showFallbackNotice(String name) {
        mode = MODE_MESSAGE;
        noText = "";
        nameText = name;
        subText = "正在切换到备用源…";
        progText = "";
        hintText = "央视网 tv.cctv.com";
        start();
    }

    public void hide() {
        mode = MODE_HIDDEN;
        stop();
    }

    public boolean isShowing() {
        return mode != MODE_HIDDEN;
    }

    public int getMode() {
        return mode;
    }

    private void start() {
        if (!running) {
            running = true;
            postInvalidateOnAnimation();
        }
    }

    private void stop() {
        running = false;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        if (mode == MODE_HIDDEN) return;

        int w = getWidth();
        int h = getHeight();
        c.drawRect(0, 0, w, h, bg);

        float cx = w * 0.5f;
        float d = getResources().getDisplayMetrics().density;

        if (mode == MODE_SWITCHING) {
            float y = h * 0.40f;

            if (!TextUtils.isEmpty(noText)) {
                float nw = bigNo.measureText(noText);
                c.drawText(noText, cx - nw * 0.5f, y, bigNo);
                y += bigNo.getTextSize() * 0.62f;
            }
            if (!TextUtils.isEmpty(nameText)) {
                float nw = bigName.measureText(nameText);
                c.drawText(nameText, cx - nw * 0.5f, y, bigName);
                y += bigName.getTextSize() * 1.15f;
            }
            if (!TextUtils.isEmpty(progText)) {
                CharSequence et = TextUtils.ellipsize(progText, progPaint, w * 0.8f,
                        TextUtils.TruncateAt.END);
                float pw = progPaint.measureText(et.toString());
                c.drawText(et.toString(), cx - pw * 0.5f, y, progPaint);
                y += progPaint.getTextSize() * 1.1f;
            }
            if (!TextUtils.isEmpty(subText)) {
                float sw = subPaint.measureText(subText);
                c.drawText(subText, cx - sw * 0.5f, y, subPaint);
                y += subPaint.getTextSize() * 1.5f;
            }

            // Sweeping arc so it is obvious the app is working, not hung.
            float r = 20f * d;
            arcRect.set(cx - r, y, cx + r, y + 2f * r);
            c.drawArc(arcRect, phase, 100f, false, arc);

            phase += 7f;
            if (phase > 360f) phase -= 360f;
            if (running) postInvalidateOnAnimation();
        } else {
            float y = h * 0.34f;
            if (!TextUtils.isEmpty(nameText)) {
                CharSequence et = TextUtils.ellipsize(nameText, bigName, w * 0.84f,
                        TextUtils.TruncateAt.END);
                float nw = bigName.measureText(et.toString());
                c.drawText(et.toString(), cx - nw * 0.5f, y, bigName);
                y += bigName.getTextSize() * 1.25f;
            }
            if (!TextUtils.isEmpty(subText)) {
                // Wrap the subtitle on CJK-friendly boundaries.
                y = drawWrapped(c, subText, cx, y, w * 0.78f, subPaint);
                y += subPaint.getTextSize() * 0.6f;
            }
            if (!TextUtils.isEmpty(hintText)) {
                float hw = hintPaint.measureText(hintText);
                c.drawText(hintText, cx - hw * 0.5f, y + hintPaint.getTextSize(), hintPaint);
            }
            if (running) {
                float r = 16f * d;
                arcRect.set(cx - r, y + hintPaint.getTextSize() * 2.2f,
                        cx + r, y + hintPaint.getTextSize() * 2.2f + 2f * r);
                c.drawArc(arcRect, phase, 100f, false, arc);
                phase += 7f;
                if (phase > 360f) phase -= 360f;
                postInvalidateOnAnimation();
            }
        }
    }

    /** Naive CJK-aware wrap; returns the next baseline y. */
    private float drawWrapped(Canvas c, String text, float cx, float y, float maxWidth, TextPaint p) {
        StringBuilder line = new StringBuilder();
        float lineHeight = p.getTextSize() * 1.35f;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '\n') {
                float lw = p.measureText(line.toString());
                c.drawText(line.toString(), cx - lw * 0.5f, y, p);
                y += lineHeight;
                line.setLength(0);
                continue;
            }
            line.append(ch);
            if (p.measureText(line.toString()) > maxWidth) {
                line.setLength(line.length() - 1);
                float lw = p.measureText(line.toString());
                c.drawText(line.toString(), cx - lw * 0.5f, y, p);
                y += lineHeight;
                line.setLength(0);
                line.append(ch);
            }
        }
        if (line.length() > 0) {
            float lw = p.measureText(line.toString());
            c.drawText(line.toString(), cx - lw * 0.5f, y, p);
            y += lineHeight;
        }
        return y;
    }
}
