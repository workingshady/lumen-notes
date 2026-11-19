// npx tsx scripts/video-notes.test.ts
import assert from "node:assert/strict";
import { findTimestamps, flashcardInsert, formatTime, parseTime, timestampAt, timestampInsert, timestampMd, TypingPause, videoSources, TS_AT, fromMatch } from "../src/lib/video-notes";

// time parsing / formatting
assert.equal(parseTime("12:34"), 754);
assert.equal(parseTime("1:02:03"), 3723);
assert.equal(parseTime("125:00"), 7500);
assert.equal(parseTime("12:60"), null);
assert.equal(parseTime("1:2"), null);
assert.equal(formatTime(754), "12:34");
assert.equal(formatTime(3723), "1:02:03");
assert.equal(formatTime(5.9), "0:05");
assert.equal(formatTime(-3), "0:00");
assert.equal(timestampMd(754), "[12:34]");
assert.equal(timestampMd(754, 2), "[12:34](#video-2)");

// finding timestamps
const f = (s: string) => findTimestamps(s).map((t) => [t.label, t.seconds, t.video]);
assert.deepEqual(f("[12:34] gradient descent"), [["12:34", 754, 1]]);
assert.deepEqual(f("see [1:02:03] and [0:05](#video-2)."), [["1:02:03", 3723, 1], ["0:05", 5, 2]]);
assert.deepEqual(f("At [3:10]: the loss"), [["3:10", 190, 1]]);
assert.deepEqual(f("[12:34](https://x.y) link"), []);
assert.deepEqual(f("[12:34][ref] link"), []);
assert.deepEqual(f("\\[12:34] escaped"), []);
assert.deepEqual(f("`[12:34]` code"), []);
assert.deepEqual(f("- [ ] task [x] [^1] [12:3] [ab:cd] [12:61]"), []);
assert.deepEqual(f("Q [2:00] :: A"), [["2:00", 120, 1]]);
const at = timestampAt("x [1:00] y", 4);
assert.equal(at?.seconds, 60);
assert.equal(timestampAt("x [1:00] y", 0), null);

// markdown-it rule regex
const m = TS_AT.exec("[1:02:03](#video-3) rest")!;
assert.deepEqual(fromMatch(m), { seconds: 3723, video: 3, label: "1:02:03" });
assert.equal(TS_AT.exec("[^1]"), null);

// players in a note
const md = [
  "# Lesson",
  "https://www.youtube.com/watch?v=aircAruvnKk&t=30",
  "text https://youtu.be/x inline is not a player",
  "```",
  "https://vimeo.com/123",
  "```",
  "![lecture.mp4](att:abc)",
  "![diagram.png](att:def)",
  "https://example.com/talk.mp3",
  "https://vimeo.com/76979871",
].join("\n");
assert.deepEqual(videoSources(md).map((s) => [s.line, s.kind]), [[1, "youtube"], [6, "file"], [8, "audio"], [9, "vimeo"]]);

// inserts
let r = timestampInsert("abc\n\nxyz", 4, 75);
assert.deepEqual(r, { at: 4, text: "[1:15] ", caret: 11 });
r = timestampInsert("abc", 1, 75, 2);
assert.equal(r.text, "\n[1:15](#video-2) ");
assert.equal(r.at, 3);
const doc = "abc";
const out = doc.slice(0, r.at) + r.text + doc.slice(r.at);
assert.equal(out.slice(r.caret - 1, r.caret), " ");
const c = flashcardInsert("", 0, 754);
assert.deepEqual(c, { at: 0, text: " [12:34] :: ", caret: 0 });

// pause while typing
const p = new TypingPause(4000);
assert.equal(p.key(0), null); // no insert yet
p.inserted(true);
assert.equal(p.key(100), "pause");
assert.equal(p.key(200), null);
assert.equal(p.tick(3000), null);
assert.equal(p.tick(4300), "resume");
p.inserted(true);
p.key(5000);
assert.equal(p.key(5100, true), "resume"); // Enter on an empty line
p.inserted(false); // video was not playing → never pauses
assert.equal(p.key(6000), null);

console.log("video-notes: all tests passed");
