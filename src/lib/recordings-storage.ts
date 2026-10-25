import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Upload } from "livekit-server-sdk";

/**
 * Session recordings live in a private Cloudflare R2 bucket, which speaks the
 * S3 API. Every part of the app that touches a recording goes through here:
 * LiveKit Egress writes with recordingsUpload(), and the student page, the
 * transcribe cron and the prune cron use the helpers below.
 */
function config() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 recording storage is not configured");
  }
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

function client() {
  const { endpoint, accessKeyId, secretAccessKey } = config();
  return new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
}

export function recordingsUpload() {
  const { endpoint, accessKeyId, secretAccessKey, bucket } = config();
  return new S3Upload({
    accessKey: accessKeyId,
    secret: secretAccessKey,
    endpoint,
    region: "auto",
    bucket,
    forcePathStyle: true,
  });
}

/** A time-limited GET URL; the bucket itself stays private. */
export function signRecordingUrl(path: string, ttlSeconds: number) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: config().bucket, Key: path }), { expiresIn: ttlSeconds });
}

export async function deleteRecording(path: string) {
  await client().send(new DeleteObjectCommand({ Bucket: config().bucket, Key: path }));
}
