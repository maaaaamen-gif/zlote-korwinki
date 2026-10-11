import { handleGetMedia } from "../../_lib/api.js";

export function onRequestGet(context) {
  return handleGetMedia(context.request, context.env, context.params.id);
}
