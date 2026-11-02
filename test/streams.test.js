import assert from "node:assert/strict";
import test from "node:test";
import { getStreamUrls, normalizeDashStreams, streamCacheSeconds } from "../streams.js";

test("prefers supplied regular CDN URLs while keeping overseas and PCDN backups intact", () => {
  const overseas = "https://upos-sz-mirrorcosov.bilivideo.com/video.m4s?upsig=original&os=cosov";
  const normal = "https://upos-sz-mirrorali.bilivideo.com/video.m4s?upsig=separate&os=alibv";
  const pcdn = "https://xy123.mcdn.bilivideo.cn:4483/video.m4s?upsig=pcdn";
  const result = normalizeDashStreams({
    video: [{ codecid: 7, height: 480, id: 32, baseUrl: overseas, backupUrl: [pcdn, normal, overseas] }],
    audio: [{ bandwidth: 128000, base_url: overseas, backup_url: [normal, pcdn] }],
  });
  assert.equal(result.videos[0].url, normal);
  assert.deepEqual(result.videos[0].backup_urls, [overseas, pcdn]);
  assert.equal(result.audios[0].url, normal);
  assert.deepEqual(result.audios[0].backup_urls, [overseas, pcdn]);
});

test("uses a backup when the main URL is absent, invalid or expired", () => {
  const valid = "https://upos-sz-mirrorali.bilivideo.com/video.m4s?upsig=keep";
  const expired = "https://upos-sz-mirrorcosov.bilivideo.com/video.m4s?deadline=1";
  assert.deepEqual(getStreamUrls({ baseUrl: expired, backup_url: ["invalid", "javascript:alert(1)", valid] }), [valid]);
  assert.deepEqual(getStreamUrls({ backupUrl: [valid], backup_url: "not-an-array" }), [valid]);
});

test("keeps an overseas URL if there is no usable alternative", () => {
  const url = "https://upos-hz-mirrorakam.akamaized.net/audio.m4s?upsig=keep";
  assert.deepEqual(getStreamUrls({ base_url: url }), [url]);
});

test("falls back to another codec if all H264 addresses are expired", () => {
  const result = normalizeDashStreams({ video: [
    { codecid: 7, height: 480, baseUrl: "https://example.com/expired?deadline=1" },
    { codecid: 12, height: 480, baseUrl: "https://example.com/valid" },
  ] });
  assert.equal(result.videos[0].url, "https://example.com/valid");
});

test("caps cache lifetime at the earliest selected stream expiry with a safety margin", () => {
  const now = 1_800_000_000_000;
  assert.equal(streamCacheSeconds({ videos: [{ url: "https://example.com/video?deadline=1800000120" }], audios: [{ url: "https://example.com/audio?deadline=1800001000" }] }, now), 60);
  assert.equal(streamCacheSeconds({ videos: [{ url: "https://example.com/video?deadline=1" }] }, now), 0);
  assert.equal(streamCacheSeconds({ videos: [{ url: "https://example.com/video" }] }, now), 1200);
});
