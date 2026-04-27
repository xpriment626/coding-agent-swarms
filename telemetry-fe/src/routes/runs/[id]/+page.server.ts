import { error } from "@sveltejs/kit";
import { getRun } from "$lib/runs.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const run = getRun(params.id);
  if (!run) {
    throw error(404, `Run not found: ${params.id}`);
  }
  return { run };
};
