# Złote Korwinki clip site

This app serves the site and its API from one Node.js service. Clip details and votes are stored in MongoDB; uploaded image/video files are stored in the same database using GridFS. External clip URLs are saved as links. The gallery shows new submissions immediately.

## Run locally

1. Install Node.js 20 or newer.
2. Create a MongoDB Atlas database user with read/write access to the app database, and allow the app host through Atlas Network Access.
3. Copy `.env.example` to `.env` and replace the placeholder `MONGODB_URI` with a newly rotated Atlas connection string. Never commit `.env` or place the URI in browser code.
4. Run `npm install`, `npm test`, then `npm start`.
5. Open [http://localhost:3000](http://localhost:3000).

The upload limit is 100 MB per file. Supported uploads are MP4, WebM, MOV, JPG, PNG, and WebP. Each visitor can vote once per clip per browser using an HTTP-only cookie; this is a basic anonymous limit, not identity verification.

Submitter email addresses are stored in MongoDB but are not returned by the public gallery API. Uploaded media is held in GridFS, so account storage and bandwidth limits apply.

## Publish

Deploy this repository to a Node.js host that supports a long-running web service. The included `render.yaml` configures a public Render web service; create it from the Render dashboard using **New → Blueprint** and select this repository. When prompted, enter `MONGODB_URI` as a secret environment variable. The blueprint sets `MONGODB_DB`, `NODE_ENV`, and `TRUST_PROXY` for the service.

Before deploying, create a MongoDB Atlas database user with read/write access to the app database and allow the Render service's outbound IP addresses in Atlas Network Access. Keep the MongoDB URI only in Render's environment-variable settings; never commit it or put it in browser code. After deployment, Render provides a public URL that anyone can use to submit clips and browse the gallery. Uploaded files are stored in MongoDB GridFS, so configure sufficient Atlas storage and bandwidth.

GitHub Pages cannot run this API or store uploaded files, so it cannot host the functional site by itself.

New submissions will be visible in the gallery as soon as they are saved. This replacement does not migrate the old Woobox submissions; import those separately from a Woobox export if needed.
