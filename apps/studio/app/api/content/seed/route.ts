import { loadContentDir } from "@genesis/narrative/node";
import { importSeedContent } from "@genesis/database";
import { contentDir, db, handle } from "@/lib/server";

export async function POST() {
  return handle(() => {
    const content = loadContentDir(contentDir());
    if (content.problems.length) throw new Error(`Seed content failed validation: ${content.problems.map((p) => p.file).join(", ")}`);
    return importSeedContent(db(), content);
  });
}
