import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { CATEGORIES, validateClipInput, ValidationError } from "../../src/clip-validation.js";

const maxUploadBytes = 100 * 1024 * 1024;
const allowedMediaTypes = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

let databaseConnection;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function getVoterId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const voterId = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("clipVoter="))
    ?.slice("clipVoter=".length);
  return voterId && /^[0-9a-f-]{36}$/i.test(voterId) ? voterId : null;
}

function ensureVoterId(request) {
  const existing = getVoterId(request);
  if (existing) return { voterId: existing, cookie: null };
  const voterId = randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    voterId,
    cookie: `clipVoter=${voterId}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure}`,
  };
}

async function getCollections(env) {
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (!env.CLIP_MEDIA) throw new Error("The CLIP_MEDIA R2 binding is required.");

  if (!databaseConnection || databaseConnection.uri !== env.MONGODB_URI) {
    const client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    });
    const promise = client.connect().then(async () => {
      const database = client.db(env.MONGODB_DB || "zlote_korwinki");
      const clips = database.collection("clips");
      const votes = database.collection("clip_votes");
      await Promise.all([
        clips.createIndex({ category: 1, createdAt: -1 }),
        votes.createIndex({ clipId: 1, voterId: 1 }, { unique: true }),
        votes.createIndex({ clipId: 1 }),
      ]);
      return { clips, votes, client };
    }).catch(async (error) => {
      await client.close();
      if (databaseConnection?.promise === promise) databaseConnection = undefined;
      throw error;
    });
    databaseConnection = { uri: env.MONGODB_URI, promise };
  }

  const { clips, votes } = await databaseConnection.promise;
  return { clips, votes, media: env.CLIP_MEDIA };
}

function respondWithError(error) {
  if (error instanceof ValidationError) return json({ error: error.message }, 400);
  if (error?.code === 11000) {
    return json({ error: "Z tego urządzenia oddano już głos na ten klip." }, 409);
  }
  if (error instanceof TypeError && /form data|multipart/i.test(error.message)) {
    return json({ error: "Nieprawidłowy formularz zgłoszenia." }, 400);
  }
  console.error("Request failed.", error);
  return json({ error: "Wystąpił błąd serwera. Spróbuj ponownie później." }, 500);
}

export async function handleGetClips(request, env) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") || "";
  const pageValue = url.searchParams.get("page") ?? "0";
  const limitValue = url.searchParams.get("limit") ?? "20";
  const page = Number.parseInt(pageValue, 10);
  const limit = Number.parseInt(limitValue, 10);

  if (
    (category && !CATEGORIES.includes(category))
    || !Number.isInteger(page)
    || page < 0
    || page > 1000
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 50
  ) {
    return json({ error: category ? "Nieprawidłowa kategoria." : "Nieprawidłowe parametry strony." }, 400);
  }

  const voter = ensureVoterId(request);
  try {
    const { clips, votes } = await getCollections(env);
    const rows = await clips.aggregate([
      { $match: category ? { category } : {} },
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
    const voted = await votes.find(
      { voterId: voter.voterId, clipId: { $in: pageRows.map((clip) => clip._id) } },
      { projection: { clipId: 1 } },
    ).toArray();
    const votedIds = new Set(voted.map((vote) => vote.clipId.toString()));
    const response = json({
      clips: pageRows.map((clip) => ({
        id: clip._id.toString(),
        name: clip.name,
        caption: clip.caption,
        category: clip.category,
        videoUrl: clip.videoUrl,
        mediaType: clip.mediaType,
        mediaUrl: clip.mediaId ? `/api/media/${clip.mediaId.toString()}` : null,
        createdAt: clip.createdAt,
        votes: clip.votes,
        hasVoted: votedIds.has(clip._id.toString()),
      })),
      hasMore,
    });
    if (voter.cookie) response.headers.append("Set-Cookie", voter.cookie);
    return response;
  } catch (error) {
    return respondWithError(error);
  }
}

export async function handleSubmitClip(request, env) {
  let mediaId;
  let mediaStored = false;
  try {
    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Nieprawidłowy formularz zgłoszenia." }, 400);
    }
    const entry = form.get("media");
    const file = entry instanceof File && entry.name ? entry : null;
    if (file && file.size > maxUploadBytes) {
      return json({ error: "Plik jest większy niż limit 100 MB." }, 413);
    }
    if (file && !allowedMediaTypes.has(file.type)) {
      throw new ValidationError("Wybierz plik MP4, WebM, MOV, JPG, PNG lub WebP.");
    }

    const input = validateClipInput({
      name: form.get("name"),
      caption: form.get("caption"),
      gallery_category: form.get("gallery_category"),
      video_url: form.get("video_url"),
    }, Boolean(file));

    const { clips, media } = await getCollections(env);
    mediaId = file ? new ObjectId() : null;
    if (file) {
      await media.put(mediaId.toString(), file.stream(), {
        httpMetadata: { contentType: file.type },
      });
      mediaStored = true;
    }
    const result = await clips.insertOne({
      ...input,
      mediaId,
      mediaType: file?.type ?? null,
      createdAt: new Date(),
    });
    mediaStored = false;
    return json({ id: result.insertedId.toString() }, 201);
  } catch (error) {
    if (mediaStored && mediaId) {
      try {
        await env.CLIP_MEDIA.delete(mediaId.toString());
      } catch (cleanupError) {
        console.error("Failed to clean up media after submission failed.", cleanupError);
      }
    }
    return respondWithError(error);
  }
}

export async function handleGetMedia(_request, env, id) {
  if (!ObjectId.isValid(id)) return json({ error: "Nie znaleziono pliku." }, 404);
  try {
    if (!env.CLIP_MEDIA) throw new Error("The CLIP_MEDIA R2 binding is required.");
    const media = await env.CLIP_MEDIA.get(id);
    if (!media) return json({ error: "Nie znaleziono pliku." }, 404);
    return new Response(media.body, {
      headers: {
        "Content-Type": media.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(media.size),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function handleVote(request, env, id) {
  if (!ObjectId.isValid(id)) return json({ error: "Nie znaleziono klipu." }, 404);
  try {
    const { clips, votes } = await getCollections(env);
    const clipId = new ObjectId(id);
    const clip = await clips.findOne({ _id: clipId }, { projection: { _id: 1 } });
    if (!clip) return json({ error: "Nie znaleziono klipu." }, 404);

    const voter = ensureVoterId(request);
    await votes.insertOne({ clipId, voterId: voter.voterId, createdAt: new Date() });
    const count = await votes.countDocuments({ clipId });
    const response = json({ votes: count });
    if (voter.cookie) response.headers.append("Set-Cookie", voter.cookie);
    return response;
  } catch (error) {
    return respondWithError(error);
  }
}
