---
name: video-evidence
description: "Record a browser session when a human wants to see what a screenshot cannot show: scroll, drag and drop, hover, gestures, animations, transitions, loading states, multi-step workflows (stepper, wizard, search to checkout), bug repros, and feature demos for PMs or stakeholders. Produces a captioned MP4, a storyboard PNG, and a state trace a human can check at a glance, plus an optional presentation cut. Optional: suggest it where it fits and record when the human asks. Use for /video-evidence, \"show me a video\", \"record the flow\", demo requests, or review gates that ask for a video."
disable-model-invocation: true
---

# Video evidence

A screenshot proves a state. It cannot prove that the list scrolled, the card was dragged, or the toast slid in rather than popped. For those claims, record the real session and hand the human three artifacts that agree with each other:

- **`<slug>.mp4`.** The recorded run, with an oversized cursor, a ripple on every press, and a caption naming each step. For the human.
- **`<slug>.storyboard.png`.** For step-based flows, one tile per captioned step, taken right after that step's probe. For motion-first clips, a time-sampled grid of the run. The whole run at a glance, and the version that renders inline in chat and PRs.
- **`<slug>.trace.json`.** The state read from the page after every captioned step and across every transition. Keep the per-step checkpoints that map 1:1 to storyboard tiles separate from any extra transition samples. For the machine and for timing claims.

Video alone is not proof: an agent can record the wrong thing and describe it confidently. The trace alone is not evidence a human can check. Ship both, and make them tell the same story.

Static states stay screenshots (the **prove-it-works** principle skill). This skill is optional. When a row in the table below fits, suggest a recording in the reply and make one when the human asks for it or a review gate already requires a video. Never block the work waiting for that answer.

## When a video helps

Suggest a recording when one of these fits. An **evidence** cut proves behavior and ships with its trace. A **presentation** cut explains a feature to people who will not read the diff. Both come from the same script.

| Who | Situation | Cut | The video must show |
|---|---|---|---|
| Developer | Scroll, drag and drop, animation, transition, gesture | Evidence | The motion itself, with mid-transition samples in the trace |
| Developer | Loading, optimistic update, rollback, two racing requests | Evidence | Each intermediate state in order: skeleton, content, error, retry |
| Developer | Keyboard or focus flow | Evidence | The focus ring moving key by key, with the key named in the caption |
| QA | Stepper, wizard, onboarding, multi-page form | Evidence | Every step, the validation on each step that has it, data kept on Back, a summary that matches the input |
| QA | End-to-end journey, for example search → product → cart → checkout → payment → confirmation | Evidence | Each page landing, the values carried across (item, quantity, total), the order id at the end |
| QA | Bug report or bug fix | Evidence | Before and after, same script, same data, same viewport |
| QA | Unhappy paths: declined card, expired session, network error, refresh mid-flow | Evidence | One short clip per path: the error the user sees and the recovery |
| QA | Responsive or locale matrix | Evidence | The same script at each viewport or locale, one file each |
| PM | Acceptance of a user story | Presentation, with the evidence linked | One chapter per acceptance criterion, in the story's words |
| PM | Sprint demo, release note, stakeholder walkthrough | Presentation | The happy path at a watching pace, no debug data on screen |
| PM | Comparing variants (A/B, prototype options) | Presentation | Each variant run through the same script, back to back |

A static end state, a copy change, or an API-only change does not need a video. A screenshot or a response body proves it faster.

## 1. Prepare the tab

- Fix the viewport (`browser.open({ viewport: { width: 1280, height: 800 } })`). A human compares runs; the frame must not reflow between them.
- Inject the overlay before anything happens: `const overlay = await tab.addInitScript(await Bun.file("<overlay.js path>").text()); await tab.reload();`. The overlay lives at `skill://video-evidence/scripts/overlay.js`; resolve that to a file path for `Bun.file`. It mounts once per document and survives navigation.
- Leave motion settings alone. Emulate `prefers-reduced-motion` only when the reduced-motion path is the claim, and then record both variants.

## 2. Record, drive, probe in one cell

Start and stop the recording inside a single `tab.run`. Idle tabs freeze when a turn settles, so a recording that spans turns captures a frozen page. Open the tab with `persist: true` only if a run must span turns.

