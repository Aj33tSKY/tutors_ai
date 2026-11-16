import { AudioChannel, AudioConfig, AudioRoute } from "@livekit/protocol";
import { EgressClient, EncodedFileType, EncodingOptionsPreset, FileOutput, MediaSource, Output, S3Upload, StartEgressRequest, StorageConfig } from "livekit-server-sdk";
import { describeInfo, type EgressControl } from "./recording-control";

/** LiveKit's Twirp API answers "not_found" for an egress it has no record of (for example after a server restart). */
export const isEgressNotFound = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && String((error as { code: unknown }).code) === "not_found");

/** Egress adapter for the self-hosted LiveKit stack. Output goes to the private recordings bucket. */
export function livekitEgress(env = process.env): EgressControl | null {
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url, R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKey, R2_SECRET_ACCESS_KEY: accessSecret, R2_BUCKET: bucket } = env;
  if (!key || !secret || !url || !endpoint || !accessKey || !accessSecret || !bucket) return null;
  const client = new EgressClient(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), key, secret);
  const storage = () => new StorageConfig({ provider: { case: "s3", value: new S3Upload({ accessKey, secret: accessSecret, endpoint, region: "auto", bucket, forcePathStyle: true }) } });
  return {
    async startAudio({ roomName, tutorIdentity, studentIdentity, path }) {
      // One stereo file per call: tutor left, student right. The channel, not a guess, says who spoke, and one job
      // per call keeps concurrent Egress usage proportional to concurrent calls.
      const result = await client.startEgress(new StartEgressRequest({
        roomName,
        source: { case: "media", value: new MediaSource({ audio: new AudioConfig({ captureAll: false, routes: [
          new AudioRoute({ match: { case: "participantIdentity", value: tutorIdentity }, channel: AudioChannel.LEFT }),
          new AudioRoute({ match: { case: "participantIdentity", value: studentIdentity }, channel: AudioChannel.RIGHT }),
        ] }) }) },
        // Without disableManifest Egress writes an <id>.json beside the file that no row points at, so retention would never delete it.
        outputs: [new Output({ config: { case: "file", value: new FileOutput({ fileType: EncodedFileType.OGG, filepath: path, disableManifest: true }) } })],
        storage: storage(),
      }));
      return result.egressId;
    },
    async startScreen({ roomName, trackSid, path }) {
      const result = await client.startEgress(new StartEgressRequest({
        roomName,
        source: { case: "media", value: new MediaSource({ video: { case: "videoTrackId", value: trackSid } }) },
        // Passthrough saves the track as published: no re-encode and no audio. LiveKit rejects any explicit file type
        // with PASSTHROUGH and picks the container from the codec itself.
        encoding: { case: "preset", value: EncodingOptionsPreset.PASSTHROUGH },
        outputs: [new Output({ config: { case: "file", value: new FileOutput({ filepath: path, disableManifest: true }) } })],
        storage: storage(),
      }));
      return result.egressId;
    },
    async stop(egressId) {
      try { await client.stopEgress(egressId); }
      catch (error) { if (!(isEgressNotFound(error) || (error && typeof error === "object" && "code" in error && String(error.code) === "failed_precondition"))) throw error; }
    },
    async stopStray(roomName, keep) {
      const tracked = new Set(keep);
      const active = await client.listEgress({ roomName, active: true });
      await Promise.all(active.filter((info) => !tracked.has(info.egressId)).map((info) => client.stopEgress(info.egressId).catch(() => undefined)));
    },
    async describe(egressId) {
      // "No record" must be null, not an error: the reconciler settles null as ended, but treats an error as "server
      // unreachable, retry later", which would leave a forgotten recording (and its lesson's summary) stuck for ever.
      try {
        const [info] = await client.listEgress({ egressId });
        return info ? describeInfo(info) : null;
      } catch (error) {
        if (isEgressNotFound(error)) return null;
        throw error;
      }
    },
  };
}
