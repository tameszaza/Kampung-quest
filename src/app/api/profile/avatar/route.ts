import { auth } from "@/lib/auth";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";
import { deleteAvatar, saveUploadedAvatar } from "@/server/profile/avatar-storage";
import { errorResponse } from "@/server/http/responses";
import { headers } from "next/headers";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) return Response.json({ error: "Choose a photo first" }, { status: 400 });
    const photoUrl = await saveUploadedAvatar(user.id, file);
    const updated = await identityStore.updatePhoto(user.id, photoUrl);
    await auth.api.updateUser({ headers: await headers(), body: { image: photoUrl } });
    return Response.json({ user: updated, photoUrl });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await deleteAvatar(user.id);
    const updated = await identityStore.updatePhoto(user.id, null);
    await auth.api.updateUser({ headers: await headers(), body: { image: null } });
    return Response.json({ user: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
