import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAuthUsernameAvailable } from "@/server/identity/auth-username";
import { identityStore } from "@/server/identity/container";
import { profileCompletionSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { importProviderAvatar } from "@/server/profile/avatar-storage";
import { errorResponse } from "@/server/http/responses";

type AuthUser = { id: string; name: string; email: string; image?: string | null; username?: string | null };

export async function POST(request: Request) {
  try {
    const profile = await requireUser();
    const input = profileCompletionSchema.parse(await request.json());
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) throw new Error("Authentication required");
    const authUser = session.user as AuthUser;
    const [authAvailability, appAvailable] = await Promise.all([
      isAuthUsernameAvailable(input.username, authUser.id),
      identityStore.isUsernameAvailable(input.username, profile.id),
    ]);
    if (!authAvailability || !appAvailable) throw new Error("That display name is already taken");

    let photoUrl = profile.photoUrl;
    if (!photoUrl?.startsWith("/api/profile/avatar/") && input.useProviderPhoto && authUser.image) {
      photoUrl = await importProviderAvatar(profile.id, authUser.image) ?? photoUrl;
    }
    if (!input.useProviderPhoto && !photoUrl?.startsWith("/api/profile/avatar/")) photoUrl = null;

    await auth.api.updateUser({
      headers: requestHeaders,
      body: {
        name: input.fullName,
        username: input.username,
        displayUsername: input.username,
        image: photoUrl,
      },
    });
    const user = await identityStore.completeProfile(profile.id, {
      fullName: input.fullName,
      username: input.username,
      phone: input.phone || null,
      dateOfBirth: input.dateOfBirth || null,
      gender: input.gender || null,
      preferredLanguage: input.preferredLanguage,
      area: input.area || null,
      photoUrl,
      preferences: {
        interests: input.interests,
        groupSize: input.groupSize,
        activityLevel: input.activityLevel,
      },
    });
    return Response.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
