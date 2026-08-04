import { readQuestImage } from "@/server/quest/quest-image-storage-route";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { key } = await context.params;
    const image = await readQuestImage(key);
    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Quest image not found" }, { status: 404 });
  }
}
