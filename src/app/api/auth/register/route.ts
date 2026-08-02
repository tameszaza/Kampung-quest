import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { hashPassword } from "@/server/identity/password";
import { registerSchema } from "@/server/identity/schemas";
import { startSession } from "@/server/identity/session";
import { defaultPreferences } from "@/server/identity/types";
import { errorResponse } from "@/server/http/responses";

export async function POST(request: Request) {
  try {
    const input = registerSchema.parse(await request.json());
    const user = await identityStore.createUser({
      fullName: input.fullName,
      email: input.email || null,
      phone: input.phone || null,
      passwordHash: await hashPassword(input.password),
      dateOfBirth: input.dateOfBirth || null,
      gender: input.gender || null,
      preferredLanguage: input.preferredLanguage,
      area: input.area || null,
      photoUrl: null,
      preferences: {
        ...defaultPreferences,
        interests: input.interests,
        groupSize: input.groupSize,
        activityLevel: input.activityLevel,
      },
    });
    await startSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

