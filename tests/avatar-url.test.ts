import { describe, expect, it } from "vitest";
import { isLocalAvatarUrl } from "@/lib/avatar-url";

describe("avatar URL classification", () => {
  it("bypasses Next image optimization only for the app avatar route", () => {
    expect(isLocalAvatarUrl("/api/profile/avatar/6aa44dc9d0c2dc64425232a5b4337912?v=1")).toBe(true);
    expect(isLocalAvatarUrl("/assets/profile-maria.jpg")).toBe(false);
    expect(isLocalAvatarUrl("https://lh3.googleusercontent.com/avatar")).toBe(false);
    expect(isLocalAvatarUrl(null)).toBe(false);
  });
});
