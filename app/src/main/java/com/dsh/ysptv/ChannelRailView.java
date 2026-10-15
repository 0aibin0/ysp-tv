package com.dsh.ysptv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.OverScroller;

/**
 * The channel list that slides in from the left edge.
 *
 * Drawn directly on a canvas so it stays sharp and cheap on low-end TV boxes.
 * It is fully operable two ways: with a remote (the activity moves the
 * highlight) and by touch (tap a row to switch, drag to scroll, fling to skim).
 */
public final class ChannelRailView extends View {

    private static final int BG = 0xF2101216;
    private static final int ROW_SEL = 0xFF1E6FD9;
    private static final int ROW_ALT = 0x14FFFFFF;
    private static final int DIVIDER = 0x18FFFFFF;
    private static final int TEXT = 0xFFF2F4F8;
    private static final int TEXT_DIM = 0xFF9AA4B2;
    private static final int ACCENT = 0xFF4EA1FF;

    /** Reports a channel chosen by tapping a row. */
    public interface OnChannelPicked {
        void onChannelPicked(int index);
    }

    private final TextPaint noPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint namePaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint progPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint headPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint hintPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint rowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rowRect = new RectF();

    private final String[] progTitles = new String[Channels.ALL.length];

    private final OverScroller scroller;
    private VelocityTracker velocity;
    private final int touchSlop;
    private final float density;

    private int selected = 0;
    private float rowHeight;
    private float pad;
    private float headHeight;
    private float scroll = 0f;
    private float targetScroll = 0f;

    /** True when the rail should follow the selection; false while the user scrolls. */
    private boolean followSelection = true;

    private boolean dragging;
    private float downY;
    private float lastY;
    private long downTime;

    private OnChannelPicked pickedListener;

    /** Small label shown at the top of the rail. */
    private String header = "频道";

    public ChannelRailView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        scroller = new OverScroller(context);
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();

        pad = 18f * density;
        rowHeight = 64f * density;
        headHeight = 58f * density;
        applyTextSizes();

        bgPaint.setColor(BG);
        barPaint.setColor(0x66FFFFFF);

