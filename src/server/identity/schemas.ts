import { z } from "zod";

const optionalEmail = z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]).optional();
const optionalPhone = z.union([z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"), z.literal("")]).optional();

export const passwordSchema = z.string()
  .min(8, "Use at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Add at least one letter")
  .regex(/[0-9]/, "Add at least one number");

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  email: optionalEmail,
  phone: optionalPhone,
  password: passwordSchema,
  dateOfBirth: z.union([z.string().date(), z.literal("")]).optional(),
  gender: z.union([z.enum(["Female", "Male", "Prefer not to say"]), z.literal("")]).optional(),
  preferredLanguage: z.string().trim().min(2).max(50).default("English"),
  area: z.string().trim().max(100).optional(),
  interests: z.array(z.string().trim().min(1).max(50)).max(12).default([]),
  groupSize: z.enum(["one-to-one", "small", "any"]).default("small"),
  activityLevel: z.enum(["gentle", "moderate", "any"]).default("gentle"),
}).superRefine((value, context) => {
  if (!value.email?.trim() && !value.phone?.trim()) {
    context.addIssue({ code: "custom", path: ["email"], message: "Add an email or phone number" });
  }
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your email or phone number").max(150),
  password: z.string().min(1, "Enter your password").max(128),
  rememberMe: z.boolean().default(true),
});

export const preferenceUpdateSchema = z.object({
  preferredLanguage: z.string().trim().min(2).max(50).optional(),
  area: z.string().trim().max(100).nullable().optional(),
  interests: z.array(z.string().trim().min(1).max(50)).max(12).optional(),
  groupSize: z.enum(["one-to-one", "small", "any"]).optional(),
  activityLevel: z.enum(["gentle", "moderate", "any"]).optional(),
  accessibilityNeeds: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  textSize: z.enum(["large", "extra-large"]).optional(),
  highContrast: z.boolean().optional(),
  messageNotifications: z.boolean().optional(),
  questNotifications: z.boolean().optional(),
});

export const createConversationSchema = z.object({
  type: z.enum(["direct", "group"]),
  participantIds: z.array(z.string().trim().min(1)).min(1).max(30),
  title: z.string().trim().min(2).max(100).optional(),
}).superRefine((value, context) => {
  if (value.type === "direct" && value.participantIds.length !== 1) {
    context.addIssue({ code: "custom", path: ["participantIds"], message: "Choose one person for a direct message" });
  }
  if (value.type === "group" && !value.title) {
    context.addIssue({ code: "custom", path: ["title"], message: "Give your group a name" });
  }
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Write a message first").max(2000, "Keep messages under 2,000 characters"),
});
