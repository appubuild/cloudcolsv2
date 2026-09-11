/**
 * Evidence for the media delivery path, against production.
 *
 * Everything here is measured rather than asserted from the code: how many bytes a
 * range request actually transfers, whether a 206 comes back, how long the first byte
 * takes, and whether a second read of a thumbnail reaches Backblaze at all.
 *
 * Links are minted exactly as the app mints them, so this exercises the deployed
 * worker rather than a private reimplementation of it. It never downloads a whole
 * video: proving a range works by transferring a gigabyte would prove the opposite of
 * the point.
 *
 *   CDN_TICKET_SECRET=... node scripts/media-audit.mjs [--include-1gb]
 */
import fs from "node:fs";
import crypto from "node:crypto";

const env = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const SECRET = process.env.CDN_TICKET_SECRET || "";
const CDN = "https://cdn.cloudcols.com";
const HOST = env.B2_ENDPOINT.replace(/^https?:\/\//, "");
const MB = 1048576;
const NL = String.fromCharCode(10);

const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const sha = (d) => crypto.createHash("sha256").update(d).digest("hex");

/** Signs a request straight to Backblaze — used only to place and remove test objects. */
function presignB2(method, key, extra = {}) {
  const amz = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amz.slice(0, 8);
  const scope = day + "/" + env.B2_REGION + "/s3/aws4_request";
  const uri = "/" + env.B2_BUCKET + "/" + key.split("/").map(encodeURIComponent).join("/");
  const q = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": env.B2_ACCESS_KEY_ID + "/" + scope,
    "X-Amz-Date": amz,
    "X-Amz-Expires": "3600",
    "X-Amz-SignedHeaders": "host",
    ...extra,
  });
  q.sort();
  const canonical = [method, uri, q.toString(), "host:" + HOST + NL, "host", "UNSIGNED-PAYLOAD"].join(NL);
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(canonical)].join(NL);
  let k = hmac("AWS4" + env.B2_SECRET_ACCESS_KEY, day);
  for (const p of [env.B2_REGION, "s3", "aws4_request"]) k = hmac(k, p);
  q.set("X-Amz-Signature", crypto.createHmac("sha256", k).update(sts).digest("hex"));
  return "https://" + HOST + uri + "?" + q;
}

const sb = (query) =>
  fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/" + query, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  }).then((r) => r.json());

/** A delivery link of the shape the app issues. */
function ticket(key, cls, opts = {}) {
  const { disp = "i", filename = "", ct = "", userId = "" } = opts;
  const exp = Math.ceil((Date.now() + 1800000) / 600000) * 600000;
  const fields = [key, String(exp), cls, disp, filename, ct, userId].join(NL);
  const sig = crypto.createHmac("sha256", SECRET).update(fields).digest("hex");
  const p = new URLSearchParams({ key, exp: String(exp), c: cls, d: disp, sig });
  if (filename) p.set("n", filename);
  if (ct) p.set("ct", ct);
  if (userId) p.set("u", userId);
  return CDN + "/v1/object?" + p;
}

/** The cookie the app sets alongside a bound link. */
function cookieFor(userId) {
  const body = "v1." + userId + "." + (Date.now() + 3600000);
  return "cc_dk=" + body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  const suffix = detail ? "  (" + detail + ")" : "";
  if (ok) {
    pass += 1;
    console.log("    ok   " + name + suffix);
  } else {
    failures.push(name + suffix);
    console.log("    FAIL " + name + suffix);
  }
}

/** Reads a range and reports what was actually transferred, not what was promised. */
async function readRange(url, from, to, headers) {
  const started = Date.now();
  const range = "bytes=" + from + "-" + (to === null ? "" : to);
  const res = await fetch(url, { headers: { ...headers, range } });
  let ttfb = null;
  let bytes = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      if (ttfb === null) ttfb = Date.now() - started;
      bytes += chunk.length;
    }
  }
  return { status: res.status, bytes, ttfb: ttfb ?? Date.now() - started, headers: res.headers };
}

async function exercise(label, key, size, owner, contentType) {
  console.log(NL + "  " + label + " — " + (size / MB).toFixed(1) + " MB");
  const cookie = { cookie: cookieFor(owner) };
  const url = ticket(key, "p", { ct: contentType, userId: owner });

  const head = await fetch(url, { method: "HEAD", headers: cookie });
  check("HEAD reports the true length", Number(head.headers.get("content-length")) === size, String(head.headers.get("content-length")));
  check("ranges advertised", head.headers.get("accept-ranges") === "bytes");
  check("content-type preserved", String(head.headers.get("content-type")) === contentType, String(head.headers.get("content-type")));
  check("private original bypasses the edge cache", head.headers.get("x-cdn-cache") === "BYPASS", String(head.headers.get("x-cdn-cache")));

  // What a player asks for first.
  const opening = await readRange(url, 0, MB - 1, cookie);
  check("opening range is 206", opening.status === 206, String(opening.status));
  check("exactly the requested bytes", opening.bytes === MB, String(opening.bytes));
  check("content-range names the whole object", opening.headers.get("content-range") === "bytes 0-" + (MB - 1) + "/" + size, String(opening.headers.get("content-range")));
  check("first byte is prompt", opening.ttfb < 6000, opening.ttfb + "ms");
  check("the whole file was not transferred", opening.bytes < size, (opening.bytes / MB).toFixed(1) + " MB of " + (size / MB).toFixed(1) + " MB");

  // Dragging the scrubber.
  const mid = Math.floor(size / 2);
  const seek = await readRange(url, mid, mid + 262143, cookie);
  check("seek into the middle is 206", seek.status === 206 && seek.bytes === 262144, seek.status + ", " + seek.bytes + " bytes");
  // Was 15–33 s at depth before the subrequest stopped going through Cloudflare's cache
  // layer; the bound is set so that regression cannot come back unnoticed.
  check("seek first byte is prompt", seek.ttfb < 4000, seek.ttfb + "ms");

  // Resuming an interrupted download.
  const tail = await readRange(url, size - 131072, null, cookie);
  check("open-ended range resumes to the end", tail.status === 206 && tail.bytes === 131072, tail.status + ", " + tail.bytes + " bytes");

  // Security, on the same object.
  check("no cookie, no bytes", (await fetch(url, { method: "HEAD" })).status === 403);
  check("another account's cookie is refused", (await fetch(url, { method: "HEAD", headers: { cookie: cookieFor("someone-else") } })).status === 403);
}

