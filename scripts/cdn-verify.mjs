/**
 * Verification harness for the CDN worker.
 *
 * Runs the real worker under `wrangler dev` against a stand-in for Backblaze, and
 * asserts the things that cannot be established by reading the code: that a forged
 * ticket is refused, that a range request comes back as a 206 without pulling the
 * whole object, that a thumbnail is served from the edge cache the second time, and
 * that a private original never is.
 *
 * The stand-in matters. Backblaze's S3 endpoint is not reachable without production
 * credentials, and pointing this at production would upload nothing but would bill
 * real transactions to run a test. What is exercised here is every line of the worker
 * — ticket parsing, signature checking, presigning, range forwarding, cache decisions,
 * header construction — with only the origin replaced. The one thing it cannot prove
 * is that Backblaze itself honours the signature, which the app's existing upload and
 * download paths already establish against the live bucket.
 *
 * Run: node scripts/cdn-verify.mjs
 */

import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const B2_PORT = 8801;
const CDN_PORT = 8802;
const SECRET = "verification-only-secret-not-a-real-one";
const BUCKET = "cloudcols-test";

// ---------------------------------------------------------------------------
// Fixtures. Sizes chosen so "did it stream or did it buffer" is answerable: the
// video is far larger than a single range, so a 206 that returns everything is
// visibly wrong.
// ---------------------------------------------------------------------------
const OBJECTS = new Map([
  ["user-A/derivatives/thumbs/pic.webp", filled(20 * 1024, 0x41)],
  ["user-A/user-files/video/clip.mp4", filled(12 * 1024 * 1024, 0x56)],
  ["user-A/user-files/doc/report.pdf", filled(200 * 1024, 0x50)],
  ["user-B/derivatives/thumbs/other.webp", filled(20 * 1024, 0x42)],
]);

function filled(size, byte) {
  return Buffer.alloc(size, byte);
}

let upstreamHits = 0;
const upstreamLog = [];

