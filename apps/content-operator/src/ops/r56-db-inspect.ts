import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient } from "@ai-affiliate/database";

async function main() {
  const c = loadConfig();
  const db = createDatabaseClient();
  await db.connect();
  const analysis = await db.prisma.analysisRun.count({ where: { status: "COMPLETED" } });
  const items = await db.prisma.researchItem.findMany({
    include: { images: true },
  });
  const pubs = await db.prisma.publicationTarget.count({
    where: { platform: "BLOGGER", status: "PUBLISHED" },
  });
  const xpubs = await db.prisma.xPublication.count({ where: { status: "PUBLISHED" } });
  const candidates = await db.prisma.contentCandidate.count();
  console.log(
    JSON.stringify(
      {
        analysisCompleted: analysis,
        contentCandidates: candidates,
        blogPublished: pubs,
        xPublished: xpubs,
        bloggerDirect: c.bloggerAllowDirectPublish,
        items: items.map((i) => ({
          externalId: i.externalId,
          images: i.images.length,
          hasDesc: Boolean(i.description),
          hasAf: Boolean(i.url && /af_id|affiliate_id/.test(i.url)),
        })),
      },
      null,
      2,
    ),
  );
  await db.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
