import { readAvatar } from "@/server/profile/avatar-storage";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { key } = await context.params;
    const image = await readAvatar(key);
    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Avatar not found" }, { status: 404 });
  }
}

