import { listRuns } from "$lib/runs.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  return { runs: listRuns() };
};
