import { handleGetClips, handleSubmitClip } from "../_lib/api.js";

export function onRequestGet(context) {
  return handleGetClips(context.request, context.env);
}

export function onRequestPost(context) {
  return handleSubmitClip(context.request, context.env);
}