```javascript
const out = await tab.run(async ({ tab, page }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  const step = (text) => page.evaluate((t) => document.dispatchEvent(new CustomEvent("evidence:step", { detail: t })), `${++n}. ${text}`);
  const at = { x: 0, y: 0 };
  const frames = [];
  const checkpoints = [];
  const snapStep = async (label) => {
    const state = await page.evaluate(() => ({
      fileInputClickCount: Number(document.documentElement.dataset.evFileInputClickCount ?? "0"),
      // Read the state the claim is about: scrollTop, parent of the dragged node, computed style mid-transition.
    }));
    checkpoints.push({ step: n, label, t: Date.now() - t0, ...state });
    await page.screenshot({ path: `<frames-dir>/frame-${String(n).padStart(2, "0")}.png` });
    frames.push({ step: n, label, path: `<frames-dir>/frame-${String(n).padStart(2, "0")}.png` });
  };
  const glide = async (x, y, ms = 600) => {
    const n = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) { await page.mouse.move(at.x + ((x - at.x) * i) / n, at.y + ((y - at.y) * i) / n); await sleep(16); }
    Object.assign(at, { x, y });
  };
  const trace = [];
  const t0 = Date.now();
  const probe = async (label) => trace.push({ t: Date.now() - t0, label, ...(await page.evaluate(() => ({
    fileInputClickCount: Number(document.documentElement.dataset.evFileInputClickCount ?? "0"),
    // Read the state the claim is about: scrollTop, parent of the dragged node, computed style mid-transition.
  }))) });

  await tab.recordStart("<dir>/<slug>.mp4", { contactSheet: true });
  await probe("start");

  await step("Drag Card from Todo to Done");
  const from = await (await page.$("<source selector>")).boundingBox();
  const to = await (await page.$("<target selector>")).boundingBox();
  await glide(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await sleep(150);
  await glide(to.x + to.width / 2, to.y + to.height / 2, 800);
  await page.mouse.up();
  await probe("after-drop");
  await snapStep("after-drop");

  await step("Toast slides in");
  for (let i = 0; i < 5; i++) { await sleep(150); await probe(`toast-${i}`); }
  await sleep(600);
  await snapStep("toast-settled");

  if (frames.length !== n || checkpoints.length !== n) throw new Error(`step/storyboard mismatch: steps=${n} checkpoints=${checkpoints.length} frames=${frames.length}`);
  return { trace, checkpoints, frames, recording: await tab.recordStop() };
}, { timeout: 120 });
await Bun.write("<dir>/<slug>.trace.json", JSON.stringify(out.trace, null, 2));
```

Use one `<frames-dir>` per storyboard artifact. For a single clip, it can live directly under the evidence directory. For chaptered workflows, make it segment-specific (`<dir>/<segment-slug>/`) so each storyboard reads only that chapter's frames.

Rules for the drive:

- **Real input only.** `page.mouse` moves, presses, and wheel ticks, `page.keyboard`, and the tab helpers. Never set state through `evaluate` to fake an interaction.
- **Pace it for a human.** Unpaced `page.mouse.move(x, y, { steps })` finishes inside one frame and the video shows a teleport. Glide in roughly 16 ms steps over 400 to 800 ms per travel. Scroll in wheel ticks with a short sleep between them.
- **Keyboard paths count.** When the feature has a keyboard alternative (keyboard reordering, arrow navigation), record it too: focus the element, then pause about 500 ms between key presses so the focus ring and each move stay visible.
- **Caption before acting.** One `step()` per user action, phrased as the user would say it. The viewer should never have to guess what is happening.
- **Probe, then frame, for each captioned step.** Right after each step's proof probe, take a screenshot and add it to a per-step frame list. Build the storyboard from those frames for step-based flows. Keep the MP4 time-sampled storyboard only for motion-heavy clips where the in-between frames are the point.
- **Hold the result.** Keep each result state on screen for at least 500 ms and hold the final state before stopping. If the only visible change is the caption text, hold about 1 s so the recorder has time to emit a frame.
- **Probe after every step and across every transition.** Sample a transition at its start, middle, and end, so the trace shows the curve (`top: -80px → -24px → 8px → 16px`), not just the endpoints.

## 3. Multi-step workflows

A stepper or a search-to-checkout journey runs across pages and minutes. It fails in ways a single interaction does not: a value lost between steps, a wait that runs out, a side effect on real data. Plan it before recording.

