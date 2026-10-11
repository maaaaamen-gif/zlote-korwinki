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
import {
  ADMIN_SESSION_DURATION_MS,
  createAdminSession,
  credentialsMatch,
  verifyAdminSession,
} from "./src/admin-auth.js";

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
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", apiLimiter);
app.use("/api/admin", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  return next();
});

let clips;
let votes;
let settings;
let bucket;
let mongoClient;

const defaultSiteSettings = Object.freeze({ uploadsEnabled: true, votingEnabled: false });

async function getSiteSettings() {
  const current = await settings.findOne({ _id: "site" });
  if (!current) return { ...defaultSiteSettings };
  const uploadsEnabled = current.uploadsEnabled === true;
  return {
    uploadsEnabled,
    votingEnabled: !uploadsEnabled && current.votingEnabled === true,
  };
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  return (request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_SESSION_DURATION_MS,
    path: "/",
  };
}

function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  const expectedOrigin = `${request.protocol}://${request.get("host")}`;
  if (origin !== expectedOrigin) {
    return response.status(403).json({ error: "Żądanie musi pochodzić z tej strony." });
  }
  return next();
}

function requireAdmin(request, response, next) {
  const valid = verifyAdminSession(
    readCookie(request, "adminSession"),
    process.env.ADMIN_USERNAME,
    process.env.ADMIN_SESSION_SECRET,
  );
  if (!valid) return response.status(401).json({ error: "Zaloguj się jako administrator." });
  return next();
}

