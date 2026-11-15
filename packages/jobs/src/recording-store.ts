import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RecordingStore } from "./lesson-jobs.js";

export function recordingStore(): RecordingStore {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Worker R2 storage is not configured");
  const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey },
    requestHandler: { connectionTimeout: 10000, requestTimeout: 60000 }, maxAttempts: 3 });
  return {
    sign: (path, expiresIn) => getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), { expiresIn }),
    remove: async (path) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path })); },
  };
}