- **Script from the acceptance criteria.** Write the journey as chapters before opening the browser. Each chapter has a name, the user actions, and the checkpoint that proves it worked. For checkout: `search` (results list the query), `product` (price read), `cart` (count and subtotal), `checkout` (address accepted), `payment` (test card accepted), `confirmation` (order id shown, total equals the cart total).
- **Test data only.** Run against local or staging, with a seeded account and the payment provider's test mode (Stripe: card `4242 4242 4242 4242`). Never use a real card or a production account, and never run a flow that emails real people. If the environment only takes real payments, stop at the payment page and say so.
- **Nothing secret on camera.** Type test credentials only, and check the frames for tokens, personal emails, and addresses before the file leaves the machine.
- **One recording per chapter group.** Keep each `tab.run` under about 90 seconds and name the files in order: `<slug>-01-search.mp4`, `<slug>-02-cart.mp4`. A short segment that hangs costs one retake, not the whole journey. Run the segments back to back in one cell so the tab never idles between them; the page state carries over. Return the step counter from each segment and pass it into the next, so the numbering continues. Write each segment's step screenshots into its own directory or prefix so its storyboard only reads that segment's frames.
- **Arm the navigation wait before the click.** A `waitForFunction` started on the old page can hang after the new page loads. Pair the two, then wait for the new page's own signal (its heading, a response via `page.waitForResponse`, the step indicator reading "3 of 5"), then hold 500 ms:

  ```javascript
  const go = async (sel, heading) => {
    const nav = page.waitForNavigation();
    await click(sel); // glide to the element's center, press, release
    await nav;
    await page.waitForFunction((t) => document.querySelector("h1")?.textContent === t, {}, heading);
    await sleep(500);
  };
  ```

  In-page steps (a stepper that re-renders without navigating) need no navigation wait: wait for the step indicator.
- **Captions survive same-origin page loads.** The overlay keeps the current caption in `sessionStorage`. After a hop to another origin (a hosted payment page) it starts blank, so call `step()` again once that page lands.
- **Keep the bookkeeping 1:1.** After every captioned step, append one checkpoint and one screenshot to the workflow's per-step list. Transition probes can be extra, but the step list must stay one row per caption from step 1 through step N, even when the MP4 is stitched from chapters.
- **Checkpoint every chapter.** End each chapter with a `probe` that reads the values the journey carries: the selected item, quantity, subtotal, stepper position, URL. Read form fields through `.value`; `innerText` does not include what the user typed. The predicate that matters most is carry-through: what the user entered on the first step is what the last step shows.
- **Record unhappy paths separately.** Validation on each step, Back keeping entered data, a refresh mid-flow, a declined test card (Stripe: `4000 0000 0000 0002`). One short clip each, named for the path.
- **Payment fields are cross-origin frames.** Hosted fields (Stripe Elements, Adyen, Braintree) live in iframes. Wait for the frame, then type into it: `page.frames().find((f) => f.url().includes("<provider host>"))`.

Join the segments for the full cut. Run this from the evidence directory; each segment's duration gives its chapter start:

```bash
ls <slug>-[0-9][0-9]-*.mp4 | sed "s/.*/file '&'/" > <slug>.list
ffmpeg -v error -y -f concat -safe 0 -i <slug>.list -c copy <slug>.mp4
for f in <slug>-[0-9][0-9]-*.mp4; do echo "$f $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
```

`-c copy` joins without re-encoding because every segment shares the viewport and codec. Take chapter times from the durations, not the trace: the video clock drifts from the wall clock. Build one storyboard per segment, so each chapter reads on its own.

## 4. Assert the trace

Write the pass predicate for each claim before reading the video, then check it against the trace. The shapes worth reaching for:

- **Appears by.** The target is visible, or has reached its end value, by time `t`.
- **Order.** `a` changes before `b` does.
- **Stays in frame.** The element's box stays inside the viewport or its container across every sample.
- **Actually moved.** At least one sample sits strictly between the start and end values. Two endpoints prove a jump, not an animation.
- **Settles.** The last two samples agree, so nothing is still in flight when you stop.

A predicate that fails is the finding. Do not retune the sampling until it passes.

Before you report, hard-assert the captioned-step bookkeeping:

- `step()` calls == per-step checkpoints == storyboard tiles.
- Caption numbers on the tiles run with no gaps across that artifact's expected range: `1..N` for a single clip, or `<first-step>..<last-step>` for a later chapter whose numbering continues.
- The workflow table you will post has one row per tile, no more and no less.

If any count or caption number mismatches, fail the run and fix the recording before you cite it. Extra transition probes are fine; silent step loss is not.

## 5. Verify the recording itself

A recording is an artifact like any other. Check it before you cite it.

- `ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of compact <slug>.mp4`. Duration above zero, size matches the viewport.
- `read <slug>.mp4` returns a preview grid. `read <slug>.mp4:1.2s` returns one frame. Look at the frames that should show each step.
- For step-based flows, tile the per-step screenshots from that segment only: `ffmpeg -v error -y -framerate 1 -start_number <first-step> -i <segment-dir>/frame-%02d.png -vf "tile=CxR" <segment-slug>.storyboard.png`. Use the first step number that segment wrote (`1` for `frame-01.png`, `6` for `frame-06.png`, and so on), write the storyboard to a segment-specific path, and keep each segment's frames in its own directory or prefix so the command does not read later segments by accident. For motion-first clips, use the time-sampled grid: `ffmpeg -v error -y -i <slug>.mp4 -vf "fps=12/D,scale=400:-1,tile=4x3" -frames:v 1 <slug>.storyboard.png`. A fixed `fps` on a long run fills the grid from the first seconds only, which is why it is the wrong default for captioned workflows.
- Read the storyboard back and assert the tile count matches the per-step checkpoints and the caption numbers cover that artifact's expected contiguous range.
- Build a caption strip and read it back: `ffmpeg -v error -y -i <slug>.mp4 -vf "crop=iw:60:0:ih-60,fps=4,tile=1xN" -frames:v 1 <slug>.captions.png`. Every caption must appear in at least one sampled frame. If a caption is missing, fail the run instead of hand-waving the gap.
- Read the captions themselves for grammar and accuracy. Fix awkward wording before you ship the artifact.