async function main() {
  if (!SECRET) {
    console.log("CDN_TICKET_SECRET must be set in the environment to run this.");
    process.exitCode = 2;
    return;
  }

  console.log("Delivery evidence, against production");
  console.log("=".repeat(62));
  const health = await (await fetch("https://cloudcols.com/api/health")).json();
  console.log("app : ok=" + health.ok + " delivery=" + health.delivery);
  console.log("cdn : " + (await (await fetch(CDN + "/__health")).text()));

  const files = await sb(
    "files?select=original_filename,object_key,size_bytes,mime_type,owner_id,thumbnail_url,width,height,duration_seconds&status=eq.ready&order=size_bytes.desc&limit=40",
  );
  const videos = files.filter((f) => String(f.mime_type || "").startsWith("video/"));

  const buckets = [
    ["small", (s) => s < 50 * MB],
    ["100 MB class", (s) => s >= 100 * MB && s < 200 * MB],
    ["250 MB class", (s) => s >= 250 * MB && s < 320 * MB],
    ["330 MB class", (s) => s >= 320 * MB],
  ];
  for (const [label, match] of buckets) {
    const f = videos.find((v) => match(Number(v.size_bytes)));
    if (!f) {
      console.log(NL + "  " + label + " — no file of this size on the account");
      continue;
    }
    await exercise(label + ": " + f.original_filename, f.object_key, Number(f.size_bytes), f.owner_id, f.mime_type || "video/mp4");
  }

  console.log(NL + "  Recorded media metadata");
  const missing = videos.filter((v) => v.width == null || v.duration_seconds == null);
  console.log("    " + (videos.length - missing.length) + " of " + videos.length + " videos have width/height/duration recorded");
  for (const v of videos) {
    const dims = v.width ? v.width + "x" + v.height : "—";
    const dur = v.duration_seconds == null ? "—" : Number(v.duration_seconds).toFixed(1) + "s";
    console.log("      " + String(v.original_filename).padEnd(34) + " " + dims.padEnd(12) + " " + dur);
  }

  const withThumb = files.find((f) => f.thumbnail_url);
  if (withThumb) {
    console.log(NL + "  Thumbnail caching");
    const turl = ticket(String(withThumb.thumbnail_url), "t", { ct: "image/webp", userId: withThumb.owner_id });
    const cookie = { cookie: cookieFor(withThumb.owner_id) };
    const first = await fetch(turl, { headers: cookie });
    const size = (await first.arrayBuffer()).byteLength;
    // The edge copy is written in waitUntil, after the first response has gone. A read
    // fired the same instant can beat it — that is a race in the test, not a miss.
    await new Promise((r) => setTimeout(r, 3000));
    const second = await fetch(turl, { headers: cookie });
    await second.arrayBuffer();
    check("second read comes from the edge", second.headers.get("x-cdn-cache") === "HIT", first.headers.get("x-cdn-cache") + " then " + second.headers.get("x-cdn-cache"));
    check("thumbnail is small, not the original", size < 512 * 1024, (size / 1024).toFixed(0) + " KB");
    check("browser may keep it", String(second.headers.get("cache-control")).includes("immutable"), String(second.headers.get("cache-control")));
  }

  if (process.argv.includes("--include-1gb")) {
    console.log(NL + "  1 GB object (nothing on the account is this big)");
    const key = "_audit/" + crypto.randomUUID() + ".bin";
    const size = 1024 * MB;
    const part = 32 * MB;
    const chunk = crypto.randomBytes(part);

    const created = await fetch(presignB2("POST", key, { uploads: "" }), { method: "POST" });
    const xml = await created.text();
    const uploadId = xml.slice(xml.indexOf("<UploadId>") + 10, xml.indexOf("</UploadId>"));
    const etags = [];
    for (let i = 0; i < size / part; i += 1) {
      const r = await fetch(presignB2("PUT", key, { partNumber: String(i + 1), uploadId }), { method: "PUT", body: chunk });
      if (!r.ok) throw new Error("part " + (i + 1) + " -> " + r.status);
      etags.push(r.headers.get("etag"));
      process.stdout.write("\r    uploading " + (((i + 1) * part) / MB).toFixed(0) + " MB / 1024 MB   ");
    }
    process.stdout.write("\r" + " ".repeat(48) + "\r");
    const parts = etags.map((e, i) => "<Part><PartNumber>" + (i + 1) + "</PartNumber><ETag>" + e + "</ETag></Part>").join("");
    await fetch(presignB2("POST", key, { uploadId }), {
      method: "POST",
      body: "<CompleteMultipartUpload>" + parts + "</CompleteMultipartUpload>",
    });

    try {
      await exercise("1 GB synthetic object", key, size, "audit-user", "video/mp4");
    } finally {
      await fetch(presignB2("DELETE", key), { method: "DELETE" });
      console.log("    (test object removed)");
    }
  }

  console.log(NL + "=".repeat(62));
  console.log(pass + " passed, " + failures.length + " failed");
  if (failures.length) {
    console.log(NL + "Failures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
