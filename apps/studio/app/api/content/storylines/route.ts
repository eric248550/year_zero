import { saveStoryline } from "@genesis/database";
import { db, handle, readJson } from "@/lib/server";

export async function POST(req: Request) {
  const body = await readJson(req);
  return handle(() => {
    const validation = saveStoryline(db(), body.storyline);
    return { saved: validation.valid, validation };
  });
}
