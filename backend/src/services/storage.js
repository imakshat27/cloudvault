import fs from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/env.js";

class StorageService {
  constructor() {
    this.isS3Configured = config.aws.storageMode === "s3";

    if (this.isS3Configured) {
      console.log(
        `[Storage] Initializing AWS S3 Client for bucket: ${config.aws.bucketName}`,
      );
      this.s3Client = new S3Client({
        region: config.aws.region,
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
      this.bucket = config.aws.bucketName;
    } else {
      console.log("[Storage] Local filesystem mode");
      if (!fs.existsSync(config.paths.uploadsDir)) {
        fs.mkdirSync(config.paths.uploadsDir, { recursive: true });
      }
    }
  }

  localPath(key) {
    const root = path.resolve(config.paths.uploadsDir);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep))
      throw new Error("Invalid storage key");
    return target;
  }

  /**
   * Generates a pre-signed upload URL for direct client upload
   */
  async getUploadUrl({ key, mimeType, fileSize }) {
    if (this.isS3Configured) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: fileSize,
        IfNoneMatch: "*",
      });
      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 900,
      }); // 15 mins
      return {
        uploadUrl,
        storageType: "s3",
        key,
      };
    }

    // Local dev upload URL endpoint
    return {
      uploadUrl: `/api/documents/local-upload/${encodeURIComponent(key)}`,
      storageType: "local",
      key,
    };
  }

  async getFileMetadata(key) {
    if (this.isS3Configured) {
      const result = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength };
    }
    return { size: fs.statSync(this.localPath(key)).size };
  }

  /**
   * Reads file buffer from storage (S3 or local) for text extraction
   */
  async getFileBuffer(key) {
    if (this.isS3Configured) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      if (response.ContentLength > 25 * 1024 * 1024) {
        response.Body.destroy();
        throw new Error("File exceeds 25 MB");
      }
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    }

    const localPath = this.localPath(key);
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at local storage path: ${localPath}`);
    }
    return fs.readFileSync(localPath);
  }

  /**
   * Saves a file buffer directly to local storage (for dev uploads)
   */
  async saveLocalFile(key, buffer) {
    const localPath = this.localPath(key);
    const parentDir = path.dirname(localPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(localPath, buffer);
    return localPath;
  }

  /**
   * Deletes a file from storage
   */
  async deleteFile(key) {
    if (this.isS3Configured) {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return;
    }

    const localPath = this.localPath(key);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
}

export const storageService = new StorageService();