## 6. Report

Put the three paths in the reply, then one line per claim: the predicate, its result from the trace, and the timestamp in the video where a human can see it. For a workflow, make it a table with one row per storyboard tile: step, checkpoint, trace result, and where to see it. In the trace-result column, show only the fields that changed from the previous step (`fileInputClickCount: 0 → 1`, not a full dump). In the where-to-see column, point to either `frame N, ~Xs` or `trace only (<reason>)` when the evidence is headless-only, such as a native file picker click. The PR table and storyboard must stay 1:1. Embed the storyboard where the surface renders images (a PR body, the chat) and link the MP4. Keep the artifacts in a location the task names, for example `/tmp/swarm-<pr-id>/worker-<n>/` in a swarm lane or the verify skill's evidence directory, and never delete them in cleanup.

## Gotchas

- **Wait for the surface's own content.** A generic `waitForSelector("th")` can match hidden chrome before the app renders; Storybook's `iframe.html` carries hidden docs tables. Wait for text or a selector scoped to the app root (`#storybook-root thead th`) before recording.
- **Two JS worlds.** `tab.evaluate` and Puppeteer's `page.evaluate` inside `tab.run` do not share globals. The overlay listens for a DOM `evidence:step` event for that reason. Talk to page code through the DOM, not a global.
- **The contact sheet skips motion.** `recordStart({ contactSheet: true })` keeps only frames that changed past a threshold and can drop every mid-drag frame. It is a quick glance, not the storyboard.
- **The video clock is not the wall clock.** The recorder emits frames when the screen changes, so video timestamps drift from real time. Timing claims come from the trace.
- **A file input may only prove itself in the trace.** Headless Chromium cannot show the OS file picker. Count file-input activation in the init script for both trusted user clicks (including label-driven activation) and scripted `HTMLInputElement.prototype.click()` calls, read that counter in the per-step probe, and report the step as `trace only (native dialog is outside the browser surface)` when needed.
- **Native HTML5 drag has no drag image in headless Chromium.** The node stays put until the drop. The cursor path plus the before and after frames carry the story. Pointer-driven drag libraries render the movement. If a stepped mouse drag does not fire the drop, fall back to `tab.drag(source, target)` and say so in the report. It fires the drag events but jumps.
- **The overlay shows up in screenshots.** Take pixel-diff baselines without it: `await tab.removeInitScript(overlay.id)` and reload. `addInitScript` returns `{ id }`, not a bare id.
- **Built-in cursor.** `recordStart(path, { cursor: true })` draws a small cursor. It is hard to follow at review size, which is why the overlay draws its own. Use one or the other, not both.
- **A run that hangs or a tab that reports frozen.** If `tab.run` times out on a step that normally takes seconds, or a call fails with "frozen and could not be resumed", close and reopen the tab rather than retrying. Init scripts belong to the tab, so add the overlay again after reopening. Keep heavy jobs such as test suites and builds off the machine while recording; they starve the page and stretch every step.

## Presentation cuts

When the audience is a PM, a stakeholder, or a release note rather than a reviewer, record a second take of the same script, tuned for watching:

- **Slower.** Glide 800 to 1200 ms and hold each landing 1 to 1.5 s.
- **Captions in the story's words.** "Pay with a saved card", never a selector or a state value.
- **A clean screen.** No devtools and no probe output. Seed data that reads like real data, not `test123`.
- **A bigger fixed viewport.** 1440x900 or 1920x1080, the same for every re-record.
- **A GIF where MP4 does not play.** `ffmpeg -v error -y -i <slug>.mp4 -vf "fps=10,scale=960:-1:flags=lanczos" <slug>.gif`.

For a narrated walkthrough or a polished feature reveal, HyperFrames (`npx skills add heygen-com/hyperframes`, its `/pr-to-video` workflow) renders HTML compositions to MP4 deterministically and can place the raw recording inside a designed scene. A presentation cut is not proof. The evidence is still the raw recording and its trace, so link both next to it.