// ---------------------------------------------------------------------------
// Stand-in for the B2 S3 endpoint.
// ---------------------------------------------------------------------------
function startFakeB2() {
  const server = createServer((req, res) => {
    upstreamHits += 1;
    const url = new URL(req.url, `http://127.0.0.1:${B2_PORT}`);
    const path = decodeURIComponent(url.pathname);
    const prefix = `/${BUCKET}/`;
    upstreamLog.push(`${req.method} ${path}${req.headers.range ? ` range=${req.headers.range}` : ""}`);

    if (!path.startsWith(prefix)) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<Error><Code>NoSuchBucket</Code></Error>");
      return;
    }

    const key = path.slice(prefix.length);
    const body = OBJECTS.get(key);
    if (!body) {
      // Shaped like B2: an XML body naming the bucket and key, which is exactly what
      // the worker must not pass through to the reader.
      res.writeHead(404, { "content-type": "application/xml" });
      res.end(`<Error><Code>NoSuchKey</Code><Key>${key}</Key><BucketName>${BUCKET}</BucketName></Error>`);
      return;
    }

    const common = {
      "accept-ranges": "bytes",
      etag: `"etag-${key.length}-${body.length}"`,
      "last-modified": "Mon, 01 Sep 2026 00:00:00 GMT",
      "content-type": "application/octet-stream",
      "x-amz-file-id": "internal-b2-id-should-not-be-forwarded",
    };

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : body.length - 1;
        const slice = body.subarray(start, end + 1);
        res.writeHead(206, {
          ...common,
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "content-length": String(slice.length),
        });
        res.end(req.method === "HEAD" ? undefined : slice);
        return;
      }
    }

    res.writeHead(200, { ...common, "content-length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
  });

  return new Promise((resolve) => server.listen(B2_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Ticket minting.
//
// Deliberately a separate implementation of the canonical string from the one in
// lib/services/cdnTicket.ts. If the two ever disagree every signed request below
// fails, which is the point: this asserts the format rather than assuming it.
// ---------------------------------------------------------------------------
function mint({ key, exp, cls, disp = "i", filename = "", contentType = "", userId = "", legacy = false }) {
  const fields = [key, String(exp), cls, disp, filename, contentType];
  // The old shape had no owner field. The worker still accepts it, so links already
  // in a browser survive a deploy; this exercises that path deliberately.
  if (!legacy) fields.push(userId);
  const canonical = fields.join("\n");
  const sig = createHmac("sha256", SECRET).update(canonical).digest("hex");
  const p = new URLSearchParams({ key, exp: String(exp), c: cls, d: disp, sig });
  if (filename) p.set("n", filename);
  if (contentType) p.set("ct", contentType);
  if (userId) p.set("u", userId);
  return `http://127.0.0.1:${CDN_PORT}/v1/object?${p.toString()}`;
}

/** The cookie the app sets alongside a bound link. */
function cookieFor(userId, expiresAt = Date.now() + 3600_000) {
  const body = `v1.${userId}.${expiresAt}`;
  return `cc_dk=${body}.${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

const soon = () => Date.now() + 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForWorker() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDN_PORT}/__health`);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The CDN worker did not start within 90s.");
}

async function main() {
  const b2 = await startFakeB2();
  console.log(`Stand-in B2 listening on :${B2_PORT}`);
  // Without this an early failure leaves the listener open, the event loop alive, and
  // the run hanging instead of reporting what went wrong.
  process.on("exit", () => { try { b2.close(); } catch {} });

  // Spawned as `node node_modules/wrangler/bin/wrangler.js` rather than through npx:
  // on Windows, spawning a .cmd shim without a shell fails with EINVAL, and turning
  // the shell on would mean quoting every argument correctly on two platforms.
  const wrangler = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "-c",
      "infrastructure/wrangler.jsonc",
      "--port",
      String(CDN_PORT),
      "--local",
      "--var",
      `B2_ENDPOINT:http://127.0.0.1:${B2_PORT}`,
      "--var",
      `B2_BUCKET:${BUCKET}`,
      "--var",
      "B2_REGION:us-east-005",
      "--var",
      "B2_ACCESS_KEY_ID:test-key-id",
      "--var",
      "B2_SECRET_ACCESS_KEY:test-secret",
      "--var",
      `CDN_TICKET_SECRET:${SECRET}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } },
  );

  let workerLog = "";
  wrangler.stdout.on("data", (d) => (workerLog += d.toString()));
  wrangler.stderr.on("data", (d) => (workerLog += d.toString()));

  const shutdown = () => {
    try {
      wrangler.kill();
    } catch {}
    b2.close();
  };

  try {
    const health = await waitForWorker();
    console.log("\nCDN worker up.\n");

    console.log("Ticket validation");
    check("health reports configured", health.configured === true, JSON.stringify(health));

    const noTicket = await fetch(`http://127.0.0.1:${CDN_PORT}/v1/object`);
    check("a request with no ticket is refused", noTicket.status === 400, `got ${noTicket.status}`);

    const thumbKey = "user-A/derivatives/thumbs/pic.webp";
    const good = mint({ key: thumbKey, exp: soon(), cls: "t", contentType: "image/webp" });

    const forged = good.replace(/sig=[0-9a-f]+/, `sig=${"0".repeat(64)}`);
    const forgedRes = await fetch(forged);
    check("a forged signature is refused", forgedRes.status === 403, `got ${forgedRes.status}`);

    const expired = mint({ key: thumbKey, exp: Date.now() - 1000, cls: "t", contentType: "image/webp" });
    const expiredRes = await fetch(expired);
    check("an expired ticket is refused", expiredRes.status === 403, `got ${expiredRes.status}`);

    // The class decides whether the edge may hold the bytes, so it is signed. Editing
    // it must invalidate the ticket rather than upgrade the request.
    const privateTicket = mint({ key: "user-A/user-files/doc/report.pdf", exp: soon(), cls: "p" });
    const promoted = privateTicket.replace("c=p", "c=t");
    const promotedRes = await fetch(promoted);
    check("a private ticket cannot be edited into a cacheable one", promotedRes.status === 403, `got ${promotedRes.status}`);

    const flipped = privateTicket.replace("d=i", "d=a");
    const flippedRes = await fetch(flipped);
    check("an inline ticket cannot be edited into a download", flippedRes.status === 403, `got ${flippedRes.status}`);

    console.log("\nOwnership binding");
    const owner = "user-A";
    const bound = mint({ key: thumbKey, exp: soon(), cls: "t", contentType: "image/webp", userId: owner });

    check("a bound link is refused with no cookie", (await fetch(bound)).status === 403);
    check(
      "a bound link works for the account it was issued to",
      (await fetch(bound, { headers: { cookie: cookieFor(owner) } })).status === 200,
    );
    check(
      "a bound link is refused for a different account",
      (await fetch(bound, { headers: { cookie: cookieFor("user-B") } })).status === 403,
    );
    check(
      "a forged cookie is refused",
      (await fetch(bound, { headers: { cookie: `cc_dk=v1.${owner}.${Date.now() + 3600_000}.${"0".repeat(64)}` } })).status === 403,
    );
    check(
      "an expired cookie is refused",
      (await fetch(bound, { headers: { cookie: cookieFor(owner, Date.now() - 1000) } })).status === 403,
    );
    check("removing the owner from the link invalidates it", (await fetch(bound.replace(/&u=[^&]*/, ""))).status === 403);
    check(
      "rewriting the owner invalidates it",
      (await fetch(bound.replace(`u=${owner}`, "u=user-B"), { headers: { cookie: cookieFor("user-B") } })).status === 403,
    );
    check(
      "a link issued before the change still works",
      (await fetch(mint({ key: thumbKey, exp: soon(), cls: "t", contentType: "image/webp", legacy: true }))).status === 200,
    );

  console.log("\nDelivery");
    upstreamHits = 0;
    const first = await fetch(good);
    const firstBody = Buffer.from(await first.arrayBuffer());
    check("a valid ticket serves the object", first.status === 200, `got ${first.status}`);
    check("the whole object arrives", firstBody.length === 20 * 1024, `${firstBody.length} bytes`);
    check("content-type comes from the ticket", first.headers.get("content-type") === "image/webp", String(first.headers.get("content-type")));
    check("B2 internal headers are not forwarded", first.headers.get("x-amz-file-id") === null);
    check("the response is marked private", (first.headers.get("cache-control") ?? "").includes("private"), String(first.headers.get("cache-control")));
    check("ranges are advertised", first.headers.get("accept-ranges") === "bytes");
    check("sniffing is disabled", first.headers.get("x-content-type-options") === "nosniff");

    console.log("\nEdge cache");
    const hitsAfterFirst = upstreamHits;
    const second = await fetch(good);
    await second.arrayBuffer();
    const cacheState = second.headers.get("x-cdn-cache");
    const cachedWithoutUpstream = upstreamHits === hitsAfterFirst;
    check(
      "a thumbnail is served from the edge on the second request",
      cacheState === "HIT" && cachedWithoutUpstream,
      `x-cdn-cache=${cacheState}, upstream hits ${hitsAfterFirst} -> ${upstreamHits}`,
    );

    // Different user, different key, same delivery class: the entries must not collide.
    const otherThumb = mint({ key: "user-B/derivatives/thumbs/other.webp", exp: soon(), cls: "t", contentType: "image/webp" });
    const otherRes = await fetch(otherThumb);
    const otherBody = Buffer.from(await otherRes.arrayBuffer());
    check(
      "another tenant's thumbnail is not served from this one's cache entry",
      otherBody[0] === 0x42 && otherBody.length === 20 * 1024,
      `first byte 0x${otherBody[0]?.toString(16)}`,
    );

    // Two share links can point at one file with different permissions. The cached
    // entry carries a content-disposition, so the two must not share one.
    const shareKey = "user-A/user-files/doc/report.pdf";
    const shareView = mint({ key: shareKey, exp: soon(), cls: "s", contentType: "application/pdf" });
    const shareDownload = mint({
      key: shareKey,
      exp: soon(),
      cls: "s",
      disp: "a",
      filename: "report.pdf",
      contentType: "application/pdf",
    });
    const sv = await fetch(shareView);
    await sv.arrayBuffer();
    const sd = await fetch(shareDownload);
    await sd.arrayBuffer();
    check(
      "a view share and a download share of one file do not share a cache entry",
      sv.headers.get("content-disposition") === "inline" &&
        (sd.headers.get("content-disposition") ?? "").startsWith("attachment"),
      `view=${sv.headers.get("content-disposition")}, download=${sd.headers.get("content-disposition")}`,
    );

    const pdfTicket = mint({ key: "user-A/user-files/doc/report.pdf", exp: soon(), cls: "p", contentType: "application/pdf" });
    upstreamHits = 0;
    const p1 = await fetch(pdfTicket);
    await p1.arrayBuffer();
    const p2 = await fetch(pdfTicket);
    await p2.arrayBuffer();
    check(
      "a private original is never held at the edge",
      p1.headers.get("x-cdn-cache") === "BYPASS" && p2.headers.get("x-cdn-cache") === "BYPASS" && upstreamHits === 2,
      `states ${p1.headers.get("x-cdn-cache")}/${p2.headers.get("x-cdn-cache")}, upstream ${upstreamHits}`,
    );
    check("a private response is never public", !(p1.headers.get("cache-control") ?? "").includes("public"), String(p1.headers.get("cache-control")));

    console.log("\nRange requests and streaming");
    const videoKey = "user-A/user-files/video/clip.mp4";
    const videoTicket = mint({ key: videoKey, exp: soon(), cls: "p", contentType: "video/mp4" });

    const started = Date.now();
    const ranged = await fetch(videoTicket, { headers: { range: "bytes=0-65535" } });
    const rangedBody = Buffer.from(await ranged.arrayBuffer());
    const ttfb = Date.now() - started;

    check("a range request returns 206", ranged.status === 206, `got ${ranged.status}`);
    check("content-range is passed through", ranged.headers.get("content-range") === `bytes 0-65535/${12 * 1024 * 1024}`, String(ranged.headers.get("content-range")));
    check("only the requested bytes come back", rangedBody.length === 65536, `${rangedBody.length} bytes`);
    check("the whole file is not fetched to answer a range", ttfb < 3000, `${ttfb}ms`);

    const seek = await fetch(videoTicket, { headers: { range: "bytes=6291456-6357000" } });
    const seekBody = Buffer.from(await seek.arrayBuffer());
    check("seeking into the middle works", seek.status === 206 && seekBody.length === 65545, `${seek.status}, ${seekBody.length} bytes`);

    const openEnded = await fetch(videoTicket, { headers: { range: "bytes=12582800-" } });
    const openBody = Buffer.from(await openEnded.arrayBuffer());
    check("an open-ended range resumes to the end", openEnded.status === 206 && openBody.length === 12 * 1024 * 1024 - 12582800, `${openBody.length} bytes`);

    check("a ranged response is never cached at the edge", ranged.headers.get("x-cdn-cache") === "BYPASS", String(ranged.headers.get("x-cdn-cache")));

    const full = await fetch(videoTicket);
    const fullBody = Buffer.from(await full.arrayBuffer());
    check("a full video download streams the whole object", full.status === 200 && fullBody.length === 12 * 1024 * 1024, `${fullBody.length} bytes`);

    console.log("\nDisposition and filenames");
    const attach = mint({
      key: videoKey,
      exp: soon(),
      cls: "p",
      disp: "a",
      filename: "Holiday Video.mp4",
      contentType: "video/mp4",
    });
    const attachRes = await fetch(attach);
    await attachRes.arrayBuffer();
    const cd = attachRes.headers.get("content-disposition") ?? "";
    check("an attachment carries its filename", cd.startsWith("attachment") && cd.includes("Holiday Video.mp4"), cd);

    const unicode = mint({ key: videoKey, exp: soon(), cls: "p", disp: "a", filename: "ছুটির ভিডিও.mp4" });
    const unicodeRes = await fetch(unicode);
    await unicodeRes.arrayBuffer();
    const ucd = unicodeRes.headers.get("content-disposition") ?? "";
    check("a non-ASCII filename survives", ucd.includes("filename*=UTF-8''") && ucd.includes(encodeURIComponent("ছুটির ভিডিও.mp4")), ucd);

    const inlineRes = await fetch(mint({ key: videoKey, exp: soon(), cls: "p", contentType: "video/mp4" }));
    await inlineRes.arrayBuffer();
    check("an inline ticket stays inline", inlineRes.headers.get("content-disposition") === "inline", String(inlineRes.headers.get("content-disposition")));

    console.log("\nErrors and surface");
    const missing = await fetch(mint({ key: "user-A/user-files/image/does-not-exist.png", exp: soon(), cls: "p" }));
    const missingBody = await missing.text();
    check("a missing object is a 404", missing.status === 404, `got ${missing.status}`);
    check("storage error detail is not leaked", !missingBody.includes(BUCKET) && !missingBody.includes("NoSuchKey"), missingBody.slice(0, 120));

    const head = await fetch(videoTicket, { method: "HEAD" });
    check("HEAD returns metadata with no body", head.status === 200 && head.headers.get("content-length") === String(12 * 1024 * 1024), `${head.status}, len=${head.headers.get("content-length")}`);

    const post = await fetch(good, { method: "POST" });
    check("writes are refused", post.status === 405, `got ${post.status}`);

    const wrongPath = await fetch(`http://127.0.0.1:${CDN_PORT}/v1/anything`);
    check("unknown paths are 404", wrongPath.status === 404, `got ${wrongPath.status}`);

    const preflight = await fetch(good, { method: "OPTIONS", headers: { origin: "https://cloudcols.com" } });
    check("preflight is answered", preflight.status === 204 && (preflight.headers.get("access-control-allow-methods") ?? "").includes("GET"), `${preflight.status}`);
  } finally {
    shutdown();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