async function requireUploadsEnabled(_request, response, next) {
  try {
    const siteSettings = await getSiteSettings();
    if (!siteSettings.uploadsEnabled) {
      return response.status(403).json({ error: "Przesyłanie klipów jest obecnie wyłączone." });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

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

app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/korwinki.html", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));

app.get("/api/categories", (_request, response) => response.json({ categories: CATEGORIES }));

app.get("/api/site-settings", async (_request, response, next) => {
  try {
    return response.json(await getSiteSettings());
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/login", adminLoginLimiter, requireSameOrigin, (request, response) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!credentialsMatch(request.body?.username, username)
      || !credentialsMatch(request.body?.password, password)) {
    return response.status(401).json({ error: "Nieprawidłowy login lub hasło." });
  }

  response.cookie(
    "adminSession",
    createAdminSession(username, process.env.ADMIN_SESSION_SECRET),
    adminSessionCookieOptions(),
  );
  return response.json({ authenticated: true });
});

app.post("/api/admin/logout", requireSameOrigin, (_request, response) => {
  response.clearCookie("adminSession", adminSessionCookieOptions());
  return response.json({ authenticated: false });
});

app.get("/api/admin/session", requireAdmin, async (_request, response, next) => {
  try {
    return response.json({ authenticated: true, settings: await getSiteSettings() });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/admin/settings", requireSameOrigin, requireAdmin, async (request, response, next) => {
  try {
    const { setting, enabled } = request.body ?? {};
    if (!["uploadsEnabled", "votingEnabled"].includes(setting) || typeof enabled !== "boolean") {
      return response.status(400).json({ error: "Nieprawidłowe ustawienie." });
    }

    if (setting === "uploadsEnabled" && enabled) {
      await settings.updateOne(
        { _id: "site" },
        { $set: { uploadsEnabled: true, votingEnabled: false } },
      );
    } else if (setting === "votingEnabled" && enabled) {
      const result = await settings.updateOne(
        { _id: "site", uploadsEnabled: false },
        { $set: { votingEnabled: true } },
      );
      if (result.matchedCount === 0) {
        return response.status(409).json({
          error: "Aby włączyć głosowanie, najpierw wyłącz przesyłanie klipów.",
        });
      }
    } else {
      await settings.updateOne({ _id: "site" }, { $set: { [setting]: false } });
    }

    return response.json({ settings: await getSiteSettings() });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/clips", requireAdmin, async (request, response, next) => {
  try {
    const page = Number.parseInt(String(request.query.page ?? "0"), 10);
    const limit = Number.parseInt(String(request.query.limit ?? "30"), 10);
    if (!Number.isInteger(page) || page < 0 || page > 1000
        || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return response.status(400).json({ error: "Nieprawidłowe parametry strony." });
    }

    const rows = await clips.aggregate([
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
      { $sort: { createdAt: -1, _id: 1 } },
      { $skip: page * limit },
      { $limit: limit + 1 },
      { $project: { name: 0, email: 0, videoUrl: 0, mediaType: 0, mediaId: 0, voteSummary: 0 } },
    ]).toArray();

    const hasMore = rows.length > limit;
    return response.json({
      clips: rows.slice(0, limit).map((clip) => ({
        id: clip._id.toString(),
        caption: clip.caption,
        category: clip.category,
        votes: clip.votes,
        createdAt: clip.createdAt,
      })),
      hasMore,
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/clips/:id/votes", requireSameOrigin, requireAdmin, async (request, response, next) => {
  if (!ObjectId.isValid(request.params.id)) {
    return response.status(404).json({ error: "Nie znaleziono klipu." });
  }
  try {
    const clipId = new ObjectId(request.params.id);
    const clip = await clips.findOne({ _id: clipId }, { projection: { _id: 1 } });
    if (!clip) return response.status(404).json({ error: "Nie znaleziono klipu." });
    const result = await votes.deleteMany({ clipId });
    return response.json({ deletedVotes: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/clips/:id", requireSameOrigin, requireAdmin, async (request, response, next) => {
  if (!ObjectId.isValid(request.params.id)) {
    return response.status(404).json({ error: "Nie znaleziono klipu." });
  }
  try {
    const clipId = new ObjectId(request.params.id);
    let deletedClip;
    await mongoClient.withSession((session) => session.withTransaction(async () => {
      deletedClip = await clips.findOne({ _id: clipId }, { session });
      if (!deletedClip) return;
      await clips.deleteOne({ _id: clipId }, { session });
      await votes.deleteMany({ clipId }, { session });
    }));
    if (!deletedClip) return response.status(404).json({ error: "Nie znaleziono klipu." });

    if (deletedClip.mediaId) {
      const [file] = await bucket.find({ _id: deletedClip.mediaId }).limit(1).toArray();
      if (file) await bucket.delete(deletedClip.mediaId);
    }
    return response.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

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
    const siteSettings = await getSiteSettings();
    const voterId = siteSettings.votingEnabled ? getVoterId(request, response) : null;
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
      { $sort: siteSettings.votingEnabled ? { votes: -1, createdAt: -1, _id: 1 } : { createdAt: -1, _id: 1 } },
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
    return response.json({
      clips: pageRows.map((clip) => publicClip(
        siteSettings.votingEnabled ? clip : { ...clip, votes: 0 },
        votedIds,
      )),
      hasMore,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/clips", submissionLimiter, requireUploadsEnabled, upload.single("media"), async (request, response, next) => {
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

    if (!(await getSiteSettings()).uploadsEnabled) {
      if (mediaId && mediaStored) {
        await bucket.delete(mediaId);
        mediaStored = false;
      }
      return response.status(403).json({ error: "Przesyłanie klipów jest obecnie wyłączone." });
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
    if (!(await getSiteSettings()).votingEnabled) {
      return response.status(403).json({ error: "Głosowanie jest obecnie wyłączone." });
    }
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
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required.");
  }
  if (!process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 characters.");
  }
  mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoClient.connect();
    const database = mongoClient.db(process.env.MONGODB_DB || "zlote_korwinki");
    clips = database.collection("clips");
    votes = database.collection("clip_votes");
    settings = database.collection("site_settings");
    bucket = new GridFSBucket(database, { bucketName: "clip_media" });
    await Promise.all([
      clips.createIndex({ category: 1, createdAt: -1 }),
      votes.createIndex({ clipId: 1, voterId: 1 }, { unique: true }),
      votes.createIndex({ clipId: 1 }),
      settings.updateOne(
        { _id: "site" },
        { $setOnInsert: defaultSiteSettings },
        { upsert: true },
      ),
    ]);
    await settings.updateOne(
      { _id: "site", uploadsEnabled: true, votingEnabled: true },
      { $set: { votingEnabled: false } },
    );

    const port = Number(process.env.PORT || 3000);
    const server = app.listen(port, () => console.log(`Clip site listening on port ${port}.`));
    const close = () => {
      server.close((error) => {
        if (error) {
          console.error("Could not close the clip site cleanly.", error);
          process.exitCode = 1;
        }
        mongoClient.close().catch((closeError) => {
          console.error("Could not close the MongoDB connection cleanly.", closeError);
          process.exitCode = 1;
        });
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    await mongoClient.close();
    throw error;
  }
}

start().catch((error) => {
  console.error("Could not start clip site.", error);
  process.exitCode = 1;
});