        setFocusable(false);
        // Must be clickable so touch events are delivered here instead of
        // falling through to the WebView underneath.
        setClickable(true);
    }

    public void setOnChannelPickedListener(OnChannelPicked l) {
        pickedListener = l;
    }

    /**
     * Scale the type and row height to the panel. Phone screens get bigger
     * rows and larger labels so they stay comfortable under a fingertip.
     */
    private void applyTextSizes() {
        float unit = Math.max(0.85f, Math.min(1.7f, rowHeight / (64f * density)));
        noPaint.setTextSize(21f * density * unit);
        noPaint.setColor(ACCENT);
        noPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        namePaint.setTextSize(24f * density * unit);
        namePaint.setColor(TEXT);
        namePaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        progPaint.setTextSize(18f * density * unit);
        progPaint.setColor(TEXT_DIM);

        headPaint.setTextSize(22f * density * unit);
        headPaint.setColor(TEXT);
        headPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        hintPaint.setTextSize(17f * density * unit);
        hintPaint.setColor(0x88FFFFFF);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        headHeight = Math.max(52f * density, h * 0.075f);
        // Fit roughly seven rows in the viewport, but keep rows thumb-sized.
        float want = (h - headHeight) / 7.0f;
        rowHeight = Math.max(52f * density, Math.min(92f * density, want));
        applyTextSizes();
        followSelection = true;
    }

    public void setHeader(String h) {
        header = h;
        invalidate();
    }

    /**
     * Move the highlight. The rail eases toward the new selection in onDraw,
     * so there is no jump even for distant channels.
     */
    public void setSelected(int index, boolean ignored) {
        if (index < 0) index = 0;
        if (index >= Channels.ALL.length) index = Channels.ALL.length - 1;
        if (index != selected || !followSelection) {
            selected = index;
            // A programmatic move re-arms auto-follow, so a remote press always
            // snaps the list back to the highlighted channel.
            followSelection = true;
            if (scroller != null) scroller.forceFinished(true);
            invalidate();
        }
    }

    public int getSelected() {
        return selected;
    }

    /** Record the "now playing" text for a channel; pass null to clear. */
    public void setProgram(int index, String title) {
        if (index < 0 || index >= progTitles.length) return;
        progTitles[index] = title;
        invalidate();
    }

    public String getProgram(int index) {
        if (index < 0 || index >= progTitles.length) return null;
        return progTitles[index];
    }

    // ------------------------------------------------------------------ scroll

    private float maxScroll() {
        float viewport = getHeight() - headHeight;
        return Math.max(0f, Channels.ALL.length * rowHeight - viewport);
    }

    private void clampScroll() {
        float max = maxScroll();
        if (targetScroll < 0f) targetScroll = 0f;
        if (targetScroll > max) targetScroll = max;
        if (scroll < 0f) scroll = 0f;
        if (scroll > max) scroll = max;
    }

    /** The row that must stay visible for the current selection. */
    private void ensureVisible() {
        float viewport = getHeight() - headHeight;
        if (viewport <= 0) return;
        float top = selected * rowHeight;
        float bottom = top + rowHeight;
        if (top < targetScroll) targetScroll = top;
        else if (bottom > targetScroll + viewport) targetScroll = bottom - viewport;
        clampScroll();
    }

    private int rowAt(float viewY) {
        if (viewY < headHeight) return -1;
        float contentY = viewY - headHeight + scroll;
        int idx = (int) Math.floor(contentY / rowHeight);
        if (idx < 0 || idx >= Channels.ALL.length) return -1;
        return idx;
    }

    // ------------------------------------------------------------------- touch

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                downY = lastY = e.getY();
                downTime = System.currentTimeMillis();
                dragging = false;
                followSelection = false;
                scroller.forceFinished(true);
                if (velocity == null) velocity = VelocityTracker.obtain();
                velocity.clear();
                velocity.addMovement(e);
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                float y = e.getY();
                if (!dragging && Math.abs(y - downY) > touchSlop) dragging = true;
                if (dragging) {
                    float dy = lastY - y;
                    targetScroll += dy;
                    scroll += dy; // no easing while the finger is down
                    clampScroll();
                    invalidate();
                }
                lastY = y;
                if (velocity != null) velocity.addMovement(e);
                return true;
            }
            case MotionEvent.ACTION_UP: {
                long held = System.currentTimeMillis() - downTime;
                if (velocity != null) velocity.addMovement(e);

                if (!dragging && held < 700) {
                    // A tap: switch to whatever row is under the finger.
                    int idx = rowAt(e.getY());
                    if (idx >= 0) {
                        selected = idx;
                        followSelection = true;
                        invalidate();
                        if (pickedListener != null) pickedListener.onChannelPicked(idx);
                    }
                } else {
                    // Fling so a long list can be skimmed quickly.
                    int vy = 0;
                    if (velocity != null) {
                        velocity.computeCurrentVelocity(1000);
                        vy = (int) velocity.getYVelocity();
                    }
                    scroller.forceFinished(true);
                    scroller.fling(0, (int) targetScroll, 0, -vy,
                            0, 0, 0, (int) maxScroll());
                    invalidate();
                }
                if (velocity != null) {
                    velocity.recycle();
                    velocity = null;
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL: {
                dragging = false;
                followSelection = true;
                if (velocity != null) {
                    velocity.recycle();
                    velocity = null;
                }
                invalidate();
                return true;
            }
        }
        return super.onTouchEvent(e);
    }

    @Override
    public void computeScroll() {
        if (scroller.computeScrollOffset()) {
            targetScroll = scroll = scroller.getCurrY();
            clampScroll();
            invalidate();
        } else if (!dragging) {
            // Settled: let the list follow the selection again.
            followSelection = true;
        }
    }

    // -------------------------------------------------------------------- draw

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth();
        int h = getHeight();
        if (w <= 0 || h <= 0) return;

        if (followSelection && !dragging && scroller.isFinished()) {
            ensureVisible();
        }

        // Smoothly ease toward the target offset.
        float delta = targetScroll - scroll;
        if (Math.abs(delta) > 0.5f) {
            scroll += delta * 0.28f;
            if (Build.VERSION.SDK_INT >= 16) postInvalidateOnAnimation();
            else postInvalidate();
        } else {
            scroll = targetScroll;
        }

        c.drawRect(0, 0, w, h, bgPaint);

        // Header
        c.drawText(header, pad, pad + headPaint.getTextSize(), headPaint);
        float hintW = hintPaint.measureText(HINT);
        c.drawText(HINT, w - pad - hintW, pad + headPaint.getTextSize(), hintPaint);
        rowPaint.setColor(0x33FFFFFF);
        c.drawRect(pad, headHeight - 1f, w - pad, headHeight, rowPaint);

        c.save();
        c.clipRect(0, headHeight, w, h);
        c.translate(0, headHeight - scroll);

        float y = 0f;
        for (int i = 0; i < Channels.ALL.length; i++) {
            Channel ch = Channels.ALL[i];
            boolean sel = (i == selected);

            rowRect.set(pad * 0.5f, y + 2f, w - pad * 0.5f, y + rowHeight - 2f);
            if (sel) {
                rowPaint.setColor(ROW_SEL);
                c.drawRoundRect(rowRect, 8f, 8f, rowPaint);
            } else if ((i & 1) == 1) {
                rowPaint.setColor(ROW_ALT);
                c.drawRoundRect(rowRect, 8f, 8f, rowPaint);
            }
            if (i > 0) {
                rowPaint.setColor(DIVIDER);
                c.drawRect(pad, y, w - pad, y + 1f, rowPaint);
            }

            float textY = y + rowHeight * 0.5f - (namePaint.ascent() + namePaint.descent()) * 0.5f;

            String no = String.valueOf(ch.no);
            noPaint.setColor(sel ? Color.WHITE : ACCENT);
            c.drawText(no, pad, textY, noPaint);

            float nameLeft = pad + noPaint.measureText("00") + pad * 1.2f;
            float availRight = w - pad * 1.2f;
            float progWidth = 0f;

            // On a narrow panel the programme title would crowd out the
            // channel name, so it drops to a second line instead.
            boolean stacked = w < 460f * density;
            String prog = progTitles[i];
            if (!TextUtils.isEmpty(prog)) {
                progPaint.setColor(sel ? 0xFFDCE9FF : TEXT_DIM);
                if (stacked) {
                    float nameMax = availRight - nameLeft;
                    CharSequence et = TextUtils.ellipsize(prog, progPaint, nameMax,
                            TextUtils.TruncateAt.END);
                    c.drawText(et.toString(), nameLeft, textY + progPaint.getTextSize() * 1.05f, progPaint);
                } else {
                    float maxProg = (availRight - nameLeft) * 0.46f;
                    CharSequence et = TextUtils.ellipsize(prog, progPaint, maxProg,
                            TextUtils.TruncateAt.END);
                    progWidth = progPaint.measureText(et.toString());
                    c.drawText(et.toString(), availRight - progWidth, textY, progPaint);
                    progWidth += pad * 0.8f;
                }
            }

            namePaint.setColor(TEXT);
            float nameMax = availRight - nameLeft - progWidth;
            CharSequence nameEt = TextUtils.ellipsize(ch.name, namePaint, Math.max(40f, nameMax),
                    TextUtils.TruncateAt.END);
            c.drawText(nameEt.toString(), nameLeft, textY, namePaint);

            y += rowHeight;
        }
        c.restore();

        drawScrollbar(c, w, h);
    }

    private static final String HINT = "点按选择";

    /** A thin scrollbar so it is obvious the list continues past the edge. */
    private void drawScrollbar(Canvas c, int w, int h) {
        float viewport = h - headHeight;
        float total = Channels.ALL.length * rowHeight;
        if (total <= viewport || viewport <= 0f) return;

        float trackX = w - pad * 0.28f;
        float thumbH = Math.max(28f * density, viewport * (viewport / total));
        float travel = viewport - thumbH;
        float max = maxScroll();
        float frac = max <= 0f ? 0f : (scroll / max);
        float top = headHeight + travel * frac;

        rowPaint.setColor(0x22FFFFFF);
        c.drawRoundRect(new RectF(trackX - 3f * density, headHeight + 4f * density,
                trackX + 3f * density, h - 4f * density), 3f * density, 3f * density, rowPaint);
        c.drawRoundRect(new RectF(trackX - 3f * density, top,
                trackX + 3f * density, top + thumbH), 3f * density, 3f * density, barPaint);
    }
}
