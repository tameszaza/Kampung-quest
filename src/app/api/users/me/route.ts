import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { preferenceUpdateSchema } from "@/server/identity/schemas";
import { profileUpdateSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json() as Record<string, unknown>;
    let nextUser = user;
    if ("fullName" in body || "phone" in body || "emergencyContact" in body) {
      const profile = profileUpdateSchema.parse({
        fullName: body.fullName ?? user.fullName,
        phone: body.phone === undefined ? user.phone ?? "" : body.phone,
        emergencyContact: body.emergencyContact === undefined ? user.emergencyContact : body.emergencyContact,
      });
      nextUser = await identityStore.updateProfile(user.id, {
        fullName: profile.fullName,
        phone: profile.phone || null,
        emergencyContact: profile.emergencyContact ? {
          name: profile.emergencyContact.name,
          relationship: profile.emergencyContact.relationship,
          phone: profile.emergencyContact.phone,
          email: profile.emergencyContact.email || null,
        } : null,
      });
    }
    const input = preferenceUpdateSchema.parse(body);
    const preferenceKeys = Object.keys(input);
    if (preferenceKeys.length) nextUser = await identityStore.updatePreferences(user.id, input);
    return NextResponse.json({ user: nextUser });
  } catch (error) {
    return errorResponse(error);
  }
}
