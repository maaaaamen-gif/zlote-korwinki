import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import helmet from "helmet";
import { CATEGORIES, validateClipInput, ValidationError } from "./src/clip-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maxUploadBytes = 100 * 1024 * 1024;
const allowedMediaTypes = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_request, _file, callback) => callback(null, `clip-${randomUUID()}`),
  }),
  limits: { fileSize: maxUploadBytes, files: 1, fields: 5, fieldSize: 2048 },
  fileFilter: (_request, file, callback) => {
    if (allowedMediaTypes.has(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new ValidationError("Wybierz plik MP4, WebM, MOV, JPG, PNG lub WebP."));
    }
  },
});

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "1h" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

let clips;
let votes;
let bucket;

function getVoterId(request, response) {
  const existing = readVoterCookie(request);
  if (existing) return existing;
  const voterId = randomUUID();
  response.cookie("clipVoter", voterId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return voterId;
}

function readVoterCookie(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("clipVoter="));
  const voterId = cookie?.slice("clipVoter=".length);
  return voterId && /^[0-9a-f-]{36}$/i.test(voterId) ? voterId : null;
}

function publicClip(clip, votedIds) {
  const mediaId = clip.mediaId?.toString();
  return {
    id: clip._id.toString(),
    name: clip.name,
    caption: clip.caption,
    category: clip.category,
    videoUrl: clip.videoUrl,
    mediaType: clip.mediaType,
    mediaUrl: mediaId ? `/api/media/${mediaId}` : null,
    createdAt: clip.createdAt,
    votes: clip.votes,
    hasVoted: votedIds.has(clip._id.toString()),
  };
}

async function removeTempFile(filePath) {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "korwinki.html")));
app.get("/korwinki.html", (_request, response) => response.sendFile(path.join(__dirname, "korwinki.html")));

app.get("/api/categories", (_request, response) => response.json({ categories: CATEGORIES }));

app.get("/api/clips", async (request, response, next) => {
  try {
    const category = typeof request.query.category === "string" ? request.query.category : "";
    if (category && !CATEGORIES.includes(category)) {
      return response.status(400).json({ error: "Nieprawidłowa kategoria." });
    }
    const page = Number.parseInt(String(request.query.page ?? "0"), 10);
    const limit = Number.parseInt(String(request.query.limit ?? "20"), 10);
    if (!Number.isInteger(page) || page < 0 || page > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return response.status(400).json({ error: "Nieprawidłowe parametry strony." });
    }

    const filter = category ? { category } : {};
    const voterId = getVoterId(request, response);
    const rows = await clips.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "clip_votes",
          localField: "_id",
          foreignField: "clipId",
          pipeline: [{ $count: "count" }],
          as: "voteSummary",
        },
      },
      { $addFields: { votes: { $ifNull: [{ $arrayElemAt: ["$voteSummary.count", 0] }, 0] } } },
      { $sort: { votes: -1, createdAt: -1, _id: 1 } },
      { $skip: page * limit },
      { $limit: limit + 1 },
      { $project: { voteSummary: 0, email: 0 } },
    ]).toArray();

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const voted = voterId
      ? await votes.find(
          { voterId, clipId: { $in: pageRows.map((clip) => clip._id) } },
          { projection: { clipId: 1 } },
        ).toArray()
      : [];
    const votedIds = new Set(voted.map((vote) => vote.clipId.toString()));
    return response.json({ clips: pageRows.map((clip) => publicClip(clip, votedIds)), hasMore });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/clips", submissionLimiter, upload.single("media"), async (request, response, next) => {
  let mediaId;
  let mediaStored = false;
  try {
    const input = validateClipInput(request.body, Boolean(request.file));
    if (request.file) {
      const uploadStream = bucket.openUploadStream(`clip-${randomUUID()}`, {
        contentType: request.file.mimetype,
      });
      mediaId = uploadStream.id;
      mediaStored = true;
      await pipeline(createReadStream(request.file.path), uploadStream);
    }

    const result = await clips.insertOne({
      ...input,
      mediaId: mediaId ?? null,
      mediaType: request.file?.mimetype ?? null,
      createdAt: new Date(),
    });
    mediaStored = false;
    return response.status(201).json({ id: result.insertedId.toString() });
  } catch (error) {
    if (mediaId && mediaStored) {
      try {
        await bucket.delete(mediaId);
      } catch (cleanupError) {
        console.error("Failed to clean up media after submission failed.", cleanupError);
      }
    }
    return next(error);
  } finally {
    try {
      await removeTempFile(request.file?.path);
    } catch (cleanupError) {
      console.error("Failed to remove temporary uploaded file.", cleanupError);
    }
  }
});

app.get("/api/media/:id", async (request, response, next) => {
  if (!ObjectId.isValid(request.params.id)) {
    return response.status(404).json({ error: "Nie znaleziono pliku." });
  }
  try {
    const mediaId = new ObjectId(request.params.id);
    const [file] = await bucket.find({ _id: mediaId }).limit(1).toArray();
    if (!file) return response.status(404).json({ error: "Nie znaleziono pliku." });
    response.set({
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    });
    const stream = bucket.openDownloadStream(mediaId);
    stream.on("error", (error) => {
      if (response.headersSent) response.destroy(error);
      else next(error);
    });
    return stream.pipe(response);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/clips/:id/vote", voteLimiter, async (request, response, next) => {
  if (!ObjectId.isValid(request.params.id)) {
    return response.status(404).json({ error: "Nie znaleziono klipu." });
  }
  try {
    const clipId = new ObjectId(request.params.id);
    const clip = await clips.findOne({ _id: clipId }, { projection: { _id: 1 } });
    if (!clip) return response.status(404).json({ error: "Nie znaleziono klipu." });
    const voterId = readVoterCookie(request) ?? getVoterId(request, response);
    try {
      await votes.insertOne({ clipId, voterId, createdAt: new Date() });
    } catch (error) {
      if (error.code === 11000) {
        return response.status(409).json({ error: "Z tego urządzenia oddano już głos na ten klip." });
      }
      throw error;
    }
    const count = await votes.countDocuments({ clipId });
    return response.json({ votes: count });
  } catch (error) {
    return next(error);
  }
});

app.use((request, response) => response.status(404).json({ error: "Nie znaleziono strony." }));

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Plik jest większy niż limit 100 MB."
      : "Nieprawidłowy formularz lub zbyt wiele plików.";
    return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
  }
  if (error instanceof ValidationError) {
    return response.status(400).json({ error: error.message });
  }
  console.error("Request failed.", error);
  return response.status(500).json({ error: "Wystąpił błąd serwera. Spróbuj ponownie później." });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || "zlote_korwinki");
    clips = database.collection("clips");
    votes = database.collection("clip_votes");
    bucket = new GridFSBucket(database, { bucketName: "clip_media" });
    await Promise.all([
      clips.createIndex({ category: 1, createdAt: -1 }),
      votes.createIndex({ clipId: 1, voterId: 1 }, { unique: true }),
      votes.createIndex({ clipId: 1 }),
    ]);

    const port = Number(process.env.PORT || 3000);
    const server = app.listen(port, () => console.log(`Clip site listening on port ${port}.`));
    const close = () => {
      server.close((error) => {
        if (error) {
          console.error("Could not close the clip site cleanly.", error);
          process.exitCode = 1;
        }
        client.close().catch((closeError) => {
          console.error("Could not close the MongoDB connection cleanly.", closeError);
          process.exitCode = 1;
        });
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    await client.close();
    throw error;
  }
}

start().catch((error) => {
  console.error("Could not start clip site.", error);
  process.exitCode = 1;
});
