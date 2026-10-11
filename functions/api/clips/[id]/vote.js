import { handleVote } from "../../../_lib/api.js";

export function onRequestPost(context) {
  return handleVote(context.request, context.env, context.params.id);
}
