# Channel-switch latency: where the time actually goes

Measured with the page's own `performance.now()` inside desktop Chrome, where
nothing of ours runs at all. `src=` is the player assigning a new blob URL;
`WIDTH>0` is the first genuinely decoded frame (the same signal the app uses to
lift the black cover).

```
=== pid 600001818 ===
  +0ms     CALL              <- changeTV() invoked
  +23ms    src=2e5c061e8321
  +572ms   src=               <- player tears the old stream down
  +572ms   WIDTH=0
  +591ms   src=9a7502d8a301   <- new stream assigned
  +959ms   src=058d5df12abc
  +2899ms  WIDTH>0            <- FIRST REAL FRAME

=== pid 600001801 ===
  +378ms   src=17314dea80fa
  +693ms   src=5ae4a804a7ae
  +2855ms  WIDTH>0

=== pid 600001814 ===
  +375ms   src=5c3ccd41ba14
  +590ms   src=c081bbf6fa51
  +3070ms  WIDTH>0
```

## The conclusion

The site's own player needs **~2.9-3.1 s** to put a first frame on screen, on a
desktop CPU with no injected script, no overlay and no WebView host.

Breakdown of that floor:

| Stage | Cost | Whose code |
|---|---|---|
| `changeTV()` -> player teardown begins | ~380 ms | the site |
| teardown -> new blob src assigned | ~200 ms | the site |
| blob assigned -> first decoded frame | ~2.3 s | the site + CDN |
| key press -> `changeTV()` dispatched | 13-53 ms | **ours** |
| frame decoded -> cover lifted | 6-13 ms | **ours** |

So our own contribution is roughly **20-70 ms out of ~3000 ms**, i.e. already
about 2% of the total. The remaining 98% is the site fetching and starting the
stream, which an app embedding the page cannot change.

**A 1-second channel change is not reachable by optimising this app.** It would
require replacing the site's player — which is exactly the part that cannot be
done, because the stream handshake needs a signature computed by a WASM module
plus a runtime-decrypted secret inside the site's own bundle (see README,
section on known limits).

## What was optimised to get here

Starting point was ~3.8-5.0 s. Changes, all on our side:

1. **Stopped the injected script competing with the player.** It was running
   three full-document passes on a 700 ms timer plus a MutationObserver, each
   forcing synchronous layout, on the very thread that has to start the stream.
   `suppressFurniture` alone walked up to 4000 elements. Now: skipped entirely
   while a channel change is in flight (`fastMode`), and the steady-state timer
   only re-applies the cheap pin.
2. **Made the pin incremental.** `releaseAncestors` walked the whole ancestor
   chain writing ~15 properties per level, 4x/second. Now it runs only when the
   video element changes, plus a slow re-assert — and not at all during a switch,
   where rewriting `transform`/`filter`/`contain` risks dropping the element out
   of its hardware-composited layer right when it is starting.
3. **Cached the Vue component lookup.** `findScheduleHost` scanned every element
   in the document and was called from both the scan loop and the switch path.
4. **Cached the programme title** (900 ms) and cut the DOM fallback from 600
   candidates to 120, using `textContent` instead of `innerText` (which forces
   layout).
5. **Event-driven uncover.** The page now pushes a bridge event on the media
   element's own `loadeddata`/`playing`/`canplay`, so the cover lifts ~6-13 ms
   after the first frame instead of waiting for the next poll. Polling is now
   only a safety net, relaxed to 200 ms.
6. **Fixed rapid zapping.** The dial position was only advanced once a picture
   was confirmed, so consecutive presses all re-targeted the same channel. The
   page now reports the new pid the moment it adopts it.

## Reproduce

```
node research/timing-probe.js     # the desktop floor measurement above
```

On-device timings come from `adb logcat -s YspTv:D`, which prints
`TIMING push@Nms` (frame decoded) and `TIMING UNCOVERED @Nms` (cover lifted).
